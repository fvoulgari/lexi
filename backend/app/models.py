import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, synonym


class Base(DeclarativeBase):
    pass


class Language(Base):
    """A registered learning language; adding one needs data, not schema changes.

    ``publicly_available`` separates registry support from the curated UI
    catalogue. ``script``, ``text_direction`` and ``enhanced`` describe the
    language so clients never need per-language branches.
    """

    __tablename__ = "languages"
    __table_args__ = (
        CheckConstraint("id <> ''", name="language_id_not_blank"),
        CheckConstraint("script <> ''", name="language_script_not_blank"),
        CheckConstraint(
            "text_direction IN ('ltr', 'rtl')", name="valid_language_text_direction"
        ),
    )
    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(80))
    publicly_available: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    script: Mapped[str] = mapped_column(
        String(16), default="Latn", server_default="Latn"
    )
    text_direction: Mapped[str] = mapped_column(
        String(3), default="ltr", server_default="ltr"
    )
    enhanced: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    native_name: Mapped[str] = mapped_column(
        String(120), default="", server_default=""
    )
    aliases: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")


class PracticeDirection(Base):
    """A stored practice direction key with explicit prompt and answer languages."""

    __tablename__ = "practice_directions"
    __table_args__ = (
        CheckConstraint(
            "prompt_language <> answer_language", name="direction_languages_differ"
        ),
    )
    name: Mapped[str] = mapped_column(String(24), primary_key=True)
    prompt_language: Mapped[str] = mapped_column(
        ForeignKey("languages.id", name="fk_direction_prompt_language")
    )
    answer_language: Mapped[str] = mapped_column(
        ForeignKey("languages.id", name="fk_direction_answer_language")
    )
    legacy: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )


class Profile(Base):
    __tablename__ = "profiles"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    is_legacy: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    display_name: Mapped[str] = mapped_column(String(80))
    preferred_direction: Mapped[str] = mapped_column(
        String(24), default="greek_to_italian"
    )
    default_session_size: Mapped[int | None] = mapped_column(
        Integer().evaluates_none(), default=25, server_default="25"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint(
            "role IN ('learner','editor','admin')", name="valid_account_role"
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    provider_subject: Mapped[str] = mapped_column(String(255), unique=True)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id"), unique=True
    )
    role: Mapped[str] = mapped_column(
        String(16), default="learner", server_default="learner"
    )
    interface_language: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ContentScope:
    @property
    def can_edit(self):
        from app.access import account_context, can_write

        return can_write(self) if account_context.get() else False

    owner_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id"), index=True
    )
    visibility: Mapped[str] = mapped_column(
        String(16), default="legacy", server_default="legacy"
    )


entry_tags = Table(
    "entry_tags",
    Base.metadata,
    Column(
        "entry_id",
        ForeignKey("vocabulary_entries.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id",
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    ),
)


class Tag(ContentScope, Base):
    __tablename__ = "tags"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80))


class VocabularyEntry(ContentScope, Base):
    __tablename__ = "vocabulary_entries"
    __table_args__ = (
        Index("ix_vocabulary_entries_italian_id", "italian", "id"),
        CheckConstraint(
            "word_type IN ('noun','verb','adjective','adverb','expression','other')",
            name="valid_word_type",
        ),
        CheckConstraint(
            "source_language <> target_language", name="vocabulary_card_languages"
        ),
        ForeignKeyConstraint(
            ["source_language"],
            ["languages.id"],
            name="fk_vocabulary_source_language",
        ),
        ForeignKeyConstraint(
            ["target_language"],
            ["languages.id"],
            name="fk_vocabulary_target_language",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_language: Mapped[str] = mapped_column(
        String(16), default="it", server_default="it"
    )
    target_language: Mapped[str] = mapped_column(
        String(16), default="el", server_default="el"
    )
    italian: Mapped[str] = mapped_column(String(500))
    greek: Mapped[str] = mapped_column(String(500))
    source_text = synonym("italian")
    target_text = synonym("greek")
    word_type: Mapped[str] = mapped_column(String(20), index=True)
    source_collection_id: Mapped[uuid.UUID | None] = mapped_column()
    source_collection: Mapped["Collection | None"] = relationship(
        primaryjoin="foreign(VocabularyEntry.source_collection_id) == Collection.id",
        viewonly=True,
        lazy="joined",
    )
    tags: Mapped[list[Tag]] = relationship(
        secondary=entry_tags, lazy="selectin", order_by=Tag.name
    )
    italian_gender: Mapped[str | None] = mapped_column(String(20))
    greek_gender: Mapped[str | None] = mapped_column(String(20))
    italian_plural: Mapped[str | None] = mapped_column(String(500))
    greek_plural: Mapped[str | None] = mapped_column(String(500))
    italian_feminine_singular: Mapped[str | None] = mapped_column(String(500))
    italian_masculine_plural: Mapped[str | None] = mapped_column(String(500))
    italian_feminine_plural: Mapped[str | None] = mapped_column(String(500))
    italian_example: Mapped[str | None] = mapped_column(Text)
    greek_example: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    italian_masculine_singular: Mapped[str | None] = mapped_column(String(500))
    greek_masculine_singular: Mapped[str | None] = mapped_column(String(500))
    greek_masculine_plural: Mapped[str | None] = mapped_column(String(500))
    greek_feminine_singular: Mapped[str | None] = mapped_column(String(500))
    greek_feminine_plural: Mapped[str | None] = mapped_column(String(500))
    greek_neuter_singular: Mapped[str | None] = mapped_column(String(500))
    greek_neuter_plural: Mapped[str | None] = mapped_column(String(500))
    italian_adjective_gender: Mapped[str | None] = mapped_column(String(20))
    greek_adjective_gender: Mapped[str | None] = mapped_column(String(20))
    greek_pronunciation: Mapped[str | None] = mapped_column(Text)
    pronunciation: Mapped[str | None] = mapped_column(Text)
    # Single structured store for every enhanced language; legacy columns above
    # remain compatibility aliases and are kept in step on every write.
    grammar: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class LoginThrottle(Base):
    __tablename__ = "login_throttles"
    client_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int]


class PracticeSession(Base):
    __tablename__ = "practice_sessions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"), index=True)
    direction: Mapped[str] = mapped_column(
        String(24), ForeignKey("practice_directions.name", name="fk_session_direction")
    )
    requested_size: Mapped[int | None] = mapped_column(Integer)
    available: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SessionCard(Base):
    __tablename__ = "session_cards"
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("practice_sessions.id"), primary_key=True
    )
    position: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vocabulary_entries.id", ondelete="SET NULL")
    )
    snapshot: Mapped[dict] = mapped_column(JSON)
    revealed_direction: Mapped[str | None] = mapped_column(
        String(24),
        ForeignKey(
            "practice_directions.name", name="fk_session_card_revealed_direction"
        ),
    )


