# Legacy cleanup preparation — not ready to deploy

The prepared migrations remove explicitly retired claim links, recovery requests,
and gate sessions, and copy each uniquely matched Unit's ID, code, title and sort
order to its existing Collection. The account/profile association, recovery
conflict guard, learning history and historical session snapshots remain intact.

The Unit table and its references are **not removed**. Card editing, CSV imports,
filters, practice, compatibility APIs, seed data, and account deletion still use
Units. Old CSV Unit fields are not yet mapped to Collections. Do not merge or
deploy this work as a completed Unit retirement.

## Isolated restore results

On the protected 21 November 2026 frozen production backup, the four old Units
matched existing Collections with the same owner and visibility. All Unit cards
were already members. The empty `610 · Lorenzo` Unit matched its existing empty
Collection. The metadata copy preserved the source Unit ID, code, title and sort
order; ambiguous mappings or missing membership abort the migration.

After both migrations, all original columns and rows of the 16 retained tables
matched the pre-migration copy, including all profiles, cards, membership, tags,
sessions, session snapshots, review events and learning progress. The five
retired claim/gate tables removed in this rehearsal include the two already
removed by the earlier production release. Only the specified historical records
were removed; new Collection metadata columns and the schema revision changed.

All ten profiles' sessions, rating counts, progress records and difficult-card
counts matched before and after. Lollo retained five sessions, 18 reviews
(seven hard, eleven easy), 18 progress records and seven difficult cards. There
is no separate stored `learned` flag in the inspected model; original learning
records and snapshots remain unchanged. The comparison files contain private
data and remain in protected local recovery storage, not in this repository.

Backend regression suite: 285 passed, three skipped. Migration tests cover
matching metadata, absent or ambiguous mappings and missing card membership.
Production has not been modified.
