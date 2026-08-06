from typing import Any, Literal, TypedDict

from fastapi.encoders import jsonable_encoder

EventType = Literal[
    "message.created",
    "agent.status_changed",
    "task.status_changed",
    "task.step_changed",
    "model.call_finished",
    "error",
]


class WebSocketEvent(TypedDict):
    type: EventType
    payload: Any


def create_event(event_type: EventType, payload: Any) -> WebSocketEvent:
    """Build a JSON-safe workspace event with the shared wire format."""
    return {
        "type": event_type,
        "payload": jsonable_encoder(payload),
    }
