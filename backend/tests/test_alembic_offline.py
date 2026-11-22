from io import StringIO
from pathlib import Path

from alembic.config import Config
from sqlalchemy.engine import Engine

from alembic import command


def test_upgrade_renders_postgresql_sql_without_connecting(monkeypatch):
    def reject_connection(*args, **kwargs):
        raise AssertionError("Alembic offline mode attempted a database connection")

    monkeypatch.setattr(Engine, "connect", reject_connection)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    sql = StringIO()
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"), output_buffer=sql)

    command.upgrade(config, "a47c39f0a019:b58d40a1b020", sql=True)

    output = sql.getvalue()
    assert output.startswith("BEGIN;")
    assert "CREATE TABLE saved_collections" in output
    assert "GRANT SELECT, INSERT, DELETE ON saved_collections TO lexi_app" in output
    assert "SET version_num='b58d40a1b020'" in output
    assert output.rstrip().endswith("COMMIT;")
