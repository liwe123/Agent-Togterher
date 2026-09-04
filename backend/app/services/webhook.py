"""Outbound webhook service for plugin tool execution and task notifications.

C-183 (PRD-插件Webhook执行器与出站通知). Two responsibilities:

1. ``call_webhook`` — the single outbound HTTP primitive: httpx request with
   HMAC-SHA256 request signing, hard timeout, bounded retry, and a strict
   never-raise contract (every failure is logged and returned as a readable
   string so plugin tool loops and status notifications can never break the
   calling task flow).
2. ``plugin_webhook_executor`` — the real executor behind the plugin tool
   registry hook (replacing the "not implemented" placeholder), plus
   ``_notify_task_terminal`` support helpers for task-terminal notifications.

Security notes:
    - The secret is used exclusively for signing; it is never logged and
      never appears in model-facing results.
    - The signature covers the full raw body, so receivers can verify
      integrity with ``hmac.new(secret, body, hashlib.sha256)``.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger("app.services.webhook")

SIGNATURE_HEADER = "X-Webhook-Signature"
DEFAULT_TIMEOUT_SECONDS = 10.0
# Bounded retry: at most 2 extra attempts for network errors / 5xx.
MAX_ATTEMPTS = 3
RETRY_BASE_DELAY_SECONDS = 0.5


def sign_body(body: bytes, secret: str) -> str:
    """Return the ``sha256=<hex>`` HMAC-SHA256 signature of a raw body."""
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def _is_retryable(status_code: int) -> bool:
    return status_code >= 500


async def call_webhook(
    url: str,
    *,
    method: str = "POST",
    headers: dict[str, str] | None = None,
    body: bytes | str | None = None,
    secret: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[int | None, str]:
    """Send one outbound webhook request. Never raises.

    Returns ``(status_code, text)``. On failure ``status_code`` is ``None``
    and ``text`` is a short, secret-free error description. Network errors
    and 5xx responses are retried up to ``MAX_ATTEMPTS`` with exponential
    backoff; 4xx and other non-2xx responses are returned as-is (no retry).
    """
    if isinstance(body, str):
        body = body.encode("utf-8")
    request_headers: dict[str, str] = dict(headers or {})
    if body is None:
        body = b""
    if secret:
        request_headers[SIGNATURE_HEADER] = sign_body(body, secret)

    last_error: str = "unknown webhook failure"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
                response = await asyncio.wait_for(
                    client.request(
                        method.upper(),
                        url,
                        headers=request_headers,
                        content=body,
                    ),
                    timeout=timeout + 5.0,
                )
            if 200 <= response.status_code < 300:
                text = response.text
                return response.status_code, text[:20000]
            last_error = f"HTTP {response.status_code}: {response.text[:500]}"
            if not _is_retryable(response.status_code):
                logger.warning(
                    "Webhook call to %s returned non-2xx: %s", url, last_error
                )
                return response.status_code, last_error
        except asyncio.TimeoutError:
            last_error = f"webhook timeout after {timeout}s"
        except Exception as exc:  # noqa: BLE001 — never-raise contract
            last_error = f"webhook request failed: {type(exc).__name__}"
        logger.warning(
            "Webhook attempt %d/%d to %s failed: %s",
            attempt,
            MAX_ATTEMPTS,
            url,
            last_error,
        )
        if attempt < MAX_ATTEMPTS:
            await asyncio.sleep(RETRY_BASE_DELAY_SECONDS * (2 ** (attempt - 1)))
    return None, last_error


def resolve_tool_url(record: dict[str, Any]) -> str | None:
    """Resolve the outbound URL for a plugin tool record.

    ``endpoint`` may be an absolute URL or a path joined onto ``base_url``.
    """
    endpoint = record.get("endpoint")
    base_url = record.get("base_url")
    if endpoint and str(endpoint).startswith(("http://", "https://")):
        return str(endpoint)
    if base_url and endpoint:
        return str(base_url).rstrip("/") + "/" + str(endpoint).lstrip("/")
    if base_url and not endpoint:
        return str(base_url)
    return None


async def plugin_webhook_executor(
    *,
    record: dict,
    arguments: dict,
    workspace_id: int,
    session=None,
) -> str:
    """Execute one plugin tool as an outbound webhook call.

    Registered as the global plugin tool executor at startup (main + worker).
    Mirrors built-in tool guarantees: never raises, returns model-readable
    strings, and never echoes the secret.
    """
    name = record.get("name", "<plugin-tool>")
    url = resolve_tool_url(record)
    if not url:
        return f"Plugin tool '{name}' has no endpoint or base_url configured"
    config = record.get("config") or {}
    headers = dict(record.get("headers") or {})
    config_headers = config.get("headers")
    if isinstance(config_headers, dict):
        for key, value in config_headers.items():
            headers.setdefault(str(key), str(value))
    secret = (
        record.get("secret")
        or config.get("webhook_secret")
        or None
    )
    body = json.dumps(arguments or {}, ensure_ascii=False).encode("utf-8")
    status, text = await call_webhook(
        url,
        method=(record.get("method") or "POST").upper(),
        headers=headers,
        body=body,
        secret=secret,
    )
    if status is None:
        return f"Plugin tool '{name}' failed: {text}"
    return f"HTTP {status}: {text}"


def register_webhook_executor() -> None:
    """Install the webhook executor as the global plugin tool executor.

    Idempotent: safe to call from both the API lifespan and the worker
    startup (each process registers exactly one executor for itself).
    """
    from app.services.tools import register_global_plugin_tool_executor

    register_global_plugin_tool_executor(plugin_webhook_executor)
    logger.info("Plugin webhook executor registered")


async def notify_workspace_webhooks(
    session,
    workspace_id: int,
    payload: dict[str, Any],
) -> int:
    """POST a terminal-task payload to every enabled workspace plugin webhook.

    Targets come from ``workspace_plugins.config_json.webhook_url``. Signing
    uses ``config_json.webhook_secret`` when present. Returns the number of
    targets that acknowledged with a 2xx. Never raises.
    """
    if session is None or workspace_id is None:
        return 0
    from sqlalchemy import select

    from app.models import Plugin, WorkspacePlugin

    query = (
        select(WorkspacePlugin, Plugin)
        .join(Plugin, WorkspacePlugin.plugin_id == Plugin.id)
        .where(
            WorkspacePlugin.workspace_id == workspace_id,
            WorkspacePlugin.is_enabled.is_(True),
        )
    )
    rows = (await session.execute(query)).all()
    delivered = 0
    body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
    for wp, plugin in rows:
        config: dict = {}
        if wp.config_json:
            try:
                config = json.loads(wp.config_json)
            except Exception:
                config = {}
        url = config.get("webhook_url")
        if not url:
            continue
        secret = config.get("webhook_secret")
        manifest_secret = None
        try:
            manifest = json.loads(plugin.manifest_json)
            manifest_secret = manifest.get("secret")
        except Exception:
            pass
        status, _ = await call_webhook(
            str(url),
            method="POST",
            body=body,
            secret=secret or manifest_secret,
        )
        if status is not None and 200 <= status < 300:
            delivered += 1
        else:
            logger.warning(
                "Task notification to plugin '%s' webhook failed (workspace %s)",
                plugin.name,
                workspace_id,
            )
    return delivered


__all__ = [
    "SIGNATURE_HEADER",
    "call_webhook",
    "notify_workspace_webhooks",
    "plugin_webhook_executor",
    "register_webhook_executor",
    "resolve_tool_url",
    "sign_body",
]
