# バックエンド

バックエンドは FastAPI 製の REST API で、アップロードファイルや生成ドキュメントを管理しつつ Qwen3-VL / Deepseek-OCR / Chandra-OCR 系モデルの推論を実行します。メタデータは SQLite に保存し、バイナリファイル・生成テキスト・レイアウト画像はローカルストレージに保持します。

## 主なモジュール
- `app/main.py`: アプリケーションファクトリ、CORS 設定、ミドルウェア、ルーター登録、ヘルスチェック。
- `app/config.py`: `.env.backend` を読み込む Pydantic 設定レイヤー。モデル一覧やエンドポイント、サイズ上限などを検証します。
- `app/database.py`: SQLAlchemy エンジン／セッションの初期化と declarative base。
- `app/models.py`: `Upload` / `Document` の ORM 定義とリレーション。
- `app/schemas.py`: リクエスト・レスポンスで利用する Pydantic モデル。
- `app/storage.py`: アップロードファイルと生成物の保存・読み込み・削除を担当。ファイル名のサニタイズも実施します。
- `app/qwen_client.py`: PDF を画像に変換し、プロンプトを組み立ててローカル vLLM サービス（Qwen / Deepseek）を呼び出す高水準クライアント（モックモード対応）。
- `app/local_qwen.py`: OpenAI 互換の vLLM エンドポイントへ HTTP リクエストを送るクライアント。コンテナの起動確認も行います。
- `app/docker_manager.py`: モデルごとの vLLM コンテナをオンデマンドで起動・停止し、指定サービスが起動するまで待機します。
- `app/services/documents.py`: ドキュメント存在チェック、レスポンス整形、ファイルクリーンアップ用の共通処理。
- `app/dependencies.py`: ルーターで共通利用する SQLAlchemy セッション依存関係。
- `app/routers/*.py`: ファイル操作・ドキュメント操作・利用可能モデルを処理する FastAPI ルーター群。

## データモデル
```
Upload
 |- id (UUID 文字列)
 |- original_name / stored_name / mime_type / size
 |- created_at

Document
 |- id, upload_id (外部キー)
 |- title, format (markdown|latex|layout)
 |- stored_name (生成結果パスもしくはレイアウト JSON)
 |- オリジナルファイル情報（任意）
 |- created_at / updated_at

レイアウト形式では `stored_name` が JSON（`pages: [{index, text, image}]`）を指し、対応するページ画像ファイルは `storage/layout-images/` に保存されます。
```
ドキュメントは元ファイルの `upload_id` を参照し、関連するデータが残っている場合に原本を誤って削除しないようになっています。

## リクエスト処理の流れ
- アップロード時に MIME タイプとサイズを検証し、`storage/uploads` に保存して `Upload` レコードを作成します。
- ドキュメント一覧・詳細 API は共通ヘルパーで Pydantic レスポンスを組み立て、元ファイル情報・ダウンロード URL・レイアウト JSON（必要に応じて）を付加します。
- ドキュメント更新時は Markdown / LaTeX ファイルを上書きし、レイアウト形式では既存 JSON を読み出して該当ページの `text` 部分のみ上書きします。
- ドキュメント削除時は生成結果・レイアウト画像・元ファイルのコピーを削除した上でレコードを削除し、孤立ファイルを防ぎます。
- 変換処理では `QwenClient.digitalize` を呼び出し、PDF をページごとにレンダリング（`PDF_PAGE_LIMIT` を順守）した後に選択モデルへ推論リクエストを送ります。Markdown では `$` を除去し、Chandra 出力は HTML 数式を Markdown / LaTeX に変換して保存します。レイアウト形式はページごとに `text` と PNG 画像を JSON にまとめ、複数ページ PDF でも 1 ドキュメントとして管理します。生成完了後には `storage/logs/conversions.log` にモデル ID、ページ数、推論時間、サービス起動時間などを JSON 形式で追記します。
- 推論前に `docker_manager.ensure_model_service` がモデル ID に紐付くコンテナを起動し、他モデルのコンテナを停止して GPU メモリを解放します。

## 主要な環境変数
`.env.backend` で設定します。
- `DATABASE_URL`: SQLAlchemy 用の DB URI（既定は SQLite）。
- `STORAGE_ROOT`: アップロード／生成物を保存するディレクトリ。
- `QWEN_AVAILABLE_MODELS`, `QWEN_LOCAL_MODEL`: UI から選択できる Qwen 系モデルと既定モデル。
- `DEEPSEEK_AVAILABLE_MODELS`: Deepseek-OCR 系モデル ID の一覧（空であれば未使用）。
- `VLLM_BASE_URL`, `VLLM_MODEL_ENDPOINTS`: vLLM サービスへの接続先 URL（必要に応じて Deepseek / Chandra 用も統合）。
- `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL_ENDPOINTS`: Deepseek 用の vLLM エンドポイント（未設定の場合は `VLLM_BASE_URL` を利用）。
- `CHANDRA_BASE_URL`, `CHANDRA_MODEL_ENDPOINTS`: Chandra 用のエンドポイント。
- `VLLM_SERVICE_NAMES`, `DEEPSEEK_SERVICE_NAMES`, `CHANDRA_SERVICE_NAMES`: モデル ID と Docker コンテナ名の対応表（設定時は自動起動/停止）。
- `MAX_UPLOAD_SIZE_MB`, `ALLOWED_MIME_TYPES`, `PDF_PAGE_LIMIT`: バリデーション関連の閾値。
- `QWEN_MOCK`: モック応答を返す開発モードの有効化フラグ。

## テスト
`backend/tests/` ディレクトリは pytest 用に用意されています（現状は空）。安定したテストのため、`QwenClient` をモック化することを推奨します。
