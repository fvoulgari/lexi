"""Add language-search metadata and register the expanded curated catalogue.

The only schema changes are two additive `languages` columns used by the
searchable selectors; no card, progress, permission or direction-ID data is
rewritten.
"""

import json

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "c4d5e6f70819"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None

# Frozen bootstrap rows. Existing metadata labels are never renamed: the API
# keeps stable language IDs and historical display names while adding native
# names and aliases for accent-tolerant search.
LANGUAGES = {
    "ar": ("Arabic", "العربية", ["عربي"], "Arab", "rtl", False),
    "bn": ("Bengali", "বাংলা", ["Bangla"], "Beng", "ltr", False),
    "bg": ("Bulgarian", "Български", [], "Cyrl", "ltr", False),
    "ca": ("Catalan", "Català", [], "Latn", "ltr", False),
    "cs": ("Czech", "Čeština", [], "Latn", "ltr", False),
    "da": ("Danish", "Dansk", [], "Latn", "ltr", True),
    "de": ("German", "Deutsch", [], "Latn", "ltr", False),
    "el": ("Greek", "Ελληνικά", [], "Grek", "ltr", True),
    "en": ("English", "English", [], "Latn", "ltr", False),
    "es": ("Spanish", "Español", [], "Latn", "ltr", False),
    "fa": ("Persian", "فارسی", ["Farsi"], "Arab", "rtl", False),
    "fi": ("Finnish", "Suomi", [], "Latn", "ltr", False),
    "fr": ("French", "Français", [], "Latn", "ltr", False),
    "he": ("Hebrew", "עברית", [], "Hebr", "rtl", False),
    "hi": ("Hindi", "हिन्दी", [], "Deva", "ltr", False),
    "hu": ("Hungarian", "Magyar", [], "Latn", "ltr", False),
    "id": ("Indonesian", "Bahasa Indonesia", ["Indonesian"], "Latn", "ltr", False),
    "it": ("Italian", "Italiano", [], "Latn", "ltr", True),
    "ja": ("Japanese", "日本語", [], "Jpan", "ltr", False),
    "ko": ("Korean", "한국어", [], "Hang", "ltr", False),
    "nl": ("Dutch", "Nederlands", [], "Latn", "ltr", False),
    "no": ("Norwegian", "Norsk", [], "Latn", "ltr", False),
    "pl": ("Polish", "Polski", [], "Latn", "ltr", False),
    "pt": ("Portuguese", "Português", [], "Latn", "ltr", False),
    "ro": ("Romanian", "Română", [], "Latn", "ltr", False),
    "ru": ("Russian", "Русский", [], "Cyrl", "ltr", False),
    "sk": ("Slovak", "Slovenčina", [], "Latn", "ltr", False),
    "sv": ("Swedish", "Svenska", [], "Latn", "ltr", False),
    "sw": ("Swahili", "Kiswahili", [], "Latn", "ltr", False),
    "th": ("Thai", "ไทย", [], "Thai", "ltr", False),
    "tr": ("Turkish", "Türkçe", [], "Latn", "ltr", False),
    "uk": ("Ukrainian", "Українська", [], "Cyrl", "ltr", False),
    "ur": ("Urdu", "اردو", [], "Arab", "rtl", False),
    "vi": ("Vietnamese", "Tiếng Việt", [], "Latn", "ltr", False),
    "zh": ("Chinese", "中文", ["Mandarin"], "Hans", "ltr", False),
}

# Language IDs that were not in the previous curated catalogue. Their rows and
# directions are the only registry data this revision adds.
ADDED_LANGUAGES = (
    "bn", "bg", "ca", "cs", "de", "es", "fa", "fi", "fr", "he", "hi", "hu",
    "id", "ko", "nl", "no", "pl", "pt", "ro", "ru", "sk", "sv", "sw", "th",
    "tr", "uk", "ur", "vi", "zh",
)
LEGACY_DIRECTIONS = ("greek_to_italian", "italian_to_greek")


def _new_directions():
    added = set(ADDED_LANGUAGES)
    return {
        f"{source}_to_{target}": (source, target)
        for source in (*ADDED_LANGUAGES, "ar", "da", "el", "en", "it", "ja")
        for target in (*ADDED_LANGUAGES, "ar", "da", "el", "en", "it", "ja")
        if source != target
        and (source in added or target in added)
        and {source, target} != {"it", "el"}
    }


def upgrade():
    op.add_column(
        "languages", sa.Column("native_name", sa.String(120), server_default="")
    )
    op.add_column(
        "languages",
        sa.Column("aliases", JSONB(), server_default=sa.text("'[]'::jsonb")),
    )
    db = op.get_bind()
    for code, values in LANGUAGES.items():
        label, native, aliases, script, direction, enhanced = values
        db.execute(
            sa.text(
                "INSERT INTO languages "
                "(id, display_name, native_name, aliases, script, text_direction, "
                "enhanced, publicly_available) "
                "VALUES (:id, :label, :native, CAST(:aliases AS jsonb), "
                ":script, :direction, "
                ":enhanced, true) "
                "ON CONFLICT (id) DO UPDATE SET "
                "native_name = EXCLUDED.native_name, aliases = EXCLUDED.aliases, "
                "script = EXCLUDED.script, text_direction = EXCLUDED.text_direction, "
                "enhanced = EXCLUDED.enhanced, publicly_available = true"
            ),
            {
                "id": code,
                "label": label,
                "native": native,
                "aliases": json.dumps(aliases, ensure_ascii=False),
                "script": script,
                "direction": direction,
                "enhanced": enhanced,
            },
        )
    for name, (prompt, answer) in _new_directions().items():
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
    codes = ", ".join(f"'{code}'" for code in ADDED_LANGUAGES)
    referenced = db.execute(
        sa.text(
            f"SELECT source_language AS code FROM vocabulary_entries "
            f"WHERE source_language IN ({codes}) "
            f"UNION SELECT target_language FROM vocabulary_entries "
            f"WHERE target_language IN ({codes}) "
            f"UNION SELECT source_language FROM collections "
            f"WHERE source_language IN ({codes}) "
            f"UNION SELECT target_language FROM collections "
            f"WHERE target_language IN ({codes})"
        )
    ).scalars().all()
    if referenced:
        raise RuntimeError(
            "Remove cards and collections using the expanded languages "
            "before downgrade."
        )
    for name in _new_directions():
        db.execute(
            sa.text("DELETE FROM practice_directions WHERE name = :name"),
            {"name": name},
        )
    db.execute(
        sa.text(f"DELETE FROM languages WHERE id IN ({codes})")
    )
    op.drop_column("languages", "aliases")
    op.drop_column("languages", "native_name")
