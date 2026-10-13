from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool
from sqlmodel import SQLModel

from shortlist import models  # noqa: F401  (registers tables on SQLModel.metadata)
from shortlist.config import get_config

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = SQLModel.metadata


def database_url() -> str:
    """URL passed by the caller (tests, `shortlist migrate`) or DATABASE_URL from the app config."""
    return config.get_main_option("sqlalchemy.url") or get_config().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(database_url(), poolclass=pool.NullPool)

    with connectable.connect() as connection:
        # render_as_batch: SQLite cannot ALTER most things in place.
        context.configure(
            connection=connection, target_metadata=target_metadata, render_as_batch=True
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