class ReviewEvent(Base):
    __tablename__ = "review_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["session_id", "position"],
            ["session_cards.session_id", "session_cards.position"],
        ),
        UniqueConstraint("session_id", "position"),
        CheckConstraint(
            "rating IN ('again','hard','easy')", name="valid_review_rating"
        ),
        ForeignKeyConstraint(
            ["direction"],
            ["practice_directions.name"],
            name="fk_review_direction",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("practice_sessions.id"))
    position: Mapped[int]
    profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"))
    entry_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vocabulary_entries.id"))
    direction: Mapped[str] = mapped_column(String(24))
    rating: Mapped[str] = mapped_column(String(8))
    snapshot: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class LearningProgress(Base):
    __tablename__ = "learning_progress"
    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id"), primary_key=True
    )
    entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vocabulary_entries.id"), primary_key=True
    )
    direction: Mapped[str] = mapped_column(
        String(24),
        ForeignKey("practice_directions.name", name="fk_progress_direction"),
        primary_key=True,
    )
    reviews: Mapped[int] = mapped_column(default=0)
    again: Mapped[int] = mapped_column(default=0)
    hard: Mapped[int] = mapped_column(default=0)
    easy: Mapped[int] = mapped_column(default=0)
    weighted_sum: Mapped[float] = mapped_column(Float, default=0)
    weight: Mapped[float] = mapped_column(Float, default=0)
    last_reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Collection(Base):
    __tablename__ = "collections"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounts.id"), index=True
    )
    title: Mapped[str] = mapped_column(String(160))
    source_unit_id: Mapped[uuid.UUID | None] = mapped_column()
    source_unit_code: Mapped[str | None] = mapped_column(String(20))
    source_unit_title: Mapped[str | None] = mapped_column(String(160))
    source_unit_sort_order: Mapped[int | None] = mapped_column(Integer)
    source_language: Mapped[str] = mapped_column(
        String(16), default="el", server_default="el"
    )
    target_language: Mapped[str] = mapped_column(
        String(16), default="it", server_default="it"
    )
    visibility: Mapped[str] = mapped_column(
        String(16), default="private", server_default="private"
    )
    __table_args__ = (
        CheckConstraint(
            "visibility IN ('private','published')", name="collection_visibility"
        ),
        CheckConstraint("source_language < target_language", name="collection_pair"),
        ForeignKeyConstraint(
            ["source_language"], ["languages.id"], name="fk_collection_source_language"
        ),
        ForeignKeyConstraint(
            ["target_language"], ["languages.id"], name="fk_collection_target_language"
        ),
    )


class CollectionEntry(Base):
    __tablename__ = "collection_entries"
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    publication_confirmed: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    collection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True
    )
    entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vocabulary_entries.id"), primary_key=True
    )


class SavedCollection(Base):
    __tablename__ = "saved_collections"
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True
    )
    collection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class RecoveryCaseGuard(Base):
    __tablename__ = "recovery_case_guards"
    case_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE")
    )
    legacy_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="RESTRICT")
    )
    current_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="RESTRICT")
    )


class AccountDeletion(Base):
    __tablename__ = "account_deletions"
    subject_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider_subject: Mapped[str | None] = mapped_column(String(255))
