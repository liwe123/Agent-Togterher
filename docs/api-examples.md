# REST API curl examples

Start the backend on `http://localhost:8000`, then run these PowerShell commands. All write examples assume the created workspace, agent, conversation, message, and task receive ID `1`; replace IDs when necessary.

```powershell
$base = "http://localhost:8000"

# Workspace
curl.exe "$base/api/workspaces"
curl.exe -X POST "$base/api/workspaces" -H "Content-Type: application/json" -d '{"name":"Demo","description":"Demo workspace"}'
curl.exe "$base/api/workspaces/1"

# Agent
curl.exe "$base/api/agents?workspace_id=1"
curl.exe -X POST "$base/api/agents" -H "Content-Type: application/json" -d '{"workspace_id":1,"name":"Agent工程师","role":"agent_engineer","model_name":"code_model","system_prompt":"实现可靠的后端能力。"}'
curl.exe "$base/api/agents/1"
curl.exe -X PATCH "$base/api/agents/1" -H "Content-Type: application/json" -d '{"status":"busy"}'
curl.exe "$base/api/agents/1/status"

# Conversation and message
curl.exe "$base/api/conversations?workspace_id=1"
curl.exe -X POST "$base/api/conversations" -H "Content-Type: application/json" -d '{"workspace_id":1,"title":"Demo chat"}'
curl.exe "$base/api/conversations/1"
curl.exe "$base/api/conversations/1/messages"
curl.exe -X POST "$base/api/conversations/1/messages" -H "Content-Type: application/json" -d '{"sender_type":"user","content":"@Agent工程师 实现后端 API"}'
curl.exe -X POST "$base/api/conversations/1/messages" -H "Content-Type: application/json" -d '{"sender_type":"user","content":"@项目总设计师 实现响应式管理页面、配套 API，并给出 Docker 部署方案"}'

# Task
curl.exe "$base/api/tasks?workspace_id=1"
curl.exe -X POST "$base/api/tasks" -H "Content-Type: application/json" -d '{"workspace_id":1,"conversation_id":1,"title":"Demo task","assigned_agent_id":1,"input_message_id":1}'
curl.exe "$base/api/tasks/1"
curl.exe -X POST "$base/api/tasks/1/run"
curl.exe -X PATCH "$base/api/tasks/1" -H "Content-Type: application/json" -d '{"status":"completed","result":"Done"}'

# Model
curl.exe "$base/api/models"
curl.exe -X POST "$base/api/models/test" -H "Content-Type: application/json" -d '{"workspace_id":1,"model_name":"code_model","prompt":"Reply with OK."}'
```

`model_name` 可使用 `config/models.yaml` 中的 `manager_model`、`code_model`、`writing_model`、`review_model`、`cheap_model`，也可直接使用 LiteLLM 的 `provider/model` 名称。成功响应包含 `content`、`usage`、`provider`、实际 `model_name`、`latency_ms` 和 `fallback_used`。

用户消息成功后，`data` 同时包含 `message`、自动创建的 `task` 和 `assigned_agent`。若消息没有有效的 Agent 提及，工作区必须存在名为“项目总设计师”的默认 Agent。

`POST /api/tasks/{task_id}/run` 仅接受 `pending` 任务，并在当前请求内同步执行。成功响应中的任务状态为 `completed`，模型文本同时写入 `tasks.result` 和原会话的 Agent 消息；模型失败时任务状态为 `failed`，错误会写入任务结果、步骤、模型调用日志和原会话错误消息。重复运行非 `pending` 任务返回 HTTP 409。

当任务分配给“项目总设计师”时，同一运行接口会自动执行 Manager → Worker → Review → Final。群聊依次收到任务拆解、每个 Worker 结果、测试专员审核和最终汇总；每个阶段都记录任务步骤，每次模型调用都记录模型日志。

`GET /api/tasks` 会在每个任务中返回 `assigned_agent` 摘要。`GET /api/tasks/{task_id}` 返回任务聚合详情：`original_input`、`task_steps`、每一步的 `agent`、`model_calls`、汇总后的 `token_usage` 和 `duration_ms`。步骤同时返回各自的 `duration_ms`，模型调用同时返回 `total_tokens`、`latency_ms` 和 `error_message`。

Interactive OpenAPI documentation is available at `http://localhost:8000/docs`.
