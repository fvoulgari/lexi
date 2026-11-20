# Staging Tunnel proof of concept — 6 November 2026

PR #63 remains draft. Production, its domains, credentials, database and spending
limits were not changed. No paid Cloudflare product or Railway resource upgrade
was enabled. Synthetic/inert probes only; no credentials or raw visitor addresses
are included here.

## Tested deployment

- Source `0503808b301346aff370d7b2ed5e4c6bd7b064f5`; deployed ingress,
  settings, middleware, supervisor and start script hashes all match (5 files).
- Railway staging deployment `394e6aa3-941d-4217-8313-2d8fc52262ed`: SUCCESS.
- Origin: `https://staging-lexi.fotiniv.com`. The former multi-level hostname is
  not used: Cloudflare indicated it requires a paid certificate feature.
- User confirmed updating the staging Google origin and redirect URI
  `https://staging-lexi.fotiniv.com/auth/callback/google`.
- Effective ingress mode `cloudflare_tunnel`, `LOGIN_LIMIT=5`, fixed window 60s.
- cloudflared 2026.10.7, official image pinned by digest in Dockerfile.
- Railway public-edge healthcheck explicitly cleared (actual instance readback
  empty). Container-local `/api/health` and connector `/ready` both returned 200.
- First deployment `3a1857f7-8c7a-42e2-b0d4-c0b47ddec2af` FAILED: the old
  public-edge healthcheck had persisted despite configuration merge patches.
  Explicit service-instance update and new deployment resolved this; it was not
  an application limiter failure.

## Acceptance evidence

| Check | Result and sanitized evidence |
| --- | --- |
| A reaches limit | PASS: two bounded identical GET sequences to `/api/auth/authorisationurl`, each 400 × 5 then 429 × 2; first ~1.49s, repeat ~1.70s; `Retry-After: 60` |
| B remains independent | PASS, manual: user with Wi-Fi off received `Please provide the thirdPartyId as a GET param`; repeated after A's second saturation with same result. Phone/browser version and server-side timing correlation were not captured |
| X-Real-IP / XFF forgery | PASS: external forged headers still produced 429 from A's saturated bucket |
| Forged CF-Connecting-IP | PASS for rejection: three changing forged CF/XFF/X-Real-IP combinations returned Cloudflare 403; isolated CF-header probe returned edge error 1000, while plain/XFF requests returned Lexi 429. Rejected at edge, not evidence of successful header replacement |
| Missing / invalid / duplicate CF header | PASS on deployed loopback boundary: all returned 400 `invalid_client_ip` even with X-Real-IP/XFF supplied; no fallback |
| Railway public domains | PASS: app domain inventory empty after removing old staging custom domain; no generated public domain; TCP proxy inventory empty |
| Old Railway CNAME target | PASS: `gadrcmpu.up.railway.app/api/health` returns 404; former custom hostname no longer reaches app |
| App socket isolation | PASS: `/proc/net/tcp*` showed only 127.0.0.1:8000 and 127.0.0.1:2000; no wildcard or IPv6 listener |
| Other-service private access | PASS: probes from staging database service to app private IPv4 AND IPv6, ports 8000 and 2000, all blocked |
| Provider readiness | PASS: session endpoint auth_available=true, authenticated=false |
| Logged-out data access | PASS: profiles and vocabulary returned 401 |
| Real Google callback on new hostname | PASS, manual user report: returned to Lexi; settings identified Google sign-in and hid Change password. Browser/version not recorded |
| Password-reset delivery and login on new hostname | PASS, manual user report: reset email received, link opened new staging hostname, password reset completed, new-password sign-in succeeded. Used reset link subsequently rejected (manual PASS). Expiry and session revocation not established by this check |
| Registration/verification delivery on new hostname | PASS, manual user report: fresh password account blocked from protected learning data before verification; verification email received, link used new staging hostname, access succeeded afterward. Verification-link reuse/expiry not yet tested |
| Private-card search isolation | PASS, manual user report: A created the synthetic private card and B could not find it. Direct-ID/export/write and progress isolation not established |
| Logout-all / unrelated-user isolation | PASS, manual user report: two password sessions signed out; separate Google session stayed signed in |

Cloudflare zone overview showed Free plan and no Workers connected. No security
settings were weakened. Default Python user agent received Cloudflare 1010;
normal user-agent probe reached the app. Edge rejection must be distinguished
from application 429. Header transforms/Pseudo IPv4 configuration was not
independently audited in this run; changes to those settings or Worker routes
require reassessing identity semantics.

The B check is human-reported; it is not an instrumented two-device trace. No
claim is made that all forged requests reached Lexi: CF-header probes were
rejected upstream. These findings apply to the tested deployment/configuration.

## Measured resources and cost limits

Connector process metrics over 39.863 seconds:

- CPU total increased 0.34 → 0.40 CPU-seconds: delta 0.06, average ~0.00151 vCPU.
- Resident memory stayed 45,568,000 bytes (~45.6 MB); separate proc status sample
  reported 45,836 kB earlier during startup.
- Short observation; not representative of sustained load. RSS excludes supervisor,
  allocator/cgroup overhead and traffic-dependent changes. No capacity upgrade.

Railway's cumulative staging app cost changed $0.1141827189 → $0.1146729041
(delta $0.0004901852), staging database $0.0351939502 → $0.0353271308
(delta $0.0001331805) during preparation/testing. Metering can lag, and differences
include normal app/database operation and deployment activity; they are NOT an
isolated connector invoice. Billing period: 18 October–18 November 2026.

