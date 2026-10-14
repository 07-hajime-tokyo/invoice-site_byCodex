# Vercel Preview Deployment Setup

このブランチをVercelにデプロイすると、プレビュー環境として動作します。
本番環境に影響を与えないよう、以下の設定が必要です。

## 必須環境変数（Vercel Preview Scope）

以下の環境変数をVercelのプレビュー環境（Preview scope）に設定してください：

### 1. 環境識別
```
APP_ENV=staging
```
この変数により、本番への副作用（cron、外部API書き込み）が無効化されます。

### 2. ステージングデータベース
```
DATABASE_URL=mysql://user:password@staging-db-host:3306/staging_db
```
**重要**: 本番の`DATABASE_URL`を使用しないでください。別のステージング用データベースを用意する必要があります。

### 3. 認証設定
```
JWT_SECRET=(preview用のランダムな文字列)
OAUTH_SERVER_URL=(OAuth serverのURL)
OWNER_OPEN_ID=(owner's OpenID)
```

### 4. ログイン許可メールアドレス
```
ALLOWED_LOGIN_EMAILS=01.murakami@gmail.com,07.hajime.tokyo@gmail.com
```

### 5. その他の必要な環境変数
```
VITE_APP_ID=invoice-site-preview
BUILT_IN_FORGE_API_URL=(optional)
BUILT_IN_FORGE_API_KEY=(optional)
```

## ステージングデータベースのセットアップ

### オプション1: TiDBブランチを使用（推奨）
TiDB Cloudを使用している場合、ブランチ機能で本番DBのコピーを作成できます：

```bash
# TiDB Cloud CLIを使用
ticloud branch create --cluster-id <cluster-id> --name staging-preview
```

作成したブランチの接続文字列を`DATABASE_URL`に設定してください。

### オプション2: mysqldumpでクローン
```bash
# 本番DBからダンプを取得
mysqldump -h production-host -u user -p production_db > dump.sql

# ステージングDBにインポート
mysql -h staging-host -u user -p staging_db < dump.sql
```

### オプション3: Drizzle migrateで空DBから構築
```bash
# ステージングDBに接続してマイグレーション実行
DATABASE_URL=<staging-db-url> pnpm drizzle-kit push

# 必要に応じて初期データを投入
# (tests/regression/seeds/ 配下のシードスクリプトを参考)
```

## 無効化される機能

`APP_ENV=staging`が設定されていると、以下の機能が自動的に無効化されます：

- ✅ Cronジョブ（在庫スナップショット、FedEx確認など）
- ✅ Google Apps Script (GAS) Webhook書き込み
- ✅ Google Sheets書き込み
- ✅ eBay API書き込み
- ✅ FedEx API書き込み
- ✅ Zaico API書き込み

読み取り専用の操作（DBからのデータ取得、画面表示など）は通常通り動作します。

## デプロイ後の確認

1. Vercelのデプロイメントログで環境変数が正しく読み込まれているか確認
2. プレビューURLにアクセスして、ログイン画面が表示されることを確認
3. 設定したメールアドレスでログイン可能か確認
4. データが表示されることを確認（ステージングDBのデータ）

## トラブルシューティング

### ログインできない
- `ALLOWED_LOGIN_EMAILS`にメールアドレスが含まれているか確認
- `JWT_SECRET`が設定されているか確認

### データベース接続エラー
- `DATABASE_URL`が正しいか確認
- ステージングDBのネットワーク設定でVercelのIPアドレスが許可されているか確認

### 本番データが表示される
- **直ちにデプロイを停止してください**
- `APP_ENV=staging`が設定されているか確認
- `DATABASE_URL`が本番DBを指していないか確認
