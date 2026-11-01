"""群聊多 Agent 接力：tasks 新增 relay_agent_ids_json

Revision ID: d5e6f7a8b9c0
Revises: c2d3e4f5a6b7
Create Date: 2026-11-01 11:00:00.000000

PRD-群聊多Agent接力协作 FR1：接力任务把按棒次排序的 Agent id 序列化后写入
tasks.relay_agent_ids_json（NULL 表示普通任务）。SQLite 与 PG 均使用
batch_alter_table 保证加列/删列兼容，downgrade 完整回滚。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.add_column(
            sa.Column("relay_agent_ids_json", sa.Text(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.drop_column("relay_agent_ids_json")
