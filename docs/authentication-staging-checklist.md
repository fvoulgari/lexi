# Authentication staging acceptance checklist

Run only after [provider setup](authentication-setup.md), with disposable synthetic learners, vocabulary and legacy profiles. Keep separate staging Core, Google client and database; stay within verified free quotas. This checklist is **pending**, not a claim of end-to-end success. Local mocked-provider tests and migration rehearsals do not verify Google, SMTP, cookies or live Core.

Record each result as PASS / FAIL / NOT RUN with date, tested commit/image, browser, non-secret environment identifier and sanitised evidence. Never attach link tokens, callback queries, cookies, credentials, personal emails or unredacted traces. A failed or inaccessible CI run is not a pass.

## Real authentication and callback recovery

- [ ] Both public Google registration and a delivered email magic link create one owned profile with learner role, no legacy access and no editor permissions. Repeat sign-in with the same method returns that account.
- [ ] Google denial, invalid/mismatched state and interrupted callbacks fail safely. Simulate one transient callback/session-hydration failure and retry without an infinite loop or duplicate account/profile. A completed callback reload returns to the application safely; unrecoverable/reused OAuth codes lead to fresh sign-in.
- [ ] Email sender/domain authentication passes; test inbox and spam delivery, rejected recipient and SMTP outage. UI errors are safe and signing in cannot silently succeed without proof of email possession.
- [ ] A fresh magic link works once. Reuse fails; a link held beyond configured 10 minutes fails. Resend/cross-tab behavior produces clear recovery. Wrong-origin links never redirect to attacker-controlled hosts.
- [ ] Signing in with Google and magic link using the same address does not silently link accounts; explain to testers to return with the original method.
- [ ] Unconfigured/unreachable Core fails closed; a health response alone never bypasses sign-in. All logged-out direct API calls and stale old shared-gate sessions lack protected access.

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
