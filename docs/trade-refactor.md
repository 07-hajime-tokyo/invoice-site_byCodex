# 取引データ・CSV領域 SSOTリファクタリング記録（T-A0〜T-A2）

基準コミット: `2ba8ecb` / ブランチ: `staff/yousunafu/refactor-trade`

## 1. 棚卸し（整理前の対象）

### 1.1 server/routers.ts（2,376行）

| 対象 | 行番号（2ba8ecb時点） | 内容 |
|---|---|---|
| 定数 | 30-35 | `SPREADSHEET_ID` / `SHEET_NAME` / `TRADE_VIEW_SPREADSHEET_ID` / `TRADE_VIEW_DEFAULT_SHEET_NAME` / `TRADE_VIEW_SHEET_NAME_KEYWORD` / `TRADE_SHEET_WRITE_BACK_ENABLED` |
| Sheetsヘルパー | 52-109 | `fixServiceAccountJson` / `getServiceAccountCredentials` / `getSheetsAccessError` / `getSheetsClient` / `canSyncTradeSheet` |
| 通貨・レートヘルパー | 111-305 | `normalizeTradeCurrency` / `inferTradeCurrencyForPartner` / `selectTradeRate` / `TradeDb` / `knownEuroRateRepairPromise`（モジュール可変状態）/ `normalizeRateDate` / `fetchJpyRateByDate` / `repairKnownEuroRateRows` / `shouldRepairDisplayedEuroRate` / `applyDisplayedEuroRateRepairs` / `changedNumber` / `spreadsheetColumnName` / `quoteSheetName` |
| シート進捗ヘルパー | 306-507 | `isTradeViewSheet` / `SheetShipmentProgress` / `tradeShipmentProgressCache`（モジュール可変状態。trade.updateSheetCell が null 代入で無効化）/ `parseSheetQuantity` / `normalizeSheetProductKey` / `getSheetShipmentProgressByInvoice` / `summarizeSheetShipmentProgress` / `getSheetShipmentStatus` / `applySheetShipmentStatuses` / `applyClosedTradeYearStatuses` / `applyManualCompleteTradeStatuses` / `assertTradeSheetExists` |
| 発送按分ヘルパー | 509-782 | 型 `TradeRow`/`ShipmentRow`/`ShipmentItemRow`/`FedexShipmentRow`/`RouterDb`、`toNumber` / `getShipmentTradeRecordId` / `normalizeShipmentTrackingNumber` / `getShipmentAllocationGroupKey` / `getDeliveryInvoiceNo` / `parseFedexShipmentItems` / `addTradeQuantity` / `allocateFedexItemsToTradeRows` / `allocateQtyToTrades` / `TradeShipmentRegistrationProgress` / `getTradeShipmentRegistrationProgress` / `applyTradeShipmentRegistrationStatuses` |
| 送料再計算 | 791-891 | `recalcShippingCostsLegacy`（**デッドコード**: どこからも呼ばれていない。逐語移動で保持） |
| 送料再計算（現行） | 893-1094 | `recalcShippingCosts`（shipment.create/update/delete から呼ばれる） |
| trade ルーター | 1262-2091 | `listFromDb` / `updateInDb` / `deleteFromDb` / `bulkUpdatePaymentDate` / `getFilterOptions` / `getSheetTabs` / `getSheetView` / `updateSheetCell` / `findTradeViewInvoiceCell` / `getExchangeRates` / `getRateByDate` / `findRowByInvoiceNo` / `updateRecord` / `addRecord` |
| shipment ルーター | 2111-2374 | `list` / `invoiceSummary` / `byInvoice` / `create` / `update` / `delete` |

ブロック外参照:
- trade/shipment のヘルパー群は routers.ts 内の他ブロック（authGate / quoteProxy / auth）からは一切参照されない（grep で確認）。
- trade ルーターは `getAllInvoiceMemos`（server/inventory/db）、`@shared/productMatching`、`@shared/tradeStatus` に依存（共有側は変更しない）。
- shipment ルーターは `recalcShippingCosts` / `normalizeShipmentTrackingNumber` / `getShipmentAllocationGroupKey` / `toNumber` を共有。→ ヘルパー群を tradeRouter.ts に置き、shipmentRouter.ts が import する（循環なし: routers.ts → tradeRouter/shipmentRouter → _core/db/shared のみ）。
- `toNumber` は listFromDb 内にも同名ローカル定義があり、モジュールレベル定義をシャドウしている（挙動は同一のため実害なし。逐語移動で保持）。

外部サービス依存（テストでの固定方針）:
- Google Sheets: `GOOGLE_SERVICE_ACCOUNT_JSON` 未設定 → `canSyncTradeSheet()`=false → listFromDb はシート進捗をスキップ、getSheetTabs は `{configured:false}`、updateRecord/addRecord は `TRADE_SHEET_WRITE_BACK_ENABLED=false` により常に DB 完結経路。
- frankfurter.dev: `repairKnownEuroRateRows` / `applyDisplayedEuroRateRepairs` は対象行（no=385/386/387・サイモン/マキシム/ネレ等）がなければ fetch しない。`recalcShippingCosts` の USD レート取得は失敗時 catch → 関税スキップ（テストDBでは network-guard によりブロックされ、関税 0 として決定的）。

