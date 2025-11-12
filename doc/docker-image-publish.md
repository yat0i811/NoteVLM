# Docker Image ビルド & 公開手順

このドキュメントでは、NoteVLM プロジェクトの Docker イメージをビルドし、Docker Hub などのコンテナレジストリに公開する手順を説明します。

## 前提条件

- Docker Engine がインストールされていること
- Docker Hub アカウント（または他のコンテナレジストリアカウント）
- `docker login` でレジストリにログイン済みであること

## イメージのビルド

### Backend イメージ

```bash
cd backend
docker build -t <your-username>/notevlm-backend:latest .
docker tag <your-username>/notevlm-backend:latest <your-username>/notevlm-backend:v1.0.0
```

### Frontend イメージ

```bash
cd frontend
docker build -t <your-username>/notevlm-frontend:latest .
docker tag <your-username>/notevlm-frontend:latest <your-username>/notevlm-frontend:v1.0.0
```

## イメージの公開

### Docker Hub にプッシュ

```bash
# Backend
docker push <your-username>/notevlm-backend:latest
docker push <your-username>/notevlm-backend:v1.0.0

# Frontend
docker push <your-username>/notevlm-frontend:latest
docker push <your-username>/notevlm-frontend:v1.0.0
```

### GitHub Container Registry (ghcr.io) にプッシュする場合

```bash
# ログイン
echo $GITHUB_TOKEN | docker login ghcr.io -u <your-username> --password-stdin

# タグ付け
docker tag <your-username>/notevlm-backend:latest ghcr.io/<your-username>/notevlm-backend:latest
docker tag <your-username>/notevlm-frontend:latest ghcr.io/<your-username>/notevlm-frontend:latest

# プッシュ
docker push ghcr.io/<your-username>/notevlm-backend:latest
docker push ghcr.io/<your-username>/notevlm-frontend:latest
```

## docker-compose.yml の更新

公開したイメージを使用するには、`docker-compose.yml` の `build` セクションを `image` に置き換えます。

```yaml
services:
  backend:
    image: <your-username>/notevlm-backend:latest
    # build: ./backend  # この行をコメントアウトまたは削除
    container_name: notevlm-backend
    ...

  frontend:
    image: <your-username>/notevlm-frontend:latest
    # build: ./frontend  # この行をコメントアウトまたは削除
    container_name: notevlm-frontend
    ...
```

## マルチアーキテクチャビルド（オプション）

ARM64 や AMD64 など複数のアーキテクチャに対応したイメージを作成する場合：

```bash
# Buildx のセットアップ（初回のみ）
docker buildx create --use

# Backend のマルチアーキテクチャビルド & プッシュ
cd backend
docker buildx build --platform linux/amd64,linux/arm64 \
  -t <your-username>/notevlm-backend:latest \
  -t <your-username>/notevlm-backend:v1.0.0 \
  --push .

# Frontend のマルチアーキテクチャビルド & プッシュ
cd ../frontend
docker buildx build --platform linux/amd64,linux/arm64 \
  -t <your-username>/notevlm-frontend:latest \
  -t <your-username>/notevlm-frontend:v1.0.0 \
  --push .
```

## イメージの確認

公開したイメージは Docker Hub の Web UI や以下のコマンドで確認できます：

```bash
# Docker Hub
docker search <your-username>/notevlm

# ローカルで確認
docker images | grep notevlm
```

## 使用例

公開したイメージを使って NoteVLM を起動：

```bash
# イメージを docker-compose.yml で指定済みの場合
docker compose up -d backend frontend

# または直接実行
docker run -d --name notevlm-backend \
  -p 8003:8003 \
  -v $(pwd)/storage:/app/storage \
  --env-file .env.backend \
  <your-username>/notevlm-backend:latest

docker run -d --name notevlm-frontend \
  -p 3003:3000 \
  --env-file .env.frontend \
  <your-username>/notevlm-frontend:latest
```

## セキュリティ注意事項

- `.env.backend` や `.env.frontend` に含まれる機密情報（API トークンなど）はイメージに含めないでください
- 環境変数は実行時に `--env-file` や `-e` オプションで渡してください
- プライベートイメージの場合は適切なアクセス権限を設定してください

## トラブルシューティング

### イメージサイズが大きい場合

- `.dockerignore` ファイルを確認し、不要なファイルを除外してください
- マルチステージビルドを活用してください（既に実装済み）
- `docker build --no-cache` でクリーンビルドを試してください

### プッシュが遅い場合

- ネットワーク速度を確認してください
- レイヤーキャッシュを活用するため、変更の少ないコマンドを Dockerfile の上部に配置してください
