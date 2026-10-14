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

## 無効化される機能（外部書き込みゲート）

`APP_ENV=staging`が設定されていると、以下の機能が自動的に無効化され、本番システムへの副作用を防ぎます：

### ✅ 完全にブロックされる外部書き込み

1. **Cronジョブ** (`server/_core/cron.ts`)
   - 在庫スナップショット (`/api/cron/inventory-snapshot`)
   - FedEx不足確認 (`/api/cron/fedex-missing`)
   - 入庫自動仕訳 (`/api/cron/inbound-classify`)
   - 不良品Yahoo価格更新 (`/api/cron/defective-yahoo-prices`)
   - 受領確認インポート (`/api/cron/receipt-ack-import`)
   - 受領確認staleチェック (`/api/cron/receipt-ack-stale`)
   - **動作**: HTTP 200で`{ skipped: true, reason: "..." }`を返す

2. **GAS Webhook** (`server/_core/gasWebhook.ts`)
   - `/api/gas/purchase-order`, `/api/gas/purchase-receive`
   - `/api/gas-webhook/register-product`
   - **動作**: HTTP 200で`{ success: false, blocked: true, reason: "..." }`を返す

3. **Google Sheets書き込み** (`server/tradeRouter.ts`)
   - `updateTradeViewCell` mutation（取引シートのセル更新）
   - その他のSpreadsheet API書き込み操作
   - **動作**: モックレスポンスを返し、実際のAPI呼び出しはスキップ

4. **FedEx API書き込み** (FedEx発送・ラベル作成 API)
   - **動作**: モックレスポンスを返し、実際のAPI呼び出しはスキップ

5. **Zaico API書き込み** (在庫作成・更新・削除 API)
   - **動作**: モックレスポンスを返し、実際のAPI呼び出しはスキップ

6. **eBay API書き込み** (出品作成・更新・削除、注文更新)
   - **動作**: モックレスポンスを返し、実際のAPI呼び出しはスキップ

7. **Yahoo関連書き込み** (出品更新等)
   - **動作**: モックレスポンスを返し、実際のAPI呼び出しはスキップ

8. **メール/通知送信**
   - **動作**: モックレスポンスを返し、実際の送信はスキップ

### ✅ 読み取り専用操作は許可

以下の操作は通常通り動作します（副作用がないため）：
- DBからのデータ取得
- Google Sheets読み取り
- 画面表示・UI操作
- Zaico/eBay/FedEx APIの読み取り専用エンドポイント

### 🔧 実装の詳細

外部書き込みゲートは`server/_core/externalWriteGates.ts`に集約されています：
- 各サービスごとに専用のゲート関数（`gateGoogleSheetsWrite`, `gateGASWebhook`, `gateCronJob`等）
- `APP_ENV !== "production"`の時、すべての書き込みをブロック
- ログ出力：`[staging] blocked external write: <service> <op> (APP_ENV=staging)`
- モックレスポンスを返すため、UIフローは正常に完了
- テストカバレッジ：`server/_core/externalWriteGates.test.ts`

### ⚠️ 起動時の一括データ修復について

`server/inventory/routers.ts`内の起動時データ修復コード（`NODE_ENV !== "production"`で実行）：
- **ステージング環境では実行されません**（`APP_ENV=staging`の時も無効）
- 修復が必要な場合は、ステージングDBに対してのみ手動実行してください

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
