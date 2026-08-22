"""Unit tests for bridge task-package metadata (P2).

Verifies that ``prepare_task`` writes acceptance criteria / allowed paths /
test command / budget / dependencies into ``task.json``, renders structured
PROMPT.md sections, and keeps legacy output when no metadata is provided.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from app.services.bridge import BaseBridge


class DummyBridge(BaseBridge):
    async def execute(self, task):
        raise NotImplementedError


@pytest.fixture
def bridge(tmp_path, monkeypatch) -> DummyBridge:
    fake = MagicMock()
    fake.bridge_root_dir = str(tmp_path)
    monkeypatch.setattr("app.services.bridge.get_settings", lambda: fake)
    return DummyBridge(workspace_id=1, node_name="codex-test")


def test_prepare_task_without_metadata_keeps_legacy_format(bridge: DummyBridge) -> None:
    prepared = bridge.prepare_task(1, "标题", "描述内容")

    task_json = json.loads(prepared.task_json_path.read_text(encoding="utf-8"))
    assert task_json == {
        "task_id": 1,
        "title": "标题",
        "description": "描述内容",
        "workspace_id": 1,
        "node_name": "codex-test",
    }
    assert prepared.prompt_path.read_text(encoding="utf-8") == "# 标题\n\n描述内容\n"
    assert prepared.acceptance_criteria is None
    assert prepared.test_command is None


def test_prepare_task_with_metadata_writes_package(bridge: DummyBridge) -> None:
    prepared = bridge.prepare_task(
        7,
        "重构登录页",
        "按规范重构",
        acceptance_criteria=["构建通过", "lint 零告警"],
        allowed_paths=["frontend/src/pages/login"],
        test_command="npm run build",
        budget_seconds=600,
        budget_turns=20,
        dependencies=["5"],
    )

    task_json = json.loads(prepared.task_json_path.read_text(encoding="utf-8"))
    assert task_json["acceptance_criteria"] == ["构建通过", "lint 零告警"]
    assert task_json["allowed_paths"] == ["frontend/src/pages/login"]
    assert task_json["test_command"] == "npm run build"
    assert task_json["budget_seconds"] == 600
    assert task_json["budget_turns"] == 20
    assert task_json["dependencies"] == ["5"]

    prompt = prepared.prompt_path.read_text(encoding="utf-8")
    assert "# 重构登录页" in prompt
    assert "## 验收条件" in prompt
    assert "- [ ] 构建通过" in prompt
    assert "- [ ] lint 零告警" in prompt
    assert "## 路径约束" in prompt
    assert "frontend/src/pages/login" in prompt
    assert "## 验证命令" in prompt
    assert "`npm run build`" in prompt

    assert prepared.acceptance_criteria == ("构建通过", "lint 零告警")
    assert prepared.allowed_paths == ("frontend/src/pages/login",)
    assert prepared.test_command == "npm run build"
    assert prepared.budget_seconds == 600
    assert prepared.budget_turns == 20
    assert prepared.dependencies == ("5",)


def test_prompt_without_test_command_requires_criteria_response(
    bridge: DummyBridge,
) -> None:
    prepared = bridge.prepare_task(
        9, "任务", "描述", acceptance_criteria=["条件A"]
    )
    prompt = prepared.prompt_path.read_text(encoding="utf-8")
    assert "逐条回应" not in prompt

    prepared = bridge.prepare_task(
        10, "任务", "描述", acceptance_criteria=["条件A"], test_command="pytest -q"
    )
    prompt = prepared.prompt_path.read_text(encoding="utf-8")
    assert "逐条回应" in prompt
