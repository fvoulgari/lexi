import asyncio
import os
from contextlib import asynccontextmanager
from urllib.parse import quote
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.access import (
    apply_scope,
    current_account,
    lock_owned_profile,
    require_same_scope,
    require_write,
)
from app.accounts import account_router
from app.auth import initialize_auth
from app.collections import collection_router
from app.config import Settings
from app.csv_export import export_collections, export_library
from app.csv_format import FORMAT_VERSION_V2, FORMAT_VERSION_V3
from app.database import database
from app.duplicates import normalized_pair
from app.filters import vocabulary_conditions
from app.grammar import (
    apply_structured_input,
    clean_grammar,
    missing_gender_fields,
    sync_entry_grammar,
)
from app.imports import import_router
from app.languages import card_languages, pair_mismatch_message, same_pair
from app.languages_api import language_router
from app.models import (
    Collection,
    CollectionEntry,
    LearningProgress,
    Profile,
    Tag,
    VocabularyEntry,
)
from app.practice import (
    difficult_progress,
    practice_availability_router,
    practice_router,
)
from app.progress import progress_router
from app.registry import refresh_registry
from app.schemas import (
    Direction,
    ProfileOutput,
    ProfileUpdate,
    TagCreate,
    TagOutput,
    VocabularyCreateRequest,
    VocabularyOutput,
    VocabularyPage,
    VocabularySaved,
    VocabularyUpdate,
    WordType,
)
from app.timing import RequestTimingMiddleware
from app.vocabulary_bulk import vocabulary_bulk_router
from app.vocabulary_deletion import delete_entries


