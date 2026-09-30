# 海外発送・梱包 リファクタリング棚卸し（staff/yousunafu/refactor-overseas）

基準コミット: `83127ff`。UI・機能・API契約・保存値・保存順は完全維持。新機能・修正なし。

## 対象ファイル（整理前）

### client/src/inventory/pages/OverseasShipping.tsx（1,924行）
- EOL: LF のみ（CR混在なし）
- 外部参照: `client/src/inventory/InventoryApp.tsx:18` の `lazy(() => import("@/inventory/pages/OverseasShipping"))`（default exportのみ）。named exportを参照する外部ファイルなし → 再export不要
- import依存: `@/inventory/pages/DeliveryHistory` から `FedexShipmentDialog, HistoryItem`（import経路そのまま維持）・`@/inventory/lib/productNameUtils`・`@/inventory/components/InvoiceStockSection`・`@/inventory/lib/currentWorker`・`@shared/productMatching`
- 型: `FedexShipment`(454)・`ShipmentItem`(465)・`CsvInvoiceData`(472)・`OrderSummaryItem`(478)・`PartnerPortal`(491)・`PartnerMessage`(499)・`ShipmentInvoiceProductMatch`(512)・`ShipmentInvoiceResolution`(513)・`ShipmentInvoiceUsage`(514)・`PartnerTab`(631)・`InvoiceEntry`(650)・`AggregatedShipmentRow`(666)
- 純粋関数: `extractInvoiceNo`(517)・`sortInvoiceNo`(526)・`shipmentProductUsageKey`(536)・`reserveShipmentProductUsage`(540)・`findCsvProductForShipmentItem`(551)・`resolveShipmentItemInvoice`(575)・`partnerLabel`(623)・`partnerTabLabel`(633)・`partnerTabSheetName`(641)・`normalizeShipmentGroupKey`(675)・`cleanShipmentProductTitle`(679)・`sameShipmentValue`(683)・`findShipmentCsvProduct`(689)・`aggregateShipmentRowsByOrderLine`(696)・`findCsvProductForDeliveryItem`(739)・`sumDeliveredQtyByOrderProduct`(767)
- 独立表示部品: `DeliveryHistoryFedexSection`(27–164, props: invoiceNo/partner のみ。内部にtRPCクエリを持つが画面本体stateとは独立)・`PartnerView`(167–451, props: shipments/csvData のみ)
- 本体: `OverseasShipping()`(785–1924)。state・イベント配線・tRPCクエリ・タブJSXは画面に残す

### server/inventory/routers.ts の `fedex: router({...})` ブロック（3699–4343）
- 手続き一覧: `getByDeliveryNo`(3703, query)・`getAll`(3712, query)・`getTodayTrackingNumbers`(3719, query, publicProcedure別名使用)・`create`(3741, mutation)・`delete`(3930, mutation)・`deleteWithGas`(3940, mutation)・`updateWithGas`(3994, mutation)・`createBatch`(4094, mutation)・`mergeByTracking`(4286, mutation)
- routers.ts ローカル定義のヘルパー（shipmentクラスター）と、fedexブロック外からの利用有無:
  - `shipmentSheetNameSchema`(209) … **ブロック外 3030 でも使用**（delivery系ブロック）→ fedexRouter.ts へ移動し export、routers.ts が import
  - `ShipmentSheetName`(210) … クラスター内+fedexのみ
  - `detectShipmentSheetNameInText`(212) … クラスター内のみ
  - `detectShipmentSheetName`(223) … fedex `createBatch`(4118) のみ
  - `mergeShipmentGasItems`(342) … クラスター内+fedexのみ
  - `alignShipmentItemsToOrderRows`(361) … fedexのみ（3762/4028/4121）
  - `ShipmentDisplayItem`(487)・`deliveryHistoryItemsToShipmentItems`(494)・`sumShipmentDisplayItems`(511) … クラスター内のみ
  - `alignShipmentItemsWithDeliveryHistories`(515) … **ブロック外 4434/4810 でも使用**（adminブロック）→ 移動し export
  - `getShipmentItemsForHistory`(553) … fedexのみ
  - `getLiveDeliveryHistoryIds`(566) … fedexのみ
  - `shouldUseExistingShipmentForGas`(571) … fedexのみ
  - `sumWorkQuantity`(586) … **ブロック外 1599/3124/4773 でも使用** → 移動し export
