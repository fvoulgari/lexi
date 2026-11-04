# Staging preparation — 4 November 2026

## Current hosted preparation

The user approved up to $2 of additional Railway usage for a 48-hour synthetic
staging test. This is a budget, not an enforced spending cap. Production and
workspace spending limits remain unchanged. PR #63 remains draft; no merge or
production deployment is authorised.

An empty staging environment was created without copying production data or
secrets. Its PostgreSQL service started on 4 November at 18:46 UTC; remove the
disposable resources after testing, no later than 6 November at 18:46 UTC unless
the user approves an extension. Both app and database have limits of 0.25 vCPU
and 0.5 GB memory, with one replica each. The database has no public TCP proxy.

- Environment: `8bb27c88-f6a8-4074-b701-bcefb982ab2d` (`staging`).
- App: `37520d89-9bee-43e1-8955-44b0d0325495` (`lexi-staging`).
- Database: `dce7d9f8-d9df-40e7-8987-6e3524f76ab2` (`Postgres-kSKC`).
- Origin: `https://staging.lexi.fotiniv.com`; DNS and HTTPS certificate verified.
- Google callback: `https://staging.lexi.fotiniv.com/auth/callback/google`.
- Verification: `https://staging.lexi.fotiniv.com/auth/verify-email`.
- Reset: `https://staging.lexi.fotiniv.com/auth/reset-password`.

The user reported saving provider credentials. A names-only staging metadata
check after deployment found all five provider variables absent from the staging
app: SUPERTOKENS_CONNECTION_URI, SUPERTOKENS_API_KEY, GOOGLE_CLIENT_ID,
GOOGLE_CLIENT_SECRET and RESEND_API_KEY. Their values were not read. The user then entered the variables and deployed changes. Deployment
`031116af-fb62-408d-b4d9-2085cda1cd66` reached SUCCESS; auth readiness is now
true, managed-Core wrong-credential rejection and Google initiation work, and
logged-out protected endpoints return 401. Full browser authentication remains
pending; see the staging checklist for exact results. The Resend sending domain
is verified. Google remains External / Testing. SuperTokens remains a development
Core; the user reports no payment card added. No paid features or upgrades were
activated. This is not evidence of a provider spending cap.

The user declined adding payment details for Cloudflare Access. Railway's native
access gate requires Enterprise, so neither gate is enabled. The user authorised
short-lived public staging for synthetic tests only. Do not invite real learners
or use real legacy data. Development bcrypt tests use 15–64 ASCII-character
passwords; production hashing and Unicode non-truncation remain separate gates.

Deployment `7286448e-4a5b-46d6-83a9-719236016867` was submitted for commit
`3fe9a4f473a3d4a7002ff9f6afe95aa2c1154cdd` on 4 November at 19:45 UTC.
Railway subsequently reported SUCCESS. HTTPS `/api/health` returned 200 with
`status=ok`; the frontend returned 200. `/api/auth/session` returned 200 with
`authenticated=false` and `auth_available=false`. Logged-out profiles and
vocabulary requests returned 503 (fail closed while auth is unconfigured), not
a completed authorization test. These responses include `Cache-Control: no-store`. The root Dockerfile,
`/api/health` healthcheck (120 seconds) and single replica are configured.
Autodeployment is not configured. Record the terminal deployment state and live
authentication evidence separately in the acceptance checklist.

The [variable template](../config/staging.env.example) contains placeholders only.
Never put credential values in this document, chat, PR, or frontend variables.
Forwarded-header trust and hosted throttling remain unverified.

## Cost estimate and credit

Read-only account inspection: Hobby plan; billing cycle 18 October–18 November
2026, resetting at 18:16 UTC. Resource usage $1.04; provider forecast $1.90.
Hobby includes $5 per cycle shared across the workspace, not per environment.
Approximately $3.96 remains now; projected headroom after existing workloads is
$3.10. Neither is reserved for staging and other usage can consume it.

Official [container rates](https://docs.railway.com/pricing/plans): memory
$10/GB-month, CPU $20/vCPU-month, volume $0.15/GB-month, egress $0.05/GB.
Builds are free. Estimates below use a 30-day month and low synthetic-test load;
they are assumptions, not measurements or enforced spending limits.

| Assumption, app and database combined | Low | Higher light use |
| --- | ---: | ---: |
| Average memory | 0.5 GB | 1 GB |
| Average active CPU | 0.02 vCPU | 0.1 vCPU |
| Stored database volume | 1 GB | 1 GB |
| Resource cost for 48 hours, before egress | $0.37 | $0.81 |
| Resource cost for 30 days, before egress | $5.55 | $12.15 |

Allow 1 GB egress ($0.05) for a short test, or 5 GB ($0.25) per month:
approximately $0.42–$0.86 for 48 hours, $5.80–$12.40 monthly. A $2 short-test
allowance provides contingency but is not a cap. Higher actual memory/CPU,
traffic or storage increases charges. No SuperTokens, email-provider or taxes
are included. On current forecasts, the short run fits existing included credit;
a full month adds roughly $5.80–$12.40 in resource usage and consumes the same
shared credit. There is no second subscription fee just for another environment.
Stopping compute does not remove retained volume storage charges.

## HTTPS email transport

Launch scope changed to email/password plus Google. Resend HTTPS delivery is
implemented for provider-generated verification and password-reset messages;
SMTP and magic-link login have been removed. Railway Hobby can remain in use.
The user configured the verified Resend sender and a domain-scoped sending key.
Actual delivery and tracking settings remain to be tested through
[operator setup](authentication-setup.md). No paid email plan was activated.

## Checks independent of managed-provider billing

Local tests use synthetic identities and a disposable test database. They can
verify callback retry state, backend permissions and isolation, claims including
conflicts/concurrency, archival and migration invariants. A disposable local
database can also rehearse backup, upgrade and restore-based rollback. See
[existing migration evidence](authentication-migration-verification.md).

These checks do not prove real Google authentication, email delivery, live Core
session renewal/revocation, hosted HTTPS cookies, DNS or Railway proxy behavior.
Those acceptance items stay NOT RUN until billing, transport, credentials and
hosted configuration are resolved. Do not mark the PR ready on local tests alone.

Local rerun on 4 November against implementation commit
`84dd12a308fbb076928575b51cd3dea146dd778a`: backend 148 passed using the existing
disposable PostgreSQL 17 test database (one Starlette/httpx deprecation warning);
frontend 223 passed across 18 files; frontend lint and build passed (bundle-size
warning). No live provider calls or hosted staging deployment were used. This
rerun did not repeat the separately documented dump/restore rehearsal.
