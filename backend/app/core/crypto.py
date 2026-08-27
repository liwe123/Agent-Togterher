"""Envelope encryption for provider API keys.

Uses Fernet (AES-128-CBC + HMAC-SHA256) from `cryptography` for authenticated
encryption. The master key is derived from the application JWT secret via
PBKDF2 so the encryption key is not the raw JWT secret itself. Stored values
carry a `v1:` prefix; legacy plaintext values (no prefix) are returned
unchanged for backward compatibility.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.auth import _get_secret_key

_PREFIX = "v1:"
_KDF_SALT = b"agent-console-provider-key-v1"
_KDF_ITERATIONS = 100_000

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        master = _get_secret_key().encode("utf-8")
        key = hashlib.pbkdf2_hmac(
            "sha256", master, _KDF_SALT, _KDF_ITERATIONS, dklen=32
        )
        _fernet = Fernet(base64.urlsafe_b64encode(key))
    return _fernet


def is_encrypted(stored: str) -> bool:
    return stored.startswith(_PREFIX)


def encrypt_api_key(plaintext: str) -> str:
    """Encrypt an API key, returning a `v1:`-prefixed Fernet token."""
    token = _get_fernet().encrypt(plaintext.encode("utf-8"))
    return _PREFIX + token.decode("ascii")


def decrypt_api_key(stored: str) -> str:
    """Decrypt a stored API key.

    Legacy plaintext values (no `v1:` prefix) are returned unchanged. Raises
    ``ValueError`` if an encrypted value cannot be decrypted (master key
    changed or data corrupted).
    """
    if not is_encrypted(stored):
        return stored
    try:
        plaintext = _get_fernet().decrypt(stored[len(_PREFIX):].encode("ascii"))
    except (InvalidToken, ValueError) as exc:
        raise ValueError(
            "无法解密已加密的 Provider API Key（主密钥可能已变更或数据损坏）"
        ) from exc
    return plaintext.decode("utf-8")


__all__ = ["decrypt_api_key", "encrypt_api_key", "is_encrypted"]
