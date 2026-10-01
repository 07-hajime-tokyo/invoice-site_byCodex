# 注文・パートナー リファクタリング棚卸し（staff/yousunafu/refactor-orders-partner）

基準コミット: `cbdef4f`。UI・機能・API契約・保存値・保存順は完全維持。新機能・修正なし。

## 対象（整理前）

### server/inventory/routers.ts の3ブロック（整理前 1,480行）
- `inventoryMemo`（629–668）: list / create / listAll
- `invoiceMemo`（848–881）: upsert / list / listAll / setManualComplete（`__manual_complete__` + colorKey "1"/"0"）
- `partner`（991–1477）: login / logout / checkSession / getShipments / updateCheck / sendMessage / getMyMessages / deleteMyMessage / markMessagesRead / addThreadReply / getThreads / 管理側（createPortal / listPortals / updatePortal / deletePortal / listMessages / markMessageRead / replyMessage / deleteMessage / getAdminThreads / addAdminThreadReply / markThreadReadByAdmin / addManualShipment / listManualShipments / deleteManualShipment / getAdminShipments）
- 認可: routers.ts:601 相当の `const publicProcedure = protectedProcedure;` 別名を全抽出先で再現（partner系は cookie `partner_session` を自前検証。実効挙動を完全維持）

### client/src/inventory/pages/OrderManagement.tsx（1,552行）
- 型: `SummaryDeliveryItem`(13)・`SummaryItem`(23)・`CsvProductSummary`(54)・`DeliveryItem`(55)・`ColorSummary`(180)・`ColorSummaryWithModel`(350)・`CsvProductCandidate`(352)・`AggregatedDeliveryItem`(427)
- 純粋関数: `exportOrderManagementCSV`(58)・`progressColor`(88)・`extractColorFromCsvName`(103)・`managementNoMatchesColor`(153, 未参照=デッドコード)・`orderStockCoverage`(189)・`isOrderStockShort`(193)・`getColorKeywords`(204)・`extractModelFromCsvName`(241)・`matchesModel`(263)・`isRandomColor`(294)・`normalizeColorToken`(299)・`normalizeColorlessQualifierToken`(303)・`hasColorlessQualifierText`(310)・`isColorlessRandomColor`(315)・`colorlessQualifierMatches`(326)・`isOtherColor`(336)・`hasLimitedEditionMarker`(345)・`normalizeLooseText`(354)・`csvProductGroupKey`(358)・`suggestCsvProductNameWithFallback`(364)・`findDeliveryCsvProduct`(379)・`findCsvProductByTitleAndManagement`(395)・`cleanDeliveryProductTitle`(406)・`deliveryDateKey`(410)・`deliveryDateLabel`(416)・`sameValueOrLabel`(422)・`aggregateDeliveryItems`(438)・`isVita2000AquaBlueMisdelivery`(478)・`buildColorSummary`(487)
- 表示部品: `InvoiceMemoField`(679)・`PurchaseDetailPanel`(740)・`InventoryDetailPanel`(782)・`DeliveryDetailPanel`(884)
- 本体: `OrderManagement()`(917–1552)。state・イベント配線・tRPCクエリは画面に残す

### client/src/inventory/pages/PartnerPortal.tsx（952行）
- 型: `ShipmentItem`(15)・`FedexShipment`(23)・`CsvInvoiceData`(35)・`ShipmentInvoiceProductMatch`(42)・`ShipmentInvoiceResolution`(43)・`ShipmentInvoiceUsage`(44)
- 純粋関数: `extractInvoiceNo`(46)・`sortInvoiceNo`(55)・`shipmentProductUsageKey`(65)・`reserveShipmentProductUsage`(69)・`findCsvProductForShipmentItem`(80)・`resolveShipmentItemInvoice`(92)
- 本体: `PartnerPortal()`(139–952)。独立表示部品なし（全JSXがstate・mutationに密結合のため画面に残す）

## 既存の注意点（修正せず記録のみ）
- `const publicProcedure = protectedProcedure;`: partner系の「public」プロシージャも実際は protectedProcedure。抽出先3ファイルすべてで同じ別名を逐語再現し実効認可を維持
- **inventoryMemo は本来「在庫」ドメイン**だが、`server/inventory/routers.ts` は本担当（注文・パートナー）の単独所有ファイルのため、本ユニットで抽出を実施（inventoryMemoRouter.ts のドメイン帰属は在庫側）
- `partner.listMessages`（管理側一覧）は `isDeleted=1` の行も返す（管理画面側でフィルタされない）→ 回帰テストで現行挙動を固定
- `partner.deleteMyMessage` は他パートナーのメッセージIDを指定しても success を返す（行は変更されない / own-only のサイレント no-op）→ 回帰テストで固定
- `partner.sendMessage` の notifyOwner は失敗しても握りつぶす（try/catch）。テスト環境では forge URL 未設定で常に失敗 → 契約として固定
- OrderManagement `managementNoMatchesColor`(旧153) は未参照のデッドコード → order-management/colorMatching.ts へ逐語移動で保持
- OrderManagement `extractColorFromCsvName` 末尾の「最後トークンにフォールバック」分岐（旧140–142）は、既知機種に一致しない非空文字列では到達しない（残り全体を返す）。単体テストは実挙動（"Switch ブルー" → "Switch ブルー"）を固定
- OrderManagement 旧899 コメントに文字化け「場傈」（原文ママ、逐語保持）
- PartnerPortal の Pending Orders フィルタ: コメントは「インボイス370以降」だが実装は `parseInt(invoiceNo) >= 384`（コメントと実装の不一致。実装準拠で保持）
- PartnerPortal `parseDateStr`（shipmentGroups 内）は "M/D" 形式の年を 2026 固定で解釈（既存仕様として保持）
- `server/gemini.test.ts` は GEMINI_API_KEY 未設定の環境では失敗する既存の環境依存テスト（本変更とは無関係。`pnpm test` で唯一の失敗）

