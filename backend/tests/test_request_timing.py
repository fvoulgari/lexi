import logging
import re


def test_request_timing_is_bounded_and_does_not_log_query_data(logged_in, caplog):
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        response = logged_in.get("/api/profiles?private_marker=secret-marker")
    assert response.status_code == 200
    records = [
        r.getMessage() for r in caplog.records if "request_timing" in r.getMessage()
    ]
    assert len(records) == 1
    assert re.fullmatch(
        r"request_timing operation=profiles total_ms=\d+\.\d "
        r"provider_ms=\d+\.\d db_query_ms=\d+\.\d",
        records[0],
    )
    assert "secret-marker" not in records[0]
    assert float(records[0].split("db_query_ms=")[1]) > 0
