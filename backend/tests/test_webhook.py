"""Tests for the plugin webhook executor and outbound notifications (C-183).

Covers ``app/services/webhook.py``:

- HMAC-SHA256 request signing correctness (and absence without a secret).
- Timeout / connection-error / non-2xx behaviour under the never-raise
  contract, including bounded retry.
- Executor URL resolution and model-facing result formatting.
- Task-terminal notification fan-out to workspace plugin webhooks.
"""

from __future__ import annotations

import hashlib
import hmac
import json

import httpx
import pytest

from app.models import Plugin, Workspace, WorkspacePlugin  # noqa: F401 — populate Base.metadata before db fixtures create tables
from app.services import tools as tools_service
from app.services import webhook


def _mock_transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


class TestSignBody:
    def test_signature_matches_hmac_sha256(self) -> None:
        body = b'{"hello": "world"}'
        secret = "top-secret"
        expected = "sha256=" + hmac.new(
            secret.encode(), body, hashlib.sha256
        ).hexdigest()
        assert webhook.sign_body(body, secret) == expected

    def test_signature_is_deterministic_and_body_bound(self) -> None:
        assert webhook.sign_body(b"a", "s") == webhook.sign_body(b"a", "s")
        assert webhook.sign_body(b"a", "s") != webhook.sign_body(b"b", "s")
        assert webhook.sign_body(b"a", "s") != webhook.sign_body(b"a", "t")


