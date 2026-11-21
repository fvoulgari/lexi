"""Request-scoped aggregate timings; never retain request or query contents."""

from contextvars import ContextVar
from time import perf_counter

timings = ContextVar("request_timings", default=None)


def add(name, started):
    values = timings.get()
    if values is not None:
        values[name] = values.get(name, 0.0) + (perf_counter() - started) * 1000
