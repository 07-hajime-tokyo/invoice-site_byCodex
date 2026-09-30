# 入庫履歴・受取連絡リファクタリング記録

対象領域: 入庫履歴画面（PurchaseHistory.tsx）と受取連絡サービス（receiptAck.ts）。
基準コミット: `83127ff`。UI・機能・API契約・保存値・保存順は完全維持（逐語移動のみ）。
`server/inventory/routers.ts` は今回変更禁止（読み取りのみ・抽出は次巡の統合担当）。

## 1. 棚卸し（基準 83127ff 時点の構造）

### 1.1 client/src/inventory/pages/PurchaseHistory.tsx（563行）

| 行 | 内容 | 分類 |
| --- | --- | --- |
| 1-27 | import（React / trpc / UI部品 / lucide / supplier / sonner / usePagination / PaginationBar / @shared/receiptAck） | import |
| 29 | `receiptAckStatusSet`（RECEIPT_ACK_STATUSES の Set） | 定数 |
| 31-34 | `normalizeReceiptAckStatus(value)` | 純関数 |
| 36-38 | `normalizeReceiptAckSource(value)` | 純関数 |
| 40-45 | `getReceiptAckLabel(item)` | 純関数 |
| 47-58 | `formatReceiptAckAt(value)`（ja-JP日時整形） | 純関数 |
| 60-65 | `receiptAckTitle(item)`（ツールチップ文言） | 純関数 |
| 67-71 | `type ReceiptAckCellProps` | 型 |
| 73-124 | `ReceiptAckCell`（受取連絡列の独立表示部品。propsのみ・state/tRPCなし） | 表示部品 |
| 126-159 | `exportPurchaseHistoryCSV(items)`（CSV行構築＋BOM付きダウンロード） | 関数（DOM副作用含む） |
| 161-184 | `type PurchaseHistoryItem` | 型 |
| 186-563 | `PurchaseHistory`（default export。tRPCクエリ、検索/日付フィルターstate、ページネーション、取り消し/受取連絡済みハンドラ、JSX本体） | 画面本体（残置対象） |

外部参照: `client/src/inventory/InventoryApp.tsx:11` の `lazy(() => import("@/inventory/pages/PurchaseHistory"))` のみ（default export）。named exportなし。EOLはLFのみ（CRLF混在なし）。

### 1.2 server/inventory/receiptAck.ts（609行）

| 行 | 内容 | 分類 | export |
| --- | --- | --- | --- |
| 1-16 | import（drizzle-orm / zod / drizzle/schema / database型 / db / @shared/receiptAck） | import | - |
| 18-24 | 定数（タスクsourceKey 3種・`receiptAckLastCrawledAt`設定キー・担当者名2種・`DEFAULT_RECEIPT_ACK_STALE_HOURS`） | 定数 | - |
| 26-32 | `receiptAckCrawlItemSchema` | zod | - |
| 34-41 | `receiptAckSiteResultSchema` | zod | - |
| 43-48 | `receiptAckIngestSchema` | zod | export |
| 50-52 | `ReceiptAckIngestPayload` / `LocalPurchaseRow` / `ReceiptAckSource` | 型 | - |
| 54-59 | `ReceiptAckTaskRow` | 型 | - |
| 61-66 | `ReceiptAckUpdate` | 型 | - |
| 68-72 | `ReceiptAckFailedSite` | 型 | export |
| 74-76 | `cleanText` | 純関数 | - |
| 78-81 | `cleanNote` | 純関数 | - |
| 83-88 | `getReceiptAckStartDate`（env読み取り） | 環境関数 | - |
| 90-93 | `getReceiptAckStaleHours`（env読み取り） | 環境関数 | - |
| 95-99 | `asCrawledAt` | 純関数 | - |
| 101-106 | `isReceiptAckStale` | 純関数 | export |
| 108-119 | `collectReceiptAckFailedSites` | 純関数 | export |
| 121-128 | `incrementFailedSiteAffected` | 純関数（Map破壊的更新） | - |
| 130-132 | `receiptAckValuesEqual` | 純関数 | - |
| 134-138 | `requireDb` | DB | - |
| 140-142 | `shouldRecheckReceiptAckCandidate` | 純関数 | export |
| 144-162 | `listReceiptAckCandidatePurchases` | DB | - |
| 164-176 | `updateReceiptAckStatus` | DB | - |
| 178-192 | `buildSiteResultMaps` | 純関数 | - |
| 194-260 | `deriveStatusFromIngest` | 純関数 | - |
| 262-270 | `resolveReceiptAckNoteFromCrawlItem` | 純関数 | export |
| 272-290 | `purchaseLine` | 純関数 | - |
| 292-310 | `buildPendingTaskDetail` | 純関数 | export |
| 312-338 | `attachReceiptAckTaskLegacyManagementNos` | DB | - |
| 340-352 | `buildCrawlFailedTaskDetail` | 純関数 | export |
| 354-363 | `buildStaleTaskDetail` | 純関数 | export |
| 365-368 | `ensureReceiptAckAssignee` | DB | - |
| 370-423 | `upsertAggregateActionItem` | DB | - |
| 425-446 | `syncPendingReceiptAckActionItem` | DB | - |
| 448-456 | `syncCrawlFailedReceiptAckActionItem` | DB | - |
| 458-472 | `syncStaleReceiptAckActionItem` | DB | - |
| 474-547 | `ingestReceiptAckCrawlResult`（巡回結果取り込み本体） | DB | export |
| 549-566 | `checkReceiptAckStale` | DB | export |
| 568-587 | `markReceiptAckDone` | DB | export |
| 589-609 | `getReceiptAckSummary` | DB | export |

