"""Independent adjective forms, main genders and Greek pronunciation."""

import sqlalchemy as sa

from alembic import op

revision = "b46c77a9d008"
down_revision = "a35b66f8c007"
branch_labels = None
depends_on = None

FORMS = (
    "italian_masculine_singular",
    "greek_masculine_singular",
    "greek_masculine_plural",
    "greek_feminine_singular",
    "greek_feminine_plural",
    "greek_neuter_singular",
    "greek_neuter_plural",
)
GENDERS = ("italian_adjective_gender", "greek_adjective_gender")


def upgrade():
    for field in FORMS:
        op.add_column(
            "vocabulary_entries", sa.Column(field, sa.String(500), nullable=True)
        )
    for field in GENDERS:
        op.add_column(
            "vocabulary_entries", sa.Column(field, sa.String(20), nullable=True)
        )
    op.add_column(
        "vocabulary_entries", sa.Column("greek_pronunciation", sa.Text(), nullable=True)
    )
    # pronunciation already stores Italian pronunciation. Existing text and
    # combined Greek translations stay untouched; no gender/form inference.


def downgrade():
    for field in ("greek_pronunciation",) + GENDERS + FORMS:
        op.drop_column("vocabulary_entries", field)