@pytest.mark.asyncio
class TestCallWebhook:
    async def test_success_returns_status_and_text(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text="pong")

        status, text = await webhook.call_webhook(
            "https://example.test/hook",
            transport=_mock_transport(handler),
        )
        assert status == 200
        assert text == "pong"

    async def test_signature_header_present_with_secret(self) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["signature"] = request.headers.get(webhook.SIGNATURE_HEADER)
            captured["body"] = request.content
            return httpx.Response(200, text="ok")

        body = b"payload-bytes"
        await webhook.call_webhook(
            "https://example.test/hook",
            body=body,
            secret="s3cret",
            transport=_mock_transport(handler),
        )
        assert captured["signature"] == webhook.sign_body(body, "s3cret")

    async def test_no_signature_header_without_secret(self) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["signature"] = request.headers.get(webhook.SIGNATURE_HEADER)
            return httpx.Response(200, text="ok")

        await webhook.call_webhook(
            "https://example.test/hook",
            transport=_mock_transport(handler),
        )
        assert captured["signature"] is None

    async def test_custom_headers_forwarded(self) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["auth"] = request.headers.get("Authorization")
            return httpx.Response(200, text="ok")

        await webhook.call_webhook(
            "https://example.test/hook",
            headers={"Authorization": "Bearer abc"},
            transport=_mock_transport(handler),
        )
        assert captured["auth"] == "Bearer abc"

    async def test_non_2xx_does_not_raise_and_is_returned(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, text="not found")

        status, text = await webhook.call_webhook(
            "https://example.test/hook",
            transport=_mock_transport(handler),
        )
        assert status == 404
        assert "not found" in text

    async def test_connection_error_never_raises(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("boom")

        status, text = await webhook.call_webhook(
            "https://example.test/hook",
            transport=_mock_transport(handler),
        )
        assert status is None
        assert "failed" in text

    async def test_timeout_never_raises(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectTimeout("slow")

        status, text = await webhook.call_webhook(
            "https://example.test/hook",
            timeout=0.05,
            transport=_mock_transport(handler),
        )
        assert status is None
        assert "failed" in text

    async def test_server_error_retries_then_succeeds(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(webhook, "RETRY_BASE_DELAY_SECONDS", 0.0)
        calls = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            if calls["n"] < 3:
                return httpx.Response(500, text="oops")
            return httpx.Response(200, text="recovered")

        status, text = await webhook.call_webhook(
            "https://example.test/hook",
            transport=_mock_transport(handler),
        )
        assert status == 200
        assert text == "recovered"
        assert calls["n"] == 3

    async def test_client_error_not_retried(self) -> None:
        calls = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            return httpx.Response(400, text="bad request")

        status, _ = await webhook.call_webhook(
            "https://example.test/hook",
            transport=_mock_transport(handler),
        )
        assert status == 400
        assert calls["n"] == 1


class TestResolveToolUrl:
    def test_absolute_endpoint_wins(self) -> None:
        assert (
            webhook.resolve_tool_url(
                {"base_url": "https://a.test", "endpoint": "https://b.test/x"}
            )
            == "https://b.test/x"
        )

    def test_relative_endpoint_joined_to_base_url(self) -> None:
        assert (
            webhook.resolve_tool_url(
                {"base_url": "https://a.test/api/", "endpoint": "/query"}
            )
            == "https://a.test/api/query"
        )

    def test_none_when_missing(self) -> None:
        assert webhook.resolve_tool_url({"endpoint": "/only-path"}) is None


@pytest.mark.asyncio
class TestPluginWebhookExecutor:
    async def test_returns_http_status_and_text(self, monkeypatch) -> None:
        captured: dict = {}

        async def fake_call(url, **kwargs):
            captured["url"] = url
            captured["method"] = kwargs.get("method")
            captured["body"] = kwargs.get("body")
            captured["secret"] = kwargs.get("secret")
            return 200, '{"ok": true}'

        monkeypatch.setattr(webhook, "call_webhook", fake_call)
        result = await webhook.plugin_webhook_executor(
            record={
                "name": "query_ticket",
                "base_url": "https://ext.test/api",
                "endpoint": "tickets",
                "method": "post",
                "headers": {"Authorization": "Bearer t"},
                "secret": "s",
                "config": {},
            },
            arguments={"ticket_id": 7},
            workspace_id=1,
        )
        assert result == 'HTTP 200: {"ok": true}'
        assert captured["url"] == "https://ext.test/api/tickets"
        assert captured["method"] == "POST"
        assert json.loads(captured["body"]) == {"ticket_id": 7}
        assert captured["secret"] == "s"

    async def test_missing_endpoint_reports_error(self) -> None:
        result = await webhook.plugin_webhook_executor(
            record={"name": "nope", "config": {}},
            arguments={},
            workspace_id=1,
        )
        assert "no endpoint" in result

    async def test_failure_returns_error_string(self, monkeypatch) -> None:
        async def fake_call(url, **kwargs):
            return None, "webhook request failed: ConnectError"

        monkeypatch.setattr(webhook, "call_webhook", fake_call)
        result = await webhook.plugin_webhook_executor(
            record={"name": "t", "base_url": "https://x.test", "config": {}},
            arguments={},
            workspace_id=1,
        )
        assert "failed" in result
        assert "ConnectError" in result

    async def test_global_executor_used_by_tools_registry(
        self, monkeypatch
    ) -> None:
        """register_webhook_executor wires the executor into tools.execute_plugin_tool."""
        async def fake_call(url, **kwargs):
            return 200, "done"

        monkeypatch.setattr(webhook, "call_webhook", fake_call)
        webhook.register_webhook_executor()
        try:
            result = await tools_service.execute_plugin_tool(
                {
                    "name": "hook_tool",
                    "plugin_name": "ext-plugin",
                    "base_url": "https://ext.test",
                    "endpoint": "run",
                    "parameters": {},
                    "config": {},
                },
                "{}",
                session=None,
                workspace_id=1,
            )
            assert result == "HTTP 200: done"
        finally:
            tools_service._GLOBAL_PLUGIN_TOOL_EXECUTOR = None


@pytest.mark.asyncio
class TestNotifyWorkspaceWebhooks:
    async def test_delivers_to_configured_webhook_only(
        self, db_session, monkeypatch
    ) -> None:
        workspace = Workspace(name="ws-notify")
        db_session.add(workspace)
        await db_session.flush()

        plugin_on = Plugin(
            name="notifier",
            display_name="Notifier",
            manifest_json=json.dumps({"secret": "manifest-secret"}),
        )
        plugin_off = Plugin(name="quiet", display_name="Quiet", manifest_json="{}")
        db_session.add_all([plugin_on, plugin_off])
        await db_session.flush()

        db_session.add_all(
            [
                WorkspacePlugin(
                    workspace_id=workspace.id,
                    plugin_id=plugin_on.id,
                    is_enabled=True,
                    config_json=json.dumps(
                        {"webhook_url": "https://hooks.test/on", "webhook_secret": "ws"}
                    ),
                ),
                WorkspacePlugin(
                    workspace_id=workspace.id,
                    plugin_id=plugin_off.id,
                    is_enabled=False,
                    config_json=json.dumps(
                        {"webhook_url": "https://hooks.test/off"}
                    ),
                ),
            ]
        )
        await db_session.commit()

        delivered_urls: list[str] = []

        async def fake_call(url, **kwargs):
            delivered_urls.append(url)
            assert kwargs.get("secret") == "ws"
            return 200, "ok"

        monkeypatch.setattr(webhook, "call_webhook", fake_call)
        count = await webhook.notify_workspace_webhooks(
            db_session, workspace.id, {"event": "task.terminal"}
        )
        assert count == 1
        assert delivered_urls == ["https://hooks.test/on"]

    async def test_no_config_means_zero_requests(self, db_session, monkeypatch) -> None:
        workspace = Workspace(name="ws-plain")
        db_session.add(workspace)
        await db_session.commit()

        async def fail_call(url, **kwargs):  # pragma: no cover — must not run
            raise AssertionError("webhook should not be called")

        monkeypatch.setattr(webhook, "call_webhook", fail_call)
        count = await webhook.notify_workspace_webhooks(
            db_session, workspace.id, {"event": "task.terminal"}
        )
        assert count == 0
