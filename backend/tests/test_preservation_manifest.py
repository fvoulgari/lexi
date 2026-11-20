from copy import deepcopy

from app.preservation_manifest import compare, encode


def test_comparison_detects_changed_columns_and_key_replacement():
    before = {
        "tables": {
            "reviews": {
                "primary_key": ["id"],
                "columns": ["id", "rating"],
                "rows": {'["one"]': {"id": "a", "rating": "b"}},
            }
        }
    }
    after = deepcopy(before)
    after["tables"]["reviews"]["rows"]['["one"]']["rating"] = "c"
    after["tables"]["reviews"]["rows"]['["two"]'] = {"id": "d", "rating": "e"}
    assert compare(before, after) == [
        {
            "table": "reviews",
            "key": '["one"]',
            "change": "columns_changed",
            "columns": ["rating"],
        },
        {"table": "reviews", "key": '["two"]', "change": "row_added"},
    ]
    assert compare(before, deepcopy(before)) == []


def test_canonical_json_orders_nested_keys():
    assert encode({"b": 2, "a": {"z": 1, "y": 0}}) == '{"a":{"y":0,"z":1},"b":2}'


def test_snapshot_captures_real_schema_and_detects_row_change(test_database):
    from sqlalchemy import create_engine, text

    from app.preservation_manifest import snapshot

    engine = create_engine(test_database)
    with engine.begin() as connection:
        before = snapshot(connection)
        assert {
            "accounts",
            "profiles",
            "vocabulary_entries",
            "review_events",
            "learning_progress",
            "collections",
            "collection_entries",
        } <= before["tables"].keys()
        connection.execute(
            text("CREATE TABLE manifest_test_rows (id integer PRIMARY KEY, value text)")
        )
        connection.execute(text("INSERT INTO manifest_test_rows VALUES (1, 'before')"))
        initial = snapshot(connection)
        connection.execute(
            text("UPDATE manifest_test_rows SET value = 'after' WHERE id = 1")
        )
        changed = snapshot(connection)
        assert compare(initial, changed) == [
            {
                "table": "manifest_test_rows",
                "key": "[1]",
                "change": "columns_changed",
                "columns": ["value"],
            }
        ]
        connection.execute(text("DROP TABLE manifest_test_rows"))
    engine.dispose()
