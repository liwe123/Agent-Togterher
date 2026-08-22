"""task status waiting_approval varchar widen

Revision ID: f788539de554
Revises: 5291a2a7e49d
Create Date: 2026-08-22 11:35:51.970662

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f788539de554'
down_revision: Union[str, None] = '5291a2a7e49d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.alter_column(
            "status",
            existing_type=sa.VARCHAR(length=9),
            type_=sa.Enum(
                "pending",
                "running",
                "waiting_approval",
                "completed",
                "failed",
                "cancelled",
                name="task_status_enum",
                native_enum=False,
                create_constraint=False,
                validate_strings=True,
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.alter_column(
            "status",
            existing_type=sa.Enum(
                "pending",
                "running",
                "waiting_approval",
                "completed",
                "failed",
                "cancelled",
                name="task_status_enum",
                native_enum=False,
                create_constraint=False,
                validate_strings=True,
            ),
            type_=sa.VARCHAR(length=9),
        )
