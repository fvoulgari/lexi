from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text

from app.legacy_retirement_ready import check_legacy_retired


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
