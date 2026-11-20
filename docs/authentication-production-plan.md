# Authentication production plan — awaiting review

Prepared 7 November 2026 for #63; reviewed again20 November. This is a proposal, not permission to provision,
route traffic, create a release tag, bootstrap an administrator or migrate production.
#65 collections are excluded. The existing staging-only runtime guard remains intact.

## Separate merge from release

Merging checked code into `main` does not authorize production use. The workflow
publishes a main image; production deployment requires a separately eligible release
tag and the production job. Confirm Railway production remains pinned to its
approved immutable release image rather than following `latest` or a Git branch.
Do not create that tag until the gates below close. Retain #63 as draft for now.
Read-only Railway inspection on 7 November confirms production source has no Git
repository and is pinned to `ghcr.io/fvoulgari/lexi@sha256:589bb1e76ddc9cdc42196c5bba1941498c9b59964821a36354159b5136667e89`; it does not follow `main` or `latest`.

## Managed Core and billing

On 20 November the operator explicitly approved Core-only usage-based production
creation, then personally completed payment setup. `lexi-production` is Active in
Ireland, Core **12.5.0**, with **zero paid add-ons**. Lexi production is not connected.
The creation screen says charges apply when usage exceeds the free tier. Published
pricing advertises free below 5,000 MAUs and $0.02/MAU outside the offer. No hard
spending cap is verified; the operator accepted that exposure. This is not a
zero-cost guarantee. No payment details or secret values were recorded.

Saved settings were reloaded and read back on the actual production Core:

| Setting | Proposed production value | Actual staging value, dashboard read 7 Nov | Actual production |
| --- | --- | --- | --- |
| Password hashing | provider-managed **ARGON2**, provider-calibrated supported work settings | bcrypt, disabled control | **PASS: argon2 saved** (work settings not exposed) |
| Access validity | 3,600 seconds | 3,600 seconds | **PASS: 3,600 seconds** |
| Refresh validity | 10,080 minutes / **168 hours** (7 days) | **2,400 hours** (100 days) | **PASS: 168 hours** |
| Reset-token lifetime | 3,600,000 milliseconds / **3,600 seconds** | 3,600 seconds | **PASS: 3,600 seconds** |
| Verification-token lifetime | 86,400,000 milliseconds / **24 hours** | 24 hours | **PASS: 24 hours** |
| Dynamic access signing-key interval | retain supported 168 hours unless separately reviewed | 168 hours | **PASS: 168 hours** |

Use the dashboard's displayed units; do not paste milliseconds into a seconds
field. `SESSION_HOURS` in Lexi does not set these values. Refresh validity is not
an absolute maximum session age. Record the saved Core version, settings, units
and non-secret deployment identity privately. Do not infer defaults when an API
omits fields: the staging tenant API returned no explicit values for these keys.
The values above were read from the actual dashboard instead.

