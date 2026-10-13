"""owner name

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-13 20:11:43.307049

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("settings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "full_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=""
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("settings", schema=None) as batch_op:
        batch_op.drop_column("full_name")
