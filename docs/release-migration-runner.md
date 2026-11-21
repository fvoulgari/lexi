# One-off release migration runner

`scripts/release-migration-20261121.sql` is scoped to the release whose source
revision is `f80b11e3f013` and target is `c03e95b6c015`. It is not a general
Alembic replacement. It requires a matching database name, `postgres` operator,
table owners, runtime role and exact old index definitions. A mismatch fails
before changes. Execute with `psql -X -v ON_ERROR_STOP=1 -v target_db=railway -f FILE`
in the authenticated database console after the approved frozen backup passes.

The three migrations run in one transaction under a temporary NOLOGIN role.
The operator temporarily transfers only the seven affected tables, grants the
needed references and read access, then reassigns ownership, revokes grants and
drops the role before commit. Errors roll back both DDL and role changes. Runtime
credentials remain outside this process. Never print or inject production
credentials into the local rehearsal.

The runner was compared against canonical Alembic on two PostgreSQL 18 restores
of the protected production snapshot, each with the same synthetic recovery case.
Full row/column-hash manifests matched, as did normalized schema dumps including
ACLs. The recovery guard contained the synthetic case; the temporary role was
absent, `lexi_app` could read the guard and could not read `account_directory`.
A mismatched index failed before mutation. An injected error after the first
DDL restored the original Alembic revision and both indexes and left no temporary
role. The independent backup and original data remain unchanged.
