# Authentication production execution — 20 November 2026

> Historical record. For current behavior and operator procedures, see the [README](../README.md), [authentication guide](authentication.md), and [Railway runbook](railway-release.md).

The operator explicitly authorized the cutover and follow-up deployment. #63 and
#66 are merged. **v1.2.1 is live at https://lexi.fotiniv.com.** #65 remains separate,
open and draft; its collection changes are not part of this release.

## Immutable release and CI

- Release commit: `567060535ff43ab6275d690fca56bf9bd504f96e`.
- Image: `ghcr.io/fvoulgari/lexi@sha256:66b6de9af1ddbe3339e2f1f0c67fffcb8de5887a8cd5e07b341c072b58e60e73`.
- Railway deployment: `1fef76d7-6b52-4bce-89b7-a9bf29dcf3b9`, SUCCESS.
- **PASS:** [v1.2.1 checks, publication and automated deployment](https://github.com/fvoulgari/lexi/actions/runs/44814534874).
- Public `/api/health` reports this exact deployment, `status=ok` and
  `ingress_mode=cloudflare_tunnel`.
- #63 final CI [44810740660](https://github.com/fvoulgari/lexi/actions/runs/44810740660)
  and #66 CI [44812817507](https://github.com/fvoulgari/lexi/actions/runs/44812817507): PASS.
- Initial v1.2.0 automated deployment **FAILED** because the saved Railway token
  was rejected. The operator replaced the GitHub production environment token.
  Authorized manual deployment of the checked immutable image succeeded with a
  durable deployment ledger. Rerunning the failed job then succeeded as a no-op.
- #66 fixed controller convergence when Railway omits the unused timeout for a
  disabled public healthcheck. Its only changes were controller/tests; app and
  schema are identical between v1.2.0 and v1.2.1. Production smoke evidence below
  was collected on v1.2.0 (`9d85a1b9fd8a857bb70ac906ee4d27b5925cf240`), then health,
  backup checksum and bypass probes repeated after v1.2.1.

## Production results

| Check | Result / evidence |
| --- | --- |
| Google sign-in | **PASS**, operator reports sign-in works on production. Google-only settings previously passed staging; not separately asserted by this production response |
| Password registration / verification delivery | **PASS**, operator confirms unverified protection, delivered production-hostname link and subsequent access |
| Reset email / new password / reused link | **PASS**, operator confirms the requested production flow completed and reused link rejected |
| Automated synthetic auth/isolation | **PASS: 15 checks** against public HTTPS: unverified data denied, verified sessions, distinct accounts/profiles, credential availability, foreign direct card reads/writes, search/CSV isolation, atomic mixed-owner bulk denial, collection denial, practice/progress denial, reset revocation, unrelated session preserved, old password rejected and Unicode new-password sign-in |
| Reset revokes already active sessions | **PASS**, both A sessions revoked immediately; unrelated B remains valid |
| A/B rate buckets | **PASS**, 5 requests return 400 and sixth 429; independent external connection B returns 400 before/after A saturation, in 1.85 seconds. Different source addresses compared in memory, never logged |
| Spoof resistance | **PASS**, saturated A forging XFF or X-Real-IP remains 429. Forged CF-Connecting-IP receives upstream 403; this is rejection, not proof of successful header substitution |
| Missing/invalid/duplicate CF identity | **PASS**, controlled loopback requests reject with `invalid_client_ip`, including XFF/X-Real-IP-only requests; no fallback |
| Alternate ingress | **PASS**, no app Railway public domains/TCP proxy; old generated target and forged Host return 404; other-service private IPv4/IPv6 probes to app/metrics blocked. App and metrics listen on loopback only |
| Post-v1.2.1 recovery | **PASS**, deployment-bound public health; old public target 404 and separate DB-service private ports 8000/2000 blocked after rollout |
| Disabled magic-link endpoints | **PASS**, three passwordless/code aliases return 404; legacy claim links remain separate |
| Access expiry / refresh | **PASS on staging**, actual signed-token expiry rejects, refresh preserves account/profile and advances expiry. Production 7-day natural refresh expiry **NOT RUN** |
| Hosted admin/editor/legacy claims | **NOT RUN**, deliberately skipped; no promotion, mapping or real claim issued |
| Public Google OAuth audience | **NOT RUN**, console requires operator login; test-account sign-in does not prove unrestricted Google audience. Confirm Testing versus In production before advertising unrestricted Google registration |

Synthetic automation used provider-issued verification/reset tokens without sending
email; it is separate from operator-confirmed delivery. Six temporary smoke users
across harness attempts were removed with their guarded synthetic application data.
Two early harness attempts failed (CSRF recipe selection, then output-shape
assumption), were corrected and cleaned; the final run passed all 15 checks.
Real operator accounts and existing learning content were preserved.

Earlier local evidence remains: 233 backend tests with real disposable Argon2 Core,
268 frontend tests, Ruff, ESLint and frontend build PASS; final release controller
24 tests PASS. Independent reviews cleared the Tunnel/backoff and rollout fixes.

## Managed Core, ingress and cost

Production Core `lexi-production`, Ireland, Core 12.5.0: provider-managed Argon2;
access 3,600 seconds; refresh 168 hours; reset 3,600 seconds; verification 24 hours;
signing-key interval 168 hours. Work factors are not exposed, so calibration is
not independently claimed. Synthetic 15/128 ASCII and 128 Unicode passwords at
168/512 bytes passed correct/wrong-tail tests without truncation; four probe
identities were removed. Staging bcrypt is not the production hashing evidence.

Core-only usage-based free allowance was explicitly accepted, with no verified hard
spending cap and no paid add-ons. Cloudflare Free Tunnel was used; no paid Cloudflare
upgrade. Railway connector runs alongside the app; no separate service/plan upgrade.
[Measured staging resources/cost](authentication-tunnel-staging-results.md#measured-resources-and-cost-limits)
remain the available observation, not an isolated production invoice. Production
incremental connector billing has **NOT BEEN MEASURED** separately.

Tunnel `lexi-production` routes `lexi.fotiniv.com` to `http://127.0.0.1:8000`.
The original Railway custom domain was removed; DNS points to the Tunnel. The
runtime requires exact production environment identity plus explicit
`LEXI_PRODUCTION_TUNNEL_ENABLED=true`. Only CF-Connecting-IP is used on this isolated
path. `LOGIN_LIMIT=5` per 60 seconds remains unchanged; identifier backoff remains.
No production threshold increase is implied. Public edge healthchecks are disabled;
container supervision checks local app and connector readiness, ON_FAILURE/10.

Secrets are sealed in Railway. The protected local handoff file was deleted.
The temporary account SSH key was revoked successfully after final checks and
local private/public key files were removed. No secrets, raw IPs or auth links
are retained in this report.

## Database preservation and rollback

Source PostgreSQL 18.6, revision `b46c77a9d008`: 4 profiles, 262 cards,
18 reviews and 18 progress rows. Old app stopped and DB clients checked before
backup/migration. Backup remains protected on the persistent production DB volume:
`/var/lib/postgresql/data/pgdata/lexi-auth-cutover-20261120/pre-auth.dump`.
Archive listing and SHA-256 verification PASS, including after v1.2.1 deployment.
Directory mode 0700/files 0600; retain under operator-controlled backup policy.

Migration to `b46d77a9d009` PASS. Original-column fingerprints for all 11 original
tables matched immediately after migration, before opening registration: original
IDs, text/metadata, reviews, progress and snapshots unchanged. No existing cards,
units or tags published; original profiles remain legacy. No legacy mapping or
administrator promotion performed. New registered accounts legitimately add rows.

Synthetic backup/restore/migration rehearsal PASS previously. **Restore rehearsal
on a protected production copy NOT RUN**, explicitly waived by the operator for
the current test-user deployment. Archive/checksum checks do not prove restoration.
No production-copy rehearsal or recovery-time claim is made.

Rollback follows the [migration runbook](authentication-migration-runbook.md):
freeze writes; preserve a new backup plus all post-cutover accounts/reviews/progress
and mapping/audience deltas; use a compatible tested Tunnel-capable image. Do not
blindly downgrade the schema or restore the old backup over subsequent writes.
For database recovery restore to a separately approved private destination, compare
original manifests and reconcile post-cutover writes before switching. No recovery
resource is provisioned by this report. If ingress fails, keep origin closed and
serve maintenance or restore the prior tested Tunnel configuration; never reopen
wildcard/private/public origin access as fallback.

## Remaining operator decisions

- Confirm Google OAuth audience in the existing Cloud project before unrestricted
  public Google registration; any publish action needs explicit operator approval.
- Admin/editor/legacy claim validation remains unverified. A future approved test
  needs only synthetic legacy profile/history and a designated synthetic admin;
  test claim continuation, redemption, reuse/revocation and active-profile conflicts.
  Promotion, synthetic legacy fixture creation and claim issuance require approval.
- Production-copy restore rehearsal remains an accepted gap; schedule an approved
  private restore before relying on the backup for a recovery guarantee.

Verdicts: **merged and deployed successfully** for the authorized test-user rollout.
This is not a claim that skipped admin/claims, unrestricted Google audience, natural
seven-day refresh expiry or protected-copy restoration have been verified.