def create_app():
    settings = Settings()
    engine, sessions = database(settings.database_url)

    @asynccontextmanager
    async def lifespan(app):
        from app.account_deletion import deletion_worker

        with sessions() as db:
            refresh_registry(db)
        worker = asyncio.create_task(deletion_worker(sessions)) if gate.ready else None
        try:
            yield
        finally:
            if worker:
                worker.cancel()
                try:
                    await worker
                except asyncio.CancelledError:
                    pass
            engine.dispose()

    def refresh_catalogue():
        # Refresh per request so data-only registry changes are visible at once.
        with sessions() as db:
            refresh_registry(db)

    app = FastAPI(
        title="Lexi",
        lifespan=lifespan,
        dependencies=[Depends(refresh_catalogue)],
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    gate = initialize_auth(app, settings, sessions)
    app.state.gate = gate
    app.state.sessions = sessions

    @app.middleware("http")
    async def response_security(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
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
        fields = sorted(
            {
                str(error["loc"][1])
                for error in exc.errors()
                if len(error["loc"]) > 1 and error["loc"][0] == "body"
            }
        )
        languages = [
            language
            for prefix, language in (("italian", "Italian"), ("greek", "Greek"))
            if any(
                field.startswith(prefix) and field.endswith("_gender")
                for field in fields
            )
        ]
        model_messages = [
            str(error["msg"]).removeprefix("Value error, ")
            for error in exc.errors()
            if len(error["loc"]) <= 1 and str(error["msg"]).startswith("Value error, ")
        ]
        if languages:
            message = "Check the entry's gender for: " + ", ".join(languages)
        elif model_messages:
            message = model_messages[0]
        else:
            message = "Check the submitted fields."
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "invalid_input",
                    "message": message,
                    "fields": fields,
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
        return {
            "status": "ok",
            "deployment_id": os.environ.get("RAILWAY_DEPLOYMENT_ID"),
            "ingress_mode": settings.auth_ingress_mode,
        }

    app.include_router(language_router(sessions))
    app.include_router(account_router(sessions, gate))
    app.include_router(collection_router(sessions, gate))
    app.include_router(practice_availability_router(sessions, gate))
    app.include_router(practice_router(sessions, gate))
    app.include_router(progress_router(sessions, gate))
    app.include_router(import_router(sessions, gate))
    app.include_router(vocabulary_bulk_router(sessions, gate))

    app.get("/api/auth/session")(gate.state)
    app.post("/api/auth/logout")(gate.logout)
    app.post("/api/auth/logout-all")(gate.logout_all)

    def collection_membership(db, collection_id):
        collection = db.get(Collection, collection_id)
        if collection is None:
            raise HTTPException(404, "Collection not found.")
        return collection, VocabularyEntry.id.in_(
            select(CollectionEntry.entry_id).where(
                CollectionEntry.collection_id == collection_id
            )
        )

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
        collection_id: UUID | None = None,
        archived: bool = False,
        all_languages: bool = False,
    ):
        conditions = vocabulary_conditions(q, unit_ids, no_unit, word_types, tag_ids)
        if not all_languages:
            conditions.extend(
                [
                    VocabularyEntry.source_language == "it",
                    VocabularyEntry.target_language == "el",
                ]
            )
        with sessions() as db:
            if collection_id is not None:
                _, membership = collection_membership(db, collection_id)
                conditions.append(membership)
            if archived:
                conditions.append(VocabularyEntry.archived_at.is_not(None))
            total = db.scalar(
                select(func.count())
                .select_from(VocabularyEntry)
                .where(*conditions)
                .execution_options(include_archived=archived)
            )
            entries = db.scalars(
                select(VocabularyEntry)
                .where(*conditions)
                .execution_options(include_archived=archived)
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
        "/api/vocabulary/export.csv",
        dependencies=[Depends(gate.require)],
        response_class=Response,
    )
    def export_vocabulary(
        collection_id: UUID | None = None,
        q: str = Query("", max_length=500),
        word_types: list[WordType] = Query(default=[]),
        tag_ids: list[UUID] = Query(default=[]),
        include_ids: bool = False,
        archived: bool = False,
        format: str | None = None,
        representation: str | None = None,
    ):
        if format not in (None, "v1", "v2", "v3"):
            raise HTTPException(422, "Choose CSV format v1, v2 or v3.")
        if representation not in (None, "vocabulary", "metadata"):
            raise HTTPException(
                422, "Choose a vocabulary or all-metadata export."
            )
        if representation and format:
            raise HTTPException(
                422, "Choose an export representation, not a CSV version."
            )
        vocabulary_only = representation == "vocabulary"
        metadata = representation == "metadata"
        use_v2 = (
            format in ("v2", "v3")
            or representation in ("vocabulary", "metadata")
            or (format is None and representation is None and collection_id is not None)
        )
        conditions = vocabulary_conditions(q, [], False, word_types, tag_ids)
        if archived:
            conditions.append(VocabularyEntry.archived_at.is_not(None))
        with sessions() as db:
            filename = "lexi-vocabulary.csv"
            collection = None
            if collection_id is not None:
                collection, membership = collection_membership(db, collection_id)
                conditions.append(membership)
                filename = f"{collection.title}.csv"
            entries = db.scalars(
                select(VocabularyEntry)
                .where(*conditions)
                .execution_options(include_archived=archived)
                .order_by(VocabularyEntry.italian, VocabularyEntry.id)
            ).all()
            return Response(
                export_collections(
                    entries,
                    current_account().id,
                    collection,
                    version=(
                        FORMAT_VERSION_V3
                        if metadata or format == "v3"
                        else FORMAT_VERSION_V2
                    ),
                    vocabulary_only=vocabulary_only,
                )
                if use_v2
                else export_library(
                    entries, current_account().id, include_ids=include_ids
                ),
                media_type="text/csv; charset=utf-8",
                headers={
                    "Content-Disposition": (
                        f"attachment; filename*=UTF-8''{quote(filename, safe='')}"
                        if collection_id is not None
                        else f'attachment; filename="{filename}"'
                    )
                },
            )

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
        def reject_structured(errors):
            raise HTTPException(
                422,
                detail={
                    "code": "invalid_input",
                    "message": "; ".join(
                        f"{error['path']}: {error['message']}" for error in errors
                    ),
                    "fields": [error["path"] for error in errors],
                },
            )

        with sessions.begin() as db:
            values = body.model_dump(exclude_unset=True)
            visibility = values.pop("visibility", "private")
            collection_id = values.pop("collection_id", None)
            legacy_unit_id = values.pop("unit_id", None)
            confirm_exposure = values.pop("confirm_collection_exposure", False)
            if legacy_unit_id is not None:
                if collection_id is not None or entry_id is not None:
                    raise HTTPException(422, "Choose a collection for this card.")
                matches = list(
                    db.scalars(
                        select(Collection.id).where(
                            Collection.source_unit_id == legacy_unit_id,
                            Collection.owner_account_id == current_account().id,
                        )
                    )
                )
                if len(matches) != 1:
                    raise HTTPException(
                        422,
                        {
                            "code": "invalid_input",
                            "message": "Choose a collection for this card.",
                            "fields": ["unit_id"],
                        },
                    )
                collection_id = matches[0]
            if entry_id is None and not collection_id:
                raise HTTPException(422, "Choose a collection for this card.")
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
                values = clean_grammar(values, values["word_type"])
                errors, grammar = apply_structured_input(
                    values, ("it", "el"), values["word_type"], VocabularyEntry
                )
                if errors:
                    reject_structured(errors)
                entry = apply_scope(VocabularyEntry(**values), visibility=visibility)
                sync_entry_grammar(entry, grammar)
                db.add(entry)
            else:
                entry = db.get(VocabularyEntry, entry_id)
                if entry is None:
                    raise HTTPException(404, detail="Vocabulary entry not found.")
                require_write(entry)
                languages = card_languages(entry)
                values = clean_grammar(
                    values, values.get("word_type", entry.word_type), languages
                )
                errors, grammar = apply_structured_input(
                    values,
                    languages,
                    values.get("word_type", entry.word_type),
                    VocabularyEntry,
                )
                if errors:
                    reject_structured(errors)
                missing = missing_gender_fields(
                    {
                        "word_type": entry.word_type,
                        **{
                            field: getattr(entry, field)
                            for field in (
                                "italian_gender",
                                "greek_gender",
                                "italian_adjective_gender",
                                "greek_adjective_gender",
                            )
                        },
                        **values,
                    },
                    languages,
                )
                if missing:
                    raise HTTPException(
                        422,
                        detail={
                            "code": "invalid_input",
                            "fields": missing,
                            "message": "Choose the entry's gender for: "
                            + ", ".join(
                                "Italian" if field.startswith("italian") else "Greek"
                                for field in missing
                            ),
                        },
                    )
                for field, value in values.items():
                    setattr(entry, field, value)
                sync_entry_grammar(entry, grammar)
            if tag_ids is not None:
                for tag in tags:
                    require_same_scope(entry, tag)
                entry.tags = tags
            db.flush()
            db.refresh(entry)
            if collection_id is not None:
                collection = db.scalar(
                    select(Collection)
                    .where(Collection.id == collection_id)
                    .with_for_update()
                )
                if (
                    collection is None
                    or collection.owner_account_id != current_account().id
                ):
                    raise HTTPException(403, "Choose a collection you own.")
                if (
                    entry.owner_account_id != current_account().id
                    or entry.visibility != "private"
                ):
                    raise HTTPException(
                        422, "New collection cards must be owned private cards."
                    )
                if not same_pair(
                    collection.source_language,
                    collection.target_language,
                    entry.source_language,
                    entry.target_language,
                ):
                    raise HTTPException(
                        422,
                        pair_mismatch_message(
                            entry.source_language,
                            entry.target_language,
                            collection.source_language,
                            collection.target_language,
                        ),
                    )
                published = collection.visibility == "published"
                if published and not confirm_exposure:
                    raise HTTPException(
                        409,
                        "Confirm sharing this new card through the public collection.",
                    )
                if entry_id is None and collection.source_unit_code:
                    entry.source_collection_id = collection.id
                position = (
                    db.scalar(
                        select(
                            func.coalesce(func.max(CollectionEntry.position), -1)
                        ).where(CollectionEntry.collection_id == collection.id)
                    )
                    + 1
                )
                db.add(
                    CollectionEntry(
                        collection_id=collection.id,
                        entry_id=entry.id,
                        position=position,
                        publication_confirmed=published,
                    )
                )
                db.flush()

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
    def create_entry(body: VocabularyCreateRequest):
        return save_entry(body)

    @app.delete(
        "/api/vocabulary/{entry_id}",
        dependencies=[Depends(gate.require), Depends(gate.check_csrf)],
    )
    def delete_entry(entry_id: UUID):
        with sessions.begin() as db:
            # Reviews take the same entry lock before inserting history.
            entry = db.scalar(
                select(VocabularyEntry)
                .where(VocabularyEntry.id == entry_id)
                .with_for_update(of=VocabularyEntry)
            )
            if entry is None:
                raise HTTPException(404, "Vocabulary entry not found.")
            require_write(entry)
            delete_entries(db, [entry_id])
            return {"deleted": str(entry_id)}

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
                if db.get(VocabularyEntry, record.entry_id) is not None
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
            profile = lock_owned_profile(db, profile_id)
            if profile is None:
                raise HTTPException(404, detail="Learner profile not found.")
            for field, value in body.model_dump(exclude_unset=True).items():
                setattr(profile, field, value)
            db.flush()
            return ProfileOutput.model_validate(profile)

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
                values = body.model_dump()
                visibility = values.pop("visibility", "private")
                tag = apply_scope(Tag(**values), visibility=visibility)
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
        public_files = {
            "sw.js": "text/javascript",
            "manifest.webmanifest": "application/manifest+json",
            "icon-192.png": "image/png",
            "icon-512.png": "image/png",
            "apple-touch-icon.png": "image/png",
            "favicon.ico": "image/vnd.microsoft.icon",
            "favicon-32.png": "image/png",
        }
        if path in public_files:
            asset = settings.static_dir / path
            if not asset.is_file():
                raise HTTPException(404, detail="Static file not found.")
            return FileResponse(
                asset,
                media_type=public_files[path],
            )
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

    app.add_middleware(RequestTimingMiddleware)
    return app
