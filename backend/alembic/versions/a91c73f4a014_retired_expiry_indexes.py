"""Remove obsolete expiry indexes without removing any history."""

from sqlalchemy import inspect

from alembic import op

revision = "a91c73f4a014"
down_revision = "f80b11e3f013"
branch_labels = None
depends_on = None

INDEXES = (
    ("gate_sessions", "ix_gate_sessions_expires_at"),
    ("legacy_claim_continuations", "ix_legacy_claim_continuations_expires_at"),
)


def _existing(table, name):
    indexes = inspect(op.get_bind()).get_indexes(table, schema="public")
    matches = [index for index in indexes if index["name"] == name]
    if not matches:
        return False
    index = matches[0]
    options = index.get("dialect_options", {})
    if (
        index["unique"]
        or index["column_names"] != ["expires_at"]
        or options.get("postgresql_where") is not None
        or options.get("postgresql_using") not in (None, "btree")
        or options.get("postgresql_include")
    ):
        raise RuntimeError(f"Unexpected definition for {name}; review before cleanup")
    return True


def upgrade():
    for table, name in INDEXES:
        if _existing(table, name):
            op.drop_index(name, table_name=table, schema="public")


def downgrade():
    for table, name in INDEXES:
        if not _existing(table, name):
            op.create_index(name, table, ["expires_at"], schema="public")
