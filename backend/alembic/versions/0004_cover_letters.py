"""cover letters

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-13 17:37:49.735407

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "coverletter",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=False),
        sa.Column("language", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("text", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("edited", sa.Boolean(), nullable=False),
        sa.Column("model", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sqlmodel.sql.sqltypes.UTCDateTime(), nullable=False),
        sa.Column("updated_at", sqlmodel.sql.sqltypes.UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["job.id"], name=op.f("fk_coverletter_job_id_job")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_coverletter")),
    )
    with op.batch_alter_table("coverletter", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_coverletter_job_id"), ["job_id"], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("coverletter", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_coverletter_job_id"))

    op.drop_table("coverletter")
