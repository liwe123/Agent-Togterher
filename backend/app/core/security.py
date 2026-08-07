import hmac

from fastapi import Request, WebSocket

from app.core.config import get_settings


def _configured_token() -> str | None:
    secret = get_settings().app_api_token
    if secret is None:
        return None
    value = secret.get_secret_value().strip()
    return value or None


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


def request_token(request: Request) -> str | None:
    return _bearer_token(request.headers.get("authorization")) or request.headers.get(
        "x-api-key"
    )


def websocket_token(websocket: WebSocket) -> str | None:
    return (
        _bearer_token(websocket.headers.get("authorization"))
        or websocket.headers.get("x-api-key")
        or websocket.query_params.get("token")
    )


def token_required() -> bool:
    return _configured_token() is not None


def token_is_valid(candidate: str | None) -> bool:
    expected = _configured_token()
    if expected is None:
        return True
    return candidate is not None and hmac.compare_digest(candidate, expected)
