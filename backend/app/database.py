from time import perf_counter

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.timing import add


def database(url):
    engine = create_engine(url, pool_pre_ping=True)

    @event.listens_for(engine, "before_cursor_execute")
    def before_query(conn, cursor, statement, parameters, context, executemany):
        context._lexi_query_start = perf_counter()

    @event.listens_for(engine, "after_cursor_execute")
    def after_query(conn, cursor, statement, parameters, context, executemany):
        add("db_query_ms", context._lexi_query_start)

    return engine, sessionmaker(engine, expire_on_commit=False)
