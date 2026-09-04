"""Agent tool registry and safe tool handlers for the function-calling loop.

Tools are declared as JSON Schema and dispatched through ``execute_tool``.
Handlers never raise for model-facing errors; every failure is converted into
an error string the model can read and react to.

Plugin tools (declarative webhook tools registered through the plugin
registry) are merged into the Function Calling spec at runtime and dispatched
through an extensible executor hook. See ``register_plugin_tool_executor`` for
the execution boundary: since C-183 a process-wide webhook executor
(``app/services/webhook.py``) is installed at startup and performs the actual
outbound HTTP calls; per-plugin executors registered here still take
precedence, and without any executor a plugin tool yields an honest
"not implemented" error string instead of a fake result.
"""

from __future__ import annotations

import ast
import json
from collections.abc import Awaitable, Callable

from sqlalchemy import select


def _const_value(node: ast.AST) -> float | None:
    """Return the numeric value of a literal node, or None if not a constant."""
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    return None


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
        # Guard against billion-scale exponent DoS (e.g. 9**9**9) before eval.
        # Only the exponent needs to be constant and bounded: a non-constant
        # exponent (e.g. 9**(9**9)) is the blow-up path, while a bounded constant
        # exponent keeps the result finite (final value is also capped at 1e12).
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
            exp = _const_value(node.right)
            if exp is None:
                raise ValueError("unsupported exponent")
            if abs(exp) > 64:
                raise ValueError("exponent too large")
    value = eval(compile(tree, "<calc>", "eval"), {"__builtins__": {}}, {})
    if abs(value) > 1e12:
        raise ValueError("result too large")
    return float(value)


async def _tool_calculate(*, session, expression: str) -> str:
    try:
        return str(safe_eval_expression(expression))
    except Exception as exc:
        return f"Calculate failed: {exc}"


async def _tool_query_tasks(
    *, session, workspace_id: int, status: str | None = None, limit: int = 10
) -> str:
    from app.models import Task
    stmt = (
        select(Task)
        .where(Task.workspace_id == workspace_id)
        .order_by(Task.id.desc())
        .limit(max(1, min(limit, 50)))
    )
    if status:
        stmt = stmt.where(Task.status == status)
    rows = (await session.scalars(stmt)).all()
    items = [{"id": t.id, "status": t.status.value if hasattr(t.status, "value") else t.status, "title": (t.title or "")[:80], "result": (t.result or "")[:120]} for t in rows]
    return json.dumps(items, ensure_ascii=False, default=str)


async def _tool_get_agents(*, session, workspace_id: int) -> str:
    from app.models import Agent
    stmt = select(Agent).where(Agent.workspace_id == workspace_id)
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
            "description": "List configured agents in the current workspace.",
            "parameters": {"type": "object", "properties": {}}, 
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


# ---------------------------------------------------------------------------
# Plugin tools: runtime discovery, spec injection, and executor hook.
# ---------------------------------------------------------------------------

PluginToolExecutor = Callable[..., Awaitable[str]]

_PLUGIN_TOOL_EXECUTORS: dict[str, PluginToolExecutor] = {}

_PLUGIN_TYPE_CHECKS = {
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "array": lambda v: isinstance(v, list),
    "object": lambda v: isinstance(v, dict),
}


def register_plugin_tool_executor(
    plugin_name: str, executor: PluginToolExecutor
) -> None:
    """Register the executor for every tool exposed by a plugin.

    The executor is called as ``executor(record=..., arguments=...,
    workspace_id=..., session=...)`` and must return a string. This is the
    extensibility boundary for actually running plugin tools: without an
    executor the service refuses to fabricate a result.
    """
    _PLUGIN_TOOL_EXECUTORS[plugin_name] = executor


def unregister_plugin_tool_executor(plugin_name: str) -> None:
    _PLUGIN_TOOL_EXECUTORS.pop(plugin_name, None)


