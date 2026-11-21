# Authentication operator setup

Use this guide when configuring a Lexi environment or rotating provider
credentials. See the [historical production release record](authentication-production-release-2026-11-20.md)
for rollout evidence. Review provider costs, quotas and account-linking settings
before provisioning a new environment.

## Origins and provider resources

Exact origins: production `https://lexi.fotiniv.com`; isolated staging `https://staging-lexi.fotiniv.com`. Keep separate databases, Core deployments/API keys and Google web clients for staging and production. Never populate staging with unredacted production data.

For each environment:

1. In the [SuperTokens dashboard](https://supertokens.com/dashboard), create/select the managed deployment. Store its HTTPS connection URI and API key directly in the backend runtime's protected variables. Do not expose Core administration to browser code. Keep automatic account linking and other paid features disabled.
2. Enable email/password and required email verification in Lexi's SDK recipes; do not enable passwordless. The managed development dashboard reports configuration changes are available only to production Cores. Leave its disabled bcrypt setting unchanged. Restricted synthetic staging tests may proceed with short passwords; see [development versus production hashing requirements](authentication-hashing.md). Do not infer that a paid upgrade is needed. For production with the unchanged 15–128-character Unicode policy, separately confirm provider-supported Argon2 and non-truncation before accepting real users. Passwords and hashing remain entirely inside Core.
   Production target lifetimes are `password_reset_token_lifetime=3600000` milliseconds (one hour) and `email_verification_token_lifetime=86400000` milliseconds (one day), using supported editable Core configuration. The dashboard may instead display seconds: enter `3600` and `86400` only when those fields explicitly say seconds. Record development's actual read-only values; do not claim the targets were applied. See the [Core configuration reference](https://github.com/supertokens/supertokens-core/blob/master/config.yaml). The former `passwordless_code_lifetime` setting is no longer applicable.
3. Production session targets are `access_token_validity=3600` seconds and `refresh_token_validity=10080` minutes (7 days). Set them only where supported and editable, respecting the dashboard's displayed units. Record development's current read-only settings and test against those actual values. These Core names and units come from [Core's configuration reference](https://github.com/supertokens/supertokens-core/blob/master/config.yaml); its default refresh lifetime is 144000 minutes, not 7 days. Resolve unavailable production controls with the provider before rollout rather than silently accepting a different lifetime. Test renewal/inactivity behavior; refresh lifetime is not a guaranteed absolute session deadline.
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
3. In Resend **API Keys**, create a sending-only key restricted to that domain. Enter it directly into **Railway → Lexi → staging → staging application → Variables → `RESEND_API_KEY`** and protect it there. Set `EMAIL_FROM` to a sender on the verified domain, such as `Lexi <noreply@auth.fotiniv.com>`. The staging domain is verified; verify the separate production key and account limits before production use. Do not paste keys into chat, PRs, or screenshots.
4. Test both verification and reset delivery, rejected recipients, quotas, network timeouts and provider outages. Public registration/recovery acknowledgements intentionally do not reveal email existence or delivery status; operators receive a sanitised failure event. Acknowledgement does not prove delivery.

Verification links use `${ORIGIN}/auth/verify-email`; reset links use `${ORIGIN}/auth/reset-password`. Keep SDK-generated token/tenant parameters intact. The UI requires explicit confirmation/submission, never consumes tokens on GET, and clears token URLs after a definitive success or invalid-token result. Transient network failures retain the URL token so retry remains possible; tokens are never stored in browser storage. Reset revokes existing sessions for that password identity. The provider may mark email verified after successful password reset because it proves inbox possession; protected data still requires the provider's verified status. Password-reset email never creates or links a password identity for a Google-only account.

## Backend runtime variables

Set these in the selected environment's protected runtime configuration, never frontend `VITE_*` variables or build arguments. Values below describe requirements, not credentials.

| Variable | Required setting |
| --- | --- |
| `DATABASE_URL` | Selected environment's private PostgreSQL connection using the restricted runtime login. SQLAlchemy accepts `postgresql+psycopg://`; standard PostgreSQL URLs are normalised. |
| `PUBLIC_ORIGIN` | Exact selected HTTPS origin, no trailing slash. |
| `COOKIE_SECURE` | `true` in staging/production. |
| `SUPERTOKENS_CONNECTION_URI` | Selected Core's HTTPS connection URI. |
| `SUPERTOKENS_API_KEY` | Selected Core's secret API key. |
| `GOOGLE_CLIENT_ID` | Selected environment's web client ID. |
| `GOOGLE_CLIENT_SECRET` | Corresponding secret. |
| `RESEND_API_KEY` | Secret, sending-only Resend API key restricted to the verified sender domain. |
| `EMAIL_FROM` | Verified sender, optionally `Lexi <address@verified-domain>`. |
| `AUTH_INGRESS_MODE` | `cloudflare_tunnel` on hosted environments. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Sealed connector credential for the selected environment. |
| `LEXI_PRODUCTION_TUNNEL_ENABLED` | `true` for the production tunnel. |
| `LOGIN_LIMIT` | `5`; application authentication, verification and recovery limit per client-address hash in a 60-second window. Hosted ingress provenance must be verified separately. |

Keep browser requests same-origin and omit credentials and token URLs from edge logs.
The start command disables raw application access logs.
Verify both sign-in methods, verification and reset delivery, and session renewal
when changing provider configuration. Check `/api/auth/session` for
`auth_available=true` before testing those browser flows.

## Password-attempt and hosted IP-limit status

Password sign-in also applies persistent tenant/identifier failure backoff: up to
one second on failed responses after repeated failures in five minutes. It stores
HMAC identifiers using the sealed Core API key, never raw emails/passwords; valid
credentials are not locked out. This supplements rather than replaces IP limits.
Hosted IP limits use the isolated Tunnel ingress. Failed-password verification is serialized
per HMAC tenant/identifier using a short PostgreSQL advisory lease across replicas,
with a ten-second provider timeout, bounded failure delay and no persistent account
lockout. Busy concurrent attempts receive a generic 429; provider timeout is 503.
Lease cancellation and failure recording are covered by regression tests.

## Hosted Tunnel configuration

Production and staging route their respective hostnames through Cloudflare
Tunnel to the application listener on loopback. The supervisor also binds
connector metrics to loopback and disables Uvicorn proxy-header trust.
Verify the exact Environment ID, public origin and Google callback before
rotating a connector token. Keep Railway public app domains and database TCP
proxies disabled. Use the [Railway release runbook](railway-release.md) for
readiness and [staging restart](staging-restart.md) for the paused environment.
