from test_vocabulary_editing import headers


def upload(client, csv, action="preview"):
    return client.post(
        f"/api/imports/{action}",
        content=csv.encode("utf-8"),
        headers={**headers(client), "Content-Type": "text/csv"},
    )


def test_preview_is_pure_and_confirmation_imports_valid_rows(logged_in):
    csv = (
        "italian,greek,word_type,unit_code,unit_title,tags,pronunciation\n"
        "il perché,το γιατί,noun,07,Domande,questions|daily,perˈke\n"
    )
    before = logged_in.get("/api/vocabulary").json()["total"]
    units = logged_in.get("/api/units").json()
    preview = upload(logged_in, csv)
    assert preview.status_code == 200
    assert preview.json()["counts"] == {
        "imported": 0,
        "valid": 1,
        "skipped": 0,
        "duplicate": 0,
        "error": 0,
    }
    assert preview.json()["proposed_units"][0]["code"] == "07"
    assert preview.json()["proposed_tags"] == ["daily", "questions"]
    assert logged_in.get("/api/vocabulary").json()["total"] == before
    assert logged_in.get("/api/units").json() == units
    assert logged_in.get("/api/tags").json() == []
    result = upload(logged_in, csv, "confirm")
    assert result.status_code == 200
    assert result.json()["counts"]["imported"] == 1
    entry = logged_in.get("/api/vocabulary?q=perché").json()["items"][0]
    assert entry["greek"] == "το γιατί"
    assert entry["pronunciation"] == "perˈke"
    assert entry["unit"]["code"] == "07"
    assert {tag["name"] for tag in entry["tags"]} == {"questions", "daily"}


def test_stale_preview_and_repeat_confirmation_skip_normalized_duplicates(logged_in):
    csv = (
        "italian,greek,word_type\n"
        "il perché,το γιατί,noun\n"
        " IL PERCHE\u0301 , ΤΟ ΓΙΑΤΊ ,noun\n"
    )
    assert upload(logged_in, csv).json()["counts"]["duplicate"] == 1
    logged_in.post(
        "/api/vocabulary",
        json={
            "italian": "il perché",
            "greek": "το γιατί",
            "word_type": "noun",
            "notes": "Preserve this meaning",
        },
        headers=headers(logged_in),
    )
    for _ in range(2):
        result = upload(logged_in, csv, "confirm").json()
        assert result["counts"]["imported"] == 0
        assert result["counts"]["duplicate"] == 2
    assert logged_in.get("/api/vocabulary?q=perché").json()["items"][0]["notes"] == (
        "Preserve this meaning"
    )


def test_row_errors_genders_and_invalid_rows_do_not_reserve_pairs(logged_in):
    csv = (
        "italian,greek,word_type,gender,italian_gender,greek_gender,tags\n"
        "nuovo,νέο,noun,masculine,feminine,neuter,bad\n"
        "nuovo,νέο,noun,masculine,,neuter,new\n"
        "vuoto,,noun,,,,orphan\n"
    )
    preview = upload(logged_in, csv).json()
    assert [r["status"] for r in preview["rows"]] == ["error", "valid", "error"]
    assert "conflicts" in preview["rows"][0]["errors"][0]
    assert preview["proposed_tags"] == ["new"]
    result = upload(logged_in, csv, "confirm").json()
    assert result["counts"] == {
        "imported": 1,
        "valid": 1,
        "skipped": 2,
        "duplicate": 0,
        "error": 2,
    }
    entry = logged_in.get("/api/vocabulary?q=nuovo").json()["items"][0]
    assert entry["italian_gender"] == "masculine"
    assert entry["greek_gender"] == "neuter"
    assert [t["name"] for t in logged_in.get("/api/tags").json()] == ["new"]


