from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.legacy_retirement_ready import check_legacy_retired
from app.schema_ready import check_schema


def test_unmigrated_unit_blocks_release(client, test_database):
    engine = create_engine(test_database)
    unit_id = uuid4()
    try:
        check_legacy_retired(test_database)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO units (id, code, title, sort_order, visibility) "
                    "VALUES (:id, 'PENDING', 'Pending', 0, 'legacy')"
                ),
                {"id": unit_id},
            )
        with pytest.raises(RuntimeError, match="Unmigrated legacy content"):
            check_legacy_retired(test_database)
    finally:
        with engine.begin() as connection:
            connection.execute(
                text("DELETE FROM units WHERE id = :id"), {"id": unit_id}
            )
        engine.dispose()


def test_missing_schema_revision_blocks_startup(test_database):
    engine = create_engine(test_database)
    schema = "unmigrated_" + uuid4().hex
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        url = make_url(test_database).update_query_dict(
            {"options": f"-csearch_path={schema}"}
        )
        with pytest.raises(
            RuntimeError, match="schema is not at the application revision"
        ):
            check_schema(url.render_as_string(hide_password=False))
    finally:
        with engine.begin() as connection:
            connection.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}"')
        engine.dispose()
