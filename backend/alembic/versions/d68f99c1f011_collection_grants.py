"""Collection-scoped, explicit publication and Italian–Greek compatibility."""

import sqlalchemy as sa

from alembic import op

revision = "d68f99c1f011"
down_revision = "c57e88b0e010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "collection_entries",
        sa.Column(
            "publication_confirmed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_collection_entries_confirmed_entry",
        "collection_entries",
        ["entry_id"],
        postgresql_where=sa.text("publication_confirmed"),
    )
    db = op.get_bind()
    # Before c57, published library cards were unowned. Owned published cards
    # were introduced by the draft's global exposure implementation. Withdraw
    # those accidental permanent publications; require fresh per-collection consent.
    # Never infer grants from mere references, or change independent library cards.
    db.execute(
        sa.text(
            "UPDATE vocabulary_entries SET visibility='private' "
            "WHERE visibility='published' AND owner_account_id IS NOT NULL"
        )
    )
    # Existing Italian/Greek-named grammar attributes keep their language meaning.
    # Normalize the two primary text slots only; never rewrite stored reviews or
    # snapshots (renderers interpret their explicit original language identifiers).
    db.execute(
        sa.text(
            "UPDATE vocabulary_entries SET source_language='it', "
            "target_language='el', italian=greek, greek=italian "
            "WHERE source_language='el' AND target_language='it'"
        )
    )


def downgrade():
    raise RuntimeError(
        "Restore a reviewed backup; retain post-cutover learning history."
    )
