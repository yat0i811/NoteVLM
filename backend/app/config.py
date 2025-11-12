from __future__ import annotations

import json
from functools import lru_cache
from typing import Dict, Iterable, Literal, Tuple

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _parse_comma_separated(value: str) -> Tuple[str, ...]:
    entries = [item.strip() for item in value.split(",") if item.strip()]
    if not entries:
        raise ValueError("At least one model identifier must be provided")
    return tuple(entries)


def _safe_json_loads(value: str):
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.backend",
        env_file_encoding="utf-8",
        case_sensitive=False,
        env_json_loads=_safe_json_loads,
    )

    database_url: str = "sqlite:///./storage/app.db"
    storage_root: str = "./storage"
    qwen_mock: bool = False
    qwen_local_model: str = "Qwen/Qwen3-VL-4B-Instruct"
    qwen_available_models: tuple[str, ...] = (
        "Qwen/Qwen3-VL-2B-Instruct",
        "Qwen/Qwen3-VL-4B-Instruct",
        "Qwen/Qwen3-VL-8B-Instruct",
        "Qwen/Qwen3-VL-32B-Instruct",
        "Qwen/Qwen3-VL-2B-Instruct-FP8",
        "Qwen/Qwen3-VL-4B-Instruct-FP8",
        "Qwen/Qwen3-VL-8B-Instruct-FP8",
        "Qwen/Qwen3-VL-32B-Instruct-FP8",
    )
    qwen_local_revision: str | None = None
    qwen_local_dtype: Literal["float16", "bfloat16", "float32"] = "bfloat16"
    qwen_local_device_map: str = "auto"
    qwen_local_max_new_tokens: int = 2048
    huggingface_hub_token: str | None = None
    vllm_base_url: str = "http://vllm:8000"
    vllm_api_key: str | None = None
    vllm_request_timeout_seconds: float = 300.0
    vllm_model_endpoints: Dict[str, str] = {}
    vllm_service_names: Dict[str, str] = {}
    vllm_service_start_timeout_seconds: float = 240.0
    vllm_service_poll_interval_seconds: float = 2.0
    deepseek_available_models: tuple[str, ...] = ()
    deepseek_base_url: str = "http://deepseek-ocr:8000"
    deepseek_api_key: str | None = None
    deepseek_request_timeout_seconds: float = 300.0
    deepseek_model_endpoints: Dict[str, str] = {}
    deepseek_service_names: Dict[str, str] = {}
    deepseek_service_start_timeout_seconds: float | None = None
    chandra_available_models: tuple[str, ...] = ()
    chandra_base_url: str = "http://chandra-ocr:8000"
    chandra_api_key: str | None = None
    chandra_request_timeout_seconds: float = 300.0
    chandra_model_endpoints: Dict[str, str] = {}
    chandra_service_names: Dict[str, str] = {}
    chandra_service_start_timeout_seconds: float | None = 600.0
    pdf_page_limit: int = 20
    max_upload_size_mb: int = 20
    allowed_mime_types: tuple[str, ...] = (
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/heic",
        "image/heif",
    )
    frontend_origin: str = "*"

    @field_validator("qwen_available_models", mode="before")
    @classmethod
    def _coerce_available_models(cls, value: Iterable[str] | str) -> tuple[str, ...]:
        if isinstance(value, str):
            return _parse_comma_separated(value)
        if isinstance(value, Iterable):
            converted = tuple(item.strip() for item in value if str(item).strip())
            if converted:
                return converted
        raise ValueError("QWEN_AVAILABLE_MODELS must contain at least one model identifier")

    @field_validator("qwen_local_model")
    @classmethod
    def _validate_default_model(cls, value: str, info):
        available_qwen = info.data.get("qwen_available_models") or ()
        available_deepseek = info.data.get("deepseek_available_models") or ()
        available_chandra = info.data.get("chandra_available_models") or ()
        available = tuple(available_qwen) + tuple(available_deepseek) + tuple(available_chandra)
        if available and value not in available:
            raise ValueError(
                f"Default model '{value}' is not present in QWEN_AVAILABLE_MODELS {available}"
            )
        return value

    @field_validator("vllm_model_endpoints", mode="before")
    @classmethod
    def _parse_vllm_endpoints(cls, value: Dict[str, str] | str | None) -> Dict[str, str]:
        if value in (None, ""):
            return {}
        if isinstance(value, dict):
            return {str(k): str(v) for k, v in value.items()}
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:  # pragma: no cover - invalid env only at runtime
                raise ValueError("VLLM_MODEL_ENDPOINTS must be valid JSON") from exc
            if not isinstance(parsed, dict):
                raise ValueError("VLLM_MODEL_ENDPOINTS must be a mapping of model -> URL")
            return {str(k): str(v) for k, v in parsed.items()}
        raise ValueError("Unsupported VLLM_MODEL_ENDPOINTS value")

    @field_validator("vllm_service_names", mode="before")
    @classmethod
    def _parse_vllm_service_names(cls, value: Dict[str, str] | str | None) -> Dict[str, str]:
        if value in (None, ""):
            return {}
        if isinstance(value, dict):
            return {str(k): str(v) for k, v in value.items() if str(k).strip() and str(v).strip()}
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:  # pragma: no cover - invalid env only at runtime
                raise ValueError("VLLM_SERVICE_NAMES must be valid JSON") from exc
            if not isinstance(parsed, dict):
                raise ValueError("VLLM_SERVICE_NAMES must be a mapping of model -> container name")
            return {str(k): str(v) for k, v in parsed.items() if str(k).strip() and str(v).strip()}
        raise ValueError("Unsupported VLLM_SERVICE_NAMES value")

    @field_validator("deepseek_available_models", mode="before")
    @classmethod
    def _coerce_deepseek_models(cls, value: Iterable[str] | str) -> tuple[str, ...]:
        if value in (None, ""):
            return ()
        if isinstance(value, str):
            if not value.strip():
                return ()
            return _parse_comma_separated(value)
        if isinstance(value, Iterable):
            return tuple(item.strip() for item in value if str(item).strip())
        raise ValueError("DEEPSEEK_AVAILABLE_MODELS must contain at least one model identifier")

    @field_validator("deepseek_model_endpoints", mode="before")
    @classmethod
    def _parse_deepseek_endpoints(cls, value: Dict[str, str] | str | None) -> Dict[str, str]:
        if value in (None, ""):
            return {}
        if isinstance(value, dict):
            return {str(k): str(v) for k, v in value.items()}
        if isinstance(value, str):
            if not value.strip():
                return {}
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("DEEPSEEK_MODEL_ENDPOINTS must be valid JSON") from exc
            if not isinstance(parsed, dict):
                raise ValueError("DEEPSEEK_MODEL_ENDPOINTS must be a mapping of model -> URL")
            return {str(k): str(v) for k, v in parsed.items()}
        raise ValueError("Unsupported DEEPSEEK_MODEL_ENDPOINTS value")

    @field_validator("deepseek_service_names", mode="before")
    @classmethod
    def _parse_deepseek_service_names(cls, value: Dict[str, str] | str | None) -> Dict[str, str]:
        if value in (None, ""):
            return {}
        if isinstance(value, dict):
            return {str(k): str(v) for k, v in value.items() if str(k).strip() and str(v).strip()}
        if isinstance(value, str):
            if not value.strip():
                return {}
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("DEEPSEEK_SERVICE_NAMES must be valid JSON") from exc
            if not isinstance(parsed, dict):
                raise ValueError("DEEPSEEK_SERVICE_NAMES must be a mapping of model -> container name")
            return {str(k): str(v) for k, v in parsed.items() if str(k).strip() and str(v).strip()}
        raise ValueError("Unsupported DEEPSEEK_SERVICE_NAMES value")

    @field_validator("chandra_available_models", mode="before")
    @classmethod
    def _coerce_chandra_models(cls, value: Iterable[str] | str) -> tuple[str, ...]:
        if value in (None, ""):
            return ()
        if isinstance(value, str):
            if not value.strip():
                return ()
            return _parse_comma_separated(value)
        if isinstance(value, Iterable):
            return tuple(item.strip() for item in value if str(item).strip())
        raise ValueError("CHANDRA_AVAILABLE_MODELS must contain at least one model identifier")

    @field_validator("chandra_model_endpoints", mode="before")
    @classmethod
    def _parse_chandra_endpoints(cls, value: Dict[str, str] | str | None) -> Dict[str, str]:
        if value in (None, ""):
            return {}
        if isinstance(value, dict):
            return {str(k): str(v) for k, v in value.items()}
        if isinstance(value, str):
            if not value.strip():
                return {}
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("CHANDRA_MODEL_ENDPOINTS must be valid JSON") from exc
            if not isinstance(parsed, dict):
                raise ValueError("CHANDRA_MODEL_ENDPOINTS must be a mapping of model -> URL")
            return {str(k): str(v) for k, v in parsed.items()}
        raise ValueError("Unsupported CHANDRA_MODEL_ENDPOINTS value")

    @field_validator("chandra_service_names", mode="before")
    @classmethod
    def _parse_chandra_service_names(cls, value: Dict[str, str] | str | None) -> Dict[str, str]:
        if value in (None, ""):
            return {}
        if isinstance(value, dict):
            return {str(k): str(v) for k, v in value.items() if str(k).strip() and str(v).strip()}
        if isinstance(value, str):
            if not value.strip():
                return {}
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("CHANDRA_SERVICE_NAMES must be valid JSON") from exc
            if not isinstance(parsed, dict):
                raise ValueError("CHANDRA_SERVICE_NAMES must be a mapping of model -> container name")
            return {str(k): str(v) for k, v in parsed.items() if str(k).strip() and str(v).strip()}
        raise ValueError("Unsupported CHANDRA_SERVICE_NAMES value")

    @property
    def available_models(self) -> tuple[str, ...]:
        return (
            tuple(self.qwen_available_models)
            + tuple(self.deepseek_available_models)
            + tuple(self.chandra_available_models)
        )

    @property
    def model_endpoints(self) -> Dict[str, str]:
        combined = dict(self.vllm_model_endpoints)
        combined.update(self.deepseek_model_endpoints)
        combined.update(self.chandra_model_endpoints)
        return combined

    @property
    def service_names_map(self) -> Dict[str, str]:
        combined = dict(self.vllm_service_names)
        combined.update(self.deepseek_service_names)
        combined.update(self.chandra_service_names)
        return combined

    def service_start_timeout(self, model_id: str) -> float:
        if model_id in self.deepseek_available_models:
            return (
                self.deepseek_service_start_timeout_seconds
                if self.deepseek_service_start_timeout_seconds is not None
                else self.vllm_service_start_timeout_seconds
            )
        if model_id in self.chandra_available_models:
            return (
                self.chandra_service_start_timeout_seconds
                if self.chandra_service_start_timeout_seconds is not None
                else self.vllm_service_start_timeout_seconds
            )
        return self.vllm_service_start_timeout_seconds


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
