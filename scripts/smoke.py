"""Connected gate-to-library check against the running application."""

import http.cookiejar
import json
import os
import urllib.error
import urllib.request

base = os.environ.get("SMOKE_BASE_URL", "http://localhost:8000")
password = os.environ["SHARED_PASSWORD"]
cookies = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))


def request(path, method="GET", body=None, csrf=None):
    headers = {"Content-Type": "application/json"}
    if csrf:
        headers["X-CSRF-Token"] = csrf
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        response = client.open(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    payload = response.read().decode()
    return response.status, payload


assert request("/api/health")[0] == 200
assert request("/vocabulary")[0] == 200
assert request("/api/vocabulary")[0] == 401
status, body = request("/api/auth/session")
assert status == 200
csrf = json.loads(body)["csrf_token"]
assert request("/api/auth/login", "POST", {"password": password})[0] == 403
assert request("/api/auth/login", "POST", {"password": password}, csrf)[0] == 200
status, body = request("/api/vocabulary?page=1&page_size=6")
assert status == 200
first = json.loads(body)
second = json.loads(request("/api/vocabulary?page=2&page_size=6")[1])
assert first["total"] == second["total"] == 10
assert len(first["items"]) == 6 and len(second["items"]) == 4
assert len({entry["id"] for entry in first["items"] + second["items"]}) == 10
assert {entry["unit"]["code"] for entry in first["items"] + second["items"]} == {"00"}
assert {p["display_name"] for p in json.loads(request("/api/profiles")[1])} == {"Foteini", "Spyros"}
assert [u["code"] for u in json.loads(request("/api/units")[1])] == ["00", "01"]
assert request("/api/auth/logout", "POST", csrf=csrf)[0] == 200
assert request("/api/vocabulary")[0] == 401
print("PASS: shared gate, CSRF, seeded profiles/units, both library pages, and logout")
