# Authentication operator setup

Prepared 4 November 2026. These are operator instructions, not evidence of provisioning or deployment. PR #63 remains a draft; readiness, merging and deployment require separate authorisation even after its release gates are resolved. See [staging checks](authentication-staging-checklist.md) and [migration/rollback](authentication-migration-runbook.md).

## Decisions and costs before provisioning

Railway account inspection confirmed Hobby on 4 November 2026. Email delivery
now uses Resend over HTTPS; SMTP is not used and no Railway upgrade is required.
See the [staging preparation and cost estimate](authentication-staging-preparation.md).
No hosted resources or paid plans have been approved or activated.

SuperTokens managed Core is the implementation candidate. Its current [pricing](https://supertokens.com/pricing) advertises free service **under 5,000 monthly active users** and $0.02/MAU outside the free offer. MAUs are unique logged-in users per month, including registrations. Confirm whether billing at the threshold covers all MAUs or only excess usage, available hard spending limits, and separate staging usage with the provider; do not assume incremental billing or that alerts prevent charges. No paid plan, billable upgrade, or recurring charge is authorised. If free-only operation cannot be assured, stop for approval.

Account linking is disabled by the application; leave paid add-ons disabled. The pricing page lists account linking at $0.005/MAU with a $100 minimum. Resend HTTPS delivery is implemented but not activated: confirm its free-plan quotas, sandbox restrictions, domain ownership and billing separately. Ordinary Google OAuth client configuration is used, not Google Cloud Identity Platform; no paid Google service is required by this code. Confirm the selected projects incur no unrelated charges.

## Origins and provider resources

Choose exact origins `STAGING_ORIGIN` and `PRODUCTION_ORIGIN` (scheme and host, optional port, no path or trailing slash). Production is `https://lexi.fotiniv.com`; proposed staging is `https://staging.lexi.fotiniv.com`, pending DNS and isolated service provisioning. Keep separate databases, Core deployments/API keys and Google web clients for staging and production. Never populate staging with unredacted production data.

For each environment, after verifying free-only terms:

1. In the [SuperTokens dashboard](https://supertokens.com/dashboard), create/select the managed deployment. Store its HTTPS connection URI and API key directly in the backend runtime's protected variables. Do not expose Core administration to browser code. Keep automatic account linking and other paid features disabled.
2. Enable email/password and required email verification. Do not enable passwordless. Password validation is 15–128 characters for registration and reset, with spaces and Unicode allowed. Passwords are stored only by Core. Set `password_reset_token_lifetime=3600000` milliseconds (one hour) and `email_verification_token_lifetime=86400000` milliseconds (one day) using the selected Core's supported configuration; verify saved values, expiry and single use in staging. See the [Core configuration reference](https://github.com/supertokens/supertokens-core/blob/master/config.yaml). The former `passwordless_code_lifetime` setting is no longer applicable.
3. In the same deployment configuration set `access_token_validity=3600` seconds and `refresh_token_validity=10080` minutes (7 days). Confirm the saved values in the selected Core deployment before testing. These names and units come from [Core's configuration reference](https://github.com/supertokens/supertokens-core/blob/master/config.yaml); its default refresh lifetime is 144000 minutes, not 7 days. If the managed console does not expose a field, resolve that with provider support before rollout rather than silently accepting a different lifetime. Test actual renewal/inactivity behavior; refresh lifetime is not a guaranteed absolute session deadline.
4. Record non-secret deployment identifier, selected region, quotas, saved lifetimes and cost controls in the private operator record. Keep API keys and credential screenshots out of GitHub/chat.

## Google web client

Repeat separately for staging and production in [Google Auth Platform](https://console.cloud.google.com/auth/overview):

1. Select the intended Cloud project. In **Branding**, set Lexi's name, support contact, authorised domain, homepage and privacy-policy URLs. Supply actual operator-controlled URLs. In **Audience**, choose External for public registration; use Testing plus explicitly listed synthetic test users for staging. Complete the production publishing/verification requirements reported by Google before public launch.
2. In **Data Access**, request only `openid`, `email`, and `profile`. In **Clients → Create client**, choose **Web application** and an environment-specific name.
3. Add the exact environment origin to **Authorised JavaScript origins**. Add exactly `${ORIGIN}/auth/callback/google` to **Authorised redirect URIs**. Here `${ORIGIN}` means the chosen literal origin, not a string pasted into Google. No wildcard, `/api` prefix or trailing slash. Store the client ID and secret directly in the backend secret store.
4. For a separate local client, use origin `http://localhost:5173` and redirect `http://localhost:5173/auth/callback/google`. Do not weaken production cookie/HTTPS settings for local development.

Google documents [client/branding setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) and requires [exact redirect matching](https://developers.google.com/identity/protocols/oauth2/web-server). Lexi uses SuperTokens' OAuth web redirect flow, not One Tap; no extra Google browser library is needed.

## Email delivery

Use the [Resend HTTPS email API](https://resend.com/docs/api-reference/emails/send-email) via SuperTokens' supported [email-delivery service interface](https://supertokens.com/docs/platform-configuration/email-delivery). No SMTP connection or shared provider sender is used.

1. Before activating delivery, inspect Resend's **Billing** and confirm the Free plan, payment/upgrade behavior and available quota controls. Its [published free quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits) are 100 messages/day and 3,000/month, shared between sent and received messages; confirm them in the account. Do not add payment details or enable paid features without approval. SuperTokens automatic billing remains a separate unresolved check.
2. In Resend **Domains**, add an operator-owned sending subdomain (for example `auth.fotiniv.com`, subject to DNS approval). Enter the exact SPF/DKIM records Resend supplies in the domain's DNS console, verify them in Resend, and set an appropriate DMARC policy. Disable click/open tracking for authentication email to avoid token-link rewriting.
3. In Resend **API Keys**, create a sending-only key restricted to that domain. Enter it directly into **Railway → Lexi → staging → staging application → Variables → `RESEND_API_KEY`** and protect it there. Set `EMAIL_FROM` to a sender on the verified domain, such as `Lexi <noreply@auth.fotiniv.com>`. These are proposed sender details, not an already verified domain. Do not paste keys into chat, PRs, or screenshots.
4. Test both verification and reset delivery, rejected recipients, quotas, network timeouts and provider outages. Public registration/recovery acknowledgements intentionally do not reveal email existence or delivery status; operators receive a sanitised failure event. Acknowledgement does not prove delivery.

Verification links use `${ORIGIN}/auth/verify-email`; reset links use `${ORIGIN}/auth/reset-password`. Keep SDK-generated token/tenant parameters intact. The UI requires explicit confirmation/submission, never consumes tokens on GET, and clears token URLs after submission. Reset revokes existing sessions for that password identity. The provider may mark email verified after successful password reset because it proves inbox possession; protected data still requires the provider's verified status. Password-reset email never creates or links a password identity for a Google-only account.

Legacy claims remain `${ORIGIN}/claim#token=<generated-token>`, with default 48-hour validity and a separate 20-minute continuation. They are not sign-in links and remain available after removing magic-link login. Never log their fragments or register them as Google callbacks.

## Backend runtime variables

Set these in the selected environment's protected runtime configuration, never frontend `VITE_*` variables or build arguments. Values below describe requirements, not credentials.

| Variable | Required setting |
| --- | --- |
| `DATABASE_URL` | Selected environment's private PostgreSQL connection; password is secret. SQLAlchemy accepts `postgresql+psycopg://`; standard PostgreSQL URLs are normalised. |
| `PUBLIC_ORIGIN` | Exact selected HTTPS origin, no trailing slash. |
| `COOKIE_SECURE` | `true` in staging/production. |
| `SUPERTOKENS_CONNECTION_URI` | Selected Core's HTTPS connection URI. |
| `SUPERTOKENS_API_KEY` | Selected Core's secret API key. |
| `GOOGLE_CLIENT_ID` | Selected environment's web client ID. |
| `GOOGLE_CLIENT_SECRET` | Corresponding secret. |
| `RESEND_API_KEY` | Secret, sending-only Resend API key restricted to the verified sender domain. |
| `EMAIL_FROM` | Verified sender, optionally `Lexi <address@verified-domain>`. |
| `FORWARDED_ALLOW_IPS` | Verified trusted proxy IPs/CIDRs; never `*`. Default `127.0.0.1` is not proof the actual edge proxy is trusted. |
| `CLAIM_HOURS` | `48`; allowed 1–168, controls legacy claims only. |
| `LOGIN_LIMIT` | `5`; application authentication, verification and recovery limit per client-address hash in a 60-second window. |

`SESSION_HOURS` is parsed for compatibility but unused: it does **not** configure provider sessions. `SHARED_PASSWORD` and `SESSION_SECRET` do not restore old gate authentication. `POSTGRES_PASSWORD` belongs only to local database provisioning, not an extra production application setting.

Keep frontend and API same-origin; no permissive CORS. Validate proxy trust before interpreting per-client throttling. Configure edge logs to omit auth callback query strings, cookies, bodies, Authorization headers and claim secrets. The application start command disables raw access logs; check upstream logs independently. `/api/health` proves neither provider connectivity nor delivered email. `/api/auth/session` must report `auth_available=true`, followed by the complete [real-provider checklist](authentication-staging-checklist.md).
