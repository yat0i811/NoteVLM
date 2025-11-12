# NoteVLM

NoteVLM は PDF / 画像をアップロードして Qwen3-VL / Deepseek-OCR / Chandra-OCR 系モデルで Markdown・LaTeX・レイアウト付きテキストに変換する Web アプリケーションです。Next.js フロントエンドと FastAPI バックエンドを Docker Compose でまとめて起動します。

## 主な機能
- PDF / 画像のアップロードとメタデータ（SQLite）・バイナリ（`storage/`）の保持
- Qwen3-VL / Deepseek-OCR / Chandra-OCR からモデルを選択し、Markdown / LaTeX / レイアウト JSON を生成
- 複数ページ PDF はページごとのドキュメントとして保存し、レイアウト出力ではページ画像とテキストを紐付け
- ブラウザ内での自動保存付きエディタ、Markdown / LaTeX プレビュー、トランスクリプトのストリーミング表示
- 変換進捗の可視化、生成結果とオリジナルファイルのダウンロード、不要データの削除

## 動作要件
- Docker Engine 24 以降 / Docker Compose v2
- CUDA 対応 GPU（本番推論時）※ モック動作は `QWEN_MOCK=1` で可能
- 必要に応じて Hugging Face Hub トークン

## 使い方
1. `.env.backend` を編集し、CORS、利用するモデル、vLLM / Deepseek-OCR / Chandra の接続先を設定します。
2. 必要なら `NEXT_PUBLIC_API_URL`（任意で `NEXT_PUBLIC_DOWNLOAD_URL`）を `.env.local` などで指定します。
3. `./start.sh` を実行するとバックエンドとフロントエンド、オンデマンド起動用の vLLM / Deepseek / Chandra コンテナが prepare 状態になります。
4. ブラウザで `http://localhost:3003` にアクセスします。
5. 停止は `./stop.sh` を実行します。

## 環境変数サンプル

### `.env.backend`

以下は GPU 推論を利用する構成の一例です。必要なキーのみを残し、未使用サービスのブロックは削除してください。

```env
# 基本設定
FRONTEND_ORIGIN=http://localhost:3003
DATABASE_URL=sqlite:///./storage/app.db
STORAGE_ROOT=./storage
QWEN_MOCK=false

# Qwen3-VL モデル
QWEN_AVAILABLE_MODELS=Qwen/Qwen3-VL-4B-Instruct
QWEN_LOCAL_MODEL=Qwen/Qwen3-VL-4B-Instruct
VLLM_BASE_URL=http://vllm-4b:8000
VLLM_MODEL_ENDPOINTS={"Qwen/Qwen3-VL-4B-Instruct":"http://vllm-4b:8000"}
VLLM_SERVICE_NAMES={"Qwen/Qwen3-VL-4B-Instruct":"notevlm-vllm-4b"}

# Deepseek-OCR（任意）
DEEPSEEK_AVAILABLE_MODELS=Deepseek/DeepSeek-OCR
DEEPSEEK_BASE_URL=http://deepseek-ocr:8000
DEEPSEEK_MODEL_ENDPOINTS={"Deepseek/DeepSeek-OCR":"http://deepseek-ocr:8000"}
DEEPSEEK_SERVICE_NAMES={"Deepseek/DeepSeek-OCR":"notevlm-deepseek-ocr"}

# Chandra-OCR（任意）
CHANDRA_AVAILABLE_MODELS=datalab-to/chandra
CHANDRA_BASE_URL=http://chandra-ocr:8000
CHANDRA_MODEL_ENDPOINTS={"datalab-to/chandra":"http://chandra-ocr:8000"}
CHANDRA_SERVICE_NAMES={"datalab-to/chandra":"notevlm-chandra-ocr"}

# 制約
MAX_UPLOAD_SIZE_MB=20
ALLOWED_MIME_TYPES=application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif
PDF_PAGE_LIMIT=20
```

主な項目:
- `FRONTEND_ORIGIN`: CORS 許可元。ローカル開発ではフロントエンドの URL を指定。
- `QWEN_AVAILABLE_MODELS` と `QWEN_LOCAL_MODEL`: 利用可能な Qwen3-VL モデルと既定値。
- `VLLM_*`, `DEEPSEEK_*`, `CHANDRA_*`: 各モデルを提供する vLLM / OpenAI 互換サービスの URL とコンテナ名。オンデマンド起動に利用します。
- `QWEN_MOCK=true` にすると推論を行わずモック出力で動作確認できます。
- `MAX_UPLOAD_SIZE_MB`, `ALLOWED_MIME_TYPES`, `PDF_PAGE_LIMIT`: アップロード制限を調整する際に利用します。

### `.env.frontend`

フロントエンドは Next.js の環境変数を `.env.local` や `.env.frontend` から読み込みます。最低限、バックエンドの公開 URL を指定してください。

```env
NEXT_PUBLIC_API_URL=http://localhost:8003
NEXT_PUBLIC_DOWNLOAD_URL=http://localhost:8003
```

`NEXT_PUBLIC_DOWNLOAD_URL` を別ホストにすると、CDN 経由でのダウンロード配信やプロキシ越しの構成を利用できます。未設定の場合は `NEXT_PUBLIC_API_URL` と同じ値が用いられます。

## ディレクトリ構成
```
backend/    FastAPI アプリ
frontend/   Next.js フロントエンド
storage/    アップロード・生成結果・変換ログ
doc/        システムドキュメント
docker-compose.yml
```

## ドキュメント
詳細は以下を参照してください：
- `doc/overview.md` - システム概要
- `doc/backend.md` - バックエンド詳細
- `doc/frontend.md` - フロントエンド詳細
- `doc/container-operations.md` - コンテナ操作とメンテナンス
- `doc/docker-image-publish.md` - Docker イメージのビルドと公開手順

## GitHub にプッシュする前に

1. `.env.backend` と `.env.frontend` を作成（`.env.*.example` を参考に）
2. 機密情報（HF_TOKEN など）が `.gitignore` で除外されていることを確認
3. `storage/` ディレクトリの構造は保持されますが、内容は除外されます

## Docker イメージの公開

プロジェクトを Docker Hub や GitHub Container Registry に公開する場合は、`doc/docker-image-publish.md` を参照してください。
