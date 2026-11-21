"""Copy Unit identity and metadata onto matching existing Collections.

The legacy tables remain until runtime dependencies are removed. Fail rather
than guessing when a Unit has no unique, access-equivalent Collection.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "f36b28e9f018"
down_revision = "e25a17d8e017"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("collections", sa.Column("source_unit_id", UUID(as_uuid=True)))
    op.add_column("collections", sa.Column("source_unit_code", sa.String(20)))
    op.add_column("collections", sa.Column("source_unit_title", sa.String(160)))
    op.add_column("collections", sa.Column("source_unit_sort_order", sa.Integer()))
    op.execute(
        "LOCK TABLE units, collections, vocabulary_entries, collection_entries "
        "IN SHARE ROW EXCLUSIVE MODE"
    )
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (
            SELECT u.id FROM units u LEFT JOIN collections c
              ON c.owner_account_id = u.owner_account_id
             AND c.title = u.code || ' · ' || u.title
             AND c.visibility = u.visibility
            GROUP BY u.id HAVING count(c.id) <> 1
          ) OR EXISTS (
            SELECT c.id FROM collections c JOIN units u
              ON c.owner_account_id = u.owner_account_id
             AND c.title = u.code || ' · ' || u.title
             AND c.visibility = u.visibility
            GROUP BY c.id HAVING count(u.id) <> 1
          ) THEN
            RAISE EXCEPTION 'Unit to Collection mapping is missing or ambiguous';
          END IF;
          IF EXISTS (
            SELECT 1 FROM vocabulary_entries v JOIN units u ON u.id = v.unit_id
            JOIN collections c ON c.owner_account_id = u.owner_account_id
              AND c.title = u.code || ' · ' || u.title AND c.visibility = u.visibility
            WHERE NOT EXISTS (
              SELECT 1 FROM collection_entries ce
              WHERE ce.collection_id = c.id AND ce.entry_id = v.id
            )
          ) THEN
            RAISE EXCEPTION 'Unit card is missing from its Collection';
          END IF;
        END $$
    """)
    op.execute("""
        UPDATE collections c SET source_unit_id = u.id,
          source_unit_code = u.code, source_unit_title = u.title,
          source_unit_sort_order = u.sort_order
        FROM units u WHERE c.owner_account_id = u.owner_account_id
          AND c.title = u.code || ' · ' || u.title AND c.visibility = u.visibility
    """)


def downgrade():
    raise RuntimeError("Restore the reviewed backup to reverse the metadata copy.")
