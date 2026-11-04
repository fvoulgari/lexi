# Authentication release verification

Verified locally on 4 November 2026. This is implementation evidence, not a claim that production authentication is configured or ready to deploy.

## Original implementation evidence — commit 83a8dc0

The following table records the original implementation checks, before the callback and claim-race follow-up below.

| Check | Result |
| --- | --- |
| Full backend suite, isolated PostgreSQL 18.6 | 146 passed, one existing Starlette/httpx deprecation warning |
| Backend Ruff and compilation | Passed |
| Python installed dependency consistency | Passed |
| Frontend Vitest | 221 passed across 17 files |
| Frontend ESLint and production build | Passed |
| Frontend production dependency audit | Zero reported vulnerabilities |
| PWA Chromium check | Passed: static-only cache, offline gate, practice retry, logout, cache update |
| Mobile Chromium check | Passed at 320, 390, and 760 pixels, including navigation, touch targets, focus, overflow and safe-area layout |
| Greek sign-in visual smoke | Passed at 320, 390, and 1280 pixels with an isolated mock API; no overflow or browser errors; 390-pixel screenshot inspected |
| Release/publication script regressions | 43 passed using local test registry and controlled HTTP servers |
| Production linux/amd64 Docker build | Passed |
| Built image with fresh PostgreSQL 18 | Passed startup migrations, database health, frontend shell, no-store/security headers, unconfigured-auth rejection, no password fallback, and disabled raw access logs |
| Migration/backup/restore | Passed PostgreSQL 17.11 and 17.11 → 18.6 rehearsals; see migration evidence |
| Independent integrated security review | No remaining identified application security blockers; see review record |

The full PostgreSQL 18 suite ran in a new isolated container with a dedicated disposable database. The image smoke used another isolated PostgreSQL/container network. All temporary containers, volumes, databases, and network created for these checks were removed; existing development databases and real learner data were untouched. The earlier local integration run used the existing PostgreSQL 17.11 test database and also passed; PostgreSQL 18 is the final full-suite evidence matching CI.

Backend checks cover unauthorised access, cross-account IDs, private imports/exports and atomic bulk operations, editor/admin permissions, unpublished metadata, archival/history preservation, claim expiry/revocation/reuse/regeneration, no automatic transfer, account/profile uniqueness, concurrent redemption, transaction rollback, blocked practice after ownership changes, private recovery requests, provider callback/linking restrictions, disabled identity-existence endpoints, and fail-closed provider configuration. Provider substitutes are test-only and do not provide a runtime login bypass.

Frontend checks cover sign-in states/callbacks, claim capture and URL scrubbing, explicit confirmation/cancellation/conflicts, private collections and empty responses, read-only shared controls, successful claim session refresh, account-change cache quarantine, and delayed preference responses that cannot replace another identity or role.

## Required external verification

No hosted authentication project, Google client, SMTP sender, paid plan, production migration, or production deployment was created or changed. Real Google and magic-link authentication, delivery, single-use/expiry, callback/domain configuration, browser cookie renewal/revocation and provider free-tier limits remain setup-dependent release gates. Follow the exact setup and administrator procedure in [authentication.md](authentication.md). Do not label the release production-ready until the operator completes these checks and verifies the production backup/migration plan.

See [migration evidence](authentication-migration-verification.md) and the [independent review](authentication-security-review.md). The approved work is tracked by [spec #52](https://github.com/fvoulgari/lexi/issues/52) and its ten sub-issues.

## Callback and independent-review follow-up — 4 November 2026

- Fixed failed Google/email callback recovery: replacement email requests continue showing delivery/cooldown states rather than a permanent completing screen. Failed callback query/fragment credentials are removed, and an existing internal `/claim` destination survives retry.
- Fresh independent Standards and Spec reviews inspected the authorization, isolation, legacy claims and migration boundaries. Standards had no actionable findings. Spec review found a claim-revocation race: an identity-mapped link could retain pre-revocation attributes after waiting for transaction locks. The locked query now reloads attributes with `populate_existing=True`.
- Both new concurrent revoke/regenerate regressions failed before this fix (redemption incorrectly returned success) and passed after it. They assert unchanged ownership and an unconsumed token. This is a resolved regression, not a remaining test failure.
- Current local full backend suite: **148 passed**, using the existing disposable PostgreSQL 17.11 test server. Ruff and compilation passed. Current full frontend suite: **223 passed across 18 files**; ESLint and build passed. The callback/account/claim focused run passed 42 tests.
- The rebuilt frontend also passed the isolated Chromium PWA check and mobile navigation checks at 320, 390 and 760 pixels.
- Non-failing warnings: Starlette/httpx deprecation and Vite's bundle-size advisory. These are not failed checks.
- CI access was restored: GitHub confirms required backend, frontend, image-validation and aggregate checks succeeded for `83a8dc0`. That result does not verify the follow-up commit. The follow-up commit's separate CI result is tracked in PR #63; pending or inaccessible checks must never be reported as passing.

The new [provider setup](authentication-setup.md), [staging checklist](authentication-staging-checklist.md), and [migration/rollback runbook](authentication-migration-runbook.md) distinguish operator instructions and pending real-provider acceptance from executed local tests. No hosted authentication, email delivery, production migration, merge or deployment was performed.
