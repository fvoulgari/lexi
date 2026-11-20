"""Public HTTP release checks; writes require an explicit disposable-data opt-in."""

import argparse
import http.cookiejar
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--write-disposable",
        type=Path,
        metavar="EVIDENCE_JSON",
        help="Use a fresh dedicated test account, import two meanings, and save reviews",
    )
    mode.add_argument(
        "--verify",
        type=Path,
        metavar="EVIDENCE_JSON",
        help="Read back saved evidence after an app restart or restore",
    )
    args = parser.parse_args()
    if args.write_disposable and args.write_disposable.exists():
        parser.error("Use a new evidence filename; no disposable writes were started")
    base = os.environ.get("SMOKE_BASE_URL", "http://localhost:8000").rstrip("/")
    jar = http.cookiejar.MozillaCookieJar()
    cookie_file = os.environ.get("SMOKE_COOKIE_FILE")
    if cookie_file:
        # Use an owner-only Netscape cookie export for a dedicated test account.
        # Never print it, commit it, or pass credentials on the command line.
        if Path(cookie_file).stat().st_mode & 0o077:
            parser.error("SMOKE_COOKIE_FILE must be readable only by its owner")
        jar.load(cookie_file, ignore_discard=True)
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    csrf = None

    def request(path, method="GET", body=None, expected=200, csv=False):
        headers = {"Content-Type": "text/csv" if csv else "application/json", "rid": "session", "Origin": base}
        if csrf:
            headers["X-CSRF-Token"] = csrf
        data = (
            body.encode("utf-8")
            if csv
            else (json.dumps(body).encode() if body is not None else None)
        )
        req = urllib.request.Request(
            base + path, data=data, headers=headers, method=method
        )
        try:
            response = client.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            payload = response.read().decode()
            check(
                response.status == expected,
                f"{method} {path}: expected {expected}, got {response.status}",
            )
            if path.startswith("/api/"):
                check(
                    response.headers.get("Cache-Control") == "no-store",
                    f"Private API response may be cached: {path}",
                )
            return (
                json.loads(payload)
                if ("application/json" in response.headers.get("Content-Type", ""))
                else payload
            )

    request("/api/health")
    check('id="root"' in request("/vocabulary"), "Frontend shell missing")
    state = request("/api/auth/session")
    if not state["authenticated"]:
        request("/api/vocabulary", expected=401 if state["auth_available"] else 503)
        check(not (args.write_disposable or args.verify), "A dedicated authenticated test account is required for persistence checks")
        print("PASS: public health, frontend shell, private cache policy, and fail-closed access. Provider sign-in not verified.")
        return
    csrf = state["csrf_token"]
    profiles = request("/api/profiles")
    request("/api/units")
    first = request("/api/vocabulary?page=1&page_size=6")
    second = request("/api/vocabulary?page=2&page_size=6")
    check(first["total"] == second["total"], "Library total changed during smoke")
    check(
        not ({e["id"] for e in first["items"]} & {e["id"] for e in second["items"]}),
        "Pagination repeats entries",
    )

    if args.write_disposable:
        check(len(profiles) == 1, "Expected exactly one owned learner profile")
        profile = profiles[0]
        check(request(f"/api/profiles/{profile['id']}/progress")["total_reviews"] == 0,
              "Write drill requires a fresh dedicated disposable account")
        # Unique markers isolate the drill within this disposable account.
        marker = uuid4().hex[:12]
        unit = request(
            "/api/units",
            "POST",
            {
                "code": f"release-{marker}",
                "title": f"Release drill {marker}",
                "sort_order": 0,
            },
            expected=201,
        )
        csv = (
            "italian,greek,word_type,unit_code,unit_title,tags,italian_gender,greek_gender\n"
            f"il quaderno {marker},το τετράδιο {marker},noun,release-{marker},"
            f"Release drill {marker},release-{marker},masculine,neuter\n"
            f"scrivere {marker},γράφω {marker},verb,release-{marker},"
            f"Release drill {marker},release-{marker},,\n"
        )
        before = first["total"]
        preview = request(
            f"/api/imports/preview?unit_id={unit['id']}", "POST", csv, csv=True
        )
        check(preview["counts"]["valid"] == 2, "Preview did not validate both meanings")
        check(request("/api/vocabulary")["total"] == before, "Preview wrote vocabulary")
        imported = request(
            f"/api/imports/confirm?unit_id={unit['id']}", "POST", csv, csv=True
        )
        check(imported["counts"]["imported"] == 2, "Import did not save both meanings")
        check(
            request(
                f"/api/imports/confirm?unit_id={unit['id']}", "POST", csv, csv=True
            )["counts"]["imported"]
            == 0,
            "Repeat import duplicated meanings",
        )
        entries = request(f"/api/vocabulary?q={marker}")["items"]
        check(len(entries) == 2, "Imported meanings not searchable")
        unit_id = entries[0]["unit"]["id"]
        sessions = []
        for direction, rating in [
            ("greek_to_italian", "again"),
            ("italian_to_greek", "easy"),
        ]:
            session = request(
                "/api/sessions",
                "POST",
                {
                    "profile_id": profile["id"],
                    "direction": direction,
                    "size": 10,
                    "mode": "random",
                    "unit_ids": [unit_id],
                },
                expected=201,
            )
            check(len(session["cards"]) == 2, "Category queue is not the imported unit")
            path = f"/api/sessions/{session['id']}/cards/0"
            request(path + "/reveal", "POST", {"direction": direction})
            review = {"direction": direction, "rating": rating}
            saved = request(path + "/reviews", "POST", review)
            check(
                request(path + "/reviews", "POST", review) == saved,
                "Review retry was not idempotent",
            )
            summary = request(f"/api/sessions/{session['id']}/summary")
            check(summary["total"] == 1, "Summary inflated review count")
            sessions.append({"id": session["id"], "summary": summary})
        progress = request(f"/api/profiles/{profile['id']}/progress")
        check(progress["total_reviews"] == 2, "Progress missing reviews")
        check(
            {r["key"]: r["total_reviews"] for r in progress["directions"]}
            == {
                "greek_to_italian": 1,
                "italian_to_greek": 1,
            },
            "Learning directions are not independent",
        )
        check(
            marker in request("/api/vocabulary/export.csv"),
            "Export missing imported meanings",
        )
        evidence = {
            "profile_id": profile["id"],
            "entries": entries,
            "progress": progress,
            "sessions": sessions,
        }
        # Evidence contains learner data: keep it local and readable by its owner only.
        with os.fdopen(
            os.open(args.write_disposable, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600),
            "w",
            encoding="utf-8",
        ) as output:
            json.dump(evidence, output, ensure_ascii=False, indent=2)
        print(
            "PASS: import preview/confirm/retry, both learning directions, review retry, summary, progress, export"
        )
    elif args.verify:
        evidence = json.loads(args.verify.read_text())
        for entry in evidence["entries"]:
            check(
                request(f"/api/vocabulary/{entry['id']}") == entry,
                "Vocabulary changed after restart/restore",
            )
        check(
            request(f"/api/profiles/{evidence['profile_id']}/progress")
            == evidence["progress"],
            "Progress changed after restart/restore",
        )
        for session in evidence["sessions"]:
            check(
                request(f"/api/sessions/{session['id']}/summary") == session["summary"],
                "Session summary changed after restart/restore",
            )
        print(
            "PASS: saved vocabulary, both directions of progress, and summaries survived"
        )
    else:
        check(isinstance(profiles, list), "Profiles response is not a list")
    request("/api/auth/logout", "POST")
    request("/api/vocabulary", expected=401)
    print(
        "PASS: health, frontend shell, verified account, CSRF, pagination, private cache policy, logout"
    )


if __name__ == "__main__":
    main()