### 1.2 クライアント側

| ファイル | 行数 | 抽出対象（型・定数・純粋関数） |
|---|---|---|
| client/src/pages/Home.tsx | 773 | `FilterableKey` / `ActiveTab` / `runWhenIdle` / `normalizeTradeDataPartner` / `dbRecordToTradeRecord` |
| client/src/components/AddTradeDialog.tsx | 1,129 | `FormState` / `InvoiceApplyPreview` / `DEFAULT_TRADE_PARTNERS` / `getTodayDateString` / `createInitialForm` / `getCurrencyForPartner`(Add版) / `isHiddenTradePartner` / `PARTNER_MAP` / `PRODUCT_WORD_MAP` / `PARTNER_PREFIX_MAP` / `toJapanesePartner` / `toJapaneseProductName` / `fetchFrankfurterRate` / `normalizeDate` / `STATUS_PRESETS` |
| client/src/components/EditTradeDialog.tsx | 693 | `fetchFrankfurterRate`（Addと完全同一）/ `normalizeDate`（完全同一）/ `STATUS_PRESETS`（完全同一）/ `EditFormState` / `TradeCurrency` / `getCurrencyForPartner`(Edit版) / `normalizeCurrency` |
| client/src/components/DataTable.tsx | 619 | `DataTableProps` / `VISIBLE_COLUMNS` / `PAGE_SIZE_OPTIONS` / `MOBILE_META_COLUMNS` / `getTradeRecordId` |

コンポーネント間の重複定義:
- **完全同一（SSOT統合対象）**: `fetchFrankfurterRate`・`normalizeDate`・`STATUS_PRESETS`（AddTradeDialog と EditTradeDialog で逐語一致）。
- **類似だが挙動が異なる（統合しない・記録のみ）**:
  - `getCurrencyForPartner`: Add版は `"ユーロ" | "ドル"` を返しデフォルト "ドル"（サミー/デボン判定なし・hennes kamusien 判定なし）。Edit版は `TradeCurrency | null` を返し、サミー/デボン→"ドル"、該当なし→null。さらに server 側 `inferTradeCurrencyForPartner` は hennes kamusien も EUR 判定しデフォルトは既存通貨から導出。3実装とも判定集合・デフォルトが異なる。
  - `isHiddenTradePartner`（AddTradeDialog）と `normalizeTradeDataPartner`（Home.tsx）: どちらも "hennes kamusien" 特別扱いだが、前者は真偽値（非表示判定）、後者は "サイモン" への置換。意味が異なるため統合しない。

## 2. 既存の不具合・仕様の不統一（修正せず記録のみ）

1. `recalcShippingCostsLegacy`（routers.ts 791-891）は未使用のデッドコード。逐語移動で保持した。
2. `trade.getFilterOptions` の返却契約: DB 未接続時は `{ years, partners, currencies, statuses }`（`months` なし）、接続時は `months` を含む。呼び出し側は optional 扱いのため実害なし。
3. `trade.listFromDb` はページングをアプリ側 `slice` で行うため、全件を毎回取得している（`page`/`pageSize` は SQL に反映されない）。
4. `trade.updateRecord` はシート書き戻し無効時（現行運用）でも `no === null` の場合に `{ success: true, updatedRow: null }` を返し、DB を更新しない（インボイスNoが数値でない行は編集不可）。
5. `trade.updateRecord` の通貨は `inferTradeCurrencyForPartner` により入力より取引相手名を優先する（例: 相手が「ルカ」なら入力 "ドル" でも "ユーロ" で保存）。クライアント側の Add/Edit の判定と集合が一致していない（上記 1.2 参照）。
6. `repairKnownEuroRateRows` / `applyDisplayedEuroRateRepairs` は特定インボイスNo（385/386/387）・特定取引相手名をハードコードした読み取り時自己修復で、listFromDb のたびに外部レートAPIへ依存し得る。
7. `shipment.create` の `insertId` は `(result as any).insertId` で取得しており型安全でない。
8. `applyTradeShipmentRegistrationStatuses` 等のステータス導出はインボイスNo > 399 のみ対象（399 以下は complete 系へ丸め）。境界値はコード内マジックナンバー。
9. `listFromDb` 内のローカル `toNumber` がモジュールレベル `toNumber` をシャドウしている（挙動同一）。
10. Home.tsx の `dbRecordToTradeRecord` は数値文字列を `Math.round` / 小数2桁丸めで変換するため、DB 保存値（decimal 文字列）と画面表示値が厳密には一致しない（例: unitPrice "100.5049" → 100.5、customsDuty "12.6" → 13）。丸め仕様は単体テストで固定した。
11. EditTradeDialog.tsx の `fetchFrankfurterRate` は定義のみで一度も呼ばれていないデッドコードだった（Edit 側は `trpc.trade.getRateByDate` を使用）。AddTradeDialog 側と逐語一致のため、SSOT 統合（`tradeFormShared.ts`）により未使用の重複定義は自然消滅した（挙動変更なし）。
12. `PRODUCT_WORD_MAP` は配列順で `/pink/gi` が `/coral\s*pink/gi` より先に評価されるため、"coral pink" は「コーラルピンク」にならず「coral ピンク」になる（コーラルピンク置換は到達不能）。既存仕様として単体テストで固定した。

