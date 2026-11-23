# Curated language catalogue

The database registry from ADR 0006 is the single source of truth for language metadata and practice directions. An API publishes only the curated, publicly available subset; the frontend hydrates from that response and keeps no static language list.

## Decision

- `languages` rows carry `display_name`, `script`, `text_direction`, `publicly_available` and `enhanced`. `practice_directions` rows carry their explicit prompt/answer languages and a `legacy` flag.
- `GET /api/languages` returns only public languages and directions whose endpoints are both public. Registered but non-curated languages are usable by backend validation and tests but never advertised.
- Backend validation (pairs, directions, request schemas) reads the same registry. The registry is refreshed from the database per request, so a data-only language registration is visible immediately.
- The frontend is bootstrapped with the API response and caches it for offline starts. There is no duplicated code list of codes, labels or direction keys; helpers derive all of them from the response.
- Interface language remains a separate setting and is unchanged by this decision. Legacy direction keys stay in the registry with `legacy = true`.

## Alternatives considered

- **Keep a frontend mirror of the supported codes.** It drifted after every language addition and could advertise languages the backend could not serve.
- **Return every registered language to the UI.** Untested or internal-only languages would appear as supported. Curation is a separate flag precisely to prevent this.
- **Derive direction keys from string patterns in the client.** Legacy keys are historical data, not a formatting convention; they must be read from the registry.

## Consequences

Language labels now come from registry `display_name` values rather than browser-localised names. Adding a basic language is a registry insert plus a curation decision; adding a picker or RTL rendering later consumes the same metadata without new hidden branches. The application requires the catalogue API at startup and falls back to the last cached response when offline.
