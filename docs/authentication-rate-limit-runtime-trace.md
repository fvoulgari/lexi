# Deployed limiter trace — 6 November 2026

## Demonstrated cause

The missing public 429 is caused by **changing Railway transport-peer buckets**,
not a missing endpoint check, incorrect effective limit, broken increment, or
an outdated authentication source file. No application fix has been deployed.

The deployed limiter hashes `auth:` plus ASGI `scope["client"][0]`. Default
Uvicorn trust accepts only loopback, while Railway public requests arrive from
changing proxy peers. Seven identical requests from one external connection used
six buckets; no bucket reached the configured limit of five.

## Verified deployment and configuration

- Staging deployment `47e33666-ecb8-4039-9f70-c53d1b254c73`, declared commit
  `7ad367955312c42fe6c4cdc66d2aa9240fa09415`.
- Image `sha256:eb340c7350fcf4c37b8dbd0e3630fff7dcd161d045a47cb90737fdb6eef89f6c`.
- Runtime comparison: **29 backend application/startup files match the declared
  commit**, with no mismatches. This checks the relevant deployed source, not just
  the CLI deployment message; it is not a full reproducible-image attestation.
- Runtime Settings: `LOGIN_LIMIT=5`; `FORWARDED_ALLOW_IPS` absent; `PORT=8000`.
- Runtime throttle source confirms a fixed **60-second window**.
- `GET /api/auth/authorisationurl` is present in the deployed limited-route set.
  Database changes during the exact request sequence prove it reaches the limiter
  before the SDK's missing-thirdPartyId validation returns 400.
- Auth source SHA-256:
  `1492daf9ccfc3055dec59880ce87dd42bf4b43cb55ee52715730cb4eabacd4f6`.

## Public request trace — FAIL

One persistent external HTTPS connection sent seven identical, credential-free
GET requests, with no query string, cookies or varying forwarding headers.

```text
GET /api/auth/authorisationurl, seven requests, 1.412 seconds
HTTP: 400, 400, 400, 400, 400, 400, 400
Expected with stable client bucket and fresh window: 400 × 5, 429 × 2
```

A separate read-only process observed the staging throttle table during this
sequence. It assigned ephemeral labels in memory and emitted neither stored key
hashes nor raw identifiers:

| Request-order counter changes | Bucket | Attempts | Window reset? |
| --- | --- | --- | --- |
| 1 | bucket-1 | 1 | yes |
| 2 | bucket-2 | 1 | yes |
| 3 | bucket-3 | 1 | yes |
| 4 | bucket-1 | 2 | no |
| 5 | bucket-4 | 1 | yes |
| 6 | bucket-5 | 1 | yes |
| 7 | bucket-6 | 1 | yes |

These observations occurred within 1.2 seconds; the clock/window cannot explain
six new buckets. A kernel-socket observation during a credential-free empty-JSON
sign-in request also matched the actual transport peer to its persisted throttle
key. Its key and peer address were compared only in memory, never printed.

Reproduce the public release-gate failure after a quiet window:

```sh
python3 scripts/verify-auth-rate-limit.py --limit 5
```

The bounded script targets staging only and exits nonzero unless the exact
five-then-two sequence is observed. It sends no email, credentials or OAuth code.
Do not reinterpret its current failure as a passing application-bucket test.

## Stable transport control — PASS

From the already-running staging database container, seven identical requests to
the private IPv4 app listener produced:

```text
400, 400, 400, 400, 400, 429, 429
Persisted private-caller counter: 7
```

The exact caller lookup was derived in memory; no address or bucket hash was
printed. This proves the existing counter/enforcement works with a stable
transport identity. It is **not** a fix or passing test for public per-client IP
throttling.

## Private bypass and safe-fix constraint

A bounded private IPv4 request from the staging database container reached the
same auth endpoint with a forged public Host and forwarding headers and returned
400. It required no public ingress. This proves the private HTTP path is reachable;
it does not claim the current app trusts those forged headers.

The kernel's local socket destination for a public request also equals the app's
private IPv4 address. Therefore binding that particular address would not isolate
public from private ingress. The app currently listens on IPv4 port 8000, not an
IPv6 HTTP listener; no IPv6 isolation guarantee is inferred from the initial
inconclusive IPv6 probe.

Simply trusting X-Real-IP would remove the observed bucket rotation but permit
private callers to select that identity. Guessed CIDRs, observed-peer allowlists,
Host/Origin tests or fixed hop counts do not establish safe provenance. No such
workaround was enabled. No Cloudflare change or production deployment occurred.

A safe public client-IP fix remains blocked on a supported positive ingress
restriction or authenticated origin connection. Under the unchanged current
network topology, an application-only header switch does not meet the stated
security requirement. Do not claim this gate resolved or recommend ready.
Two-connection and forged-header bucket tests were **not repeated**, because the
public one-connection baseline still fails, as required by the investigation order.

## Diagnostic access and cleanup

The initial automated review rejected registration of an account-level SSH key.
After explicit user approval, a temporary key was registered and used only for
staging source/settings inspection, sanitized counter observation, and bounded
network probes. It was then deleted through the provider API; read-back reported
no registered SSH keys. Local private/public keys and temporary host-key and
registration files were removed. No public debug endpoint, persistent logging
instrumentation, schema/data migration, counter reset or request-secret capture
was introduced.
