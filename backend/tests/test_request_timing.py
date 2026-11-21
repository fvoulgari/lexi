import asyncio
import logging
import re

from app.timing import RequestTimingMiddleware, operation_for


def test_request_timing_is_bounded_and_does_not_log_query_data(logged_in, caplog):
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        response = logged_in.get("/api/profiles?private_marker=secret-marker")
    assert response.status_code == 200
    records = [
        r.getMessage() for r in caplog.records if "request_timing" in r.getMessage()
    ]
    assert len(records) == 1
    assert re.fullmatch(
        r"request_timing operation=profiles status=200 total_ms=\d+\.\d "
        r"provider_ms=\d+\.\d db_query_ms=\d+\.\d",
        records[0],
    )
    assert "secret-marker" not in records[0]
    assert float(records[0].split("db_query_ms=")[1]) > 0


def test_timing_logs_after_final_body_without_logging_path_or_query(caplog):
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"first", "more_body": True})
        assert not caplog.records
        await send({"type": "http.response.body", "body": b"last"})

    async def send(message):
        pass

    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        asyncio.run(
            RequestTimingMiddleware(app)(
                {
                    "type": "http",
                    "method": "GET",
                    "path": "/api/vocabulary",
                    "query_string": b"q=secret",
                },
                None,
                send,
            )
        )
    assert len(caplog.records) == 1
    assert "operation=vocabulary_list" in caplog.text
    assert "secret" not in caplog.text


def test_operation_labels_exclude_other_methods():
    assert operation_for("/api/vocabulary", "GET") == "vocabulary_list"
    assert operation_for("/api/vocabulary", "POST") is None
    assert operation_for("/api/sessions", "GET") is None
    assert operation_for("/api/sessions", "POST") == "practice_start"
