from __future__ import annotations

import io
import json
import mimetypes
import os
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from .. import models, schemas
from ..dependencies import get_db
from ..services import documents as document_service
from ..storage import storage_manager

router = APIRouter(prefix="/documents", tags=["documents"])


def build_content_disposition(filename: str) -> str:
    base_name, ext = os.path.splitext(filename)
    normalized = unicodedata.normalize("NFKD", base_name).encode("ascii", "ignore").decode("ascii")
    sanitized = re.sub(r"[^A-Za-z0-9._-]", "_", normalized).strip("._-")
    if not sanitized:
        sanitized = "document"
    safe_filename = f"{sanitized}{ext}"
    quoted = quote(filename)
    return f"attachment; filename=\"{safe_filename}\"; filename*=UTF-8''{quoted}"


@router.get("", response_model=list[schemas.DocumentSummary])
def list_documents(db: Session = Depends(get_db)) -> list[schemas.DocumentSummary]:
    documents = db.query(models.Document).order_by(models.Document.updated_at.desc()).all()
    return [schemas.DocumentSummary.model_validate(doc) for doc in documents]


@router.get("/{document_id}", response_model=schemas.DocumentDetail)
def get_document(document_id: str, db: Session = Depends(get_db)) -> schemas.DocumentDetail:
    document = document_service.ensure_document(db, document_id)
    return document_service.document_to_detail(document)


@router.put("/{document_id}", response_model=schemas.DocumentDetail)
def update_document(document_id: str, payload: schemas.UpdateDocumentRequest, db: Session = Depends(get_db)) -> schemas.DocumentDetail:
    document = document_service.ensure_document(db, document_id)

    if payload.title:
        document.title = payload.title
    document.updated_at = datetime.utcnow()

    if document.format == "layout":
        if payload.layout is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Layout payload is required")
        raw = storage_manager.load_document(document.stored_name)
        try:
            stored_layout = json.loads(raw) if raw else {"version": 1, "pages": []}
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stored layout data is invalid") from exc

        payload_pages = {page.index: page for page in payload.layout.pages}
        updated_pages: list[dict] = []
        for page in stored_layout.get("pages", []):
            index = page.get("index")
            if index in payload_pages:
                page["text"] = payload_pages[index].text
            updated_pages.append(page)
        stored_layout["pages"] = updated_pages
        stored_layout["version"] = payload.layout.version
        serialized = json.dumps(stored_layout, ensure_ascii=False)
        path = storage_manager.save_document(document.id, document.format, serialized)
        document.stored_name = path.name
        return document_service.document_to_detail(document, content=serialized)

    if payload.content is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Content is required")

    path = storage_manager.save_document(document.id, document.format, payload.content)
    document.stored_name = path.name

    return document_service.document_to_detail(document, content=payload.content)


@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
def delete_document(document_id: str, db: Session = Depends(get_db)) -> Response:
    document = document_service.ensure_document(db, document_id)

    document_service.delete_document_files(document)
    db.delete(document)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{document_id}/download")
