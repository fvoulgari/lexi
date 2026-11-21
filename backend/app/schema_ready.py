"""Fail closed when operator-run migrations have not reached this release."""

import os
from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine


def check_schema(url: str) -> None:
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    expected = set(ScriptDirectory.from_config(config).get_heads())
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            current = set(MigrationContext.configure(connection).get_current_heads())
    finally:
        engine.dispose()
    if current != expected:
        raise RuntimeError(
            "Database schema is not at the application revision; "
            "run operator migrations before starting."
        )


if __name__ == "__main__":
    check_schema(os.environ["DATABASE_URL"])
