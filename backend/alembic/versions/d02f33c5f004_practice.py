"""Persist random practice queues, review events and learner progress."""

import sqlalchemy as sa

from alembic import op

revision = "d02f33c5f004"
down_revision = "c91e22b4f003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "practice_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("direction", sa.String(length=24), nullable=False),
        sa.Column("requested_size", sa.Integer(), nullable=True),
        sa.Column("available", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["profiles.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_practice_sessions_profile_id"),
        "practice_sessions",
        ["profile_id"],
        unique=False,
    )
    op.create_table(
        "session_cards",
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("entry_id", sa.Uuid(), nullable=True),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("revealed_direction", sa.String(length=24), nullable=True),
        sa.ForeignKeyConstraint(
            ["entry_id"], ["vocabulary_entries.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["practice_sessions.id"],
        ),
        sa.PrimaryKeyConstraint("session_id", "position"),
    )
    op.create_table(
        "review_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("entry_id", sa.Uuid(), nullable=False),
        sa.Column("direction", sa.String(length=24), nullable=False),
        sa.Column("rating", sa.String(length=8), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "direction IN ('greek_to_italian','italian_to_greek')",
            name="valid_review_direction",
        ),
        sa.CheckConstraint(
            "rating IN ('again','hard','easy')", name="valid_review_rating"
        ),
        sa.ForeignKeyConstraint(
            ["entry_id"],
            ["vocabulary_entries.id"],
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["profiles.id"],
        ),
        sa.ForeignKeyConstraint(
            ["session_id", "position"],
            ["session_cards.session_id", "session_cards.position"],
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["practice_sessions.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "position"),
    )
    op.create_table(
        "learning_progress",
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("entry_id", sa.Uuid(), nullable=False),
        sa.Column("direction", sa.String(length=24), nullable=False),
        sa.Column("reviews", sa.Integer(), nullable=False),
        sa.Column("again", sa.Integer(), nullable=False),
        sa.Column("hard", sa.Integer(), nullable=False),
        sa.Column("easy", sa.Integer(), nullable=False),
        sa.Column("weighted_sum", sa.Float(), nullable=False),
        sa.Column("weight", sa.Float(), nullable=False),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["entry_id"],
            ["vocabulary_entries.id"],
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["profiles.id"],
        ),
        sa.PrimaryKeyConstraint("profile_id", "entry_id", "direction"),
    )


def downgrade():
    op.drop_table("learning_progress")
    op.drop_table("review_events")
    op.drop_table("session_cards")
    op.drop_table("practice_sessions")
