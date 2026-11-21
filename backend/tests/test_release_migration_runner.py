"""The console runner must fail closed outside its approved starting state."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

RUNNER = Path(__file__).resolve().parents[2] / "scripts/release-migration-20261121.sql"


@pytest.mark.skipif(
    shutil.which("psql") is None, reason="PostgreSQL client unavailable"
)
@pytest.mark.parametrize("wrong_target", [False, True])
def test_runner_rejects_wrong_revision_or_database(test_database, wrong_target):
    url = make_url(test_database).set(drivername="postgresql")
    environment = os.environ.copy()
    environment.update(
        PGHOST=url.host or "localhost",
        PGPORT=str(url.port or 5432),
        PGUSER=url.username or "postgres",
        PGPASSWORD=url.password or "",
        PGDATABASE=url.database,
    )
    target = "incorrect_database" if wrong_target else url.database
    result = subprocess.run(
        [
            "psql",
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-v",
            f"target_db={target}",
            "-f",
            str(RUNNER),
        ],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert (
        "unexpected database" in result.stdout
        if wrong_target
        else "unexpected Alembic revision" in result.stderr
    )
    engine = create_engine(test_database)
    with engine.connect() as db:
        scripts = ScriptDirectory.from_config(
            Config(str(Path(__file__).parents[1] / "alembic.ini"))
        )
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == (
            scripts.get_current_head()
        )
        assert not db.scalar(
            text(
                "SELECT EXISTS (SELECT FROM pg_roles "
                "WHERE rolname='lexi_release_migrate')"
            )
        )
    engine.dispose()
