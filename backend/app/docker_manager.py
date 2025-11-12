from __future__ import annotations

import logging
import time
from threading import Lock

import docker
import httpx
from docker.errors import APIError, NotFound

from .config import settings

logger = logging.getLogger(__name__)

_docker_client: docker.DockerClient | None = None
_lock = Lock()


class DockerManagerError(RuntimeError):
    """Raised when docker control operations fail."""


def _get_client() -> docker.DockerClient:
    global _docker_client
    if _docker_client is None:
        try:
            _docker_client = docker.from_env()
        except Exception as exc:  # pragma: no cover - environment specific
            raise DockerManagerError(f"Docker クライアントの初期化に失敗しました: {exc}") from exc
    return _docker_client


def _start_container(name: str) -> None:
    client = _get_client()
    try:
        container = client.containers.get(name)
    except NotFound as exc:
        raise DockerManagerError(
            f"Container '{name}' not found. VLLM_SERVICE_NAMES の設定を確認してください。"
        ) from exc
    except APIError as exc:
        raise DockerManagerError(f"Docker API エラー: {exc}") from exc

    if container.status == "running":
        return

    try:
        container.start()
        logger.info("Started container %s for vLLM service", name)
    except APIError as exc:
        raise DockerManagerError(f"コンテナ '{name}' の起動に失敗しました: {exc}") from exc


def _stop_container(name: str) -> None:
    client = _get_client()
    try:
        container = client.containers.get(name)
    except NotFound:
        return
    except APIError as exc:
        logger.warning("Failed to inspect container %s: %s", name, exc)
        return

    if container.status in {"exited", "created"}:
        return

    try:
        container.stop(timeout=15)
        logger.info("Stopped container %s", name)
    except APIError as exc:
        logger.warning("コンテナ '%s' の停止に失敗しました: %s", name, exc)


def _wait_for_ready(
    base_url: str,
    ready_path: str = "/v1/models",
    *,
    timeout: float,
    interval: float,
) -> None:
    interval = max(0.5, interval)
    deadline = time.monotonic() + timeout

    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            response = httpx.get(f"{base_url}{ready_path}", timeout=5.0)
            if response.status_code == 200:
                logger.info("vLLM service at %s is ready", base_url)
                return
            logger.debug("vLLM readiness probe returned %s", response.status_code)
        except Exception as exc:  # pragma: no cover - network failures at runtime only
            last_error = exc
            logger.debug("vLLM readiness probe failed: %s", exc)
        time.sleep(interval)

    message = "Timed out waiting for vLLM service to become ready"
    if last_error:
        message = f"{message}: {last_error}"
    raise DockerManagerError(message)


def ensure_model_service(
    model_id: str,
    base_url: str,
    *,
    service_map: dict[str, str] | None = None,
    ready_path: str = "/v1/models",
) -> float:
    """Ensure the vLLM container for the given model is running and others are stopped.

    Returns the elapsed seconds spent preparing the target container (starting and waiting
    for readiness). When no action is needed the returned value is close to zero.
    """

    service_map = service_map if service_map is not None else settings.vllm_service_names
    if not service_map:
        return 0.0

    target_container = service_map.get(model_id)
    if not target_container:
        logger.info("No container mapping configured for model %s; skipping docker control.", model_id)
        return 0.0

    start_time = time.monotonic()
    with _lock:
        # Start the target container
        _start_container(target_container)

        # Stop other mapped containers to free GPU memory
        for other_model, other_container in service_map.items():
            if other_container == target_container:
                continue
            try:
                _stop_container(other_container)
            except Exception as exc:  # pragma: no cover
                logger.warning("Failed to stop container %s (%s): %s", other_container, other_model, exc)

    # Wait for the target service to accept connections
    timeout = settings.service_start_timeout(model_id)
    interval = settings.vllm_service_poll_interval_seconds
    _wait_for_ready(base_url, ready_path, timeout=timeout, interval=interval)
    return time.monotonic() - start_time