def test_file_validation_and_gate_protection(logged_in):
    for csv in [
        "italian,greek,word_type,unknown\na,b,noun,x\n",
        "italian,italian,word_type\na,b,noun\n",
        "italian,greek\na,b\n",
        "italian,greek,word_type\n",
        'italian,greek,word_type\na,"unclosed,noun\n',
        "x" * 1_048_577,
        "italian,greek,word_type\n" + "a,b,noun\n" * 2001,
    ]:
        assert upload(logged_in, csv).status_code == 422
    assert (
        logged_in.post(
            "/api/imports/preview", content=b"\xff", headers=headers(logged_in)
        ).status_code
        == 422
    )
    csv = "italian,greek,word_type\na,b,noun\n"
    assert logged_in.post("/api/imports/confirm", content=csv).status_code == 403
    logged_in.cookies.clear()
    assert upload(logged_in, csv).status_code == 401


def test_tags_are_trimmed_and_deduplicated_before_assignment(logged_in):
    result = upload(
        logged_in,
        "italian,greek,word_type,tags\nnuovo,νέο,noun,daily| daily |daily\n",
        "confirm",
    )
    assert result.status_code == 200
    entry = logged_in.get("/api/vocabulary?q=nuovo").json()["items"][0]
    assert [tag["name"] for tag in entry["tags"]] == ["daily"]


def test_example_is_gated_utf8_and_importable(logged_in):
    response = logged_in.get("/api/imports/example")
    assert response.status_code == 200
    assert "attachment" in response.headers["Content-Disposition"]
    assert (
        upload(logged_in, "\ufeff" + response.content.decode("utf-8")).json()["counts"][
            "valid"
        ]
        == 3
    )
    assert response.text.splitlines() == [
        "italian,greek,word_type",
        "casa,σπίτι,noun",
        "parlare,μιλάω,verb",
        "bello,όμορφος,adjective",
    ]
    logged_in.cookies.clear()
    assert logged_in.get("/api/imports/example").status_code == 401


def test_unit_conflicts_and_malformed_rows_are_reported_without_partial_metadata(
    logged_in,
):
    csv = (
        "italian,greek,word_type,unit_code,unit_title,unit_sort_order,tags\n"
        "primo,πρώτο,noun,07,Domande,7,daily\n"
        "secondo,δεύτερο,noun,07,Other,7,orphan\n"
        "terzo,τρίτο,noun,,Title,0,orphan\n"
        "quarto,τέταρτο,noun,08,Title,no,orphan\n"
        "quinto,πέμπτο,noun\n"
        "sesto,έκτο,noun,,,,,extra\n"
    )
    result = upload(logged_in, csv, "confirm").json()
    assert result["counts"]["imported"] == 1
    assert result["counts"]["error"] == 5
    assert [t["name"] for t in logged_in.get("/api/tags").json()] == ["daily"]
    assert not any(u["code"] == "08" for u in logged_in.get("/api/units").json())


def test_concurrent_confirmations_import_pair_once(logged_in):
    from concurrent.futures import ThreadPoolExecutor

    from fastapi.testclient import TestClient

    from app.main import create_app

    csv = "italian,greek,word_type\nnuovo,νέο,noun\n"
    with TestClient(create_app()) as device:
        device.cookies.update(logged_in.cookies)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(upload, c, csv, "confirm") for c in (logged_in, device)
            ]
            results = [f.result().json()["counts"] for f in futures]
    assert sorted(r["imported"] for r in results) == [0, 1]
    assert logged_in.get("/api/vocabulary?q=nuovo").json()["total"] == 1


def test_legacy_columns_and_conflicting_aliases(logged_in):
    csv = (
        "italian,greek,type,unit,unit_title,plural,example\n"
        "il perché,το γιατί,noun,07,Domande,i perché,Non so il perché.\n"
    )
    result = upload(logged_in, csv, "confirm")
    assert result.status_code == 200
    assert result.json()["counts"]["imported"] == 1
    entry = logged_in.get("/api/vocabulary?q=perché").json()["items"][0]
    assert entry["italian_plural"] == "i perché"
    assert entry["italian_example"] == "Non so il perché."
    assert entry["unit"]["code"] == "07"
    conflict = upload(
        logged_in, "italian,greek,type,word_type\nnuovo,νέο,noun,verb\n"
    ).json()
    assert conflict["counts"]["error"] == 1
    assert "conflicts" in conflict["rows"][0]["errors"][0]
