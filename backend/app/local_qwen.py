from __future__ import annotations

import base64
import io
import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Iterable, List
import time

import httpx
from PIL import Image

from .config import settings
from .docker_manager import DockerManagerError, ensure_model_service

logger = logging.getLogger(__name__)


class LocalQwenUnavailable(RuntimeError):
    """Raised when the vLLM backend is not reachable or misconfigured."""


@dataclass
class GenerationResult:
    content: str
    model_prepare_seconds: float
    inference_seconds: float


class LocalQwenClient:
    def __init__(self, model_id: str) -> None:
        self.model_id = model_id
        self._service_map = settings.service_names_map
        if model_id in settings.deepseek_available_models:
            base_url = settings.deepseek_model_endpoints.get(
                model_id,
                settings.deepseek_base_url or settings.vllm_base_url,
            )
            api_key = settings.deepseek_api_key
            timeout = settings.deepseek_request_timeout_seconds
        elif model_id in settings.chandra_available_models:
            base_url = settings.chandra_model_endpoints.get(
                model_id,
                settings.chandra_base_url or settings.vllm_base_url,
            )
            api_key = settings.chandra_api_key
            timeout = settings.chandra_request_timeout_seconds
        else:
            base_url = settings.vllm_model_endpoints.get(model_id, settings.vllm_base_url)
            api_key = settings.vllm_api_key
            timeout = settings.vllm_request_timeout_seconds

        base_url = (base_url or "").strip()
        if not base_url:
            raise LocalQwenUnavailable("推論サービスのベース URL が設定されていません。")

        self.base_url = base_url.rstrip("/")
        self.api_key = api_key.strip() if isinstance(api_key, str) and api_key.strip() else None
        self.timeout = timeout

    def generate_with_metrics(self, images: Iterable[Image.Image], prompt: str) -> GenerationResult:
        pil_images: List[Image.Image] = [img.convert("RGB") for img in images]
        if not pil_images:
            raise ValueError("画像が必要です")

        try:
            prepare_elapsed = ensure_model_service(
                self.model_id,
                self.base_url,
                service_map=self._service_map,
            )
        except DockerManagerError as exc:
            raise LocalQwenUnavailable(str(exc)) from exc

        contents: list[dict[str, object]] = []
        for img in pil_images:
            buffered = io.BytesIO()
            img.save(buffered, format="PNG")
            b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
            contents.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{b64}",
                    },
                }
            )
        contents.append({"type": "text", "text": prompt})

        payload = {
            "model": self.model_id,
            "messages": [
                {
                    "role": "user",
                    "content": contents,
                }
            ],
            "max_tokens": settings.qwen_local_max_new_tokens,
            "temperature": 0.0,
        }

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        url = f"{self.base_url}/v1/chat/completions"
        inference_start = time.monotonic()
        try:
            response = httpx.post(url, headers=headers, json=payload, timeout=self.timeout)
        except httpx.HTTPError as exc:  # pragma: no cover - network failures are runtime only
            logger.error("vLLM request failed: %s", exc)
            raise LocalQwenUnavailable(f"vLLM サーバーへのリクエストに失敗しました: {exc}") from exc

        if response.status_code != 200:
            logger.error(
                "vLLM server returned %s: %s", response.status_code, response.text[:500]
            )
            raise LocalQwenUnavailable(
                f"vLLM サーバーがエラーを返しました (status {response.status_code})."
            )

        try:
            data = response.json()
        except ValueError as exc:
            logger.error("Failed to decode vLLM response JSON: %s", exc)
            raise LocalQwenUnavailable("vLLM 応答の JSON 解析に失敗しました。") from exc

        try:
            message = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            logger.error("Unexpected vLLM response format: %s", data)
            raise LocalQwenUnavailable("vLLM 応答の形式が想定外です。") from exc

        if not isinstance(message, str):
            logger.error("vLLM response message is not text: %s", message)
            raise LocalQwenUnavailable("vLLM 応答がテキストではありません。")

        inference_elapsed = time.monotonic() - inference_start
        return GenerationResult(
            content=message.strip(),
            model_prepare_seconds=prepare_elapsed,
            inference_seconds=inference_elapsed,
        )

    def generate(self, images: Iterable[Image.Image], prompt: str) -> str:
        result = self.generate_with_metrics(images, prompt)
        return result.content


@lru_cache(maxsize=4)
def get_local_qwen_client(model_id: str) -> LocalQwenClient:
    return LocalQwenClient(model_id)