[Provider hashing documentation](https://supertokens.com/docs/authentication/email-password/password-hashing)
supports managed Argon2 configuration; the actual production deployment must still
show and retain it before real registrations. Existing bcrypt hashes continue to
verify as bcrypt; changing an algorithm is not proof all existing users were rehashed.
Do not migrate staging synthetic users into production. Preserve the unchanged
15–128-character Unicode policy; do not implement custom hashing in Lexi.

### Prepared non-truncation probe

Use `scripts/verify-core-password-policy.py` in a trusted private job with the
backend dependencies. The operator enters `LEXI_CORE_PROBE_URI` and secret
`LEXI_CORE_PROBE_KEY` into that job's protected variables, selecting the intended
production Core explicitly. Never pass a key as a command argument or paste it
into chat. After separate authorization for synthetic Core writes:

```sh
python scripts/verify-core-password-policy.py --allow-synthetic-core-writes
```

It creates unique `example.invalid` provider identities, sends no email, touches
no Lexi database, verifies correct and incorrect passwords at 15/128 characters,
and rejects a Unicode password differing only after UTF-8 byte 72. It deletes
only the identities it created and reports cleanup. No credential/token is printed.
The prepared probe passed on the disposable local Argon2 Core (128 Unicode
characters at 168bytes and 128 supplementary Unicode characters at 512bytes); **PASS on managed production Core 12.5.0, 20 November, tested commit c8eb74e**. All four synthetic identities were deleted (cleanup PASS), and the temporary protected key file was removed. Application
15/128/129 validation remains covered by application tests and must also be
checked through the release candidate's registration/reset/change-password UI.

## Production ingress proposal

Existing production origin read from protected Railway configuration:
**https://lexi.fotiniv.com**. Production rollout is now explicitly authorized.
The reviewed runtime rejects
production unless both the exact production environment ID and
`LEXI_PRODUCTION_TUNNEL_ENABLED=true` match. Independent reviewers cleared this preparation change; it retains fail-closed
validation; never remove the guard or accept an arbitrary environment variable
as proof of origin provenance.

Authorized cutover sequence:

1. Create a separate production Tunnel in the confirmed Free Cloudflare account,
   using the existing zone. Confirm creation adds no subscription/paid certificate
   or Access seat. Use a single-level hostname, `lexi.fotiniv.com`.
2. Route only that hostname to `http://127.0.0.1:8000` in the same container as Lexi.
   Enter the connector credential directly into sealed production
   `CLOUDFLARE_TUNNEL_TOKEN`. No token in build arguments, images, Git, chat or logs.
3. Bind Uvicorn to **127.0.0.1**, disable proxy-header interpretation, bind connector
   metrics to **127.0.0.1:2000**. Remove every app Railway public custom/generated
   domain and TCP proxy. Do not rely only on DNS pointing at Cloudflare. Private
   Railway DNS can continue to resolve, but no socket may accept traffic on it.
   Keep PostgreSQL private and separate from the public app.
4. Trust only one valid `CF-Connecting-IP` arriving on the isolated local connector
   path. Missing/duplicate/invalid identity fails closed. Ignore X-Real-IP and XFF.
   Audit Cloudflare Pseudo IPv4/header transforms/Workers so none changes identity
   semantics. No Worker-origin exception or alternate service may reach a wildcard
   app listener. Host/Origin are not ingress authentication.
5. Clear the Railway public HTTP healthcheck; use combined loopback app health and
   connector `/ready`. The supervisor exits if startup is not ready within about
   90 seconds or a previously ready connector/app stays unready for about 30 seconds
   (plus probe/poll time). Keep Railway ON_FAILURE restart policy and bounded retries.
6. Repeat two-network sixth-request 429/B-independent/header-spoof tests at **5/60**
   first, using an isolated prelaunch production candidate and synthetic identities.
   Probe no public domain/TCP proxy and both IPv4/IPv6 app/metrics ports from a
   different service. Kill the connector once; demonstrate automatic recovery and
   recheck all bypasses after restart.

Production threshold recommendation **for review only**: start with 20 auth requests
per IP per 60 seconds across the currently covered signup/signin/reset/verification/
OAuth routes; monitor shared-NAT false positives. Keep the separate HMAC-identifier
password verification lease and bounded failed-password backoff. Do not silently
apply this recommendation: current staging is **5/60**, production unchanged.

No separate connector service is needed. Staging measured connector RSS/CPU and
whole-service Railway cost are recorded in the [staging report](authentication-tunnel-staging-results.md).
The earlier short process sample extrapolated about $0.49/month extra connector
compute, not a bill or a ceiling. Production traffic and resource overhead differ;
Railway compute/egress continue billing under its existing plan. No new paid plan
is proposed without review; confirm remaining included credit and an approved
operating budget before provision/routing. Do not change a workspace-wide spending
limit that could stop existing production.

### Fail-closed ingress rollback

Before cutover retain the prior tested Tunnel-capable immutable image, sealed
connector credential and route configuration. On failure, freeze writes and serve
maintenance or roll back to that Tunnel-capable image with the same loopback-only
listeners. If no compatible healthy image exists, keep the application inaccessible.
Never re-add a Railway public domain/TCP proxy, bind `0.0.0.0`, trust guessed peers
or fall back to XFF as recovery. Database rollback is separate and may require a
compatible image/restored private database. Re-enable user access only after the
trusted-IP and no-bypass checks pass again.

## Exact OAuth, email and protected variables

Google **production** web client (separate from staging):

- Authorized JavaScript origin: `https://lexi.fotiniv.com`
- Authorized redirect URI: `https://lexi.fotiniv.com/auth/callback/google`
- Authorized branding domain: `fotiniv.com`; scopes only `openid email profile`.
- Review Google audience/publishing requirements before public launch. Testing
  users are insufficient for an unrestricted public release.

Email paths generated by the provider:
`https://lexi.fotiniv.com/auth/verify-email` and
`https://lexi.fotiniv.com/auth/reset-password`; retain generated token/tenant
parameters, do not manually construct credentials. Legacy claims remain separate
`https://lexi.fotiniv.com/claim#token=…`. Never put those actual links in reports.

Use Resend HTTPS (no SMTP or Railway plan upgrade). Sender proposal:
`Lexi <noreply@auth.fotiniv.com>`, subject to confirming the verified sending domain,
SPF/DKIM and tracking disabled. Use a separate sending-only domain-scoped production
key. Free quotas are 100/day and 3,000/month at [Resend's published limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits);
verify the actual account's plan, payment/overage behavior and shared staging usage.
No paid upgrade is approved. Delivered verification/reset and hostname checks must
be repeated on the production candidate with operator-controlled synthetic inboxes.

The operator enters these in **Railway → Lexi → production → application → Variables**,
with secrets sealed. Agent prepares names; operator supplies provider secrets:

| Name | Value/source |
| --- | --- |
| `DATABASE_URL` | reviewed private migrated target database reference; secret |
| `PUBLIC_ORIGIN` | `https://lexi.fotiniv.com` |
| `COOKIE_SECURE` | `true` |
| `SUPERTOKENS_CONNECTION_URI` | intended production Core HTTPS URI |
| `SUPERTOKENS_API_KEY` | production Core secret |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | production Google web client; secret sealed |
| `RESEND_API_KEY` | separate scoped production sending secret |
| `EMAIL_FROM` | reviewed verified sender above |
| `CLOUDFLARE_TUNNEL_TOKEN` | separate production Tunnel secret, only after approval |
| `AUTH_INGRESS_MODE` | `cloudflare_tunnel`, only after reviewed guard/configuration change |
| `LOGIN_LIMIT` | approved production threshold; recommendation is not applied |
| `CLAIM_HOURS` | `48` |

No `VITE_*` secret, custom password table, automatic account linking, magic-link
login or general permanent-deletion UI. `FORWARDED_ALLOW_IPS` is ignored in Tunnel
mode and cannot establish trusted ingress. Do not use `*`.

## Database and skipped hosted privilege checks

Use the [cutover runbook](authentication-migration-runbook.md), including its
comparison ledger and post-cutover write handling. Synthetic restore rehearsal
passed; a protected production-backup rehearsal has **NOT RUN** and requires
explicit approval for learner-data access, destination, protection and any cost.

Hosted admin/editor/claim tests remain deliberately **NOT RUN**. Prepared minimal
synthetic procedure after separate approval:

1. Authorize one named staging synthetic account's admin promotion; inspect the
   `bootstrap-admin` dry run before applying. Never infer identity from email/name.
2. Create only a disposable, explicitly marked unclaimed legacy profile with a
   synthetic review/history; issue an expiring claim for a different synthetic
   account with an empty profile. Confirm pre-login continuation → login → explicit
   redeem preserves the legacy ID/history and grants neither editor nor library access.
3. Reuse/revoke/expire links; try another-account redemption and two-account race;
   verify no partial reassignment. Add synthetic activity before a second claim;
   verify conflict report and both histories retained without merging.
4. Assign/revoke editor using admin; editor can manage permitted shared content but
   not another user's private card/progress or roles. Record audit events without tokens.
5. Revoke fixture sessions/claims and remove only approved synthetic fixtures;
   remove temporary privileged access. Never issue a real learner test claim.

Required additional approval covers the exact staging account promotion,
synthetic legacy fixture writes and cleanup; it is intentionally not requested or
performed in this task because the user explicitly skipped these hosted checks.
Acceptance of this documented test gap is distinct from evidence of a PASS.

## Next operator step — 20 November

Prepare the separate production Google OAuth web client for origin
`https://lexi.fotiniv.com` and redirect URI
`https://lexi.fotiniv.com/auth/callback/google`. Do not replace staging credentials.
The operator has now authorized production rollout. The managed Core probe is
complete; the protected production-copy rehearsal is waived because only test
users are present. Take the pre-cutover backup before migration. Production
ingress activation and hosted acceptance results remain pending.

## Operator decision: rehearsal waiver

The operator confirmed production contains only test users and explicitly accepted
skipping the protected production-copy migration rehearsal. This is a waived gate,
not a PASS. Keep the source intact and take a verified backup before cutover; no
permission to discard cards, profiles or history was inferred. Actual production
migration, routing and deployment still require the concrete cutover approval.

Production Tunnel activation additionally requires sealed connector credentials,
`AUTH_INGRESS_MODE=cloudflare_tunnel` and `LEXI_PRODUCTION_TUNNEL_ENABLED=true`
on the exact production environment. Neither setting has been applied. Unknown
environments remain rejected even with the opt-in. The guard runs before Alembic.
