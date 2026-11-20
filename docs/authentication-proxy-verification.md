# Authentication rate-limit proxy verification — 6 November 2026

## Result

Three new regressions passed against actual disposable PostgreSQL using the
installed Uvicorn ProxyHeadersMiddleware and the application AuthBoundary:

- An untrusted transport peer cannot rotate its bucket using X-Forwarded-For,
  X-Real-IP, Forwarded, CF-Connecting-IP or a public Host header. An unrelated
  transport peer retains its own allowance; throttling returns Retry-After.
- A deliberately allowlisted synthetic proxy distinguishes forwarded clients.
  Expiring the persisted window restores the allowance.
- Different forwarded clients behind the same untrusted transport peer share
  one bucket. This reproduces the configuration hazard; it is not evidence that
  the actual Railway deployment has been probed or correctly configured.

Fixtures use documentation-only IP ranges. They are not deployment allowlists.
Provider calls are replaced by an inert endpoint; the HTTP boundary, Uvicorn
header handling and PostgreSQL rate accounting are real. Ruff passed.

## Provider constraints

Railway's [public networking specifications](https://docs.railway.com/networking/public-networking/specs-and-limits)
identify X-Real-IP. Its [employee clarification](https://station.railway.com/questions/need-authoritative-client-ip-proxy-tru-090eac86)
confirms the public edge overwrites caller-supplied X-Real-IP and X-Forwarded-For
for custom and generated domains. It publishes neither ingress CIDRs nor a
signed ingress header. Private-network traffic bypasses sanitization, and
Cloudflare-to-Railway IPv6 end-client derivation is not confirmed there.
[Private networking](https://docs.railway.com/networking/private-networking/how-it-works)
now supports IPv4 as well as IPv6, so binding 0.0.0.0 is not proof of private
HTTP isolation. A matching public Host can be forged on private ingress.

Current start.sh retains loopback-only proxy trust by default. It prevents
arbitrary remote forwarding-header trust but does not establish separate client
buckets behind Railway. Do not set FORWARDED_ALLOW_IPS='*', guess a private CIDR,
trust a fixed hop count or accept X-Real-IP solely because Host matches.

## Concrete path to closing the gate

Prefer an authenticated origin boundary if Railway cannot supply a supported
public/private transport discriminator or ingress isolation. An explicitly
configured edge must overwrite a secret origin-auth header and canonical client
IP; the application must validate the secret before accepting the IP and reject
unauthenticated direct/private requests. Health checks require a minimal exception
that cannot reach authentication or protected data. Secrets belong only in edge
and sealed backend configuration, with overlapping-key rotation and no logs.

Cloudflare proxying with an origin request-header rule is a candidate, subject to
verification of current plan capabilities and cost. It requires an intentional
routing/configuration change and a staging deployment, neither authorised by this
verification. Do not implement unauthenticated header trust as an interim shortcut.
Do not expose a public diagnostic endpoint that echoes client addresses or secrets.

After approving the boundary and deployment: prove same-client throttling and
header-spoof resistance through both the custom and generated domains; prove a
second independent network retains its allowance; attempt private-network bypass;
verify reset after the window and unchanged session/claim behavior. No mail needs
to be sent: use inert invalid requests and bounded counts, recording only status
codes. Close the release gate only after those hosted checks pass.

No deployment, external resource, billing, DNS or production configuration changed.
