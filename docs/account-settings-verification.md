# Account settings and authentication feedback — 4 November 2026

## Implementation

The account card keeps the existing cream/sage surface and typography, showing
one name, email and credential methods. Identity and actions have separate
spacing; actions stack at narrow widths. Sign-out-all remains secondary. The
page title is singular in English and Italian; the Greek word «Προφίλ» already
serves the singular. Generic privacy paragraphs were removed from these cards.
All new presentation styles are scoped to `.account-card` or `.gate-card`.

The authenticated, verified `/api/account/credentials` endpoint obtains the
current user's actual login methods from SuperTokens, filtered by session tenant
and tied to its recipe identity. It never searches globally by email. Google-only
identities cannot change or create a password. A password method on the actual
provider account is available independently of the latest sign-in method; an
ambiguous set of password credentials fails closed.

`POST /api/account/password` requires the existing session/CSRF checks and an
account-specific rate limit. Secret request fields and confirmation are validated.
SuperTokens `verify_credentials` checks the current password; the returned user
and recipe IDs must match the selected owned credential. Only then does
`update_email_or_password` apply the existing provider password policy. Success
revokes every session for that provider account and clears the current session,
matching password-reset policy. There is no custom hashing, password persistence,
account linking, new environment variable or database migration.

The registration bug was reproduced before fixing: success set a registration
notice and then selected sign-in, leaving that notice visible in the wrong view.
Registration, reset and verification completion now remain in their own views
until explicit navigation. Recovery acceptance replaces its form with a compact
conditional acknowledgement and the submitted email, not a delivery claim.
Request-generation checks ignore late responses. Feedback stores translation
keys so a language change does not retain old-language notices or validation.
Verification resend retains its controls. Pending/error states remain specific
to the requested operation and re-enable controls on failure.

## Executed checks

- Before: two failing UI regressions reproduced registration text under sign-in
  and an accepted reset keeping its email form visible.
- Frontend: **262 passed across 20 files**; ESLint and Vite build passed.
- Backend: **179 passed**, including the opt-in real local Core integration;
  Ruff lint and format checks passed. One existing Starlette/httpx deprecation
  warning and the existing Vite bundle-size warning remain non-failing.
- The pinned, disposable local SuperTokens Core used Argon2 and its own
  PostgreSQL database. Tests rejected an incorrect current password, accepted a
  valid change, revoked two existing sessions, rejected the old password,
  accepted the replacement, preserved account identity, and left the separate
  Google identity unchanged. Email was captured in memory, not delivered. The
  local Core/database containers, anonymous volumes and network were removed.
- Endpoint tests covered Google-only/matching-email separation, actual credential
  availability after Google login, different-user/recipe rejection, another
  tenant's credential, missing provider records, provider failure, validation,
  CSRF rejection and throttling.
- UI tests covered password/current-password autofill, show/hide controls,
  required/mismatched fields, incorrect-password/service errors, cancellation,
  successful reauthentication, reset acceptance/failure, pending-view switches,
  language changes and existing Google/verification/legacy continuation.
- Local Chromium snapshots passed at **1280, 390 and 320 pixels**, in English,
  Greek and Italian. Verified no horizontal overflow, at least 16 pixels between
  identity and actions, initial password focus, Google-only hiding and reset
  replacement. Before and after account/reset screenshots were inspected.

## Screenshots

All images use synthetic fixtures. `frontend/tests/account-ui.mjs` captures the
views using intercepted local API responses; these are not live-provider browser
acceptance tests. The before build was preserved from the prior revision before
editing. Artifacts are local under `.scratch/account-ui/`:

| Component | Before | After |
| --- | --- | --- |
| Account, desktop | `before/account-1280.png` | `after/account-1280.png` |
| Account, mobile | `before/account-390.png` | `after/account-390.png` |
| Reset request, desktop | `before/reset-request-1280.png` | `after/reset-request-1280.png` |
| Reset request, mobile | `before/reset-request-390.png` | `after/reset-request-390.png` |
| Reset accepted, desktop | `before/reset-accepted-1280.png` | `after/reset-accepted-1280.png` |
| Reset accepted, mobile | `before/reset-accepted-390.png` | `after/reset-accepted-390.png` |

Additional Google-only/password-form images are in `after/`; localized variants
are in `after/el/` and `after/it/`, including 320-pixel views.

## Limits and release state

This revision was **not deployed** to staging or production. Live managed-Core
password change, delivered verification/reset mail and provider/browser session
behaviour remain to be checked after separately authorised deployment. Existing
production hashing and hosted acceptance gates remain open; a local Argon2 pass
does not certify the development managed Core's bcrypt policy. Existing progress,
permissions, isolation, legacy claims and migration behaviour are unchanged.
Keep PR #63 draft; no merge or deployment is authorised for this revision.

Provider APIs were checked against the installed SDK and the
[official SuperTokens Python API](https://supertokens.com/docs/python/recipe/emailpassword/syncio/index.html).
