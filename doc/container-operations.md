# コンテナ起動／停止コマンド

NoteVLM の各コンテナはリポジトリ直下の `docker-compose.yml` で管理されています。GPU メモリを解放したい場合は対象コンテナを停止すると割り当てが解除されます。

## 全体オーケストレーション
- 起動: `./start.sh`
- 停止（GPU を含むすべてのコンテナをまとめて解放）: `./stop.sh`

## 個別サービス操作
共通フラグ: すべて `docker compose -f docker-compose.yml` を起点に実行します。

| サービス名 | モデル／役割 | 起動コマンド | 停止コマンド（GPU メモリ解放） | 備考 |
| --- | --- | --- | --- | --- |
| `backend` | FastAPI バックエンド | `docker compose -f docker-compose.yml up -d backend` | `docker compose -f docker-compose.yml stop backend` | 停止後に完全削除したい場合は `rm -f backend` を追加実行 |
| `frontend` | Next.js フロントエンド | `docker compose -f docker-compose.yml up -d frontend` | `docker compose -f docker-compose.yml stop frontend` | `backend` が起動している必要あり |
| `vllm-2b` | Qwen3-VL-2B-Instruct | `docker compose -f docker-compose.yml up -d vllm-2b` | `docker compose -f docker-compose.yml stop vllm-2b` | GPU0 を使用 |
| `vllm-2b-fp8` | Qwen3-VL-2B-Instruct-FP8 | `docker compose -f docker-compose.yml up -d vllm-2b-fp8` | `docker compose -f docker-compose.yml stop vllm-2b-fp8` | GPU0 を使用 |
| `vllm-4b` | Qwen3-VL-4B-Instruct | `docker compose -f docker-compose.yml up -d vllm-4b` | `docker compose -f docker-compose.yml stop vllm-4b` | GPU1 を使用 |
| `vllm-4b-fp8` | Qwen3-VL-4B-Instruct-FP8 | `docker compose -f docker-compose.yml up -d vllm-4b-fp8` | `docker compose -f docker-compose.yml stop vllm-4b-fp8` | GPU1 を使用 |
| `vllm-8b` | Qwen3-VL-8B-Instruct | `docker compose -f docker-compose.yml up -d vllm-8b` | `docker compose -f docker-compose.yml stop vllm-8b` | GPU0/1 を2枚利用（テンソル並列） |
| `vllm-8b-fp8` | Qwen3-VL-8B-Instruct-FP8 | `docker compose -f docker-compose.yml up -d vllm-8b-fp8` | `docker compose -f docker-compose.yml stop vllm-8b-fp8` | GPU0/1 を2枚利用 |
| `vllm-32b` | Qwen3-VL-32B-Instruct | `docker compose -f docker-compose.yml --profile qwen32b up -d vllm-32b` | `docker compose -f docker-compose.yml stop vllm-32b` | プロファイル `qwen32b` が必要 |
| `vllm-32b-fp8` | Qwen3-VL-32B-Instruct-FP8 | `docker compose -f docker-compose.yml --profile qwen32b up -d vllm-32b-fp8` | `docker compose -f docker-compose.yml stop vllm-32b-fp8` | プロファイル `qwen32b` が必要 |
| `deepseek-ocr` | DeepSeek-OCR | `docker compose -f docker-compose.yml --profile deepseek up -d deepseek-ocr` | `docker compose -f docker-compose.yml stop deepseek-ocr` | プロファイル `deepseek` が必要、GPU0 を使用 |
| `chandra-ocr` | datalab-to/chandra | `docker compose -f docker-compose.yml --profile chandra up -d chandra-ocr` | `docker compose -f docker-compose.yml stop chandra-ocr` | プロファイル `chandra` が必要、GPU0 を使用 |

### ワンポイント
- 停止後にコンテナ自体を削除してストレージも整理したい場合は、続けて `docker compose -f docker-compose.yml rm -f <サービス名>` を実行してください。
- `start.sh` 実行済みの場合、vLLM 系サービスは `--no-start` で作成済みなので、必要なサービスだけ `up -d` すると高速に起動できます。
- 稼働状況は `docker compose -f docker-compose.yml ps` で確認できます。

## メンテナンスコマンド

- **全サービス起動**: `docker compose -f docker-compose.yml up -d`
- **全サービス停止**: `docker compose -f docker-compose.yml stop`
- **コンテナ削除（ネットワーク込み）**: `docker compose -f docker-compose.yml down`
- **ボリュームも含めて完全削除**: `docker compose -f docker-compose.yml down --volumes --remove-orphans`
- **ビルドキャッシュ／未使用リソース削除**: `docker system prune -af`
- **ストレージ初期化**: `rm -rf storage/app.db storage/uploads/* storage/documents/* storage/layout-images/* storage/logs/*`（実行前に必要なデータをバックアップしてください）