## 進捗

- [x] 調査・棚卸し（本ドキュメント）
- [x] P-A0: 整理前基準 tests/regression/ordersPartner.test.ts（コミット 69b113b）
- [x] P-A1: partner / invoiceMemo / inventoryMemo ルーター抽出（コミット cb302ee）
- [x] P-A2: OrderManagement.tsx → order-management/（コミット 86bc97d）
- [x] P-A3: PartnerPortal.tsx → partner-portal/（コミット b5d7cc3）

## 変更ファイル / 検証結果

### P-A0（コミット 69b113b）
- 新設 `tests/regression/ordersPartner.test.ts`（646行・21テスト）: partner login成功/失敗（パスワード不一致 UNAUTHORIZED・コード不存在 NOT_FOUND・inactive）、checkSession（cookieなし/有効/不正token/期限切れ）、logout、getShipments（シート別フィルタ・manual負ID・checks・csvDataパートナー絞込）、updateCheck upsert、sendMessage（通知失敗無視）、getMyMessages（降順・削除/他者除外）、deleteMyMessage、markMessagesRead、addThreadReply/getThreads、管理CRUD（Portal/Message/Thread/ManualShipment/getAdminShipments）、invoiceMemo upsert/list/listAll/setManualComplete、inventoryMemo create/list/listAll
- cookieはログイン後にDBから sessionToken を読み `partner_session=encodeURIComponent(JSON)` を自前構築。専用テストDBのみ使用
- 旧コードで全218テスト（既存197+新規21）成功を確認してからコミット

### P-A1（コミット cb302ee）
- `server/inventory/routers.ts` 1,480 → 888行。3ブロックを1行参照（`partner: partnerRouter,` 等）へ置換、ブロック専用import（db関数25個ほか）を削除。`getInventoryMemos` は修復コード（254）と型（137）で使用のため維持
- 新設: `partnerRouter.ts`（525行）・`invoiceMemoRouter.ts`（46行）・`inventoryMemoRouter.ts`（52行）。各ファイルに `const publicProcedure = protectedProcedure;` を再現
- 逐語比較: 抽出3ブロック本体 + routers.ts 残余（786行）を `git show cbdef4f` と行単位照合 → MISSING=0 / EXTRA=0。`pnpm check` クリーン。回帰218/218成功

### P-A2（コミット 86bc97d）
- `OrderManagement.tsx` 1,552 → 656行。新設 `order-management/`: types.ts(72)・exportCsv.ts(31)・colorMatching.ts(237)・csvProductMatching.ts(51)・display.ts(38)・aggregateDeliveries.ts(44)・colorSummary.ts(215)・InvoiceMemoField.tsx(64)・PurchaseDetailPanel.tsx(44)・InventoryDetailPanel.tsx(104)・DeliveryDetailPanel.tsx(35)
- 単体テスト5ファイル・49テスト（colorMatching 16 / display 6 / csvProductMatching 9 / aggregateDeliveries 5 / colorSummary 6 ほか）全成功
- 逐語比較（非import行の集合比較、`export `接頭辞のみ許容）: 1,461行 → MISSING=0 / EXTRA=0。`pnpm check` クリーン

### P-A3（コミット b5d7cc3）
- `PartnerPortal.tsx` 952 → 830行。新設 `partner-portal/`: types.ts(32)・shipmentInvoice.ts(101)
- 単体テスト shipmentInvoice.test.ts・14テスト全成功（インボイスNo抽出・ソート・使用量予約・CSV商品照合・残数優先割当）
- 逐語比較: 883行 → MISSING=0 / EXTRA=0。`pnpm check` クリーン

### 最終確認
- `pnpm check`（tsc --noEmit）: エラーなし
- 回帰テスト `node scripts/test-local-regression.mjs test`: 全成功（218テスト）
- クライアント単体 `pnpm test`: 新規63テスト含め成功（唯一の失敗は既存の環境依存 `server/gemini.test.ts`）
- 終了時に `node scripts/test-local-regression.mjs seed` で専用DBを架空7件に復元

## 未検証範囲
- 実ブラウザでの画面表示（OrderManagement / PartnerPortal）は目視未確認（型チェック・単体テスト・逐語比較で担保）
- Zaico / GAS / FedEx / Forge通知など外部接続経路（テスト環境では無効・未設定のまま契約を固定)
