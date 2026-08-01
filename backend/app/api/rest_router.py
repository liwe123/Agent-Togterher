from fastapi import APIRouter

from app.api.v1.endpoints.agents import router as agents_router
from app.api.v1.endpoints.conversations import router as conversations_router
from app.api.v1.endpoints.messages import router as messages_router
from app.api.v1.endpoints.models import router as models_router
from app.api.v1.endpoints.provider_keys import router as provider_keys_router
from app.api.v1.endpoints.tasks import router as tasks_router
from app.api.v1.endpoints.workspaces import router as workspaces_router
from app.schemas import ErrorResponse

rest_api_router = APIRouter(
    responses={
        404: {"model": ErrorResponse, "description": "Resource not found"},
        409: {"model": ErrorResponse, "description": "Resource conflict"},
        422: {"model": ErrorResponse, "description": "Validation error"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    }
)
rest_api_router.include_router(workspaces_router)
rest_api_router.include_router(agents_router)
rest_api_router.include_router(conversations_router)
rest_api_router.include_router(messages_router)
rest_api_router.include_router(tasks_router)
rest_api_router.include_router(models_router)
rest_api_router.include_router(provider_keys_router)
