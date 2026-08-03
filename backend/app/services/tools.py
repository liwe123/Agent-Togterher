"""Agent tool registry and safe tool handlers for the function-calling loop.

Tools are declared as JSON Schema and dispatched through ``execute_tool``.
Handlers never raise for model-facing errors; every failure is converted into
an error string the model can read and react to.
"""

from __future__ import annotations

import ast
import json

from sqlalchemy import select


def safe_eval_expression(expression: str) -> float:
    """Evaluate a math expression using an AST whitelist. Never eval()."""
    tree = ast.parse(expression, mode="eval")
    allowed = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Add, ast.Sub,
               ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
               ast.UAdd, ast.USub, ast.Constant)
    for node in ast.walk(tree):
        if not isinstance(node, allowed):
            raise ValueError("unsupported expression")
        if isinstance(node, ast.Constant) and not isinstance(node.value, (int, float)):
            raise ValueError("unsupported literal")
    value = eval(compile(tree, "<calc>", "eval"), {"__builtins__": {}}, {})
    if abs(value) > 1e12:
        raise ValueError("result too large")
    return float(value)


async def _tool_calculate(*, session, expression: str) -> str:
    try:
        return str(safe_eval_expression(expression))
    except Exception as exc:
        return f"Calculate failed: {exc}"


async def _tool_query_tasks(*, session, status: str | None = None, limit: int = 10) -> str:
    from app.models import Task
    stmt = select(Task).order_by(Task.id.desc()).limit(max(1, min(limit, 50)))
    if status:
        stmt = stmt.where(Task.status == status)
    rows = (await session.scalars(stmt)).all()
    items = [{"id": t.id, "status": t.status.value if hasattr(t.status, "value") else t.status, "title": (t.title or "")[:80], "result": (t.result or "")[:120]} for t in rows]
    return json.dumps(items, ensure_ascii=False, default=str)


async def _tool_get_agents(*, session, workspace_id: int | None = None) -> str:
    from app.models import Agent
    stmt = select(Agent)
    if workspace_id:
        stmt = stmt.where(Agent.workspace_id == workspace_id)
    rows = (await session.scalars(stmt)).all()
    items = [{"id": a.id, "name": a.name, "role": a.role, "status": a.status, "model": a.model_name} for a in rows]
    return json.dumps(items, ensure_ascii=False, default=str)


async def _tool_system_status(*, session, **kwargs) -> str:
    from app.services import litellm_service
    providers = ["openai", "anthropic", "gemini", "deepseek", "qwen", "dashscope"]
    status = {p: litellm_service.is_provider_configured(p) for p in providers}
    return json.dumps({"status": "ok", "providers_configured": status}, ensure_ascii=False)


TOOL_SPECS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "Evaluate a safe arithmetic expression (numbers, + - * / // % ** ( )).",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "math expression"},
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_tasks",
            "description": "Query persisted tasks by optional status.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": ["pending", "running", "completed", "failed"]},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_agents",
            "description": "List configured agents, optionally filtered by workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "workspace_id": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_system_status",
            "description": "Return backend provider configuration status.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

_TOOL_HANDLERS = {
    "calculate": _tool_calculate,
    "query_tasks": _tool_query_tasks,
    "get_agents": _tool_get_agents,
    "get_system_status": _tool_system_status,
}


def get_tools_spec() -> list[dict]:
    return list(TOOL_SPECS)


async def execute_tool(name: str, arguments: str, *, session) -> str:
    """Dispatch a tool call. NEVER raises for model-facing errors."""
    try:
        handler = _TOOL_HANDLERS.get(name)
        if handler is None:
            return f"Unknown tool: {name}"
        args = json.loads(arguments) if arguments and arguments.strip() else {}
        if not isinstance(args, dict):
            return f"Tool '{name}' arguments must be a JSON object"
        return await handler(session=session, **args)
    except Exception as exc:
        return f"Tool '{name}' failed: {exc}"


__all__ = [
    "TOOL_SPECS",
    "execute_tool",
    "get_tools_spec",
    "safe_eval_expression",
]