外部参照（`grep -rn` 実施済み）:

- `server/inventory/routers.ts:82` → `getReceiptAckSummary`, `markReceiptAckDone`
- `server/_core/cron.ts:9` → `checkReceiptAckStale`
- `server/_core/receiptAckIngest.ts:4` → `ingestReceiptAckCrawlResult`
- `server/inventory/receiptAckDrive.ts:5` → `ingestReceiptAckCrawlResult`, `receiptAckIngestSchema`
- `server/inventory/receiptAck.test.ts:2-10` → `buildPendingTaskDetail`, `buildCrawlFailedTaskDetail`, `buildStaleTaskDetail`, `collectReceiptAckFailedSites`, `isReceiptAckStale`, `resolveReceiptAckNoteFromCrawlItem`, `shouldRecheckReceiptAckCandidate`

EOLはLFのみ。

### 1.3 server/inventory/routers.ts の関連ブロック（読み取りのみ・変更禁止）

- 595-905 付近: 入庫履歴list用ヘルパー群（次巡の抽出候補）
  - 601: `historyTimestampFrom` / 606: `purchaseHistoryKey` / 610: `nonEmptyPurchaseHistoryText`
  - 657: `purchaseHistoryQuantityWithPurchase` / 663: `historyRowCreatedMs` / 668: `localPurchaseCreatedMs`
  - 673: `preferLocalPurchaseCandidate` / 680-685: `LocalPurchaseHistoryLookup` 型
  - 686: `buildLocalPurchaseHistoryLookup` / 717: `findLocalPurchaseForHistory` / 744: `enrichPurchaseHistoryRow`
  - 770: `purchaseHistoryMergeKey` / 781: `preferPurchaseHistoryRow` / 792: `maxPurchaseHistoryQuantity`
  - 799: `mergePurchaseHistoryRows` / 829: `collapsePurchaseHistoryRows` / 839: `getRecoveredPurchaseHistoriesFromLabels`
- 3189-3297: `purchaseHistory: router({ ... })`
  - 3193-3214: `list`（`getPurchaseHistories` ＋ `getLocalPurchases` による補完 ＋ ラベル復元 ＋ 重複collapse ＋ createdAt降順 ＋ limit）
  - 3215-3296: `cancel`（Zaico OFF時: local_purchases を `purchased`→`ordered` に戻し、local_inventories を減算し、purchase_histories.cancelled=1。Zaico ON時: Zaico削除→再発注→cancelled=1）
- 3298-3312: `receiptAck: router({ summary, markDone })`（receiptAck.ts の薄いラッパー）

DB関数（`server/inventory/db.ts`・読み取りのみ）: `getPurchaseHistories`(1008) / `cancelPurchaseHistory`(1171) / `isZaicoEnabled`(2179・**常にfalseを返す実装**)。

### 1.4 テスト環境の前提

- 回帰テストは `node scripts/test-local-regression.mjs test` で実行。このworktreeの `.local/test.env` が専用DB（`invoice_remake_test_invoices`）を選択する。
- テストランナーが渡す環境変数は固定リスト（DATABASE_URL等）。`RECEIPT_ACK_START_DATE` は**未設定**で起動する。tRPC APIはテストプロセス内で起動されるため、テスト内で `process.env.RECEIPT_ACK_START_DATE` を設定・解除して有効/無効両経路を検証できる（外部接続は発生しない。ネットワークガードも有効）。
- Zaico連携は `isZaicoEnabled()` が常にfalseのため、`purchaseHistory.cancel` はローカルDB経路のみが実行される（Zaico ON経路は実外部接続が必要なため対象外として記録）。

## 2. 回帰テスト（整理前基準）

`tests/regression/purchaseHistory.test.ts` に以下の契約を固定（整理前コードで成功を確認してからコミット）:

- `purchaseHistory.list`: 基本列挙・降順・inventory_extras / purchase_extras 結合、local_purchases からの補完（receiptAck列・追跡番号・仕入先URL）、同一管理番号のcollapse、ラベル（received/stocked）からの負ID復元行、limit。
- `purchaseHistory.cancel`（ローカルDB経路）: local_purchases status戻し・在庫数減算（0未満にしない）・purchase_histories.cancelled=1、2回実行時の挙動固定。
- `receiptAck.summary`: `RECEIPT_ACK_START_DATE` 未設定時 disabled 契約・設定時の集計契約。
- `receiptAck.markDone`: 保存値（done/manual/note/at）とアクションアイテム同期、存在しないID時のエラー。
- `ingestReceiptAckCrawlResult` / `checkReceiptAckStale`（サービス直呼び）: サイト別判定・手動済み取消・巡回失敗/途絶タスク・systemSettings保存。

## 3. 抽出記録

（抽出コミットごとに追記する）

## 4. 検証結果

（最終更新時に記録する）

## 5. 既存の注意点（修正せず記録のみ）

（発見次第追記する）