- import依存（外部モジュール）: `zod`・`../_core/trpc`(router, protectedProcedure。590の`const publicProcedure = protectedProcedure;`別名を抽出先で再現)・`./db`(getFedexShipmentsByDeliveryNo, getAllFedexShipments, createFedexShipment, updateFedexShipment, deleteFedexShipment, updateFedexShipmentStatus, updateFedexShipmentHistoryAndDeliveryNo, getDeliveryHistoryById, getAllDeliveryHistories)・`./deliveryInvoiceAttribution`(invoiceNoFromDeliveryNo)・`./workOperator`(resolveWorkOperatorName)・`./workLogs`(recordWorkLog)・`./shipmentDeclarationRules`(type ShipmentGasItem)・`./orderTradeRows`(getOrderRowsFromTradeRecords, expandMaxim415416OrderRows)・`@shared/productMatching`(allocateShipmentItemsToCsvProducts)
- 抽出方針の補足: ヘルパーを routers.ts に残して export すると `routers.ts ⇄ fedexRouter.ts` の循環importになり、`shipmentSheetNameSchema`（const）が fedexRouter の `.input()` 評価時にTDZ/未定義となるため不可。**shipmentクラスター一式を fedexRouter.ts へ逐語移動**し、ブロック外でも使う3シンボル（shipmentSheetNameSchema / alignShipmentItemsWithDeliveryHistories / sumWorkQuantity）のみ export して routers.ts が import する（依存方向は routers → fedexRouter の一方向）。他ブロックのコード本文は無変更
- GAS依存: `create`/`createBatch`/`updateWithGas`/`deleteWithGas`/`mergeByTracking` は `GAS_WEBHOOK_URL` 未設定時にDB保存+エラー契約（文言固定）で完結 → 回帰テストはこの経路で固定。`alignShipmentItemsToOrderRows` は trade_records（DB）のみ参照で外部接続なし

### server/inventory/outboundBoxes.ts（705行・既に独立ルーターファイル、棚卸しのみ）
- ローカルヘルパー: `errorText`(31)・`isDuplicateError`(35)・`requireDb`(39)・`getBoxByCode`(45)・`getBoxLabels`(51)・`getBoxDetail`(58)・`issueOneBox`(64)・`resolveShipmentDestinations`(85)・`deleteShipmentRowsForUnlink`(115, export・outboundBoxes.test.ts が使用)
- ルーター手続き: `list`(132)・`attachDelivery`(147)・`create`(251)・`open`(260)・`addItem`(280)・`assignInvoice`(309)・`removeItem`(371)・`discard`(384)・`seal`(395)・`linkTracking`(454)・`unlinkTracking`(543)・`unseal`(599)・`traceByLabel`(692)
- 純粋規則は `shared/outboundBoxes.ts`（buildOutboundFedexItems / shipmentSheetForPartner 等）に集約済みで、本ファイルはDB/GAS配線が主 → コード変更なし

## 既存の注意点（修正せず記録のみ）
- シート名/取引先の対応表が複数実装に分散（SSOT不統一だが挙動が異なるため統合せず）:
  - routers.ts `detectShipmentSheetName`（デボン含む5種+フォールバック独）
  - `shared/outboundBoxes.ts` `shipmentSheetForPartner`
  - OverseasShipping.tsx `partnerLabel`(4種+fallback)・`partnerTabSheetName`(4種)・手動追加フォームの選択肢(4種、デボンなし)
  - delivery-history/shipmentSheets.ts（5種）
- OverseasShipping.tsx `partnerLabel` は「デボン発送管理」を変換しない（そのままシート名表示）。PartnerTab にも devon が無い → 既存仕様として維持
- fedex `updateWithGas` は `GAS_WEBHOOK_URL` 未設定時、trackingNumber/shippingDate/itemsJson のDB更新前に return するため spreadsheetStatus/spreadsheetError のみ更新される（本文は未更新のまま）→ 現行契約としてテストで固定
- fedex `mergeByTracking` の合算は trackingNumber のみで対象抽出（deliveryNo/sheetName不問）。書き込み payload に deliveryNo/invoiceNo を含まない（create系と非対称）
- fedex `create` の同一追跡番号合算は `productNameJa` キーのみでマージ（`mergeShipmentGasItems` の labelId 考慮と非対称）
- `getTodayTrackingNumbers` は `new Date(r.createdAt).toISOString()` のUTC日付で「当日」を判定（JSTの日付境界とずれる）→ 既存仕様として維持
- OverseasShipping.tsx `parseDateStr`(202) は「M/D」形式を 2026 年固定で解釈
- OverseasShipping.tsx 933 `invoiceNumber <= 383` をレガシー完了扱いにするハードコード
- work_logs への記録は create/createBatch で登録・合算どちらの経路でも「FedEx発送登録」で毎回追加される（合算時も新規行）

## 進捗

- [x] 調査・棚卸し（本ドキュメント）
- [ ] 整理前基準: tests/regression/overseas.test.ts
- [ ] O-A1: OverseasShipping.tsx → overseas-shipping/
- [ ] O-A2: routers.ts fedexブロック → fedexRouter.ts
- [ ] 検証・終了処理
