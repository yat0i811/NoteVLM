# NoteVLM 概要

NoteVLM は、PDF や画像をアップロードして Qwen3-VL / Deepseek-OCR / Chandra-OCR 系モデルで Markdown / LaTeX / レイアウト付きテキストに変換する Web アプリケーションです。Next.js 製フロントエンド、FastAPI バックエンド、vLLM ベースの推論サービスを組み合わせ、ファイルとメタデータをローカルストレージと SQLite に保存します。Docker Compose で一括起動できます。

## 主な機能
- PDF / 画像のアップロードとオリジナルファイルの保持
- 選択したモデルでの Markdown / LaTeX / レイアウト JSON 生成（レイアウトではページ画像と OCR テキストを紐付け）
- ブラウザ内での自動保存付きエディタ、Markdown / LaTeX プレビュー、生成テキストのストリーミング表示
- 変換進捗の可視化、不要データの整理、生成結果とオリジナルのダウンロード

## アーキテクチャ概要
```
[Next.js Frontend] <-> REST <-> [FastAPI Backend]
                                |- SQLite (メタデータ)
                                |- Disk Storage (uploads / documents / layout images)
                     |- vLLM Qwen3-VL services (必要なときだけ起動)
                     |- Deepseek-OCR service (任意)
                     |- Chandra-OCR service (任意)
```
- フロントエンドは `/api/*` エンドポイントを呼び出し、変換中の擬似ストリーミング表示を制御します。
- バックエンドは入力検証・永続化・推論呼び出しを担当し、モデルとコンテナのマッピングが設定されていれば対応する vLLM コンテナ（Qwen / Deepseek / Chandra）を自動で起動・停止します。
- `storage/` ディレクトリにアップロードファイル・生成結果・レイアウト画像・変換ログを格納します。

## 処理フロー
1. ユーザーが PDF または画像をアップロードすると、ファイル名をサニタイズして `storage/uploads` に保存します。
2. バックエンドはアップロード情報を DB に記録し、`/api/files` から取得できるようにします。
3. 変換要求を受けると、バックエンドが画像バッチを生成して選択されたモデル（Qwen / Deepseek-OCR / Chandra-OCR）を呼び出し、生成された Markdown / LaTeX / レイアウト JSON とオリジナルファイル情報を `documents` テーブルに保存します。レイアウト形式ではページ画像も `storage/layout-images` に保存します。
4. フロントエンドは生成結果を取得してエディタに反映し、ストリーミング風アニメーションでテキストを表示します。自動保存フックが編集内容を即時バックエンドへ書き戻します。
5. 利用者は生成ファイル・元ファイル双方をダウンロードでき、不要になったデータは UI から削除できます。

詳細は `doc/backend.md` と `doc/frontend.md` を参照してください。
