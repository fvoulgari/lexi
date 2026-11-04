# Staging preparation — 4 November 2026

No hosted staging resources have been created. PR #63 remains draft. Resource
creation, production deployment and changes to workspace spending limits are not
authorised. SuperTokens development Core automatic billing is not confirmed;
having its credentials is not billing confirmation.

## Proposed configuration

Use the existing single-container topology: React and FastAPI share
`https://staging.lexi.fotiniv.com`, with API routes at `/api`. This is a proposed
hostname, not an allocated or verified domain. Google callback:
`https://staging.lexi.fotiniv.com/auth/callback/google`; email link:
`https://staging.lexi.fotiniv.com/auth/verify`.

Prepare an empty staging environment, one application replica and a new private
PostgreSQL service/volume. Do not duplicate production secrets, restore real
learner data, or use the production release script. Use synthetic learners A/B,
editor/admin accounts, legacy profiles and vocabulary for the committed
[acceptance checklist](authentication-staging-checklist.md). Keep autodeploys
disabled and deploy only an explicitly recorded reviewed commit after approval.
Use the root Dockerfile, existing start script and `/api/health` health check.

The [variable template](../config/staging.env.example) contains placeholders only.
It is not an executable deployment configuration. Replace values directly in
Railway → Lexi → staging → staging application → Variables; protect credentials
there. Do not place them in frontend build variables. Verify proxy trust before
enabling the hosted service.

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
traffic or storage increases charges. No SuperTokens, SMTP-provider or taxes
are included. On current forecasts, the short run fits existing included credit;
a full month adds roughly $5.80–$12.40 in resource usage and consumes the same
shared credit. There is no second subscription fee just for another environment.
Stopping compute does not remove retained volume storage charges.

## Email transport blocker

The implementation currently uses implicit-TLS SMTP. Railway
[outbound networking policy](https://docs.railway.com/networking/outbound-networking)
blocks SMTP on Hobby, Free and Trial; SMTP requires Pro and a redeploy. Therefore
the proposed Hobby environment cannot complete delivered magic-link acceptance
with the current transport. An HTTPS transactional-email adapter is an
alternative requiring implementation and provider evaluation. Pro costs
$20/month including $20 usage, versus Hobby's $5 including $5; no upgrade,
proration assumption or email-provider selection is approved here.

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
