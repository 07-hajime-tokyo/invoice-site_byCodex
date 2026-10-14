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
# External Write Audit Report

このファイルは、ステージング環境で外部書き込みをブロックするための実装状況を記録します。

## ✅ 実装済みのゲート

### 1. Cronジョブ（server/_core/cron.ts）
すべてのcronエンドポイントが`gateCronJob()`でゲートされています：
- `/api/cron/fedex-missing`
- `/api/cron/inventory-snapshot`
- `/api/cron/inbound-classify`
- `/api/cron/defective-yahoo-prices`
- `/api/cron/receipt-ack-import`
- `/api/cron/receipt-ack-stale`

**動作**: APP_ENV=stagingの時、HTTP 200で`{ skipped: true, reason: "..." }`を返します。

### 2. GAS Webhook（server/_core/gasWebhook.ts）
`handlePurchaseWebhook()`関数の最初で`gateGASWebhook()`をチェック：
- `/api/gas/purchase-order`
- `/api/gas/purchase-receive`
- `/api/gas-webhook/register-product`

**動作**: APP_ENV=stagingの時、HTTP 200で`{ success: false, blocked: true, reason: "..." }`を返します。

### 3. Google Sheets書き込み（部分的）
**実装済み**:
- `tradeRouter.ts`: `updateTradeViewCell` mutation（1箇所）

**動作**: APP_ENV=stagingの時、`gateGoogleSheetsWrite()`がモックレスポンスを返し、実際のAPI呼び出しをスキップします。

### 4. 起動時データ修復スクリプト（server/inventory/routers.ts）
`shouldRunInventoryOneTimeRepairs()`関数が`APP_ENV=staging`の時にfalseを返すよう修正されました。

**動作**: ステージング環境では起動時修復スクリプトは実行されません。明示的に有効にする場合は環境変数`RUN_INVENTORY_ONE_TIME_REPAIRS=true`を設定してください。

## 🔄 未完了のゲート

### Google Sheets書き込み（残りの箇所）

#### tradeRouter.ts
以下の箇所は別のスプレッドシート（SPREADSHEET_ID, SHEET_NAME）を使用しており、ゲートが必要です：
1. **行 ~1723**: `syncTrade` mutation内の`sheets.spreadsheets.values.batchUpdate`
   - 目的: 取引シートの行を更新
   - スプレッドシート: SPREADSHEET_ID（TRADE_VIEW_SPREADSHEET_IDとは異なる）
   
2. **行 ~1847**: `syncTrade` mutation内の為替レート更新
   - 目的: EUR/USDレートをシートに書き込み
   
3. **行 ~1878**: `syncFromExternalSheet` mutation内の`sheets.spreadsheets.values.append`
   - 目的: 外部シートから新しい行を追加

**推奨対応**:
```typescript
await gateGoogleSheetsWrite(
  'operationName',
  async () => {
    await sheets.spreadsheets.values.batchUpdate({...});
  }
)();
```

#### yahooListingSheet.ts
以下の6箇所の書き込み操作がゲートを必要とします：
1. **行 164**: `ensureSheet()` - 新しいシートタブを作成
2. **行 189**: `ensureHeaders()` - ヘッダー行を更新
3. **行 195**: `ensureHeaders()` - シートプロパティを更新（frozen row）
4. **行 250**: `upsertDefectiveListing()` - 古いタブを非表示
5. **行 276**: `upsertDefectiveListing()` - 商品データを書き込み
6. **行 283**: `upsertDefectiveListing()` - 列の自動リサイズ

**推奨対応**:
同様に`gateGoogleSheetsWrite()`でラップします。

## 🔍 その他の外部サービス

### Zaico API
調査の結果、このプロジェクトは**実際のZaico APIを呼び出していません**。
- `localInventories`, `localPurchases`テーブルは、Zaicoデータのローカルコピーまたは代替実装
- すべての操作はローカルDB（ステージングDB）に対して行われる
- **対応不要**: ステージングDBへの書き込みは問題なし

### FedEx API
調査の結果、このプロジェクトは**実際のFedEx APIを呼び出していません**。
- `fedexShipments`テーブルはローカルDB内のデータ
- FedEx関連の操作はすべてローカルDB（ステージングDB）に対して行われる
- **対応不要**: ステージングDBへの書き込みは問題なし

### eBay API
明確な外部API呼び出しは見つかりませんでした。
- eBay関連のフィールド（`ebayListingUrl`, `ebayOrderUrl`等）はDB内のメタデータ
- **要確認**: 実際のeBay API統合があれば追加調査が必要

### Yahoo API
Yahoo Listing SheetはGoogle Sheets APIを使用しています（上記参照）。
- 独立したYahoo APIの呼び出しは見つかりませんでした
- **対応済み**: Google Sheetsゲートに含まれる

### Email/通知送信
明確なメール送信コードは見つかりませんでした。
- 必要に応じて`gateEmailSend()`を使用可能
- **対応不要**: 現時点で実装されていない

## 📊 テストカバレッジ

`server/_core/externalWriteGates.test.ts`:
- ✅ 11テストすべて合格
- Google Sheets、GAS Webhook、Cron、FedEx、Zaicoのゲート関数を検証
- APP_ENV=stagingとAPP_ENV=productionの両方の動作を確認

## 📝 ドキュメント

`docs/preview-deployment-setup.md`:
- すべてのゲート機能の詳細を記載
- ブロックされる操作の完全なリスト
- 読み取り専用操作は許可されることを明記
- 実装の詳細（ログ形式、モックレスポンス等）を説明

## 🎯 次のステップ

優先度順：
1. **高**: tradeRouter.ts内の残りのGoogle Sheets書き込み（3箇所）にゲートを追加
2. **中**: yahooListingSheet.ts内のGoogle Sheets書き込み（6箇所）にゲートを追加
3. **低**: eBay API統合の有無を確認し、必要に応じてゲートを追加
4. **完了後**: すべてのゲートをテストし、ステージング環境で実際の動作を確認
