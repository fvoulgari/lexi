from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, text


def test_directory_grants_distinct_runtime_and_operator_roles(test_database):
    suffix = uuid4().hex
    app, operator = "app_" + suffix, "operator_" + suffix
    script = (Path(__file__).parents[2] / "scripts/account-directory.sql").read_text()
    script = script.replace("lexi_app", app).replace("lexi_operator", operator)
    # The test rolls back all DDL and role creation; production runs the full script.
    script = script.replace("BEGIN;", "", 1).rsplit("COMMIT;", 1)[0]
    engine = create_engine(test_database)
    with engine.connect() as db:
        tx = db.begin()
        try:
            db.exec_driver_sql(f'CREATE ROLE "{app}" NOLOGIN')
            db.exec_driver_sql(f'CREATE ROLE "{operator}" NOLOGIN')
            db.exec_driver_sql(script)
            assert not db.execute(
                text(
                    "SELECT has_table_privilege("
                    ":role, 'public.account_directory', 'SELECT')"
                ),
                {"role": app},
            ).scalar_one()
            assert db.execute(
                text(
                    "SELECT has_table_privilege("
                    ":role, 'public.account_directory', 'SELECT')"
                ),
                {"role": operator},
            ).scalar_one()
            db.exec_driver_sql(f'SET LOCAL ROLE "{operator}"')
            assert (
                db.execute(
                    text("SELECT count(*) FROM public.account_directory")
                ).scalar_one()
                >= 0
            )
            db.exec_driver_sql("RESET ROLE")
        finally:
            tx.rollback()
    engine.dispose()