# C-183: process-wide fallback executor. Installed once at startup (API
# lifespan and worker) by ``webhook.register_webhook_executor``; per-plugin
# registrations above still win, so custom executors remain possible.
_GLOBAL_PLUGIN_TOOL_EXECUTOR: PluginToolExecutor | None = None


def register_global_plugin_tool_executor(executor: PluginToolExecutor) -> None:
    """Register the process-wide executor used when a plugin has no own one."""
    global _GLOBAL_PLUGIN_TOOL_EXECUTOR
    _GLOBAL_PLUGIN_TOOL_EXECUTOR = executor


async def _default_plugin_tool_executor(
    *, record: dict, arguments: dict, workspace_id: int, session
) -> str:
    return (
        f"Plugin tool '{record['name']}' of plugin '{record['plugin_name']}' has no "
        "executor registered; outbound webhook execution is not implemented by this service"
    )


def _parameters_to_schema(parameters) -> dict:
    """Normalize a plugin tool ``parameters`` block into a JSON Schema object.

    Accepts a full JSON Schema (``{"type": "object", "properties": ...}``), a
    flat name->type map (``{"repo": "string"}``), or a name->descriptor map
    (``{"repo": {"type": "string", "description": ..., "required": true}}``).
    """
    if not isinstance(parameters, dict):
        return {"type": "object", "properties": {}}
    if parameters.get("type") == "object" and isinstance(
        parameters.get("properties"), dict
    ):
        return parameters
    properties: dict[str, dict] = {}
    required: list[str] = []
    for key, value in parameters.items():
        if isinstance(value, dict):
            prop = {"type": value.get("type", "string")}
            if value.get("description"):
                prop["description"] = value["description"]
            properties[key] = prop
            if value.get("required"):
                required.append(key)
        elif isinstance(value, str):
            properties[key] = {"type": value}
    schema: dict = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def _validate_plugin_arguments(args: dict, parameters) -> str | None:
    schema = _parameters_to_schema(parameters)
    props = schema.get("properties", {}) if isinstance(schema, dict) else {}
    for key, value in args.items():
        if key not in props:
            continue
        prop = props[key] if isinstance(props[key], dict) else {}
        expected = prop.get("type", "string")
        check = _PLUGIN_TYPE_CHECKS.get(expected)
        if check is not None and not check(value):
            return f"Plugin tool argument '{key}' must be of type '{expected}'"
    return None


async def load_active_plugin_tools(session, workspace_id: int | None) -> list[dict]:
    """Load the normalized tool records of every plugin enabled in a workspace.

    Built-in tool names and duplicate plugin tool names are skipped (first
    enabled plugin wins), keeping the merged spec collision-free.
    """
    if session is None or workspace_id is None:
        return []
    from app.models import Plugin, WorkspacePlugin

    query = (
        select(WorkspacePlugin, Plugin)
        .join(Plugin, WorkspacePlugin.plugin_id == Plugin.id)
        .where(
            WorkspacePlugin.workspace_id == workspace_id,
            WorkspacePlugin.is_enabled.is_(True),
        )
        .order_by(WorkspacePlugin.id.asc())
    )
    rows = (await session.execute(query)).all()
    seen = set(_TOOL_HANDLERS)
    records: list[dict] = []
    for wp, plugin in rows:
        try:
            manifest = json.loads(plugin.manifest_json)
        except Exception:
            continue
        config: dict = {}
        if wp.config_json:
            try:
                config = json.loads(wp.config_json)
            except Exception:
                config = {}
        base_url = manifest.get("base_url")
        manifest_secret = manifest.get("secret")
        for raw_tool in manifest.get("tools", []):
            if not isinstance(raw_tool, dict):
                continue
            tool_name = raw_tool.get("name")
            if not tool_name or tool_name in seen:
                continue
            seen.add(tool_name)
            records.append(
                {
                    "name": tool_name,
                    "description": raw_tool.get("description") or "",
                    "parameters": raw_tool.get("parameters") or {},
                    "plugin_name": plugin.name,
                    "base_url": base_url,
                    "endpoint": raw_tool.get("endpoint"),
                    "method": raw_tool.get("method") or "POST",
                    # C-183: outbound-call hardening. Secret precedence:
                    # tool-level > manifest-level > workspace config.
                    "headers": raw_tool.get("headers") or {},
                    "secret": raw_tool.get("secret") or manifest_secret,
                    "config": config,
                }
            )
    return records


