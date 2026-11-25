"""Register Japanese and Arabic as curated basic languages (data only)."""

import sqlalchemy as sa

from alembic import op

revision = "a1b2c3d4e5f6"
down_revision = "b7c9d1e4f206"
branch_labels = None
depends_on = None

# Registry rows only: no schema change, no new column and no grammar definition.
LANGUAGES = {
    "ar": ("Arabic", "Arab", "rtl", False),
    "ja": ("Japanese", "Jpan", "ltr", False),
}
EXISTING_LANGUAGES = ("da", "el", "en", "it")


def _directions():
    added = tuple(LANGUAGES)
    return {
        f"{source}_to_{target}": (source, target)
        for source in (*added, *EXISTING_LANGUAGES)
        for target in (*added, *EXISTING_LANGUAGES)
        if source != target and {source, target} != {"it", "el"}
    }


def upgrade():
    db = op.get_bind()
    for code, (label, script, text_direction, enhanced) in LANGUAGES.items():
        db.execute(
            sa.text(
                "INSERT INTO languages "
                "(id, display_name, script, text_direction, enhanced, "
                "publicly_available) "
                "VALUES (:id, :label, :script, :direction, :enhanced, true) "
                "ON CONFLICT (id) DO UPDATE SET "
                "display_name = EXCLUDED.display_name, script = EXCLUDED.script, "
                "text_direction = EXCLUDED.text_direction, "
                "enhanced = EXCLUDED.enhanced, publicly_available = true"
            ),
            {
                "id": code,
                "label": label,
                "script": script,
                "direction": text_direction,
                "enhanced": enhanced,
            },
        )
    for name, (prompt, answer) in _directions().items():
        db.execute(
            sa.text(
                "INSERT INTO practice_directions "
                "(name, prompt_language, answer_language, legacy) "
                "VALUES (:name, :prompt, :answer, false) "
                "ON CONFLICT (name) DO NOTHING"
            ),
            {"name": name, "prompt": prompt, "answer": answer},
        )


def downgrade():
    db = op.get_bind()
    referenced = db.execute(
        sa.text(
            "SELECT source_language AS code FROM vocabulary_entries "
            "WHERE source_language IN ('ar', 'ja') "
            "UNION SELECT target_language FROM vocabulary_entries "
            "WHERE target_language IN ('ar', 'ja') "
            "UNION SELECT source_language FROM collections "
            "WHERE source_language IN ('ar', 'ja') "
            "UNION SELECT target_language FROM collections "
            "WHERE target_language IN ('ar', 'ja')"
        )
    ).scalars().all()
    if referenced:
        raise RuntimeError(
            "Remove cards and collections using Japanese or Arabic before downgrade."
        )
    for name in _directions():
        db.execute(
            sa.text("DELETE FROM practice_directions WHERE name = :name"),
            {"name": name},
        )
    for code in LANGUAGES:
        db.execute(
            sa.text("DELETE FROM languages WHERE id = :id"), {"id": code}
        )
