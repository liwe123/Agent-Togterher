from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.errors import install_error_handlers
from app.api.rest_router import rest_api_router
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.security import request_token, token_is_valid, token_required
from app.db.session import close_db, init_db
from app.websocket import build_event_relay, websocket_manager
from app.websocket.router import router as websocket_router

settings = get_settings()
_event_relay = build_event_relay(websocket_manager, settings.worker_instance_id, settings.event_bus_enabled)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await init_db()
    # C-183: install the real plugin webhook executor (idempotent).
    from app.services.webhook import register_webhook_executor

    register_webhook_executor()
    from app.db.seed import seed_defaults
    from app.db.session import AsyncSessionLocal
    from app.core.message_hub import recover_unfinished_tasks
    from app.services.integration_service import recover_orphan_integration_steps

    await _event_relay.start()
    async with AsyncSessionLocal() as session:
        await seed_defaults(session)
        await recover_orphan_integration_steps(session)
        if settings.task_execution_mode == "inline":
            await recover_unfinished_tasks(session)
    yield
    await _event_relay.stop()
    await close_db()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def authenticate_api_request(request: Request, call_next):
    public_paths = {
        "/", 
        f"{settings.api_v1_prefix}/health", 
        "/docs", 
        "/openapi.json",
        f"{settings.api_v1_prefix}/auth/register",
        f"{settings.api_v1_prefix}/auth/login",
        f"{settings.api_v1_prefix}/auth/refresh"
    }
    if (
        token_required()
        and request.url.path not in public_paths
        and not request.url.path.startswith("/docs/")
    ):
        from app.core.auth import get_user_id_from_token as jwt_user_id
        req_token = request_token(request)
        is_valid = token_is_valid(req_token)  # API token check
        if not is_valid and req_token:
            # Try JWT validation
            is_valid = jwt_user_id(req_token) is not None
            
        if not is_valid:
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": "Authentication required"},
                headers={"WWW-Authenticate": "Bearer"},
            )
    return await call_next(request)


install_error_handlers(app)
app.include_router(api_router, prefix=settings.api_v1_prefix)
app.include_router(rest_api_router, prefix="/api")
app.include_router(websocket_router)


@app.get("/", tags=["root"])
async def root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "docs": "/docs",
        "health": f"{settings.api_v1_prefix}/health",
    }
