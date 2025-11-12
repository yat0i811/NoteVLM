from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Iterable

from fastapi import UploadFile

from .config import settings


class StorageManager:
    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()
        self.uploads_dir = self.root / "uploads"
        self.documents_dir = self.root / "documents"
        self.logs_dir = self.root / "logs"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.documents_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)

    def save_upload(self, file_id: str, file: UploadFile) -> Path:
        safe_name = self._sanitize_filename(file.filename or "upload")
        target_path = self.uploads_dir / f"{file_id}_{safe_name}"
        with target_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return target_path

    def delete_upload(self, stored_name: str) -> None:
        path = self.uploads_dir / stored_name
        if path.exists():
            path.unlink()

    def get_upload_path(self, stored_name: str) -> Path:
        return self.uploads_dir / stored_name

    def save_document(self, doc_id: str, format_: str, content: str) -> Path:
        if format_ == "markdown":
            suffix = "md"
        elif format_ == "latex":
            suffix = "tex"
        elif format_ == "layout":
            suffix = "json"
        else:
            raise ValueError(f"Unsupported document format: {format_}")
        filename = f"{doc_id}.{suffix}"
        target_path = self.documents_dir / filename
        target_path.write_text(content, encoding="utf-8")
        return target_path

    def save_document_source(self, doc_id: str, upload_path: Path, original_name: str) -> Path:
        suffix = Path(original_name).suffix or upload_path.suffix
        filename = f"{doc_id}_source{suffix}"
        target_path = self.documents_dir / filename
        shutil.copyfile(upload_path, target_path)
        return target_path

    def load_document(self, stored_name: str) -> str:
        path = self.documents_dir / stored_name
        return path.read_text(encoding="utf-8")

    def delete_document(self, stored_name: str) -> None:
        path = self.documents_dir / stored_name
        if path.exists():
            path.unlink()

    def delete_document_source(self, stored_name: str | None) -> None:
        if not stored_name:
            return
        path = self.documents_dir / stored_name
        if path.exists():
            path.unlink()

    def save_layout_image(self, doc_id: str, page_index: int, data: bytes) -> Path:
        filename = f"{doc_id}_layout_{page_index:03d}.png"
        target_path = self.documents_dir / filename
        target_path.write_bytes(data)
        return target_path

    def layout_image_path(self, stored_name: str) -> Path:
        return self.documents_dir / stored_name

    def delete_layout_assets(self, doc_id: str) -> None:
        pattern = f"{doc_id}_layout_"
        for path in self.documents_dir.glob(f"{pattern}*"):
            try:
                path.unlink()
            except FileNotFoundError:
                continue

    def list_upload_files(self) -> Iterable[Path]:
        return self.uploads_dir.glob("*")

    def append_log(self, filename: str, entry: dict) -> None:
        target = self.logs_dir / filename
        with target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def _sanitize_filename(self, name: str) -> str:
        base = Path(name).name
        return re.sub(r"[^A-Za-z0-9._-]", "_", base)


storage_manager = StorageManager(settings.storage_root)
