"""Expiring legacy profile claims and private recovery requests."""

import sqlalchemy as sa

from alembic import op

revision = "b46d77a9d009"
down_revision = "a35c66f8c008"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "legacy_claim_links",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "profile_id", sa.Uuid(), sa.ForeignKey("profiles.id"), nullable=False
        ),
        sa.Column("issued_by", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
    )
    op.create_index(
        "ix_legacy_claim_links_profile_id", "legacy_claim_links", ["profile_id"]
    )
    op.create_table(
        "legacy_claim_continuations",
        sa.Column("secret_hash", sa.String(64), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_legacy_claim_continuations_expires_at",
        "legacy_claim_continuations",
        ["expires_at"],
    )
    op.create_table(
        "legacy_progress_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "account_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False
        ),
        sa.Column("profile_name", sa.String(80), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_by", sa.Uuid(), sa.ForeignKey("accounts.id")),
        sa.CheckConstraint(
            "status IN ('pending','rejected','resolved')", name="legacy_request_status"
        ),
    )
    op.create_index(
        "one_pending_legacy_request",
        "legacy_progress_requests",
        ["account_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_table(
        "legacy_resolution_cases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "account_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False
        ),
        sa.Column(
            "legacy_profile_id", sa.Uuid(), sa.ForeignKey("profiles.id"), nullable=False
        ),
        sa.Column(
            "current_profile_id",
            sa.Uuid(),
            sa.ForeignKey("profiles.id"),
            nullable=False,
        ),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "one_pending_resolution",
        "legacy_resolution_cases",
        ["account_id", "legacy_profile_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_table(
        "security_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_account_id", sa.Uuid(), sa.ForeignKey("accounts.id")),
        sa.Column("event", sa.String(64), nullable=False),
        sa.Column("resource_id", sa.String(80)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade():
    raise RuntimeError(
        "Ownership and claim migrations require reviewed backup restoration; "
        "automatic downgrade is disabled."
    )
