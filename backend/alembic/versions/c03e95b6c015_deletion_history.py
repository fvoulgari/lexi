"""Decouple account deletion from retired recovery tables."""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "c03e95b6c015"
down_revision = "b92d84a5b014"
branch_labels = None
depends_on = None


def upgrade():
    # Only the minimum relationship needed for the existing conflict guard.
    op.create_table(
        "recovery_case_guards",
        sa.Column("case_id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "account_id",
            UUID(as_uuid=True),
            sa.ForeignKey("accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "legacy_profile_id",
            UUID(as_uuid=True),
            sa.ForeignKey("profiles.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "current_profile_id",
            UUID(as_uuid=True),
            sa.ForeignKey("profiles.id", ondelete="RESTRICT"),
            nullable=False,
        ),
    )
    op.execute(
        "INSERT INTO recovery_case_guards "
        "SELECT id, account_id, legacy_profile_id, current_profile_id "
        "FROM legacy_resolution_cases"
    )
    # Claim creation is retired. Detach historical records on deletion without
    # storing a second copy of names, notes or account/profile identifiers.
    for table, column, target in (
        ("legacy_claim_links", "profile_id", "profiles"),
        ("legacy_claim_links", "issued_by", "accounts"),
        ("legacy_progress_requests", "account_id", "accounts"),
        ("legacy_progress_requests", "resolved_by", "accounts"),
        ("legacy_resolution_cases", "account_id", "accounts"),
        ("legacy_resolution_cases", "legacy_profile_id", "profiles"),
        ("legacy_resolution_cases", "current_profile_id", "profiles"),
    ):
        name = f"{table}_{column}_fkey"
        op.drop_constraint(name, table, type_="foreignkey")
        op.alter_column(table, column, nullable=True)
        op.create_foreign_key(
            name, table, target, [column], ["id"], ondelete="SET NULL"
        )
    op.execute("""
        CREATE FUNCTION anonymize_deleted_recovery_request() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF OLD.account_id IS NOT NULL AND NEW.account_id IS NULL THEN
            NEW.profile_name := '[deleted]'; NEW.note := NULL;
          END IF;
          RETURN NEW;
        END $$
    """)
    op.execute(
        "CREATE TRIGGER anonymize_deleted_recovery_request "
        "BEFORE UPDATE ON legacy_progress_requests FOR EACH ROW "
        "EXECUTE FUNCTION anonymize_deleted_recovery_request()"
    )
    # Runtime needs the guard but does not need DDL or operator privileges.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles "
        "WHERE rolname = 'lexi_app') THEN "
        "GRANT SELECT ON recovery_case_guards TO lexi_app; END IF; END $$"
    )


def downgrade():
    raise RuntimeError(
        "Restore a reviewed backup; deleted identities cannot be reconstructed."
    )
