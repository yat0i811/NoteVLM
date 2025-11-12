from __future__ import annotations

import json

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..storage import storage_manager


def ensure_document(db: Session, document_id: str) -> models.Document:
    document = db.get(models.Document, document_id)
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return document


def build_source_file(document: models.Document) -> schemas.DocumentSourceFile | None:
    if not (
        document.source_stored_name
        and document.source_original_name
        and document.source_mime_type
        and document.source_size is not None
    ):
        return None
    return schemas.DocumentSourceFile(
        name=document.source_original_name,
        mime_type=document.source_mime_type,
        size=document.source_size,
        download_url=f"/api/documents/{document.id}/original",
    )


def document_to_detail(document: models.Document, *, content: str | None = None) -> schemas.DocumentDetail:
    resolved_content = content if content is not None else storage_manager.load_document(document.stored_name)
    layout_payload: schemas.LayoutDocument | None = None
    response_content = resolved_content

    if document.format == "layout":
        try:
            payload = json.loads(resolved_content) if resolved_content else {}
        except json.JSONDecodeError as exc:  # pragma: no cover - corrupted storage should surface clearly
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stored layout data is invalid") from exc

        pages = []
        for page in payload.get("pages", []):
            index = page.get("index")
            if index is None:
                continue
            image_info = page.get("image", {})
            pages.append(
                schemas.LayoutPage(
                    index=index,
                    text=page.get("text", ""),
                    image=schemas.LayoutImage(
                        url=f"/api/documents/{document.id}/layout/pages/{index}/image",
                        width=image_info.get("width", 0),
                        height=image_info.get("height", 0),
                    ),
                )
            )

        layout_payload = schemas.LayoutDocument(
            version=payload.get("version", 1),
            pages=pages,
        )
        response_content = ""

    return schemas.DocumentDetail(
        id=document.id,
        upload_id=document.upload_id,
        title=document.title,
        format=document.format,  # type: ignore[arg-type]
        created_at=document.created_at,
        updated_at=document.updated_at,
        content=response_content,
        source_file=build_source_file(document),
        layout=layout_payload,
    )


def delete_document_files(document: models.Document) -> None:
    storage_manager.delete_document(document.stored_name)
    storage_manager.delete_document_source(document.source_stored_name)
    if document.format == "layout":
        storage_manager.delete_layout_assets(document.id)