def download_document(document_id: str, db: Session = Depends(get_db)) -> FileResponse:
    document = document_service.ensure_document(db, document_id)

    if document.format == "layout":
        raw = storage_manager.load_document(document.stored_name)
        try:
            layout = json.loads(raw) if raw else {}
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stored layout data is invalid") from exc

        pages = layout.get("pages", [])
        if not pages:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Layout document has no pages")

        buffer = io.BytesIO()
        pdf_canvas: canvas.Canvas | None = None

        for idx, page in enumerate(pages):
            image_info = page.get("image", {})
            file_name = image_info.get("file")
            if not file_name:
                continue
            image_path = storage_manager.layout_image_path(file_name)
            if not image_path.exists():
                continue

            width = float(image_info.get("width") or 595)
            height = float(image_info.get("height") or 842)

            if pdf_canvas is None:
                pdf_canvas = canvas.Canvas(buffer, pagesize=(width, height))
            else:
                pdf_canvas.setPageSize((width, height))

            with image_path.open("rb") as handle:
                pdf_canvas.drawImage(ImageReader(handle), 0, 0, width=width, height=height)

            try:
                pdf_canvas.saveState()
                pdf_canvas.setFillAlpha(0.82)
                pdf_canvas.setFillColorRGB(1, 1, 1)
                pdf_canvas.rect(0, 0, width, height, stroke=0, fill=1)
                pdf_canvas.restoreState()
            except AttributeError:
                pass

            margin = max(36.0, min(width, height) * 0.06)
            box_width = max(120.0, width - margin * 2)
            box_height = max(120.0, height - margin * 2)

            pdf_canvas.saveState()
            pdf_canvas.setFillColorRGB(1, 1, 1)
            pdf_canvas.rect(margin, margin, box_width, box_height, stroke=0, fill=1)
            pdf_canvas.restoreState()

            text_content = page.get("text", "")
            if text_content.strip():
                text_left = margin + 18
                text_top = height - margin - 36
                text_obj = pdf_canvas.beginText(text_left, text_top)
                text_obj.setFont("Helvetica", 12)
                text_obj.setLeading(18)
                available_width = max(120.0, box_width - 36)
                for raw_line in text_content.splitlines():
                    if not raw_line.strip():
                        text_obj.textLine("")
                        continue
                    for wrapped in simpleSplit(raw_line, "Helvetica", 11, available_width):
                        text_obj.textLine(wrapped)
                pdf_canvas.drawText(text_obj)

            if idx < len(pages) - 1:
                pdf_canvas.showPage()

        if pdf_canvas is None:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to render layout PDF")

        pdf_canvas.save()
        buffer.seek(0)

        filename = f"{document.title}.pdf"
        headers = {
            "Content-Disposition": build_content_disposition(filename),
        }
        return StreamingResponse(buffer, media_type="application/pdf", headers=headers)

    path = storage_manager.documents_dir / document.stored_name
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Stored document missing")

    media_type = (
        "text/markdown"
        if document.format == "markdown"
        else mimetypes.types_map.get(".tex", "application/x-tex")
    )
    filename = document.title
    suffix = ".md" if document.format == "markdown" else ".tex"
    return FileResponse(path, media_type=media_type, filename=f"{filename}{suffix}")


@router.get("/{document_id}/original")
def download_document_original(document_id: str, preview: bool = Query(False), db: Session = Depends(get_db)) -> FileResponse:
    document = document_service.ensure_document(db, document_id)
    if not document.source_stored_name or not document.source_original_name:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Original file not stored")

    path = storage_manager.documents_dir / document.source_stored_name
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Stored original file missing")

    media_type = document.source_mime_type or mimetypes.guess_type(document.source_original_name)[0] or "application/octet-stream"
    safe_name = Path(document.source_original_name).name
    response = FileResponse(path, media_type=media_type, filename=safe_name)
    if preview:
        disposition = response.headers.get("Content-Disposition")
        if disposition:
            response.headers["Content-Disposition"] = disposition.replace("attachment", "inline", 1)
    return response


@router.get("/{document_id}/layout/pages/{page_index}/image")
def get_layout_page_image(document_id: str, page_index: int, db: Session = Depends(get_db)) -> FileResponse:
    document = document_service.ensure_document(db, document_id)
    if document.format != "layout":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layout not available for this document")

    raw = storage_manager.load_document(document.stored_name)
    try:
        layout = json.loads(raw) if raw else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Stored layout data is invalid") from exc

    target_page = None
    for page in layout.get("pages", []):
        if page.get("index") == page_index:
            target_page = page
            break

    if not target_page:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requested page image not found")

    image_info = target_page.get("image", {})
    file_name = image_info.get("file")
    if not file_name:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not stored")

    path = storage_manager.layout_image_path(file_name)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Stored image missing")

    return FileResponse(path, media_type="image/png", filename=f"{document.title}_page{page_index}.png")