## 3. 進捗（作業単位ごとに追記）

- [x] T-A0: `tests/regression/trade.test.ts` 新設（整理前の旧コードで成功を確認）— コミット `4de009a`
- [x] T-A1: trade → `server/tradeRouter.ts`、shipment → `server/shipmentRouter.ts` 逐語移動 — コミット `26e556f`
- [x] T-A2: Home.tsx / AddTradeDialog / EditTradeDialog / DataTable の型・純粋関数抽出と SSOT 化 — コミット `6aa001c`

## 4. 実施結果

### 4.1 ファイル・行数の変化

| ファイル | 変更 |
|---|---|
| server/routers.ts | 2,376行 → 233行（trade/shipment ブロックを1行参照に置換） |
| server/tradeRouter.ts | 新規 1,892行（定数 30-35・ヘルパー 52-1094・trade ルーター 1262-2091 を逐語移動。`toNumber` / `normalizeShipmentTrackingNumber` / `getShipmentAllocationGroupKey` / `recalcShippingCosts` のみ `export ` 付与） |
| server/shipmentRouter.ts | 新規 271行（shipment ルーター 2111-2374 を逐語移動。共有ヘルパーは tradeRouter から import、循環なし） |
| client/src/pages/home/model.ts | 新規（`FilterableKey` / `ActiveTab` / `runWhenIdle` / `normalizeTradeDataPartner` / `dbRecordToTradeRecord`） |
| client/src/components/trade/tradeFormShared.ts | 新規 SSOT（`fetchFrankfurterRate` / `normalizeDate` / `STATUS_PRESETS` — Add/Edit で逐語一致だった3定義を単一化） |
| client/src/components/trade/addTradeModel.ts | 新規（FormState・既定取引相手・`getCurrencyForPartner`(Add版)・`toJapanesePartner` / `toJapaneseProductName` ほか） |
| client/src/components/trade/editTradeModel.ts | 新規（EditFormState・`getCurrencyForPartner`(Edit版)・`normalizeCurrency`。Add版とは挙動が異なるため統合せず） |
| client/src/components/trade/dataTableModel.ts | 新規（`DataTableProps`・表示列定数・`getTradeRecordId`） |
| client/src/components/AddTradeDialog.tsx | 1,129行 → 964行 |
| client/src/pages/Home.tsx | 773行 → 691行 |
| client/src/components/EditTradeDialog.tsx | 693行 → 621行 |
| client/src/components/DataTable.tsx | 619行 → 578行 |

### 4.2 検証結果

- 逐語比較（`git show 2ba8ecb:<path>` との行レベル多重集合比較。CRLF→LF 正規化のうえ実施）:
  - server: tradeRouter.ts / shipmentRouter.ts とも MISSING=0 / EXTRA=0（許容差分は `export ` 接頭辞・import 行・ラッパー開閉のみ）。routers.ts の差分は import 群と1行参照・保持コメントのみ。
  - client: 新規5モジュールの非許容 EXTRA=0、編集4ファイルの非許容 MISSING=0（許容差分は import 行・`export ` 接頭辞・ヘッダーコメントのみ）。
- `pnpm check`: エラーなし。
- 回帰テスト `node scripts/test-local-regression.mjs test`: **165件 全成功**（既存145 + T-A0 新設20。LOCAL_TEST_TARGET=invoices の専用架空DBのみ使用）。
- クライアント単体テスト（vitest）: 新設 **31件 全成功**（home/model 7・tradeFormShared 6・addTradeModel 10・editTradeModel 4・dataTableModel 4）。
- テスト後 `node scripts/test-local-regression.mjs seed` で専用DBを架空7件へ復元。

### 4.3 未検証範囲

- Google Sheets 実接続経路（`getSheetView` / `updateSheetCell` / `findTradeViewInvoiceCell` / `getExchangeRates` / `getRateByDate` / `findRowByInvoiceNo` の実サービス動作、および `TRADE_SHEET_WRITE_BACK_ENABLED=true` 時の書き戻し経路）— 外部サービステスト禁止のため未検証（シート未設定時の契約は T-A0 で固定済み）。
- frankfurter.dev 実レート取得経路（`fetchJpyRateByDate` / client `fetchFrankfurterRate` のライブ応答）— fetch モックでの契約固定のみ。
