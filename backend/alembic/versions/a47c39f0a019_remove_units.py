"""Retain original grouping as a Collection reference, then remove Units."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "a47c39f0a019"
down_revision = "f36b28e9f018"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "LOCK TABLE units, collections, vocabulary_entries, collection_entries "
        "IN SHARE ROW EXCLUSIVE MODE"
    )
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (
            SELECT u.id FROM units u LEFT JOIN collections c
              ON c.source_unit_id = u.id
             AND c.owner_account_id = u.owner_account_id
             AND c.source_unit_code = u.code
             AND c.source_unit_title = u.title
             AND c.source_unit_sort_order = u.sort_order
            GROUP BY u.id HAVING count(c.id) <> 1
          ) OR EXISTS (
            SELECT 1 FROM vocabulary_entries v
            JOIN collections c ON c.source_unit_id = v.unit_id
            WHERE NOT EXISTS (
              SELECT 1 FROM collection_entries ce
              WHERE ce.collection_id = c.id AND ce.entry_id = v.id
            )
          ) THEN
            RAISE EXCEPTION 'Unit metadata or membership changed after mapping';
          END IF;
        END $$
    """)
    # This Collection reference preserves each card's original classification
    # even when a card belongs to multiple Collections. It is not a Unit FK.
    op.add_column(
        "vocabulary_entries", sa.Column("source_collection_id", UUID(as_uuid=True))
    )
    op.execute("""
        UPDATE vocabulary_entries v SET source_collection_id = c.id
        FROM units u JOIN collections c ON c.source_unit_id = u.id
          AND c.owner_account_id = u.owner_account_id
          AND c.source_unit_code = u.code
          AND c.source_unit_title = u.title
          AND c.source_unit_sort_order = u.sort_order
        WHERE v.unit_id = u.id
    """)
    op.drop_column("vocabulary_entries", "unit_id")
    op.drop_table("units")


def downgrade():
    raise RuntimeError("Restore the reviewed backup to recover the Unit schema.")
