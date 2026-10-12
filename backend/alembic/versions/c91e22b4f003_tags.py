"""Persist shared tags and vocabulary assignments."""

import sqlalchemy as sa

from alembic import op

revision = "c91e22b4f003"
down_revision = "b80d11a3e002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_vocabulary_entries_italian_id", "vocabulary_entries", ["italian", "id"]
    )
    op.create_table(
        "tags",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False, unique=True),
    )
    op.create_table(
        "entry_tags",
        sa.Column(
            "entry_id",
            sa.Uuid(),
            sa.ForeignKey("vocabulary_entries.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            sa.Uuid(),
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index("ix_entry_tags_tag_id", "entry_tags", ["tag_id"])


def downgrade():
    op.drop_index("ix_vocabulary_entries_italian_id", table_name="vocabulary_entries")
    op.drop_table("entry_tags")
    op.drop_table("tags")
