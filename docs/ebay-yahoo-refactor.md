# eBay・ヤフオク出品領域 SSOTリファクタリング記録

ブランチ: `staff/yousunafu/refactor-ebay-yahoo` / 基準コミット: `2ba8ecb`

## 棚卸し（基準コミット時点）

### server/inventory/routers.ts（4,035行）
- `zaico: router({...})` ブロック: 1247〜3018行（35手続き）
  - getOperators / testConnection / getPurchases / completePurchase / getInventories /
    getCategories / addCategory / deleteCategory / getPurchasesWithCategoryPage /
    getPurchasesWithCategory / getInventoryById / getPurchasesByInventoryId /
    deletePurchaseOnly / updatePurchaseData / deleteInventory / upsertInventoryExtra /
    createInventory / updateInventory / getShaftSales / upsertShaftSale /
    updateShaftSaleDate / updateShaftSaleProfit / updateSupplierNameOnly /
    updateEbayListingUrl / updateEbayOrderUrl / updateEbayOrderStatus /
    updateCategoryOnly / getInboundConfig / setDirectPartnerNames / setInboundClass /
    advanceStage / separateShaft / getNextPurchaseNum / createOrderedPurchase / createDelivery
- `purchaseHistory: router({...})`: 3023〜3131行（list / cancel）
- `receiptAck: router({...})`: 3133〜3147行（summary / markDone）
- routers.ts への外部importは server/routers.ts の `inventoryRouter` のみ。
  個別手続き・ローカルヘルパーを他ファイルから直接importしている箇所は無し（再export互換は不要）。

### routers.ts ローカルヘルパーの所属（依存調査結果）
- zaicoブロック専用（zaicoRouter.ts へ移動対象）:
  - normalizeListingUrl（207行）、GitHub CSVクラスタ
    fetchGithubCsv / getGithubCsvToken / buildGithubHeaders / rawGithubUrlToContentsApi /
    readGithubCsvResponse / fetchCsvFromGithub（213〜275行）
  - extractLatestDateFromEtc（286行）
  - カテゴリクラスタ CATEGORY_SETTINGS_KEY / ALL_CATEGORY_LABEL / UNCATEGORIZED_LABEL /
    uniqueSortedCategories / getStoredCategories / setStoredCategories /
    extractCategoriesFromItemsJson / getInventoryCategoryList / clearLocalCategory（307〜419行）
  - ensureStockLabelsForInventories（1118行）＋ type InventoryItemLabelForEnsure（428行）
  - localPurchaseMatchesInventoryForLinkedDelete（1171行）
- purchaseHistoryブロック専用（purchaseHistoryRouter.ts へ移動対象）:
  - type PurchaseHistoryRow（424行）と 432〜722行の入庫履歴ヘルパークラスタ
    （historyTimestampFrom / purchaseHistoryKey / nonEmptyPurchaseHistoryText /
    localPurchaseItem* / purchaseHistoryQuantityWithPurchase / historyRowCreatedMs /
    localPurchaseCreatedMs / preferLocalPurchaseCandidate / LocalPurchaseHistoryLookup /
    buildLocalPurchaseHistoryLookup / findLocalPurchaseForHistory / enrichPurchaseHistoryRow /
    purchaseHistoryMergeKey / preferPurchaseHistoryRow / maxPurchaseHistoryQuantity /
    mergePurchaseHistoryRows / collapsePurchaseHistoryRows /
    getRecoveredPurchaseHistoriesFromLabels）
- routers.ts に残すもの:
  - `const publicProcedure = protectedProcedure;`（421行）— 34箇所で使用。抽出先でも別名を再現
    （先行事例: deliveryHistoryRouter.ts）
  - type LocalInventoryRow / InventoryMemoRow（423・425行）— 一回限り修理関数が使用
  - 724〜1115行の一回限り修理クラスタ（EBAY_7696 / MAXIM_404 修理・
    softDeleteInventoriesHiddenByDeliveryHistory・runInventoryOneTimeRepairsOnce・
    setTimeout起動）— zaicoブロックから未参照のため routers.ts に残置

