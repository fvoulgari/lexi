# Authentication release status — 20 November 2026

> Historical record. For current behavior and operator procedures, see the [README](../README.md), [authentication guide](authentication.md), and [Railway runbook](railway-release.md).

**Current outcome: #63 and #66 merged; v1.2.1 released to production with successful automated deployment.** See the [production execution report](authentication-production-release-2026-11-20.md) for tested commits, results, accepted exceptions and rollback. #65 remains separate and draft. Production Google sign-in, registration/verification and password-reset delivery/reuse were confirmed by the operator. Hosted admin/legacy claims remain NOT RUN. Public Google audience status remains unverified.

## Historical pre-cutover assessment (superseded by execution report)

At the time of the assessment below, PR #63 stayed **draft**. No merge, tag, production deployment/routing/migration or
Lexi production provisioning was performed. The separately approved production authentication Core was created on 20 November; see the current update below. #65 remains separate. This document distinguishes
implementation/merge evidence from production release gates.

## Tested candidate

Final runtime/test commit: **`762e27d7e85bec137afde7141dddc71ae8cb95fa`**.
Its only change after the reviewed `49cd514` is the tested pre-migration staging
guard; the authentication/authorization code used by the isolation traces is identical.
Staging deployment: **`6a5b546c-0906-4148-849b-9b6035797896`**, SUCCESS.
Origin: **https://staging-lexi.fotiniv.com**. Later documentation-only commits do
not change this tested runtime. The earlier head `ec508d6` also had green CI;
review fixes were subsequently tested and deployed to staging only.

