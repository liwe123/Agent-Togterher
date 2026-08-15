from fastapi import APIRouter

from app.api.v1.endpoints.audit_logs import router as audit_logs_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.cost_stats import router as cost_stats_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.plugins import router as plugins_router
from app.api.v1.endpoints.quota import router as quota_router
from app.api.v1.endpoints.task_replay import router as task_replay_router
from app.api.v1.endpoints.workflows import router as workflows_router
from app.api.v1.endpoints.workspace_members import router as workspace_members_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(workspace_members_router)
api_router.include_router(audit_logs_router)
api_router.include_router(cost_stats_router)
api_router.include_router(quota_router)
api_router.include_router(task_replay_router)
api_router.include_router(plugins_router)
api_router.include_router(workflows_router)
