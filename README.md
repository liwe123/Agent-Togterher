# Agent Console

Agent Console is a local-first multi-agent collaboration dashboard. It combines a
Next.js frontend, a FastAPI backend, SQLite persistence, LiteLLM model routing,
and workspace-scoped WebSocket events so a user can chat with agents, dispatch
tasks, observe execution, and inspect model-call traces.

The project is an MVP for a coordinated agent workspace rather than a marketing
site. The first screen is the operational console: agent status, chat, task
execution, model settings, and contact-style agent directory views.

## Features

- Multi-agent dashboard with seeded roles:
  - Project Architect
  - Agent Engineer
  - Frontend Designer
  - Knowledge Manager
  - QA Engineer
  - Operations Engineer
- Chat workflow with `@Agent` mentions and automatic task creation.
- Task execution lifecycle:
  - `pending`
  - `running`
  - `completed`
  - `failed`
- Single-agent execution path for directly assigned work.
- Manager-led multi-agent workflow:
  - manager planning
  - worker execution
  - QA review
  - final summary
- LiteLLM-backed model abstraction with provider fallback.
- Workspace-scoped WebSocket events for messages, tasks, steps, agent status,
  model calls, and errors.
- SQLite persistence with startup schema creation and idempotent seed data.
- Recovery hardening for unfinished tasks after process restart.
- Fallback failure persistence when the active SQLAlchemy session becomes
  invalid during task failure handling.
- Frontend data guards for non-standard API error responses.
- Basic frontend unit tests using Node's built-in test runner.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js App Router, React, TypeScript, Tailwind CSS, shadcn-style UI primitives |
| Backend | FastAPI, Python, SQLAlchemy asyncio, Pydantic |
| Database | SQLite with `aiosqlite` |
| Model calls | LiteLLM |
| Realtime | WebSocket |
| Local orchestration | Docker Compose |
| Tests | pytest, Node test runner, ESLint, Next production build |

## Repository Layout

```text
.
|-- backend/
|   |-- app/
|   |   |-- agents/        # Manager, worker, reviewer, and final-agent prompts
|   |   |-- api/           # REST endpoints and error wrappers
|   |   |-- core/          # MessageHub, orchestrator, config
|   |   |-- db/            # Async session, schema init, seed data
|   |   |-- models/        # SQLAlchemy models
|   |   |-- schemas/       # Pydantic request/response schemas
|   |   |-- services/      # LiteLLM integration
|   |   `-- websocket/     # Workspace WebSocket routing and manager
|   `-- tests/             # Backend pytest suite
|-- config/
|   `-- models.yaml        # Model aliases and fallback configuration
|-- docs/
|   |-- api-examples.md
|   `-- websocket.md
|-- frontend/
|   |-- src/app/           # Next.js routes
|   |-- src/components/    # Console, chat, task, settings, contact UI
|   |-- src/hooks/         # Data loading and WebSocket hooks
|   |-- src/lib/           # API client and frontend helpers
|   |-- src/types/         # Frontend TypeScript models
|   `-- tests/             # Node test runner tests
|-- docker-compose.yml
|-- .env.example
`-- HANDOFF.md
```

## Quick Start With Docker

Prerequisites:

- Docker Desktop
- Git

```powershell
Set-Location E:\Agents
Copy-Item .env.example .env
docker compose up --build
```

Open:

- Frontend: http://localhost:3000
- Backend docs: http://localhost:8000/docs
- Health check: http://localhost:8000/api/v1/health

The backend creates the SQLite schema and seed data on startup.

## Local Development

### Backend

