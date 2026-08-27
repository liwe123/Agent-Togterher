"""Tests for provider API key envelope encryption (C-165)."""
from __future__ import annotations

import pytest

from app.core import crypto
from app.models import ProviderCredential
from app.services import litellm_service


def test_encrypt_produces_v1_prefix_and_hides_plaintext():
    token = crypto.encrypt_api_key("sk-secret-1234567890")
    assert token.startswith("v1:")
    assert "sk-secret-1234567890" not in token


def test_encrypt_decrypt_roundtrip():
    assert crypto.decrypt_api_key(crypto.encrypt_api_key("sk-abc")) == "sk-abc"


def test_is_encrypted_prefix_detection():
    assert crypto.is_encrypted("v1:xxxx") is True
    assert crypto.is_encrypted("sk-plaintext") is False


def test_decrypt_legacy_plaintext_passthrough():
    assert crypto.decrypt_api_key("sk-legacy-plaintext") == "sk-legacy-plaintext"


def test_decrypt_corrupted_token_raises():
    with pytest.raises(ValueError):
        crypto.decrypt_api_key("v1:not-a-valid-fernet-token")


@pytest.mark.asyncio
async def test_get_db_api_keys_decrypts_and_passes_plaintext(db_session):
    db_session.add(
        ProviderCredential(provider="deepseek", api_key=crypto.encrypt_api_key("sk-enc-1"))
    )
    db_session.add(ProviderCredential(provider="openai", api_key="sk-plain-2"))
    await db_session.commit()

    keys = await litellm_service.get_db_api_keys(db_session)
    assert keys["deepseek"] == "sk-enc-1"
    assert keys["openai"] == "sk-plain-2"


@pytest.mark.asyncio
async def test_get_db_api_keys_skips_undecryptable(db_session):
    db_session.add(ProviderCredential(provider="deepseek", api_key="v1:corrupted"))
    db_session.add(ProviderCredential(provider="openai", api_key="sk-ok"))
    await db_session.commit()

    keys = await litellm_service.get_db_api_keys(db_session)
    assert "deepseek" not in keys
    assert keys["openai"] == "sk-ok"
