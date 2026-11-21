from pathlib import Path
from uuid import uuid4

from conftest import TEST_CSRF, signin
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ProgrammingError

from app.main import create_app
from app.schema_ready import check_schema


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


def test_application_runs_with_restricted_login(client, test_database, monkeypatch):
    """Exercise actual requests on a separate login after owner-run migrations."""
    suffix = uuid4().hex
    app, operator = "app_" + suffix, "operator_" + suffix
    password = uuid4().hex
    script = (Path(__file__).parents[2] / "scripts/account-directory.sql").read_text()
    script = script.replace("lexi_app", app).replace("lexi_operator", operator)
    engine = create_engine(test_database)
    roles_created = False
    directory_created = False
    try:
        with engine.begin() as db:
            assert (
                db.execute(
                    text("SELECT to_regclass('public.account_directory')")
                ).scalar_one()
                is None
            )
            db.exec_driver_sql(f"CREATE ROLE {app} LOGIN PASSWORD '{password}'")
            db.exec_driver_sql(f"CREATE ROLE {operator} NOLOGIN")
        roles_created = True
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as db:
            db.exec_driver_sql(script)
        directory_created = True
        restricted = make_url(test_database).set(username=app, password=password)
        restricted_url = restricted.render_as_string(hide_password=False)
        check_schema(restricted_url)
        app_engine = create_engine(restricted_url)
        try:
            with app_engine.connect() as db:
                assert db.execute(text("SELECT current_user")).scalar_one() == app
                try:
                    db.execute(
                        text("CREATE TABLE public.role_must_not_create (id int)")
                    )
                    raise AssertionError("runtime role can create schema objects")
                except ProgrammingError:
                    db.rollback()
                try:
                    db.execute(text("SELECT * FROM public.account_directory"))
                    raise AssertionError("runtime role can read operator view")
                except ProgrammingError:
                    db.rollback()
        finally:
            app_engine.dispose()
        monkeypatch.setenv("DATABASE_URL", restricted_url)
        application = create_app()
        application.state.auth_gate.ready = True
        with TestClient(application) as runtime:
            signin(runtime)
            headers = {"X-CSRF-Token": TEST_CSRF}
            response = runtime.post(
                "/api/collections",
                headers=headers,
                json={
                    "name": "Restricted role",
                    "source_language": "el",
                    "target_language": "it",
                },
            )
            assert response.status_code == 201, response.text
            collection_id = response.json()["id"]
            response = runtime.post(
                f"/api/collections/{collection_id}/cards",
                headers=headers,
                json={"source_text": "γεια", "target_text": "ciao"},
            )
            assert response.status_code == 201, response.text
            assert (
                runtime.get(f"/api/collections/{collection_id}/entries").status_code
                == 200
            )
    finally:
        with engine.begin() as db:
            if directory_created:
                db.exec_driver_sql("DROP VIEW public.account_directory")
            if roles_created:
                db.exec_driver_sql(f"DROP OWNED BY {app}")
                db.exec_driver_sql(f"DROP OWNED BY {operator}")
                db.exec_driver_sql(f"DROP ROLE {app}")
                db.exec_driver_sql(f"DROP ROLE {operator}")
        engine.dispose()
