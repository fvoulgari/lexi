"""Public language catalogue derived from the curated database registry."""

from fastapi import APIRouter

from app.registry import get_registry


def language_router(sessions):
    router = APIRouter(prefix="/api/languages")

    @router.get("")
    def catalogue():
        registry = get_registry()
        return {
            "languages": [
                item.public_payload() for item in registry.public_languages()
            ],
            "directions": [
                item.public_payload() for item in registry.public_directions()
            ],
        }

    return router
