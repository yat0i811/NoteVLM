from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class UploadBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    original_name: str
    mime_type: str
    size: int
    created_at: datetime


class UploadDetail(UploadBase):
    documents: list["DocumentSummary"] = Field(default_factory=list)


class DocumentSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    upload_id: str
    title: str
    format: Literal["markdown", "latex", "layout"]
    created_at: datetime
    updated_at: datetime


class DocumentSourceFile(BaseModel):
    name: str
    mime_type: str
    size: int
    download_url: str


class LayoutImage(BaseModel):
    url: str
    width: int
    height: int


class LayoutPage(BaseModel):
    index: int
    text: str
    image: LayoutImage


class LayoutDocument(BaseModel):
    version: int = 1
    pages: list[LayoutPage]


class DocumentDetail(DocumentSummary):
    content: str
    source_file: DocumentSourceFile | None = None
    layout: LayoutDocument | None = None


class DigitalizeRequest(BaseModel):
    target_format: Literal["markdown", "latex", "layout"]
    title: Optional[str] = None
    model: Optional[str] = None


class UpdateDocumentRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    layout: Optional[LayoutDocument] = None


class ModelInfo(BaseModel):
    id: str
    is_default: bool = False
