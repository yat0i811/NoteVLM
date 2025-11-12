from __future__ import annotations

import mimetypes
import os
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import json

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import settings
from ..dependencies import get_db
from ..qwen_client import QwenClientError, get_qwen_client
from ..services import documents as document_service
from ..storage import storage_manager


router = APIRouter(prefix="/files", tags=["files"])


@router.get("", response_model=list[schemas.UploadDetail])
def list_files(db: Session = Depends(get_db)) -> list[schemas.UploadDetail]:
    uploads = (
        db.query(models.Upload)
        .filter(models.Upload.mime_type != "application/x-archived")
        .order_by(models.Upload.created_at.desc())
        .all()
    )
    return [schemas.UploadDetail.model_validate(upload) for upload in uploads]


@router.post("", response_model=schemas.UploadDetail, status_code=status.HTTP_201_CREATED)
async def upload_file(file: UploadFile = File(...), db: Session = Depends(get_db)) -> schemas.UploadDetail:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing filename")
    if settings.allowed_mime_types and file.content_type not in settings.allowed_mime_types:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")

    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)

    upload_id = str(uuid4())
    stored_path = storage_manager.save_upload(upload_id, file)

    upload = models.Upload(
        id=upload_id,
        original_name=file.filename,
        stored_name=stored_path.name,
        mime_type=file.content_type or mimetypes.guess_type(file.filename)[0] or "application/octet-stream",
        size=size,
        created_at=datetime.utcnow(),
    )
    db.add(upload)
    db.flush()
    db.refresh(upload)
    return schemas.UploadDetail.model_validate(upload)


@router.get("/{upload_id}")
def download_file(upload_id: str, preview: bool = Query(False), db: Session = Depends(get_db)) -> FileResponse:
    upload = db.get(models.Upload, upload_id)
    if not upload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found")
    path = storage_manager.get_upload_path(upload.stored_name)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Stored file missing")
    media_type = upload.mime_type or mimetypes.guess_type(upload.original_name)[0] or "application/octet-stream"
    safe_name = Path(upload.original_name).name
    response = FileResponse(path, media_type=media_type, filename=safe_name)
    if preview:
        disposition = response.headers.get("Content-Disposition")
        if disposition:
            response.headers["Content-Disposition"] = disposition.replace("attachment", "inline", 1)
    return response


@router.delete(
    "/{upload_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
def delete_file(upload_id: str, db: Session = Depends(get_db)) -> Response:
    upload = db.get(models.Upload, upload_id)
    if not upload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found")

    if upload.mime_type == "application/x-archived":
        if upload.stored_name:
            storage_manager.delete_upload(upload.stored_name)
            upload.stored_name = ""
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    if upload.documents:
        upload.mime_type = "application/x-archived"
        db.add(upload)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    storage_manager.delete_upload(upload.stored_name)
    db.delete(upload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{upload_id}/digitalize", response_model=list[schemas.DocumentDetail])
def digitalize_file(upload_id: str, payload: schemas.DigitalizeRequest, db: Session = Depends(get_db)) -> list[schemas.DocumentDetail]:
    upload = db.get(models.Upload, upload_id)
    if not upload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found")

    file_path = storage_manager.get_upload_path(upload.stored_name)
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Stored file missing")

    model_id = payload.model or settings.qwen_local_model
    if model_id not in settings.available_models:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported model_id",
        )

    qwen = get_qwen_client()
    try:
        result = qwen.digitalize(file_path, payload.target_format, model_id=model_id)
    except QwenClientError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    pages = result.pages
    if not pages:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Digitalization produced no content")

    base_title = payload.title or Path(upload.original_name).stem
    results: list[schemas.DocumentDetail] = []
    document_ids: list[str] = []
    document_titles: list[str] = []

    for index, page in enumerate(pages, start=1):
        content = page.content
        document_id = str(uuid4())
        title = base_title if len(pages) == 1 else f"{base_title} (Page {index})"
        document = models.Document(
            id=document_id,
            upload_id=upload.id,
            title=title,
            format=payload.target_format,
            stored_name="",
            source_stored_name=None,
            source_original_name=None,
            source_mime_type=None,
            source_size=None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )

        if payload.target_format == "layout":
            if not page.image:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Layout data missing page image")
            image_path = storage_manager.save_layout_image(document_id, index, page.image.data)
            layout_payload = {
                "version": 1,
                "pages": [
                    {
                        "index": index,
                        "text": content,
                        "image": {
                            "file": image_path.name,
                            "width": page.image.width,
                            "height": page.image.height,
                        },
                    }
                ],
            }
            content_to_store = json.dumps(layout_payload, ensure_ascii=False)
        else:
            content_to_store = content

        storage_path = storage_manager.save_document(document_id, document.format, content_to_store)
        document.stored_name = storage_path.name

        source_path = storage_manager.save_document_source(document_id, file_path, upload.original_name)
        document.source_stored_name = source_path.name
        document.source_original_name = upload.original_name
        document.source_mime_type = upload.mime_type
        document.source_size = source_path.stat().st_size

        db.add(document)
        db.flush()
        db.refresh(document)

        results.append(document_service.document_to_detail(document, content=content_to_store))
        document_ids.append(document.id)
        document_titles.append(document.title)

    try:
        storage_manager.append_log(
            "conversions.log",
            {
                "timestamp": datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
                "upload_id": upload.id,
                "document_ids": document_ids,
                "titles": document_titles,
                "target_format": payload.target_format,
                "model_id": model_id,
                "page_count": len(pages),
                "generation_seconds": round(result.total_seconds, 4),
                "model_prepare_seconds": round(sum(page.model_prepare_seconds for page in pages), 4),
                "inference_seconds": round(sum(page.inference_seconds for page in pages), 4),
                "per_page": [
                    {
                        "index": idx,
                        "model_prepare_seconds": round(page.model_prepare_seconds, 4),
                        "inference_seconds": round(page.inference_seconds, 4),
                    }
                    for idx, page in enumerate(pages, start=1)
                ],
            },
        )
    except Exception:
        # Logging failure should not break API response; errors are intentionally swallowed.
        pass

    return results