| Check | Result / evidence |
| --- | --- |
| Full backend with actual disposable Argon2 Core | **PASS: 233 tests, none skipped**, final runtime `762e27d` |
| Frontend | **PASS: 268 tests / 20 files**, rerun 20 November |
| Ruff / ESLint / frontend build / diff whitespace | **PASS**; existing Starlette/httpx deprecation and bundle-size warnings |
| Candidate CI | **PASS**, [run 42320523628](https://github.com/fvoulgari/lexi/actions/runs/42320523628): backend/frontend/application/image validation; publishing and production jobs skipped |
| Synthetic PostgreSQL 17.11 backup/restore/auth migration | **PASS**, `b46c77a9d008` → `b46d77a9d009`; IDs, original columns, references, reviews/progress/snapshots, legacy audience, constraints/defaults and archival history preserved |
| Managed-production hashing probe | **PASS**, managed production Core 12.5.0 / Argon2 on 20 November: 15/128 ASCII and 128 Unicode at 168/512 bytes; four synthetic identities deleted, temporary key file removed |

Local Core used cached official image `c74eef1f69b7`, loopback-only, synthetic
identities and captured email. It covers reset expiry/reuse, Unicode non-truncation,
account separation, password change/current-password rejection, session revocation
and logout. It does not prove live OAuth, delivered email or managed production
hashing. The container was stopped/removed after testing. Fresh migration fixture
SHA-256: `be7301e402b61fe23630cd89d2b556d1bdaf8aa6a1221bd08854b57482f35a41`.
The two created local databases and dump were removed. [Migration evidence](authentication-migration-verification.md).

## Hosted staging results

The automated fixtures are three newly created synthetic password identities;
provider SDK verified them for isolation testing without sending email. They were
not administrators, legacy learners or replacements for live email-delivery checks.
No real learner data or credentials appear in this report. Authorized B import
and collection membership also succeeded, so denial tests did not merely exercise
a broken or globally disabled write path. Auth cookies were observed Secure,
HttpOnly, SameSite=Lax; refresh cookie path `/api/auth/session/refresh`.

| Check | Result / evidence type |
| --- | --- |
| Direct card/profile/collection/session/progress reads with A IDs from B | **PASS**, hosted 404; search/selection do not expose A |
| Cross-owner card edit/archive/restore, profile edit, collection rename/delete/membership, practice reveal/review/create | **PASS**, hosted denied; foreign unit/tag attachment denied |
| Mixed-owner bulk move/delete | **PASS**, hosted 409; B's selected own card and A's state unchanged |
| CSV export | **PASS**, exact `/api/vocabulary/export.csv` returns 200 CSV scoped to caller; own content present and other learner content absent |
| CSV import to A's private destination from B | **PASS**, preview/confirm 422; no partial card/tag/unit changes |
| Denial atomicity | **PASS**, A card/metadata/collections/reviews/progress snapshots unchanged after all denied operations |
| Practice/progress isolation | **PASS**, B queues exclude A; B review succeeds without changing A; reverse direction stays independent; reciprocal A→B known-ID denial also passed |
| Reset revokes existing sessions | **PASS**, managed reset invalidated already-active A1 and A2 immediately; unrelated B remained valid |
| Actual access expiry and provider refresh | **PASS on 20 Nov**; the earlier interrupted 7 Nov observation remains incomplete. Fresh synthetic observation completed 20 Nov: before-expiry 200, expired signed token 401, refresh 200, same account/profile and advanced expiry; no lifetime changes |
| Isolated ingress / spoof resistance | **PASS**, current deployment: A gets 429 on sixth request; instrumented independent external B remains 400 before/after forged-header probes within 13.63 seconds. CF observed different source addresses; addresses processed in memory, not logged |
| Forwarding-header probes | **PASS**, saturated A forging B's XFF/X-Real-IP remains 429; forged CF-Connecting-IP rejected upstream 403; B unaffected. Rejection does not prove successful header replacement |
| Additional mobile B | **PASS**, user reported third-party-parameter response with Wi-Fi off on updated build |
| Missing/invalid/duplicate identity | **PASS**, no fallback; deployed missing/invalid/mapped-invalid probes reject, duplicate regression plus earlier deployed evidence applies |
| Connector/container restart | **PASS**, terminated staging connector once; Railway ON_FAILURE recovered via Tunnel in 37.9 seconds, combined loopback health/ready then 200 |
| Alternate ingress after restart | **PASS**, app/metrics only 127.0.0.1:8000/2000; other-service IPv4/IPv6 probes blocked; no app Railway domains, old public target 404; no TCP proxy added |
| Google login/Google-only settings | **PASS**, earlier manual report on same hostname; relevant runtime unchanged |
| Registration blocks unverified data, verification delivery/link/access | **PASS**, earlier manual report on same hostname; relevant runtime unchanged |
| Reset delivery/link/new-password sign-in and used-link rejection | **PASS**, earlier manual report; supplemented by automated reset/session revocation above |
| Logout-all / unrelated identity | **PASS**, earlier manual: both A sessions invalidated; separate Google account remained signed in |

Earlier manual browser versions/authenticated traces were not recorded. They are
not relabeled as new automated runs. [Tunnel results, cost and rollback](authentication-tunnel-staging-results.md).

### Actual managed development Core settings

Read directly from the authenticated dashboard on 7 November: Core **12.4.2**,
Ireland; **bcrypt**, access **3,600 seconds**, refresh **2,400 hours / 100 days**,
reset **3,600 seconds**, email verification **24 hours**, dynamic signing-key
interval **168 hours**. The synthetic session's provider metadata independently
reports refresh validity **8,640,000 seconds**. Tenant configuration omitted these
keys, so omitted values were not interpreted as defaults. No Core setting changed.
Natural refresh-token expiry after 100 days is not claimed tested.

## Independent review and fixes

The earlier review through `95c4034` covered authorization, account isolation,
claims and migrations. Two independent read-only standards/spec reviewers now
also reviewed the subsequent Tunnel/identifier-backoff changes through `ec508d6`
and candidate fixes at `49cd514`; the final startup safeguard at `762e27d` also
received independent read-only review.

Concrete findings fixed and regression-tested:

- Post-verification sleep alone permitted concurrent distributed password guesses.
  Verification now takes a short cross-replica HMAC-identifier advisory lease before
  Core verification, with a ten-second timeout, bounded failure delay and no persistent
  account lockout. Concurrent requests receive generic 429; provider timeout 503.
- The lease shares its database connection with failure recording. Repeated request
  cancellation cannot abandon acquisition/cleanup or overlap failure SQL with unlock.
- IPv4-mapped unspecified/multicast identities normalize before validation and reject.
- A live but disconnected connector could appear healthy. Combined app/connector
  readiness and startup/outage watchdog now force fail-closed recovery.
- The staging environment/mode/port guard now runs before Alembic, preventing a
  wrong-environment Tunnel configuration from changing schema before rejection.
- ADR 0001 now records the staging ingress exception to Railway edge TLS.

Both reviewers closed their concrete findings; no remaining code blocker was
identified in that scope. Review conclusions do not establish hosted/production
configuration or substitute for tests.

## Deliberately skipped / other unverified behavior

Hosted administrator/editor role transitions and administrator-issued legacy claim
continuation/redemption/revocation/conflicts/races are **NOT RUN**, explicitly skipped
by the user. No account was promoted and no real learner claim issued. Local claim
transaction/concurrency tests pass. A short synthetic hosted procedure and its
required additional promotion/fixture approvals are in the [production plan](authentication-production-plan.md).

Managed verification-link expiry/reuse, managed reset natural expiry, token/account-
confusion variants, complete edge-log inspection and 100-day refresh expiry are not
new hosted PASS results. Relevant local provider regressions and earlier manual
results have their narrower scopes above. Do not silently count these as passed.

## Production proposal and remaining gates

The [concrete production plan](authentication-production-plan.md) specifies exact
origin/callback/email paths, protected variable names, supported Argon2 target,
synthetic probe, proposed session lifetimes, separate Tunnel with bypass closure,
threshold recommendation/cost review and fail-closed rollback. The staging-only
runtime guard remains unchanged. Production source was read-only verified pinned
to an immutable image, with no Git repo source; merging main alone does not deploy it.

| Gate | Status | Next action / owner | Evidence required |
| --- | --- | --- | --- |
| Final document-head CI | NOT RUN until docs committed | Agent: commit/push final evidence and inspect that exact head | All required checks green; no skipped check counted PASS |
| Production Core/billing/cap | NOT RUN: only development Core exists; creation screen says usage-based billing | Operator: review terms/threshold treatment/payment/cap, approve exact budget before creation | Account-specific terms and enforceable cap or explicit approved cost exposure |
| Managed production Argon2/lifetimes | NOT RUN | Operator supplies sealed production Core configuration after approval; agent can execute approved synthetic probe | Saved settings, actual units/version and non-truncation PASS on that Core |
| Production isolated ingress | NOT RUN | Agent prepares separate reviewed production guard/config change; operator approves Tunnel/routing | Two-source limit/spoof/no-public-or-private-bypass and restart evidence on approved candidate |
| Protected production-backup rehearsal | NOT RUN | Operator approves private data access/destination/retention/cost; agent runs reviewed rehearsal afterward | Verified restore, original-column manifests, audience checks, mapping dry-run and post-cutover delta procedure |
| Admin/bootstrap and legacy mapping | NOT RUN; hosted staging checks deliberately skipped | Operator reviews synthetic procedure or explicitly accepts its gap, then authorizes real bootstrap/mappings separately | Approved exact identity/profile ledger; conflicts preserved; no implicit roles |
| Production Google/email settings and synthetic smoke | NOT RUN | Operator enters Google/Core/Resend secrets directly into protected production variables | Exact production callback, verified sender, delivery/session/isolation checks before reopening writes |

**Ready to merge into main?** Pending current UI/documentation-head CI and timed session
observation; reviewed implementation and candidate CI have passed. Keep draft.
**Ready to release to production? NO.** The production gates above remain open.
No production activation is implied by a merge-ready verdict.

## Resumption — 20 November

- PR still OPEN/DRAFT at `762e27d`; all required CI checks on that head passed.
  Publishing/production jobs were skipped. Staging is still on deployment
  `6a5b546c-0906-4148-849b-9b6035797896`, SUCCESS.
- Actual dashboard now shows managed development Core **12.5.0**, updated since
  the historical 12.4.2 evidence. Lifetimes and bcrypt remain as recorded above.
  Historical hosted results are not relabeled as fresh tests of 12.5.0.
- Found/fixed AuthGate UTF-16 length/truncation mismatch against the unchanged
  Unicode policy: count code points, permit up to 256 UTF-16 units in the input,
  still validate 15–128 code points. Registration and reset supplementary-character
  regressions pass. **268 frontend tests**, ESLint and build PASS on 20 Nov; only
  the existing bundle warning remains. Both independent reviewers found no blocker.
- Prepared Core probe additionally tests 128 supplementary characters/512 UTF-8
  bytes. Local disposable Argon2 test passes; managed production remains NOT RUN.
- Revoked the old diagnostic SSH key successfully. Precisely identified and removed
  only the three 7 Nov synthetic provider identities and their application fixtures:
  three accounts/profiles, five cards, four units/collections, three tags/reviews/
  progress rows and four practice sessions/session cards. Legacy/foreign-reference
  guards passed. No real learner/admin/claim data was modified.
- A newly approved temporary key is being used solely for the fresh staging check
  and fixture cleanup; revoke it at completion. The earlier test's local temporary
  credentials had been removed, so its expired token could not be reused.
- Production Core wizard is prepared for `lexi-production`, Ireland, all paid
  add-ons OFF (multi-tenancy was ON by default and was switched OFF in the draft).
  **Deploy Production Core was not clicked.** Billing approval is unresolved.
  No production resource, routing, migration or release was activated.

## Current update — 20 November, 19:21 UTC

Tested PR head **c8eb74e3785162018879be7e2de54d5db2ff3768**: required CI
checks **PASS**, [run 44799150781](https://github.com/fvoulgari/lexi/actions/runs/44799150781).
Publishing and production deployment jobs were **SKIPPED**. Staging deployment
`e564dded-0aa0-472d-999d-59f86cc88fb3` serves `466f163` (same tree); public
frontend artifact matches the locally verified build (**PASS**).

Approved Core-only production preparation is complete: `lexi-production`, Ireland,
Core 12.5.0, no paid add-ons, saved Argon2, access 3,600 seconds, refresh 168 hours,
reset 3,600 seconds, verification 24 hours. Managed non-truncation probe and cleanup
**PASS**. Usage-based billing beyond the allowance was explicitly accepted; no
hard cap is verified. No Lexi production app variables, routing or database changed.
The fresh staging expiry observation subsequently passed at 20:02:33 UTC. Production
ingress, protected production-backup rehearsal and cutover remain **NOT RUN**.
Hosted admin/legacy-claim checks remain deliberately **NOT RUN**.

### Production preparation follow-up

Operator confirms production currently contains test users only and waives the
protected production-copy rehearsal. Status: **NOT RUN / RISK ACCEPTED**, not PASS.
A pre-cutover verified backup remains required. The proposed production Tunnel
runtime requires both the exact environment ID and explicit opt-in; no production
variables, connector process, routing or migration were activated.

Local production Tunnel preparation: **PASS, 19 targeted tests** on the working
tree based on `c8eb74e`; Ruff PASS after formatting. Includes exact production ID
without opt-in rejected before migration; no hosted production behavior claimed.

### Release authorization — 20 November

Operator explicitly authorized merge/release/production deployment and migration,
with no further confirmation unless a check fails, a secret is unavailable or an
unapproved charge is required. #65 stays separate. Production currently contains
test users; the production-copy rehearsal is waived, but backup/data preservation
remain required. Production deployment results are pending, not claimed PASS.

Natural staging access expiry/refresh: **PASS** at 20:02:33 UTC. Protected access
before expiry succeeded, the actual expired signed token was rejected, refresh
succeeded and retained account/profile while advancing access expiry.

Production preparation review: independent standards and spec reviewers cleared
the exact-environment opt-in and deployment-bound public readiness check. Release
controller: **PASS, 22 tests**. Railway SUCCESS alone no longer advances release
success; the public Tunnel must return the exact new deployment ID in Tunnel mode.
