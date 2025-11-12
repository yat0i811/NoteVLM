from __future__ import annotations

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .database import Base, engine
from .routers import documents, files, models


def create_app() -> FastAPI:
    Base.metadata.create_all(bind=engine)

    app = FastAPI(title="NoteVLM API")

    origins = (
        ["*"]
        if settings.frontend_origin == "*"
        else [origin.strip() for origin in settings.frontend_origin.split(",") if origin.strip()]
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def limit_upload_size(request: Request, call_next):
        if request.method in {"POST", "PUT"}:
            content_length = request.headers.get("content-length")
            if content_length and int(content_length) > settings.max_upload_size_mb * 1024 * 1024:
                return JSONResponse(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    content={"detail": "Upload too large"},
                )
        return await call_next(request)

    app.include_router(files.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(models.router, prefix="/api")

    @app.get("/health", tags=["system"])
    async def health():
        return {"status": "ok"}

    return app


app = create_app()
