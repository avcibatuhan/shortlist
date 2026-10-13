"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-13 01:47:33.508748

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "run",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("started_at", sqlmodel.sql.sqltypes.UTCDateTime(), nullable=False),
        sa.Column("finished_at", sqlmodel.sql.sqltypes.UTCDateTime(), nullable=True),
        sa.Column("state", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("limits_json", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("fetched", sa.Integer(), nullable=False),
        sa.Column("unique", sa.Integer(), nullable=False),
        sa.Column("new", sa.Integer(), nullable=False),
        sa.Column("prefiltered_out", sa.Integer(), nullable=False),
        sa.Column("matched", sa.Integer(), nullable=False),
        sa.Column("not_matched", sa.Integer(), nullable=False),
        sa.Column("undecided", sa.Integer(), nullable=False),
        sa.Column("estimated_cost_usd", sa.Float(), nullable=False),
        sa.Column("errors_json", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_run")),
    )
    op.create_table(
        "settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("profile_text", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("searches_json", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("exclude_terms_json", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("monthly_budget_usd", sa.Float(), nullable=False),
        sa.Column("model_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_settings")),
    )
    op.create_table(
        "job",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("fingerprint", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("company", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("location", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("remote", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("posted_at", sqlmodel.sql.sqltypes.UTCDateTime(), nullable=True),
        sa.Column("employment_type", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("salary_text", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("description_is_snippet", sa.Boolean(), nullable=False),
        sa.Column("language", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("first_seen_run_id", sa.Integer(), nullable=False),
        sa.Column("first_seen_at", sqlmodel.sql.sqltypes.UTCDateTime(), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.ForeignKeyConstraint(
            ["first_seen_run_id"], ["run.id"], name=op.f("fk_job_first_seen_run_id_run")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_job")),
    )
    with op.batch_alter_table("job", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_job_fingerprint"), ["fingerprint"], unique=True)
        batch_op.create_index(
            batch_op.f("ix_job_first_seen_run_id"), ["first_seen_run_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_job_status"), ["status"], unique=False)

    op.create_table(
        "jobsource",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=False),
        sa.Column("source", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("source_job_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("url", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["job.id"], name=op.f("fk_jobsource_job_id_job")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_jobsource")),
        sa.UniqueConstraint(
            "source", "source_job_id", name=op.f("uq_jobsource_source_source_job_id")
        ),
    )
    with op.batch_alter_table("jobsource", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_jobsource_job_id"), ["job_id"], unique=False)

    op.create_table(
        "matchdecision",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=False),
        sa.Column("match", sa.Boolean(), nullable=True),
        sa.Column("reason", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("model", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("prompt_version", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sqlmodel.sql.sqltypes.UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["job.id"], name=op.f("fk_matchdecision_job_id_job")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_matchdecision")),
    )
    with op.batch_alter_table("matchdecision", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_matchdecision_job_id"), ["job_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("matchdecision", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_matchdecision_job_id"))

    op.drop_table("matchdecision")
    with op.batch_alter_table("jobsource", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_jobsource_job_id"))

    op.drop_table("jobsource")
    with op.batch_alter_table("job", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_job_status"))
        batch_op.drop_index(batch_op.f("ix_job_first_seen_run_id"))
        batch_op.drop_index(batch_op.f("ix_job_fingerprint"))

    op.drop_table("job")
    op.drop_table("settings")
    op.drop_table("run")
