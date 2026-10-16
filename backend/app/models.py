import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
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
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


profile_practice_units = Table(
    "profile_practice_units",
    Base.metadata,
    Column(
        "profile_id", ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True
    ),
    Column(
        "unit_id",
        ForeignKey("units.id", ondelete="RESTRICT"),
        primary_key=True,
        index=True,
    ),
)


class Profile(Base):
    __tablename__ = "profiles"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    display_name: Mapped[str] = mapped_column(String(80))
    practice_units: Mapped[list["Unit"]] = relationship(
        secondary=profile_practice_units, lazy="selectin", order_by="Unit.code"
    )

    @property
    def practice_unit_ids(self):
        return [unit.id for unit in self.practice_units]

    preferred_direction: Mapped[str] = mapped_column(
        String(24), default="greek_to_italian"
    )
    default_session_size: Mapped[int | None] = mapped_column(
        Integer().evaluates_none(), default=25, server_default="25"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Unit(Base):
    __tablename__ = "units"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    title: Mapped[str] = mapped_column(String(160))
    sort_order: Mapped[int]


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


class Tag(Base):
    __tablename__ = "tags"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80), unique=True)


class VocabularyEntry(Base):
    __tablename__ = "vocabulary_entries"
    __table_args__ = (
        Index("ix_vocabulary_entries_italian_id", "italian", "id"),
        CheckConstraint(
            "word_type IN ('noun','verb','adjective','adverb','expression','other')",
            name="valid_word_type",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    italian: Mapped[str] = mapped_column(String(500))
    greek: Mapped[str] = mapped_column(String(500))
    word_type: Mapped[str] = mapped_column(String(20), index=True)
    unit_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("units.id", ondelete="RESTRICT"), index=True
    )
    unit: Mapped[Unit] = relationship(lazy="joined")
    tags: Mapped[list[Tag]] = relationship(
        secondary=entry_tags, lazy="selectin", order_by=Tag.name
    )
    italian_gender: Mapped[str | None] = mapped_column(String(20))
    greek_gender: Mapped[str | None] = mapped_column(String(20))
    italian_plural: Mapped[str | None] = mapped_column(String(500))
    greek_plural: Mapped[str | None] = mapped_column(String(500))
    italian_example: Mapped[str | None] = mapped_column(Text)
    greek_example: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    pronunciation: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class GateSession(Base):
    __tablename__ = "gate_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class LoginThrottle(Base):
    __tablename__ = "login_throttles"
    client_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int]


class PracticeSession(Base):
    __tablename__ = "practice_sessions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"), index=True)
    direction: Mapped[str] = mapped_column(String(24))
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
    revealed_direction: Mapped[str | None] = mapped_column(String(24))


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
        CheckConstraint(
            "direction IN ('greek_to_italian','italian_to_greek')",
            name="valid_review_direction",
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
    direction: Mapped[str] = mapped_column(String(24), primary_key=True)
    reviews: Mapped[int] = mapped_column(default=0)
    again: Mapped[int] = mapped_column(default=0)
    hard: Mapped[int] = mapped_column(default=0)
    easy: Mapped[int] = mapped_column(default=0)
    weighted_sum: Mapped[float] = mapped_column(Float, default=0)
    weight: Mapped[float] = mapped_column(Float, default=0)
    last_reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
