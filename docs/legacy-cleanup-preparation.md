# Legacy cleanup verification

The proposed migrations remove the retired claim links, recovery requests and
shared-gate sessions, copy each uniquely matched Unit's identity and metadata to
its existing Collection, and remove the Unit table. Each card's original grouping
is retained as a Collection reference. Account/profile associations, the active
recovery conflict guard, learning records and historical snapshots are retained.

Card editing, imports, filters and practice use Collections. Legacy CSV Unit codes
route to matching owned Collections; ambiguous matches and published destinations
are rejected. Unmapped rows use the explicitly selected private destination.
Legacy Unit IDs accepted by compatibility requests resolve only to a visible
mapped Collection; they never recreate Units. Historical migration utilities
remain available for older backup schemas.

## Isolated restore comparison

On the protected 21 November 2026 frozen production backup, all four Units mapped
uniquely to existing Collections with matching owners, visibility and membership,
including empty `610 · Lorenzo`. The migration copied Unit IDs, codes, titles and
sort orders and refuses missing, changed or ambiguous metadata and membership.

All 264 card IDs, original retained rows and columns, Collection memberships,
tags, profiles, reviews, sessions, snapshots and learning progress matched after
migration. Every card's original Unit association mapped to the correct Collection.
The earlier audit contained 262 cards; both additional cards were created on
21 November in the Test profile's private Performance test Collection. No earlier
card was removed.

All ten profiles' sessions, review ratings, progress records and difficult-card
counts matched. Lollo retained five sessions, 18 reviews (seven hard, eleven
easy), 18 progress records and seven difficult cards. There is no separate stored
`learned` flag in the inspected model. Protected comparison files contain private
data and remain outside the repository.

The backend suite passed 299 tests with three skipped; frontend tests passed 277
and frontend lint passed. Before a later production release, freeze writes, take
and restore-test a fresh protected backup, repeat the comparison and revalidate the
mapping. The migration fails closed if production has changed incompatibly.
Production has not been modified by this PR.
