"""Backward-compatible adapter for the phase 3 model test service."""

from app.services.litellm_service import LiteLLMUnavailableError
from app.services.litellm_service import ModelCallError
from app.services.litellm_service import chat_completion

ModelServiceUnavailableError = LiteLLMUnavailableError
ModelTestError = ModelCallError


async def test_model_connection(model_name: str, prompt: str) -> tuple[str, int]:
    result = await chat_completion(
        model_name,
        [{"role": "user", "content": prompt}],
    )
    return result.content, result.latency_ms
