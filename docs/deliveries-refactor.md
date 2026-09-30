# 出庫・出庫履歴 リファクタリング棚卸し（staff/yousunafu/refactor-deliveries）

基準コミット: `2da96a7`。UI・機能・API契約・保存値・保存順は完全維持。新機能・修正なし。

## 対象ファイル（整理前）

### client/src/inventory/pages/Deliveries.tsx（3,528行）
- 型: `InventoryItemLabel`(73)・`InventoryItem`(80)・`DeliveryItem`(172)・`InventoryFormData`(227)・`ShipmentSheetName`(253)
- 定数: `emptyForm`(240)・`SHIPMENT_SHEET_NAMES`(254 / 4シート。DeliveryHistory側は「デボン発送管理」を含む5シートで不一致 → 既存仕様として維持)
- 純粋関数: `exportInventoryCSV`(102)・`normalizeInventoryCategoryName`(136)・`getInventoryDisplayCategory`(152)・`calcDaysSince`(156)・`daysBadgeClass`(165)・`formatPrice`(186)・`getManagementNo`(192)・`getInventoryLabelIds`(201)
- 表示部品: `InventoryLabelIds`(205)
- 本体: `Deliveries()`(256–3528)。state・イベント配線・tRPCクエリは画面に残す

### client/src/inventory/pages/DeliveryHistory.tsx（3,367行）
- 型: `HistoryItem`(58, export。**OverseasShipping.tsx / purchase-registration/ShippingPanels.tsx / shippingRules.ts が import** → 再export必須)・`ShipmentSheetName`(66)・`FedexShipmentView`(70)・`CancelledItem`(121)・`InventoryDetail`(127)・`_ColorEntry`(223)・`GroupedHistoryEntry`(1043)
- 定数: `SHIPMENT_SHEET_NAMES`(68 / 5シート)
- 純粋関数: `detectShipmentSheetNameInText`(82)・`detectShipmentSheetName`(93)・`sheetBadgeClass`(108)・`isDollarPartnerName`(116)・`_extractColorFromCsvName`(147)・`_extractModelFromCsvName`(165)・`_matchesModel`(181)・`_getColorKeywords`(199)・`_isRandomColor`(219)・`_scoreMatch`(224)（`_`付きは未使用に見えるがデッドコードも逐語移動）・`buildGroupDeliveredSummary`(251)・`getManagementNo`(279)・`getSupplierSite`(287)・`formatPrice`(293)・`formatDate`(298)・`formatDateShort`(309)・`exportCSV`(314)・`parseCancelledItems`(1053)・`getActiveHistoryItems`(1062)・`isRandomColor`(1071)・`normalizeColorText`(1076)・`colorAliases`(1080)・`colorKeywordMatches`(1105)・`extractModelName`(1120)・`aggregateItemsByCsvProducts`(1154)・`extractDeliveryGroup`(1549)・`extractInvoiceNoFromManagementText`(1554)・`resolveHistoryGroup`(1565)・`formatDisplayDeliveryNo`(1584)
- 表示部品: `InventoryDetailToggle`(364)・`CancelConfirmDialog`(788)・`FedexShipmentDialog`(856, export・他画面が使用)・`FedexBatchDialog`(1278)
- 本体: `DeliveryHistory()`(1589–3367)

### server/inventory/deliveryService.ts（131行）
- `InventoryDeliveryInput` 型と `processInventoryDelivery()`。呼び出し元: `routers.ts:3047`（delivery.create系）・`outboundBoxes.ts:431`。deliveryHistoryルーターとの重複定義は確認されず（db.ts関数を共用しているのみ）

### server/inventory/routers.ts の `deliveryHistory` ブロック（3340–3828）
- API: `list` / `listByInvoicePrefix` / `markDeleted` / `updateDeliveryNo` / `bulkUpdateDeliveryNo` / `moveItemsToDeliveryNo` / `cancelItem` / `deleteGroup` / `cancelItems`
- 依存（すべて外部モジュールからのimport。ブロック内ローカル定義なし）:
  - `./db`: createDeliveryHistory, getDeliveryHistories, getDeliveryHistoriesByInvoicePrefix, getDeliveryHistoriesByDeliveryNo, getDeliveryHistoryById, deleteDeliveryHistoryById, updateDeliveryHistoryItemsJson, markDeliveryItemsDeleted, updateDeliveryNo, updateDeliveryCancelledItems, getLocalInventoryByZaicoIdOrId, updateLocalInventory, deleteLocalInventory, createDeletedInventory, isZaicoEnabled, getFedexShipmentsByHistoryId, getFedexShipmentsByDeliveryNo, updateFedexShipmentHistoryAndDeliveryNo, updateFedexShipmentStatus
  - `./zaico`: deleteDelivery, updateDeliveryNum, getInventory, updateInventory, deleteInventory
  - `./workOperator`: resolveOperatorToken
  - `./deliveryInvoiceAttribution`: invoiceNoFromDeliveryNo
  - `../_core/trpc`: router, protectedProcedure（routers.ts:601 `const publicProcedure = protectedProcedure;` → 抽出先でも同じ別名を再現）
- `moveItemsToDeliveryNo` は `GAS_WEBHOOK_URL` があるとGASへfetchする（テストでは未設定 → gasResults空で契約比較）

## 既存の注意点（修正せず記録のみ）
- `SHIPMENT_SHEET_NAMES` が Deliveries(4種) と DeliveryHistory(5種=+デボン発送管理) で不一致
- routers.ts 3558–3565 の「出庫取り消し（一括）」JSDocコメントが `deleteGroup` の直前に置かれ、実体 `cancelItems` と離れている（コメント位置のズレ）。3560 に誤字「取り消すす」
- `cancelItem`/`cancelItems` の取消済み判定は inventoryId 単位（同一商品が複数回出庫された履歴では2回目以降を取り消せない）
- DeliveryHistory.tsx の `_` 接頭辞関数群（147–249）は未参照のデッドコードに見える（逐語移動で保持）
- `deliveryHistoriesToShipmentItems` 系ヘルパー（routers.ts:505 付近）は deliveryHistory ブロック外・他機能（shipment系）の所有 → 触らない

## 進捗

- [x] 調査・棚卸し（本ドキュメント）
- [ ] 整理前基準: tests/regression/deliveries.test.ts
- [ ] D-A1: Deliveries.tsx → deliveries/
- [ ] D-A2: DeliveryHistory.tsx → delivery-history/
- [ ] D-A3: deliveryHistoryRouter.ts 抽出

## 変更ファイル / 検証結果

（各作業単位の完了時に追記）
