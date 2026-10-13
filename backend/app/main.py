from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.auth import SharedGate
from app.config import Settings
from app.database import database
from app.duplicates import normalized_pair
from app.imports import import_router
from app.models import LearningProgress, Profile, Tag, Unit, VocabularyEntry
from app.practice import difficult_progress, practice_router
from app.schemas import (
    Direction,
    ProfileCreate,
    ProfileOutput,
    ProfileUpdate,
    TagCreate,
    TagOutput,
    UnitCreate,
    UnitOutput,
    VocabularyCreate,
    VocabularyOutput,
    VocabularyPage,
    VocabularySaved,
    VocabularyUpdate,
    WordType,
)


def create_app():
    settings = Settings()
    engine, sessions = database(settings.database_url)
    gate = SharedGate(settings, sessions)

    @asynccontextmanager
    async def lifespan(app):
        yield
        engine.dispose()

    app = FastAPI(
        title="Italian Notebook",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.middleware("http")
    async def response_security(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; style-src 'self'; font-src 'self'; "
            "img-src 'self' data:; frame-ancestors 'none'; "
            "base-uri 'self'; form-action 'self'"
        )
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, exc):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.detail
                if isinstance(exc.detail, dict)
                else {
                    "code": "not_found" if exc.status_code == 404 else "request_failed",
                    "message": str(exc.detail),
                }
            },
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "invalid_input",
                    "message": "Check the submitted fields.",
                    "fields": sorted(
                        {
                            str(error["loc"][1])
                            for error in exc.errors()
                            if len(error["loc"]) > 1 and error["loc"][0] == "body"
                        }
                    ),
                }
            },
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request, exc):
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "code": "service_unavailable",
                    "message": "Please try again shortly.",
                }
            },
        )

    @app.get("/api/health")
    def health():
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "ok"}

    app.include_router(practice_router(sessions, gate))
    app.include_router(import_router(sessions, gate))

    app.get("/api/auth/session")(gate.state)
    app.post("/api/auth/login")(gate.login)
    app.post("/api/auth/logout")(gate.logout)

    @app.get(
        "/api/vocabulary",
        response_model=VocabularyPage,
        dependencies=[Depends(gate.require)],
    )
    def vocabulary(
        page: int = Query(1, ge=1),
        page_size: int = Query(6, ge=1, le=100),
        q: str = Query("", max_length=500),
        unit_ids: list[UUID] = Query(default=[]),
        no_unit: bool = False,
        word_types: list[WordType] = Query(default=[]),
        tag_ids: list[UUID] = Query(default=[]),
    ):
        conditions = []
        if q.strip():
            # Treat wildcard characters as literal search text.
            pattern = (
                "%"
                + q.strip()
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
                + "%"
            )
            conditions.append(
                or_(
                    VocabularyEntry.italian.ilike(pattern, escape="\\"),
                    VocabularyEntry.greek.ilike(pattern, escape="\\"),
                )
            )
        if unit_ids or no_unit:
            units = [VocabularyEntry.unit_id.in_(unit_ids)]
            if no_unit:
                units.append(VocabularyEntry.unit_id.is_(None))
            conditions.append(or_(*units))
        if word_types:
            conditions.append(VocabularyEntry.word_type.in_(word_types))
        if tag_ids:
            conditions.append(VocabularyEntry.tags.any(Tag.id.in_(tag_ids)))
        with sessions() as db:
            total = db.scalar(
                select(func.count()).select_from(VocabularyEntry).where(*conditions)
            )
            entries = db.scalars(
                select(VocabularyEntry)
                .where(*conditions)
                .order_by(VocabularyEntry.italian, VocabularyEntry.id)
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
            return {
                "items": entries,
                "total": total,
                "page": page,
                "page_size": page_size,
            }

    @app.get(
        "/api/vocabulary/{entry_id}",
        response_model=VocabularyOutput,
        dependencies=[Depends(gate.require)],
    )
    def read_entry(entry_id: UUID):
        with sessions() as db:
            entry = db.get(VocabularyEntry, entry_id)
            if entry is None:
                raise HTTPException(404, detail="Vocabulary entry not found.")
            return entry

    def save_entry(body, entry_id=None):
        with sessions.begin() as db:
            values = body.model_dump(exclude_unset=True)
            if (
                values.get("unit_id") is not None
                and db.get(Unit, values["unit_id"]) is None
            ):
                raise HTTPException(
                    422,
                    detail={
                        "code": "invalid_input",
                        "message": "Choose an existing unit.",
                        "fields": ["unit_id"],
                    },
                )
            tag_ids = values.pop("tag_ids", None)
            if tag_ids is not None:
                tags = db.scalars(select(Tag).where(Tag.id.in_(set(tag_ids)))).all()
                if len(tags) != len(set(tag_ids)):
                    raise HTTPException(
                        422,
                        detail={
                            "code": "invalid_input",
                            "message": "Choose existing tags.",
                            "fields": ["tag_ids"],
                        },
                    )
            if entry_id is None:
                entry = VocabularyEntry(**values)
                db.add(entry)
            else:
                entry = db.get(VocabularyEntry, entry_id)
                if entry is None:
                    raise HTTPException(404, detail="Vocabulary entry not found.")
                for field, value in values.items():
                    setattr(entry, field, value)
            if tag_ids is not None:
                entry.tags = tags
            db.flush()
            db.refresh(entry)

            pair = normalized_pair(entry.italian, entry.greek)
            duplicates = [
                other.id
                for other in db.execute(
                    select(
                        VocabularyEntry.id,
                        VocabularyEntry.italian,
                        VocabularyEntry.greek,
                    ).where(VocabularyEntry.id != entry.id)
                )
                if normalized_pair(other.italian, other.greek) == pair
            ]
            return {
                "entry": VocabularyOutput.model_validate(entry),
                "duplicate_ids": duplicates,
            }

    @app.post(
        "/api/vocabulary",
        response_model=VocabularySaved,
        status_code=201,
        dependencies=[Depends(gate.require), Depends(gate.check_csrf)],
    )
    def create_entry(body: VocabularyCreate):
        return save_entry(body)

    @app.patch(
        "/api/vocabulary/{entry_id}",
        response_model=VocabularySaved,
        dependencies=[Depends(gate.require), Depends(gate.check_csrf)],
    )
    def update_entry(entry_id: UUID, body: VocabularyUpdate):
        return save_entry(body, entry_id)

    @app.get(
        "/api/profiles",
        response_model=list[ProfileOutput],
        dependencies=[Depends(gate.require)],
    )
    def profiles():
        with sessions() as db:
            return db.scalars(
                select(Profile).order_by(Profile.created_at, Profile.id)
            ).all()

    @app.post(
        "/api/profiles",
        response_model=ProfileOutput,
        status_code=201,
        dependencies=[Depends(gate.require), Depends(gate.check_csrf)],
    )
    def create_profile(body: ProfileCreate):
        with sessions.begin() as db:
            profile = Profile(**body.model_dump())
            db.add(profile)
            db.flush()
            return ProfileOutput.model_validate(profile)

    @app.get(
        "/api/profiles/{profile_id}/difficult-entries",
        dependencies=[Depends(gate.require)],
    )
    def difficult_entries(profile_id: UUID, direction: Direction):
        with sessions() as db:
            if db.get(Profile, profile_id) is None:
                raise HTTPException(404, "Learner profile not found.")
            records = db.scalars(
                difficult_progress(profile_id, direction).order_by(
                    LearningProgress.entry_id
                )
            ).all()
            return [
                {
                    "entry": VocabularyOutput.model_validate(
                        db.get(VocabularyEntry, record.entry_id)
                    ).model_dump(mode="json"),
                    "direction": record.direction,
                    "difficulty": record.weighted_sum / record.weight,
                    "reviews": record.reviews,
                }
                for record in records
            ]

    @app.get(
        "/api/profiles/{profile_id}/learning-records",
        dependencies=[Depends(gate.require)],
    )
    def learning_records(profile_id: UUID):
        with sessions() as db:
            if db.get(Profile, profile_id) is None:
                raise HTTPException(404, "Learner profile not found.")
            records = db.scalars(
                select(LearningProgress)
                .where(LearningProgress.profile_id == profile_id)
                .order_by(LearningProgress.entry_id, LearningProgress.direction)
            ).all()
            return [
                {
                    "entry_id": str(r.entry_id),
                    "direction": r.direction,
                    "reviews": r.reviews,
                    "counts": {"again": r.again, "hard": r.hard, "easy": r.easy},
                    "difficulty": r.weighted_sum / r.weight,
                    "last_reviewed_at": r.last_reviewed_at,
                }
                for r in records
            ]

    @app.get(
        "/api/profiles/{profile_id}",
        response_model=ProfileOutput,
        dependencies=[Depends(gate.require)],
    )
    def read_profile(profile_id: UUID):
        with sessions() as db:
            profile = db.get(Profile, profile_id)
            if profile is None:
                raise HTTPException(404, detail="Learner profile not found.")
            return profile

    @app.patch(
        "/api/profiles/{profile_id}",
        response_model=ProfileOutput,
        dependencies=[Depends(gate.require), Depends(gate.check_csrf)],
    )
    def update_profile(profile_id: UUID, body: ProfileUpdate):
        with sessions.begin() as db:
            profile = db.get(Profile, profile_id)
            if profile is None:
                raise HTTPException(404, detail="Learner profile not found.")
            for field, value in body.model_dump(exclude_unset=True).items():
                setattr(profile, field, value)
            db.flush()
            return ProfileOutput.model_validate(profile)

    @app.get(
        "/api/units",
        response_model=list[UnitOutput],
        dependencies=[Depends(gate.require)],
    )
    def units():
        with sessions() as db:
            return db.scalars(select(Unit).order_by(Unit.sort_order, Unit.code)).all()

    @app.get(
        "/api/tags",
        response_model=list[TagOutput],
        dependencies=[Depends(gate.require)],
    )
    def tags():
        with sessions() as db:
            return db.scalars(select(Tag).order_by(Tag.name, Tag.id)).all()

    @app.post(
        "/api/tags",
        response_model=TagOutput,
        status_code=201,
        dependencies=[Depends(gate.require), Depends(gate.check_csrf)],
    )
    def create_tag(body: TagCreate):
        try:
            with sessions.begin() as db:
                tag = Tag(**body.model_dump())
                db.add(tag)
                db.flush()
                return TagOutput.model_validate(tag)
        except IntegrityError:
            raise HTTPException(
                409,
                detail={
                    "code": "invalid_input",
                    "message": "Tag name already exists.",
                    "fields": ["name"],
                },
            ) from None

    @app.post(
        "/api/units",
        response_model=UnitOutput,
        status_code=201,
        dependencies=[Depends(gate.require), Depends(gate.check_csrf)],
    )
    def create_unit(body: UnitCreate):
        try:
            with sessions.begin() as db:
                unit = Unit(**body.model_dump())
                db.add(unit)
                db.flush()
                return UnitOutput.model_validate(unit)
        except IntegrityError:
            raise HTTPException(
                409,
                detail={
                    "code": "invalid_input",
                    "message": "Unit code already exists.",
                    "fields": ["code"],
                },
            ) from None

    @app.get(
        "/api/openapi.json",
        dependencies=[Depends(gate.require)],
        include_in_schema=False,
    )
    def openapi():
        return app.openapi()

    if (settings.static_dir / "assets").is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=settings.static_dir / "assets"),
            name="assets",
        )

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, detail="Endpoint not found.")
        index = settings.static_dir / "index.html"
        if not index.is_file():
            raise HTTPException(
                503,
                detail={
                    "code": "frontend_unavailable",
                    "message": "Build the frontend first.",
                },
            )
        return FileResponse(index)

    return app
