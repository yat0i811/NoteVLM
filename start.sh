#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

echo "[NoteVLM] Building and starting services..."
docker compose -f "${COMPOSE_FILE}" up --build -d

echo "[NoteVLM] Preparing on-demand vLLM containers..."
docker compose -f "${COMPOSE_FILE}" --profile vllm up --no-start \
  vllm-2b vllm-2b-fp8 \
  vllm-4b vllm-4b-fp8 \
  vllm-8b vllm-8b-fp8 >/dev/null 2>&1 || true
docker compose -f "${COMPOSE_FILE}" --profile qwen32b up --no-start \
  vllm-32b vllm-32b-fp8 >/dev/null 2>&1 || true
docker compose -f "${COMPOSE_FILE}" --profile deepseek up --no-start \
  deepseek-ocr >/dev/null 2>&1 || true
docker compose -f "${COMPOSE_FILE}" --profile chandra up --no-start \
  chandra-ocr >/dev/null 2>&1 || true

echo "[NoteVLM] Waiting for backend health..."
for i in $(seq 1 30); do
  STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8003/health || true)
  if [[ "${STATUS_CODE}" == "200" ]]; then
    echo "[NoteVLM] Backend is healthy."
    exit 0
  fi
  sleep 2
done

echo "[NoteVLM] Backend health check timed out." >&2
exit 1
