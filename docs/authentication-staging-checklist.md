# Authentication staging acceptance checklist

Run only after [provider setup](authentication-setup.md), with disposable synthetic learners, vocabulary and legacy profiles. Keep separate staging Core, Google client and database; stay within verified free quotas. This checklist is **pending**, not a claim of end-to-end success. Local mocked-provider tests and migration rehearsals do not verify Google, delivered email, cookies or live Core.

Record each result as PASS / FAIL / NOT RUN with date, tested commit/image, browser, non-secret environment identifier and sanitised evidence. Never attach link tokens, callback queries, cookies, credentials, personal emails or unredacted traces. A failed or inaccessible CI run is not a pass.

## Real authentication and callback recovery

- [ ] Google registration creates one owned profile with learner role and no legacy/editor permissions. Password registration returns a generic acknowledgement without an identity/session; sign-in before email verification exposes no application profile, vocabulary, progress, collections, admin or claim data. After verification, sign-in provisions exactly one owned profile.
- [ ] Google denial, state mismatch, interrupted callbacks and a transient hydration failure recover safely without duplicate accounts/profiles; a pending `/claim` destination survives retries. Reused OAuth codes require fresh sign-in.
- [ ] Registration, sign-in and reset validate passwords appropriately. Check 14/15/128/129-character boundaries, spaces, Unicode, paste, password managers, current/new-password autofill and accessible show/hide controls. Confirm Core ARGON2 hashing and reject a wrong long password differing only beyond byte 72.
- [ ] Verification and reset mail arrives from the verified HTTPS sender with tracking disabled. Check inbox/spam, rejected recipient, quota exhaustion, timeout and provider outage. Generic acknowledgement is not evidence of delivery.
- [ ] Verification/reset links require explicit confirmation/submission, work once, and fail after configured expiry or reuse. Invalid/foreign tokens cannot change identity or password. URL parameters are cleared after submission and never logged or persisted. Test verification in another browser, without a session, and while a different account is signed in.
- [ ] Password sign-in fails generically for wrong credentials, missing identities and Google-only identities. Registration/recovery responses and cookies do not disclose existence, including duplicate registration and delivery outage. Rate limiting covers signup, signin, recovery, reset and verification, including public-tenant aliases.
- [ ] Google and password identities with the same email remain separate; their account IDs and learning data differ. Recovery for a Google-only email does not create a password account. Explicit linking flags are rejected. UI explains original-method recovery without exposing identity existence.
- [ ] Successful reset revokes existing sessions for that password identity; other users and a separate Google identity remain unaffected. Return to password sign-in after reset. Verify provider-required email status before protected access.
- [ ] Old passwordless code/create/resend/consume and email/phone existence endpoints return 404, including public aliases; old `/auth/verify` URLs cannot create sessions. Unreachable Core fails closed; logged-out direct APIs and old shared-gate sessions lack access.

## Sessions and request security

- [ ] Browser access/refresh credentials are HttpOnly, Secure and SameSite=Lax on HTTPS; no credentials or claim tokens in localStorage. Refresh access after expiry and confirm expected Core refresh window; revoke the session and verify the next protected request fails immediately.
- [ ] Logout revokes this session. Logout-all invalidates two browser sessions for the same provider subject, while an unrelated user's session remains valid.
- [ ] A foreign Origin and a missing session custom header cannot mutate authenticated protected data, including claim redemption. Pre-authentication claim capture requires the exact Origin and cannot change ownership; valid same-origin browser requests work. Attempt credentialed cross-origin calls from a disposable foreign origin.
- [ ] Auth initiation exceeding the configured rate returns throttling, resets after the window, and cannot be bypassed with forged forwarded headers. Verify two real clients are distinguished behind the trusted proxy.
- [ ] Edge/application logs, referrers, error reports and cache behavior disclose no auth/claim secrets; auth responses are not shared-cached. Use sanitised browser inspection rather than exporting HAR files with credentials.

## Two-user isolation and roles

- [ ] Learner A creates cards, units/tags, imports, collections, settings and reviews in both directions. Learner B cannot list, fetch, export, modify, archive, restore or practise A's records by guessed IDs, query parameters, CSV/bulk requests or collection references.
- [ ] A and B see published shared vocabulary. Restricted legacy content remains invisible without explicit access; collection membership and historical snapshots do not bypass visibility. Removing legacy access revokes access on the next request.
- [ ] Personal variants have new ownership and independent progress. Collection references do not copy cards or confer editing rights. Reject inaccessible/private foreign cards in collections and practice requests.
- [ ] Learners cannot assign roles, publish, or mutate shared content through UI or direct API. Admin assigns/revokes editor role; editor can manage permitted shared cards/units/tags/imports/bulk operations but cannot assign roles, publish or access A/B's private data. Revocation takes effect on the next protected request.
- [ ] CSV imports/exports and mixed bulk selections obey every item's permission; rejected requests leave no unauthorised partial changes. No foreign/private data leaks in counts, errors or exports.
- [ ] Authorised archive/restore preserves reviews, progress, completed sessions and snapshots. Archived cards stay out of future practice, including collection practice. Unauthorised archive/restore fails; inaccessible wording is redacted in history without losing review totals.
- [ ] Interface language uses local/browser selection before sign-in, saved account preference after sign-in, and current selection if initially unset. Other learning settings are account-owned; device accessibility stays local. No profile switching appears.

## Legacy claims and private recovery

- [ ] Admin-only issue/revoke/list controls reveal no profile directory to learners. Private recovery requests disclose no existence information to the requester; only authorised admins review them.
- [ ] Verify synthetic claimant identity manually. Issue bearer link, confirm fragment disappears immediately and login continuation survives sign-in without token leakage to provider redirects, localStorage or logs. Preview/GET/cancel never claims.
- [ ] Explicit redemption into an empty account preserves the legacy profile ID, all history and current account preferences/roles. It grants no legacy-library/editor/admin permissions; former empty profile remains retained.
- [ ] Expired, revoked, regenerated and already consumed links fail without ownership change, including revocation/replacement committed while redemption waits on a database lock. Continuation expiry at 20 minutes requires reopening a still-valid original link. Test sign-in taking longer than this without losing data.
- [ ] Race two accounts against one link and two links against one account: exactly one eligible transaction succeeds, no duplicate owners or partial updates. Check database uniqueness and complete original history afterward.
- [ ] Attempt redemption after new reviews, sessions or owned cards/units/tags/collections exist. Both profiles, all data and link remain unchanged; one private pending conflict/report is created. No automatic merge, reassignment, retirement or review loss.
- [ ] Claimed legacy profiles cannot be transferred/reclaimed. Sanitised security events exist for issuance/revocation/redemption/conflicts/request resolution, with no bearer secrets.

## Release evidence

- [ ] Repeat [backup/restore and upgrade checks](authentication-migration-runbook.md) on synthetic legacy fixtures; compare IDs, counts, timestamps, snapshots and constraints. Record independent security review findings and closure of material findings.
- [ ] Record actual local test and GitHub CI outcomes for this exact commit. Mark inaccessible CI as NOT VERIFIED with its reason. Resolve failures before proposing promotion.
- [ ] Keep PR #63 draft; no merge, tag, deploy, real claims or production migrations are authorised by completing this checklist.
