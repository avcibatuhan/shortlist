"""run stats and prefilter reason

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-13 12:23:47.113893

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Server defaults fill the rows of runs that already exist.
    with op.batch_alter_table("job", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("filter_reason", sqlmodel.sql.sqltypes.AutoString(), nullable=True)
        )

    with op.batch_alter_table("run", schema=None) as batch_op:
        batch_op.add_column(sa.Column("skipped", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(
            sa.Column(
                "sources_json",
                sqlmodel.sql.sqltypes.AutoString(),
                nullable=False,
                server_default="{}",
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("run", schema=None) as batch_op:
        batch_op.drop_column("sources_json")
        batch_op.drop_column("skipped")

    with op.batch_alter_table("job", schema=None) as batch_op:
        batch_op.drop_column("filter_reason")
