from __future__ import annotations

from fastapi import APIRouter

from ..config import settings
from ..schemas import ModelInfo

router = APIRouter(prefix="/models", tags=["models"])


@router.get("", response_model=list[ModelInfo])
def list_models() -> list[ModelInfo]:
    return [
        ModelInfo(id=model_id, is_default=model_id == settings.qwen_local_model)
        for model_id in settings.available_models
    ]