```powershell
Set-Location E:\Agents\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

Open a second terminal:

```powershell
Set-Location E:\Agents\frontend
npm install
npm run dev
```

Open http://localhost:3000.

## Environment Variables

Start from `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_NAME` | `Agent Console API` | Backend service name |
| `APP_ENV` | `development` | Runtime environment |
| `API_V1_PREFIX` | `/api/v1` | Health/versioned API prefix |
| `CORS_ORIGINS` | localhost and 127.0.0.1 frontend origins | Allowed browser origins |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Frontend-to-backend API URL |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/agent_console.db` | Backend database URL |
| `REDIS_URL` | `redis://localhost:6379/0` | Local Redis URL reserved for queue/cache work |
| `COMPOSE_REDIS_URL` | `redis://redis:6379/0` | Docker-internal Redis URL |
| `MODELS_CONFIG_PATH` | `config/models.yaml` | LiteLLM model alias config |
| `MODEL_REQUEST_TIMEOUT_SECONDS` | `60` | Per-provider model-call timeout |
| `OPENAI_API_KEY` | empty | Optional OpenAI credential |
| `ANTHROPIC_API_KEY` | empty | Optional Anthropic credential |
| `GEMINI_API_KEY` | empty | Optional Gemini credential |
| `DEEPSEEK_API_KEY` | empty | Optional DeepSeek credential |
| `DASHSCOPE_API_KEY` | empty | Optional DashScope credential |
| `QWEN_API_KEY` | empty | Optional Qwen credential |

Keep real credentials in `.env` only. Do not commit `.env`.

## Model Configuration

Model aliases are defined in `config/models.yaml`. Agents store a model alias such
as `manager_model`, `code_model`, `review_model`, or `writing_model`. The backend
resolves the alias through LiteLLM and follows the configured fallback chain when
the primary provider is missing credentials, times out, or returns an error.

If all provider attempts fail, the failure is stored in `model_calls`, surfaced to
the task, and sent to connected WebSocket clients.

## API And Realtime Events

Stable health endpoint:

```text
GET /api/v1/health
```

Business endpoints are mounted under `/api`, including:

- `/api/workspaces`
- `/api/agents`
- `/api/conversations`
- `/api/conversations/{conversation_id}/messages`
- `/api/tasks`
- `/api/tasks/{task_id}`
- `/api/tasks/{task_id}/run`
- `/api/models`
- `/api/models/test`

Workspace WebSocket route:

```text
ws://localhost:8000/ws/workspaces/{workspace_id}
```

Important event types:

- `message.created`
- `task.status_changed`
- `task.step_changed`
- `agent.status_changed`
- `model.call_finished`
- `error`

## Testing

Run backend checks:

```powershell
Set-Location E:\Agents\backend
python -m compileall -q app tests
python -m pytest -q
```

Run frontend checks:

```powershell
Set-Location E:\Agents\frontend
npm test
npm run lint
npm run build
```

Known local note: on this Windows environment, pytest can emit temporary
directory cleanup warnings such as `WinError 145` after successful test runs. The
important signal is the command exit code and pytest pass count.

## Current Hardening

Recent robustness work includes:

- Bounded list loading for tasks, messages, and conversations.
- Stale WebSocket event guards on the frontend.
- Observable background task dispatch.
- Atomic `pending -> running` task claims.
- Model-call timeout handling.
- Startup recovery for unfinished `pending` and interrupted `running` tasks.
- Fallback failure persistence when the active task execution session is invalid.
- Safer frontend API error normalization for non-envelope error bodies.
- Workspace-aligned Agent Console loading and WebSocket subscription.

## GitHub Publishing

This repository currently has no configured Git remote. To publish manually after
creating a GitHub repository:

```powershell
Set-Location E:\Agents
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

If you prefer GitHub CLI:

```powershell
winget install --id GitHub.cli
gh auth login
gh repo create agent-console --private --source=. --remote=origin --push
```

Use `--public` instead of `--private` only if the code and configuration are safe
to publish publicly.

## Roadmap

- Add Alembic migrations before schema changes become frequent.
- Replace in-process background dispatch with a durable Redis-backed worker
  queue.
- Add Redis Pub/Sub or another shared event bus for multi-process WebSocket
  broadcasts.
- Add retry/review loops for worker output that fails QA review.
- Expand frontend tests around chat, task updates, and WebSocket reducers.

## License

No license has been selected yet. Add one before publishing this repository
publicly.
