# Hosted authentication rate limits — 6 November 2026

## Scope and exact deployment

Read-only inventory and bounded synthetic HTTP probes used the existing staging
resources. No deployment, DNS change, private-network change, paid feature or
production operation occurred. The user supplied the non-secret setting
`LOGIN_LIMIT=5` and confirmed `FORWARDED_ALLOW_IPS` is absent.

- Project: `de2e2c78-8a6b-41aa-afeb-c6d8002ecc79`.
- Environment: `staging` / `8bb27c88-f6a8-4074-b701-bcefb982ab2d`.
- Backend: `lexi-staging` / `37520d89-9bee-43e1-8955-44b0d0325495`.
- Deployment: `47e33666-ecb8-4039-9f70-c53d1b254c73`, SUCCESS.
- Tested implementation commit: `7ad367955312c42fe6c4cdc66d2aa9240fa09415`.
- Image: `sha256:eb340c7350fcf4c37b8dbd0e3630fff7dcd161d045a47cb90737fdb6eef89f6c`.

SUCCESS describes Railway deployment state, not successful rate limiting.

## Enabled routes

| Route | Inventory and observed behavior |
| --- | --- |
| `https://staging.lexi.fotiniv.com` | Only configured public domain, ACTIVE, target port 8000; reaches Lexi. |
| Railway-generated public domain | None configured according to domain list. The prior CNAME target `https://gadrcmpu.up.railway.app/api/health` independently returns 404; it is not a configured application domain. |
| Public TCP proxy | None configured for the backend. |
| `lexi-staging.railway.internal:8000` | Private endpoint ACTIVE on `railway` network, IPv4 and IPv6. Runtime HTTP reachability is NOT RUN, not assumed absent. |
| Same-environment callers | Environment service-instance inventory contains only `lexi-staging` and `Postgres-kSKC`, both active. The database container and the app itself are potential private callers; production services belong to a different environment. |

The application image binds `0.0.0.0`. This is not proof that a dual-stack private
route is excluded. Private DNS/transport access must be tested from inside the
environment; public Host/Origin values are never evidence of ingress provenance.

## Staging results

| Check | Result | Sanitized evidence |
| --- | --- | --- |
| Public custom-domain routing and configured auth | PASS | `/api/health` responds; `/api/auth/session` reports `authenticated=false`, `auth_available=true`. |
| Two independent external sources reach staging | PASS | Agent connection plus user phone with Wi-Fi off. Route-specific Railway HTTP logs show two distinct source addresses; no addresses retained in evidence. |
| One-source authentication IP limit | FAIL | On `/api/auth/authorisationurl`, logs show 15 requests from one external source within 60 seconds, all HTTP 400 despite reported limit 5. A separate seven-request persistent-connection run also produced only 400. |
| Forged-header requests performed | PASS (execution only) | Six requests varied X-Real-IP, X-Forwarded-For, Forwarded and CF-Connecting-IP using documentation-only IPs. All produced 400, as did an unmodified baseline. No email, password, OAuth code or session was involved. |
| Forged headers cannot rotate a working client bucket | NOT RUN to a conclusive result | No baseline 429 was established, so the preceding responses cannot prove spoof resistance. |
| Separate per-client buckets | NOT RUN to a conclusive result | Phone's one request returned `Please provide the thirdPartyId as a GET param` / 400. Distinct source addresses do not establish separate application buckets without a working first-client exhaustion baseline. |
| One client cannot consume the second client's bucket with forged headers | NOT RUN | No working limit baseline; no cross-victim isolation claim is made. |
| Railway's exact headers as received inside this deployment | NOT RUN | Public edge logs show source metadata, not container-received sanitized header values. Provider confirmation is not substituted for a runtime observation. |
| Private-path reachability / forged headers | NOT RUN | SSH to the existing staging database service failed with `No registered SSH keys found`. No key, helper service, TCP proxy or billable resource was created. Network-flow log query returned no rows; absence of logs is not proof of isolation. |

The limiter failure is observed, but its exact runtime cause is not established.
In particular, HTTP-log upstream address is a destination, not the peer observed
by Uvicorn. Do not infer a trusted peer range or stable hop count from this data.
The test route deliberately omits thirdPartyId: SDK validation returns 400 without
calling Google. Every such request is covered by AuthBoundary's initiation limit.

## Application protections added

IP throttling continues to cover sign-in/up, password recovery/reset, verification,
Google initiation/callback and the existing `/public/` aliases. Unknown ingress
continues to use the transport identity, ignoring caller forwarding headers.
There is no unproved Railway X-Real-IP trust mode in this change.

Password sign-in previously had no persistent identifier-level failure backoff.
The new supported-SDK override records failed results under a tenant-scoped,
domain-separated HMAC of the normalized email. The HMAC key is the existing sealed
Core API key; no new public identifier lookup, raw email logging/storage, password
hashing or credential table is introduced. Key rotation resets these backoff
buckets. This use is distinct from provider-owned password hashing.

Over five-minute windows, failed responses receive delays of 0, 0, 0, 0.25, 0.5,
then at most 1 second. Database increments are atomic; the connection is released
before asynchronous sleep. Known and unknown identifiers follow the same code and
response. Successful credentials are always passed through without backoff or
lockout, even after repeated failures; provider outages are not counted as bad
passwords. Recovery/registration behavior and alias routing remain unchanged.
This is a supplementary soft backoff, not a distributed brute-force or DDoS cure,
and does not close the failed hosted IP-limit gate.

A real SDK middleware regression on the exact inert hosted route returns
400, 400, then 429 with a limit of two: parameter-validation failures must still
consume allowance. This verifies the probe expectation locally, not the deployed
image contents or runtime peer identity.

Local verification covers spoofed headers, explicit synthetic trusted proxies,
unknown provenance with forged matching Host/Origin, persistent/concurrent failure
accounting, window reset, tenant separation, known/unknown generic results and
successful sign-in after failures. A prior failed test invocation used the wrong
SDK success-result constructor; a second fixture failure used an incorrect test
Origin. Both fixtures were corrected and targeted reruns passed. These were not
hosted successes or application security findings.

## Other authentication evidence

Existing user-reported Google sign-in and delivered verification/reset flows remain
recorded in [release evidence](authentication-release-status.md). They were not
independently repeated during these unauthenticated probes. Actual two-user private
content/role isolation remains NOT RUN on hosted staging; local API regressions
exercise synthetic users with substituted provider sessions. No passwords, links
or tokens were requested or read to manufacture an end-to-end result.

## Local results for the candidate change

Full backend suite: **190 passed, 1 skipped**. The skipped test explicitly requires
an isolated local Core, which was not started for this run. Ruff and changed-file
format checks passed. Frontend files did not change; the prior 262-test frontend
result remains historical, not a new hosted-provider verification. Provider
credential handling still runs through the existing SuperTokens APIs.

Unauthenticated hosted checks also returned 401 for vocabulary, account credentials
and administrator accounts. A request to the nonexistent `/api/progress` returned
404; it is not evidence about the profile-specific progress endpoint.

## Decision

The current setup provides no established provenance predicate for trusting
Railway X-Real-IP. We have not proved every possible Railway isolation mechanism
impossible; we have established that this configuration and available evidence do
not satisfy the release gate. Keep header trust unchanged and #63 draft. The
[authenticated Tunnel proposal, costs and rollback](authentication-tunnel-proposal.md)
is the next concrete option; provisioning requires approval and confirmation of
free-plan terms. No public diagnostic/header-echo endpoint was added.
