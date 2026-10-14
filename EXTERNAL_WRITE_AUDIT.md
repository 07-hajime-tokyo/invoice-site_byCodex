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
