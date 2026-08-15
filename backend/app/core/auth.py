import hashlib
import hmac
import os
import time
from datetime import datetime, timezone

import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.user import User

# Password hashing using PBKDF2-SHA256 (stdlib, no external dependency)
_HASH_ITERATIONS = 260_000
_SALT_LENGTH = 32


def hash_password(password: str) -> str:
    """Hash a password with PBKDF2-SHA256 and a random salt."""
    salt = os.urandom(_SALT_LENGTH)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _HASH_ITERATIONS)
    return f"{salt.hex()}${key.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a password against a stored PBKDF2-SHA256 hash."""
    try:
        salt_hex, key_hex = stored_hash.split("$", 1)
        salt = bytes.fromhex(salt_hex)
        expected_key = bytes.fromhex(key_hex)
    except (ValueError, IndexError):
        return False
    candidate_key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _HASH_ITERATIONS)
    return hmac.compare_digest(candidate_key, expected_key)


# JWT token management
ACCESS_TOKEN_EXPIRE_MINUTES = 15
REFRESH_TOKEN_EXPIRE_DAYS = 7


def _get_secret_key() -> str:
    settings = get_settings()
    secret = getattr(settings, "jwt_secret_key", None)
    if secret:
        value = secret.get_secret_value() if hasattr(secret, "get_secret_value") else str(secret)
        if value.strip():
            return value.strip()
    # Fallback: derive from app_api_token or use a default (development only)
    if settings.app_api_token:
        return f"jwt-{settings.app_api_token.get_secret_value()}"
    return "agent-console-dev-secret-change-in-production"


def create_access_token(user_id: int) -> str:
    """Create a short-lived access token."""
    now = time.time()
    payload = {
        "sub": str(user_id),
        "type": "access",
        "iat": now,
        "exp": now + ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }
    return jwt.encode(payload, _get_secret_key(), algorithm="HS256")


def create_refresh_token(user_id: int) -> str:
    """Create a long-lived refresh token."""
    now = time.time()
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "iat": now,
        "exp": now + REFRESH_TOKEN_EXPIRE_DAYS * 86400,
    }
    return jwt.encode(payload, _get_secret_key(), algorithm="HS256")


def decode_token(token: str) -> dict | None:
    """Decode and validate a JWT token. Returns payload or None."""
    try:
        payload = jwt.decode(token, _get_secret_key(), algorithms=["HS256"])
        return payload
    except jwt.PyJWTError:
        return None


def get_user_id_from_token(token: str, expected_type: str = "access") -> int | None:
    """Extract user_id from a valid token of the expected type."""
    payload = decode_token(token)
    if payload is None:
        return None
    if payload.get("type") != expected_type:
        return None
    try:
        return int(payload["sub"])
    except (KeyError, ValueError, TypeError):
        return None


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    """Find a user by email address."""
    result = await session.scalar(select(User).where(User.email == email))
    return result


async def get_user_by_id(session: AsyncSession, user_id: int) -> User | None:
    """Find a user by ID."""
    result = await session.get(User, user_id)
    return result


async def authenticate_user(session: AsyncSession, email: str, password: str) -> User | None:
    """Authenticate a user by email and password."""
    user = await get_user_by_email(session, email)
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user
