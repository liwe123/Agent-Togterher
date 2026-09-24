"""add trace/correlation fields to messages, tasks, task_steps, model_calls

Revision ID: c2d3e4f5a6b7
Revises: b7c9d1e3f5a7
Create Date: 2026-09-24 22:30:00.000000

R-05: 为链路追踪补独立字段——correlation_id（用户意图级）与 trace_id（任务
执行链级）。SQLite 加列统一走 batch_alter_table 以保证与 PG 双兼容。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, None] = 'b7c9d1e3f5a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TABLES = ("messages", "tasks", "task_steps", "model_calls")


def upgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.add_column(sa.Column("trace_id", sa.String(length=36), nullable=True))
            batch_op.add_column(
                sa.Column("correlation_id", sa.String(length=36), nullable=True)
            )
            batch_op.create_index(f"ix_{table}_trace_id", ["trace_id"])
            batch_op.create_index(f"ix_{table}_correlation_id", ["correlation_id"])


def downgrade() -> None:
    for table in reversed(_TABLES):
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_index(f"ix_{table}_correlation_id")
            batch_op.drop_index(f"ix_{table}_trace_id")
            batch_op.drop_column("correlation_id")
            batch_op.drop_column("trace_id")
