"""Save references to public Collections per account."""

import sqlalchemy as sa

from alembic import op

revision = "b58d40a1b020"
down_revision = "a47c39f0a019"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "saved_collections",
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("accounts.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "collection_id",
            sa.Uuid(),
            sa.ForeignKey("collections.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index(
        "ix_saved_collections_collection_id", "saved_collections", ["collection_id"]
    )

    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lexi_app') THEN
                GRANT SELECT, INSERT, DELETE ON saved_collections TO lexi_app;
            END IF;
        END $$
    """)


def downgrade():
    op.drop_table("saved_collections")
