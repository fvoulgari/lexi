"""Account ownership, restricted legacy library, archival, and personal collections."""

import sqlalchemy as sa

from alembic import op

revision = "a35c66f8c008"
down_revision = "b46c77a9d008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "profiles",
        sa.Column("is_legacy", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.alter_column("profiles", "is_legacy", server_default="false")
    op.create_table(
        "accounts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("provider_subject", sa.String(255), nullable=False, unique=True),
        sa.Column(
            "profile_id",
            sa.Uuid(),
            sa.ForeignKey("profiles.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("role", sa.String(16), server_default="learner", nullable=False),
        sa.Column(
            "legacy_access", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column("interface_language", sa.String(16)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "role IN ('learner','editor','admin')", name="valid_account_role"
        ),
    )
    for table in ("units", "tags", "vocabulary_entries"):
        op.add_column(
            table,
            sa.Column("owner_account_id", sa.Uuid(), sa.ForeignKey("accounts.id")),
        )
        op.add_column(
            table,
            sa.Column(
                "visibility", sa.String(16), server_default="legacy", nullable=False
            ),
        )
        op.create_index(f"ix_{table}_owner_account_id", table, ["owner_account_id"])
        op.create_check_constraint(
            f"{table}_scope",
            table,
            "(visibility = 'private' AND owner_account_id IS NOT NULL) "
            "OR (visibility IN ('legacy','published') "
            "AND owner_account_id IS NULL)",
        )
    op.drop_constraint("units_code_key", "units", type_="unique")
    op.drop_constraint("tags_name_key", "tags", type_="unique")
    for table, field in (("units", "code"), ("tags", "name")):
        op.create_index(
            f"uq_{table}_private",
            table,
            ["owner_account_id", field],
            unique=True,
            postgresql_where=sa.text("owner_account_id IS NOT NULL"),
        )
        op.create_index(
            f"uq_{table}_shared",
            table,
            [field, "visibility"],
            unique=True,
            postgresql_where=sa.text("owner_account_id IS NULL"),
        )
    op.add_column(
        "vocabulary_entries", sa.Column("archived_at", sa.DateTime(timezone=True))
    )
    op.add_column(
        "vocabulary_entries",
        sa.Column(
            "source_language", sa.String(16), nullable=False, server_default="it"
        ),
    )
    op.add_column(
        "vocabulary_entries",
        sa.Column(
            "target_language", sa.String(16), nullable=False, server_default="el"
        ),
    )
    op.create_table(
        "collections",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_account_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False
        ),
        sa.Column("title", sa.String(160), nullable=False),
    )
    op.create_index(
        "ix_collections_owner_account_id", "collections", ["owner_account_id"]
    )
    op.create_table(
        "collection_entries",
        sa.Column(
            "collection_id",
            sa.Uuid(),
            sa.ForeignKey("collections.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "entry_id",
            sa.Uuid(),
            sa.ForeignKey("vocabulary_entries.id"),
            primary_key=True,
        ),
    )


def downgrade():
    raise RuntimeError(
        "Account isolation requires an explicitly reviewed backup restore; "
        "downgrade could expose private content."
    )
