"""Ordered shareable collections; preserve stable cards and learning keys."""

import sqlalchemy as sa

from alembic import op

DIRECTION_PAIRS = {
    "greek_to_italian": ("el", "it"),
    "italian_to_greek": ("it", "el"),
    "da_to_el": ("da", "el"),
    "da_to_en": ("da", "en"),
    "da_to_it": ("da", "it"),
    "el_to_da": ("el", "da"),
    "el_to_en": ("el", "en"),
    "en_to_da": ("en", "da"),
    "en_to_el": ("en", "el"),
    "en_to_it": ("en", "it"),
    "it_to_da": ("it", "da"),
    "it_to_en": ("it", "en"),
}

revision = "c57e88b0e010"
down_revision = "b46d77a9d009"
branch_labels = None
depends_on = None


def upgrade():
    db = op.get_bind()
    # Existing application cards have explicit language identifiers. Do not guess
    # mixed or unsupported historical data; abort transaction with collection IDs.
    ambiguous = (
        db.execute(
            sa.text("""
        SELECT DISTINCT c.id FROM collections c
        JOIN collection_entries ce ON ce.collection_id=c.id
        JOIN vocabulary_entries v ON v.id=ce.entry_id
        WHERE v.source_language NOT IN ('da','el','en','it')
           OR v.target_language NOT IN ('da','el','en','it')
           OR v.source_language=v.target_language
           OR EXISTS (
               SELECT 1 FROM collection_entries other
               JOIN vocabulary_entries x ON x.id=other.entry_id
               WHERE other.collection_id=c.id AND
ARRAY[least(x.source_language,x.target_language),greatest(x.source_language,x.target_language)]
               <>
               ARRAY[least(v.source_language,v.target_language),greatest(v.source_language,v.target_language)]
           ) ORDER BY c.id
    """)
        )
        .scalars()
        .all()
    )
    if ambiguous:
        raise RuntimeError(
            "Classify incompatible collection language pairs before migration: "
            + ", ".join(map(str, ambiguous))
        )
    op.drop_constraint("vocabulary_entries_scope", "vocabulary_entries", type_="check")
    op.create_check_constraint(
        "vocabulary_entries_scope",
        "vocabulary_entries",
        "(visibility = 'private' AND owner_account_id IS NOT NULL) OR "
        "visibility = 'published' OR "
        "(visibility = 'legacy' AND owner_account_id IS NULL)",
    )
    op.add_column(
        "collections",
        sa.Column(
            "source_language", sa.String(16), server_default="el", nullable=False
        ),
    )
    op.add_column(
        "collections",
        sa.Column(
            "target_language", sa.String(16), server_default="it", nullable=False
        ),
    )
    op.add_column(
        "collections",
        sa.Column(
            "visibility", sa.String(16), server_default="private", nullable=False
        ),
    )
    db.execute(
        sa.text("""UPDATE collections c SET source_language=p.a, target_language=p.b
        FROM (SELECT ce.collection_id, min(least(v.source_language,v.target_language))
        a,
                     min(greatest(v.source_language,v.target_language)) b
              FROM collection_entries ce JOIN vocabulary_entries v ON v.id=ce.entry_id
              GROUP BY ce.collection_id) p WHERE c.id=p.collection_id""")
    )
    op.create_check_constraint(
        "collection_visibility", "collections", "visibility IN ('private','published')"
    )
    op.create_check_constraint(
        "collection_pair",
        "collections",
        "source_language IN ('da','el','en','it') AND "
        "target_language IN ('da','el','en','it') AND "
        "source_language < target_language",
    )
    op.add_column(
        "collection_entries",
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
    )
    # No previous order existed. Deterministic ID order preserves every membership.
    db.execute(
        sa.text("""UPDATE collection_entries ce SET position=p.n FROM
        (SELECT collection_id,entry_id,row_number() OVER(PARTITION BY collection_id
        ORDER BY entry_id)-1 n
         FROM collection_entries) p WHERE ce.collection_id=p.collection_id AND
         ce.entry_id=p.entry_id""")
    )
    op.create_check_constraint(
        "collection_position", "collection_entries", "position >= 0"
    )
    # Deferred uniqueness permits atomic permutations without temporary positions.
    op.create_unique_constraint(
        "collection_order",
        "collection_entries",
        ["collection_id", "position"],
        deferrable=True,
        initially="DEFERRED",
    )
    op.drop_constraint("valid_review_direction", "review_events", type_="check")
    op.create_check_constraint(
        "valid_review_direction",
        "review_events",
        "direction IN (" + ",".join(repr(d) for d in DIRECTION_PAIRS) + ")",
    )
    db.execute(
        sa.text("""CREATE FUNCTION enforce_collection_pair() RETURNS trigger LANGUAGE
        plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM collections c JOIN vocabulary_entries v ON
          v.id=NEW.entry_id
             WHERE c.id=NEW.collection_id AND
             (c.source_language<>least(v.source_language,v.target_language)
             OR c.target_language<>greatest(v.source_language,v.target_language))) THEN
             RAISE EXCEPTION 'Card language pair differs from collection' USING
             ERRCODE='23514';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER collection_pair_membership BEFORE INSERT OR UPDATE ON
        collection_entries
        FOR EACH ROW EXECUTE FUNCTION enforce_collection_pair();
    """)
    )


def downgrade():
    raise RuntimeError(
        "Restore a reviewed backup into a separate database; "
        "preserve post-cutover writes."
    )