At published $10/GB-month memory and $20/vCPU-month CPU rates, extrapolating the
brief process sample gives roughly $0.49/month or $0.033/48h, before network and
other overhead. This is an estimate from measured process use, not a bill or a
new spending authorization. No new recurring paid subscription was activated.

## Rollback / remaining gates

Keep the closed ingress topology. If the connector fails, stop it or use a
maintenance route; do not restore a wildcard listener or old public Railway
route as an automatic fallback. Retain the last tested Tunnel-capable image.
No schema migration was added. No learner history was modified by these probes.

Temporary diagnostic account SSH key was deleted successfully after the read-only
checks; local key, public-key and known-host files were removed. Tunnel token
remains sealed in staging; never put it in source, logs, PRs or chat.

Current closeout and explicit skipped/unverified checks are recorded in
[release status](authentication-release-status.md). Admin/hosted-claim testing was
explicitly skipped by the user on 7 November; it is not a PASS. Keep production
public-signup readiness gated and PR draft.

## Local checks and CI

Final full backend suite: **216 passed, 1 skipped** (opt-in local-Core integration),
one existing Starlette/httpx deprecation warning. Ruff, Docker build/binary execution
and `git diff --check` passed. Explicit regression coverage includes login/signup/
reset paths and their public aliases. CI for deployed implementation `0503808`
passed backend, frontend, application and image-validation checks; production
jobs were skipped: [run 42314031624](https://github.com/fvoulgari/lexi/actions/runs/42314031624).
Subsequent evidence/test-only commits need their own CI result.

## Reviewed candidate and restart — 7 November 2026

Runtime/test commit **`49cd514573cd1ad0597b3e42b21b38ea1629691f`**, staging deployment
**`3d996820-4192-4cfd-a91f-67ae58f79ef4`**, SUCCESS. The staging-only guard and
5 requests/60 seconds are unchanged. Independent post-review findings were fixed:
concurrent password verification now uses a cross-replica identifier lease with
bounded provider timeout and failure delay; cancellation owns/relinquishes its
connection safely; IPv4-mapped unspecified/multicast identities are rejected;
combined app/connector readiness drives a fail-closed restart watchdog.

| Check | Result / sanitized observation |
| --- | --- |
| Automated A, single fixed window | PASS: `400,400,400,400,400,429`, 1.92 seconds |
| Instrumented independent external source B | PASS: A again `400×5,429`; B 400 before and after spoof probes, all within 13.63 seconds. Cloudflare trace confirmed different source addresses in process memory; raw addresses were neither printed nor stored |
| Spoofing B from saturated A | PASS: XFF/X-Real-IP set to B's observed address still 429; forged CF-Connecting-IP set to B returned edge 403; B remained 400. This is upstream rejection, not proof of header replacement |
| Phone B | PASS, additional manual report: Wi-Fi off, expected third-party parameter message on updated build |
| Invalid identity on loopback app | PASS: missing, invalid and mapped unspecified/multicast headers return 400 with no forwarding-header fallback; duplicate-header regression passes locally and earlier deployed duplicate rejection remains applicable |
| Restart fault injection | PASS: terminated only staging `cloudflared`; supervisor exited and Railway ON_FAILURE restarted the container. Observed 502/530 while down, then external `/api/health` 200 at 37.9 seconds |
| Readiness after restart | PASS: loopback app and connector `/ready` both 200; ON_FAILURE policy with 10 retries, public healthcheck empty |
| Post-restart sockets | PASS: only `127.0.0.1:8000` and `127.0.0.1:2000`; no wildcard/IPv6 app/metrics listener |
| Private bypass after restart | PASS: actual probes from separate staging database container resolve private app DNS and fail to connect over IPv4 AND IPv6 to both ports |
| Public bypass | PASS: no app custom/generated Railway domains; old Railway target returns 404. Existing TCP-proxy inventory was empty; no proxy added |
| Backend/real local Core | PASS: 232 tests, none skipped, disposable Argon2 Core; Ruff passed |
| Frontend | PASS: 262 tests, ESLint/build passed; existing bundle warning |
| CI for candidate | PASS: [run 42320523628](https://github.com/fvoulgari/lexi/actions/runs/42320523628); publishing/production jobs skipped |

The database image has no Python runtime; its initial Python probe could not run.
Repeating the private-path probe with its installed Perl/Socket runtime produced
the four PASS results above. No software was installed in the database service.
No production route, provider setting or spending limit changed.

Connector samples around this restart: CPU 0.37 seconds/RSS 38,600,704 bytes before
fault; CPU 0.40 seconds/RSS 39,477,248 bytes after recovery (separate process lifetime,
so **not a CPU delta**). Whole-service metered cost for the remaining verification
interval is recorded in the final release status; neither process RSS nor service
billing can isolate an exact connector invoice.

### Startup-guard follow-up

Final runtime `762e27d7e85bec137afde7141dddc71ae8cb95fa`, deployment
`6a5b546c-0906-4148-849b-9b6035797896`: SUCCESS. The only runtime change after
`49cd514` checks the staging environment/mode/port before running Alembic. A
subprocess regression proves a production-ID Tunnel start cannot invoke migration.
Independent review found no new issue. Final full local backend/Core suite:
**233 PASS**, no skips; unchanged frontend results above remain applicable.
The timed managed session check spans the compatible staging restart; no Core
identity/lifetime or authorization rule changed.
