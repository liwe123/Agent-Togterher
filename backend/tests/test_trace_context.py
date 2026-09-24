from types import SimpleNamespace

from app.core.trace_context import (
    inherit_from_task,
    new_correlation_id,
    new_trace_id,
    stamp_new_message,
    stamp_task,
)


def _is_lower_hex(value: object) -> bool:
    if not isinstance(value, str) or len(value) != 32:
        return False
    if value != value.lower():
        return False
    try:
        int(value, 16)
    except ValueError:
        return False
    return True


def test_new_ids_are_lowercase_hex() -> None:
    assert _is_lower_hex(new_trace_id())
    assert _is_lower_hex(new_correlation_id())


def test_new_ids_are_unique() -> None:
    assert new_trace_id() != new_trace_id()
    assert new_correlation_id() != new_correlation_id()


def test_stamp_new_message_assigns_correlation_only() -> None:
    message = SimpleNamespace()
    stamp_new_message(message)
    assert _is_lower_hex(message.correlation_id)
    assert message.trace_id is None


def test_stamp_task_inherits_correlation_and_mints_trace() -> None:
    message = SimpleNamespace(correlation_id="corr-abc", trace_id=None)
    task = SimpleNamespace()
    stamp_task(task, source_message=message)
    assert task.correlation_id == "corr-abc"
    assert _is_lower_hex(task.trace_id)


def test_inherit_from_task_propagates_both_ids() -> None:
    task = SimpleNamespace(trace_id="trace-1", correlation_id="corr-1")
    child = SimpleNamespace()
    inherit_from_task(child, task)
    assert child.trace_id == "trace-1"
    assert child.correlation_id == "corr-1"
