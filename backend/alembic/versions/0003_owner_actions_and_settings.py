"""owner actions and settings

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-13 14:35:55.883233

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "jobevent",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=False),
        sa.Column("kind", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("value", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("created_at", sqlmodel.sql.sqltypes.UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["job.id"], name=op.f("fk_jobevent_job_id_job")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_jobevent")),
    )
    with op.batch_alter_table("jobevent", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_jobevent_job_id"), ["job_id"], unique=False)

    with op.batch_alter_table("job", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("status_changed_at", sqlmodel.sql.sqltypes.UTCDateTime(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("note", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default="")
        )
        batch_op.add_column(sa.Column("owner_label", sa.Boolean(), nullable=True))

    with op.batch_alter_table("settings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "default_limits_json",
                sqlmodel.sql.sqltypes.AutoString(),
                nullable=False,
                server_default="{}",
            )
        )
        batch_op.add_column(
            sa.Column(
                "prices_json",
                sqlmodel.sql.sqltypes.AutoString(),
                nullable=False,
                server_default="{}",
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("settings", schema=None) as batch_op:
        batch_op.drop_column("prices_json")
        batch_op.drop_column("default_limits_json")

    with op.batch_alter_table("job", schema=None) as batch_op:
        batch_op.drop_column("owner_label")
        batch_op.drop_column("note")
        batch_op.drop_column("status_changed_at")

    with op.batch_alter_table("jobevent", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_jobevent_job_id"))

    op.drop_table("jobevent")
