"""add workflow_runs and task_step dag fields

Revision ID: b7c9d1e3f5a7
Revises: a1b2c3d4e5f6
Create Date: 2026-09-04 10:00:00.000000

C-185: DAG 工作流引擎——新建 workflow_runs 运行记录表，
task_steps 增加 node_id / dependencies_json / order_index 三列。
SQLite 加列/删列统一走 batch_alter_table 以保证与 PG 双兼容。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c9d1e3f5a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workflow_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "template_id",
            sa.Integer(),
            sa.ForeignKey("workflow_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("snapshot_nodes_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_workflow_runs_template_id", "workflow_runs", ["template_id"])
    op.create_index("ix_workflow_runs_task_id", "workflow_runs", ["task_id"])
    op.create_index("ix_workflow_runs_status", "workflow_runs", ["status"])

    with op.batch_alter_table("task_steps") as batch_op:
        batch_op.add_column(sa.Column("node_id", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("dependencies_json", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("order_index", sa.Integer(), nullable=True))
        batch_op.create_index("ix_task_steps_node_id", ["node_id"])


def downgrade() -> None:
    with op.batch_alter_table("task_steps") as batch_op:
        batch_op.drop_index("ix_task_steps_node_id")
        batch_op.drop_column("order_index")
        batch_op.drop_column("dependencies_json")
        batch_op.drop_column("node_id")

    op.drop_index("ix_workflow_runs_status", table_name="workflow_runs")
    op.drop_index("ix_workflow_runs_task_id", table_name="workflow_runs")
    op.drop_index("ix_workflow_runs_template_id", table_name="workflow_runs")
    op.drop_table("workflow_runs")