def build_plugin_tool_specs(plugin_tools: list[dict]) -> list[dict]:
    """Convert normalized plugin tool records into Function Calling specs."""
    specs = []
    for tool in plugin_tools:
        description = tool.get("description") or (
            f"Plugin tool '{tool['name']}' from plugin '{tool['plugin_name']}'"
        )
        specs.append(
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": description,
                    "parameters": _parameters_to_schema(tool.get("parameters", {})),
                },
            }
        )
    return specs


async def get_workspace_tools_spec(session, workspace_id: int | None) -> list[dict]:
    """Return the built-in specs merged with the workspace's plugin tool specs."""
    plugin_tools = await load_active_plugin_tools(session, workspace_id)
    return get_tools_spec() + build_plugin_tool_specs(plugin_tools)


async def execute_plugin_tool(
    record: dict, arguments: str, *, session, workspace_id: int | None = None
) -> str:
    """Execute one plugin tool call through the registered executor hook.

    Security guarantees shared with built-in tools: the trusted ``workspace_id``
    is never taken from model arguments, arguments are validated against the
    declared parameter types, and any failure becomes an error string instead
    of interrupting the calling task loop.
    """
    name = record.get("name", "<plugin-tool>")
    try:
        args = json.loads(arguments) if arguments and arguments.strip() else {}
        if not isinstance(args, dict):
            return f"Plugin tool '{name}' arguments must be a JSON object"
        args.pop("workspace_id", None)
        if workspace_id is None:
            return f"Plugin tool '{name}' requires a workspace context"
        type_error = _validate_plugin_arguments(args, record.get("parameters", {}))
        if type_error:
            return type_error
        executor = (
            _PLUGIN_TOOL_EXECUTORS.get(record.get("plugin_name"))
            or _GLOBAL_PLUGIN_TOOL_EXECUTOR
            or _default_plugin_tool_executor
        )
        return await executor(
            record=record,
            arguments=args,
            workspace_id=workspace_id,
            session=session,
        )
    except Exception as exc:
        return f"Plugin tool '{name}' failed: {exc}"


async def execute_tool(
    name: str,
    arguments: str,
    *,
    session,
    workspace_id: int | None = None,
    plugin_tools: list[dict] | None = None,
) -> str:
    """Dispatch a tool call with a trusted workspace execution context."""
    try:
        handler = _TOOL_HANDLERS.get(name)
        if handler is not None:
            args = json.loads(arguments) if arguments and arguments.strip() else {}
            if not isinstance(args, dict):
                return f"Tool '{name}' arguments must be a JSON object"
            args.pop("workspace_id", None)
            if name in {"query_tasks", "get_agents"}:
                if workspace_id is None:
                    return f"Tool '{name}' requires a workspace context"
                args["workspace_id"] = workspace_id
            return await handler(session=session, **args)

        active_plugin_tools = plugin_tools
        if active_plugin_tools is None:
            active_plugin_tools = await load_active_plugin_tools(session, workspace_id)
        record = next((t for t in active_plugin_tools if t.get("name") == name), None)
        if record is None:
            return f"Unknown tool: {name}"
        return await execute_plugin_tool(
            record, arguments, session=session, workspace_id=workspace_id
        )
    except Exception as exc:
        return f"Tool '{name}' failed: {exc}"


__all__ = [
    "TOOL_SPECS",
    "build_plugin_tool_specs",
    "execute_plugin_tool",
    "execute_tool",
    "get_tools_spec",
    "get_workspace_tools_spec",
    "load_active_plugin_tools",
    "register_global_plugin_tool_executor",
    "register_plugin_tool_executor",
    "safe_eval_expression",
    "unregister_plugin_tool_executor",
]
