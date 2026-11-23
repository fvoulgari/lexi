"""Guard populated collection pair changes without touching card references."""

from alembic import op

revision = "b7c41d0e9a32"
down_revision = "f7a12b4c0001"
branch_labels = None
depends_on = None


def upgrade():
    # `collection_pair` still validates the stored pair, and
    # `collection_pair_membership` still validates each card reference. This only
    # stops an UPDATE from moving a collection that already has card references.
    op.execute(
        """
        CREATE FUNCTION enforce_collection_pair_population() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF (NEW.source_language <> OLD.source_language
              OR NEW.target_language <> OLD.target_language)
             AND EXISTS (SELECT 1 FROM collection_entries ce
                         WHERE ce.collection_id = NEW.id) THEN
            RAISE EXCEPTION
              'Remove every card before changing the collection language pair.'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER collection_pair_population
          BEFORE UPDATE ON collections
          FOR EACH ROW EXECUTE FUNCTION enforce_collection_pair_population();
        """
    )


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS collection_pair_population ON collections")
    op.execute("DROP FUNCTION IF EXISTS enforce_collection_pair_population()")