### client/src/inventory/pages/EbayInventory.tsx（1,389行）
- InventoryApp.tsx からのみ import。
- 分割対象: 型・定数・純粋関数（表示・計算・整形）・独立表示部品 → `ebay-inventory/` へ。

### client/src/inventory/pages/YahooListings.tsx（1,017行）
- InventoryApp.tsx からのみ import。
- サーバー側 `inventory.inboundDesk` は抽出済みのため触らない（クライアントのみ）。

## 既存の注意点（修正せず記録のみ）

- routers.ts `zaico.getInventoryById`（1801行付近）: `return await buildFromLocalDb();` の直後に
  Zaico API フォールバックの try/catch が続くが到達不能（デッドコード）。逐語移動で維持。
- `zaico.updateEbayListingUrl` の Zaico連携ON経路: `ebayListingUrl` を保存せず、既存の
  supplierName/supplierUrl を upsert し直すだけで success を返す（保存されない仕様の不統一）。
- `zaico.upsertInventoryExtra`・`deletePurchaseOnly` などで `ctx` を受けるが未使用の手続きがある。
- `purchaseHistory.cancel` は同じ取り消しを2回実行すると在庫が二重減算される（冪等でない。
  purchaseHistory.test.ts で既存挙動として固定済み）。
- `isZaicoEnabled()` は値に関係なく常に false を返す実装（db.ts 2179行）。回帰テストは
  Zaico連携OFF経路のみ契約固定。Zaico連携ON経路は実外部接続が必要なため未検証。
- `zaico.createDelivery` の GAS Webhook 経路は `GAS_WEBHOOK_URL` 未設定時に
  `fedexResult.success=false`（"GAS_WEBHOOK_URLが未設定です"）を返す。テストは未設定経路で固定。
- `upsertLocalInventory`（db.ts 1687行）は drizzle/mysql2 の戻り値（配列
  `[ResultSetHeader, ...]`）をオブジェクトとして cast して `insertId` を読むため、
  新規INSERTでも常に 0 を返す。結果 `zaico.createInventory`（Zaico OFF経路）は
  `data_id: 0` を返し、`createdId > 0` ガードによりラベル未作成・変動メモは
  inventoryId=0 で記録される（fullRestoreSnapshot.ts 306行には 0 時のフォールバック
  実装あり＝既知挙動）。回帰テストはこの既存挙動のまま固定。
- 一回限り修理クラスタ（EBAY_7696等）は import 時の setTimeout で自動実行される
  （NODE_ENV!==production時）。テストDBでは対象データ不在のため system_settings への
  完了フラグ書き込みのみ。

## 進捗

### E-A0: 整理前基準（完了）
- `tests/regression/ebayYahoo.test.ts`（32テスト）を旧コードのまま全回帰177件
  （既存145件＋新規32件）成功で確認しコミット。

### E-A1: zaicoルーター抽出（完了）
- `server/inventory/zaicoRouter.ts`（2,175行）を新設。routers.ts から以下を逐語移動:
  - `zaico: router({...})` 内側 1248〜3017行（35手続き）
  - zaicoブロック専用ヘルパー 203〜419行（normalizeListingUrl / GitHub CSVクラスタ /
    extractLatestDateFromEtc / カテゴリクラスタ）、428〜430行（InventoryItemLabelForEnsure）、
    1118〜1201行（ensureStockLabelsForInventories / localPurchaseMatchesInventoryForLinkedDelete）
- `const publicProcedure = protectedProcedure;` 別名を抽出先でも再現。
- routers.ts は 4,035行 → 1,897行。差分は import 整理（+11/-2,149）と
  `zaico: zaicoRouter,` 参照のみ。
- 逐語比較: 移動4ブロックを `git show 2ba8ecb` と行単位（多重集合）比較し MISSING=0 / EXTRA=0
  （許容差分: import行・`export const zaicoRouter = router({` ラッパー・別名行のみ）。
- routers.ts には基準時点から未使用のimportが複数残存
  （google / revertPurchase / invoiceKeyクラスタ / tradeSheetStatusクラスタ /
  isClosedTradeYear / InsertLocalInventory・InsertLocalPurchase ほか）。
  移動起因でないため今回は除去せず記録のみ。
- `pnpm check` エラーなし。全回帰177件成功。
