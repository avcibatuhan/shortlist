from alembic import command
from sqlalchemy import Engine, inspect

from shortlist.db import alembic_config


def test_migrations_create_all_tables(migrated_engine: Engine) -> None:
    tables = set(inspect(migrated_engine).get_table_names())

    assert {"job", "jobsource", "matchdecision", "run", "settings"} <= tables


def test_models_match_migrations(migrated_engine: Engine, database_url: str) -> None:
    # Raises if the models have changes that no migration covers.
    command.check(alembic_config(database_url))
