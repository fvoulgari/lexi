# Authentication, ownership, and legacy progress

Lexi uses SuperTokens Core with the Python and browser SDKs for Google sign-in, email/password with mandatory email verification, secure password reset, and cookie sessions. PostgreSQL stores application accounts, one uniquely owned learner profile per account, content permissions, claim hashes, and private recovery requests. Identity uses the stable SuperTokens user identifier, never an email or display-name match.

Public registration grants a fresh learner profile. It grants no editor role or restricted legacy-library access. Ordinary learners manage their private cards and collections and practise explicitly published shared content. Only admins assign roles or publish reviewed shared content. Editors manage authorised shared content without access to anyone else's private profiles or collections. Claiming old progress does not change these permissions.

## Provider and cost boundary

The integration candidate is SuperTokens managed Core. The official [pricing page](https://supertokens.com/pricing) advertised the core methods as free below 5,000 monthly active users during this implementation's research. The threshold is not an unlimited free plan: usage outside it is billable. Account linking is a paid add-on, so automatic linking and client-requested linking are disabled. No billing account, paid feature, or hosted resource was activated by this change. Confirm current limits, applicable terms, and cost controls before provisioning; obtain explicit approval before any paid upgrade or recurring charge.

Different sign-in methods can create different accounts even when email strings match. There is no account-linking or account-transfer UI. Use the same method to return to an existing account. Do not try to repair this by changing provider subjects or merging email matches.

Email delivery uses Resend's HTTPS API through a SuperTokens email-delivery adapter. `RESEND_API_KEY` and a domain-verified `EMAIL_FROM` are required. No email service was activated or purchased. SMTP is not used, so Railway Hobby can remain unchanged. Passwords and authentication tokens are handled by SuperTokens; Lexi application tables contain neither password hashes nor passwords. Registration and recovery responses do not disclose whether an address exists. Magic-link sign-in is removed and old passwordless endpoints return 404. Legacy claim links remain available and distinct from authentication.

## Operator handoff

- [Exact provider, Google, HTTPS email, environment and cost setup](authentication-setup.md)
- [Pending staging end-to-end acceptance checklist](authentication-staging-checklist.md)
- [Production backup, migration and rollback runbook](authentication-migration-runbook.md)
- [Executed checks and verification limits](authentication-verification.md)

PR #63 remains a draft. These instructions authorise no merge, deployment, paid service, real claim, or production migration.

## External setup before rollout

1. Provision an approved free-tier Core instance or use a separately managed development Core. Record its HTTPS connection URI and backend-only API key. Do not enable paid account linking, MFA, or tenancy features. Confirm free-tier usage controls and review costs before any upgrade.
2. Configure a Google OAuth web client. Authorise the exact frontend origin and callback `https://YOUR_LEXI_HOST/auth/callback/google`. Use `http://localhost:5173/auth/callback/google` for the supported local origin. Put Google client credentials only in backend variables. Follow Google's consent-screen and production publishing requirements for the actual audience.
3. Verify a sender domain in Resend with its SPF/DKIM records and a suitable DMARC policy. Confirm free-plan quotas and billing before activating delivery. Put `RESEND_API_KEY` and `EMAIL_FROM` directly into the backend's protected variables.
4. Set `SUPERTOKENS_CONNECTION_URI`, `SUPERTOKENS_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, exact `PUBLIC_ORIGIN`, and `COOKIE_SECURE=true` in backend runtime variables. Keep all privileged values out of frontend bundles, build arguments, logs, and Git. The environment example contains placeholders only.
5. Enable supported email/password and required email verification recipes, configure Core verification/reset token and access/refresh session lifetimes, and verify the `/auth/verify-email` and `/auth/reset-password` flows. These links are provider-managed and single-use. `CLAIM_HOURS` controls only legacy claims. Account linking stays disabled; Google and password identities with the same email remain separate, and password recovery does not add a password to Google-only identities.
6. Keep the existing single application service and privately connected PostgreSQL. Production browser requests stay same-origin. Configure only verified proxy addresses in `FORWARDED_ALLOW_IPS`; never use `*` as a shortcut. Until proxy trust is verified, throttling may group users behind the same proxy. Do not add permissive CORS.
7. Complete the backup/migration procedure below, bootstrap one verified administrator, assign legacy-library access and editor roles explicitly, and verify both real-provider sign-in methods in staging. A working health endpoint does not imply authentication has been configured: `/api/auth/session` reports `auth_available=false` and authentication fails closed when required settings are absent.

Production Google, Core, HTTPS email, real browser callbacks, link delivery/single-use/expiry, renewal, and revocation require configuration-dependent end-to-end verification. Local provider substitutes in tests prove application behavior only. This change must not be called production-ready until these checks and the production migration are completed by an authorised operator.

## Local development

Use the existing frontend/backend development setup and a disposable local database. Set `PUBLIC_ORIGIN=http://localhost:5173` and `COOKIE_SECURE=false`; the Vite `/api` proxy retains the browser's same-origin requests. Configure an actual development Core, Google localhost web callback, and development HTTPS email sender. Explicit HTTP Core is allowed only in insecure local-cookie mode. No shared-password or mock-login fallback exists.

The browser SDK handles access-token refresh. Application cookies are HttpOnly, Secure in production, and SameSite=Lax for OAuth callbacks. Session credentials are not stored in localStorage. The SDK's `rid: session` header and same-origin checks protect writes; claim capture separately requires an exact Origin. Backend verification checks Core on each request so revocation stops application access immediately. Logout revokes the current session; logout-all revokes that provider user's application sessions, not the Google browser login itself.

API errors and security events omit credentials and claim secrets. Referrer policy is `no-referrer`, responses are `no-store`, and auth initiation is throttled in PostgreSQL. The production and native start commands disable Uvicorn raw access logs because OAuth callback queries contain one-time credentials. Configure reverse-proxy/edge monitoring separately to omit request bodies, cookies, Authorization headers, email-link fragments, and provider callback query strings. Apply provider abuse controls appropriate to the audience; rate limits are not email delivery quotas.

## Migration, backup, and rollback

Do not run these procedures on production as part of implementation. Before an authorised rollout, stop writes, take a verified PostgreSQL backup using matching client tools on the private network, restore it to a separate disposable database, and run Alembic there. Existing content becomes restricted legacy content; it is not published. Existing profiles are marked legacy, IDs and history remain, and old shared-gate sessions provide no access. New profile/account creation does not seed or reset legacy users.

Run `python -m app.admin_tools legacy-report` against the restored database first. It reports legacy profile IDs, claimed status, reviews, sessions, and progress counts without mutating ownership. Compare before/after totals and relationships and exercise practice in both directions. Check all pending ownership conflicts before rollout. Do not infer mappings from names or emails.

To bootstrap the first administrator, first sign in through the real provider, then obtain the exact stable subject from the verified provider record. On the deliberately selected database run `python -m app.admin_tools bootstrap-admin --subject VERIFIED_SUBJECT` for a dry run. Review the account/profile identifiers before adding `--apply`. This privileged operator command grants no legacy-library access, refuses a different bootstrap when an administrator exists, and records a sanitised event. Thereafter manage roles through the authenticated admin interface. Do not guess a subject or expose this command as a public endpoint.

Use the claim procedure below to associate legacy users, preferably before general rollout. Legacy-library access and editor rights require separate explicit admin assignments. A person with new activity requires a reviewed resolution procedure; the application does not merge or discard data automatically.

Startup runs migrations before readiness, as before. Automatic downgrade is disabled for the ownership/claim migrations because removing those boundaries could expose private content. Do not redeploy an old shared-gate image against an account-isolated database. For failure recovery, stop writes and restore the verified pre-change backup into a replacement private database, validate its data and compatible application image, and switch the private connection only under a reviewed operator procedure. Retain the original database and backup. See the existing Railway release guide for backup tooling; its old shared-password/profile-selection instructions are superseded by this document.

## Administrator guide: legacy claims

1. Sign in as an administrator and open the admin area. Inspect unclaimed legacy profiles and their review/session counts. Verify the intended person's identity through an existing trusted channel. Matching a name is never proof.
2. Before issuing a link, acknowledge that **anyone possessing it who signs in can claim that profile**. The link is a bearer authorisation, not an invitation restricted to a named email. Generate it only after verification and manually send it through the trusted channel. Lexi never sends claim messages automatically.
3. Links expire after 48 hours by default (`CLAIM_HOURS`, range 1–168), are single-use and bound to one profile. Generating another invalidates prior outstanding links. Revoke an outstanding link after suspected misdelivery. The raw token appears only in the generated URL at issuance; only its hash is stored.
4. The recipient opens `/claim#token=...`. The frontend immediately removes the fragment from the visible URL and captures it into a short-lived server-side continuation behind an opaque HttpOnly cookie. The recipient signs in and returns to `/claim`; the secret is not put in provider redirects or localStorage. Continuations expire after 20 minutes; reopen the original valid link if sign-in takes longer.
5. After authentication and token validation, show the profile name and progress summary. The recipient must explicitly choose “Σύνδεση προφίλ”. GETs and preview scanners cannot redeem links. Cancellation changes no ownership. Successful redemption atomically associates the legacy profile and consumes the token while retaining account-level preferences and roles.
6. Replacement requires a genuinely empty temporary profile/account across learning sessions, reviews, progress, private cards, units, tags, and collections. Imports currently execute synchronously and have no separate durable job records; any future import-job relationship must be included in eligibility checks before release. Empty former profiles are retained rather than cascade-deleted and are not listed as legacy profiles.
7. When new activity or owned content exists, Lexi leaves both profiles, all data, and the token unchanged and records one pending resolution case with a dry-run report. Inspect it in the admin area. Actual reconciliation requires a separately reviewed migration; do not force reassignment, retire profiles, or consume the link as a workaround.
8. Learners can privately request previous progress from onboarding/settings using an old profile name and optional note. Responses do not disclose whether a profile exists. Review the private request, verify identity through a trusted channel, then reject it or resolve it by issuing a link. Issuing does not redeem or deliver the link.

Claims never grant editor/admin roles or restricted-library access. Claimed profiles cannot be transferred or claimed again. Generation, revocation, redemption, conflicts, and request resolution produce sanitised audit events without bearer secrets. Retain request notes only as needed for support; avoid requesting unnecessary personal information.

## Content changes and history

Ordinary delete archives a card; authorised restore reverses archival. Reviews, progress, and completed-session history remain. Archived cards are omitted from new practice and active listings. Content visibility is still enforced for historical wording: inaccessible snapshots are redacted without deleting the learner's review totals. Private collections are references and never confer access. Personal variants are distinct cards with independent progress.

The current release preserves the Italian–Greek fields while introducing explicit `it`/`el` language identifiers; it adds no further language-specific columns or additional-language entry/practice UI. Progress remains distinguished by learner, card and tested direction. Family accounts, profile switching, general merging, permanent-deletion UI, and account erasure are outside this release.
