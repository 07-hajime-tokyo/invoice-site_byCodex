# 在庫・カテゴリ・メモ リファクタリング棚卸し（staff/yousunafu/refactor-stock）

基準コミット: `cbdef4f`。UI・機能・API契約・保存値・保存順は完全維持。新機能・修正なし。クライアントのみ担当（server/ は不変更。inventoryMemo ルーター抽出は別担当）。

## 対象ファイル（整理前）

### client/src/inventory/pages/Deliveries.tsx（3,360行）
前巡 D-A1 で型・定数・表示純関数は `deliveries/`（types.ts / form.ts / shipmentSheets.ts / display.ts / exportInventoryCsv.ts / InventoryLabelIds.tsx）へ抽出済み。本体 `Deliveries()`（88–3360）の構造:

#### ロジック（コンポーネント内）
- 出庫・取引先判別（**今回対象外・残置**）: `detectCustomerFromManagementNo`(125)・`getShortPartnerDeliveryCode`(144)・`getShipmentSheetNameForCustomerCode`(152)・`generateDeliveryNo`(160)・`generateYahooAuctionDeliveryNo`(174)・`isShaftManagementNo`(181)・`extractCommonInvoiceNoFromItems`(193)
- 管理番号ヘルパー: `extractPrefixFromManagementNo`(186) — 純関数。出庫側と在庫側（販売価格照合）の両方が使用 → **stockView.ts へ抽出**
- 発注済み登録（state 201–235・operator 236–257・`openOrderedDialogForInv`(259)・`handleOrderedSubmit`(285)）: tRPC mutation・localStorage（仕入先カスタムリスト）と密結合 → 残置
- 検索・カテゴリ選択 state（330–352）・出庫カート state（353–427）・在庫編集/新規登録 state（429–437）・在庫数増減確認 state（439–447）・詳細トグル（448–463）
- 一括削除モード（465–529）: mutation 配線 → 残置
- カテゴリ管理 `handleAddCategory`(531)・`handleDeleteCategory`(552): mutation/invalidate 配線 → 残置
- 在庫メモ履歴 state + query（573–578）・在庫数直接入力（580–597）
- `categoryOptions` useMemo(601–612): カテゴリ候補の集計 → **stockFilters.buildCategoryOptions へ抽出**
- `filteredInventories` useMemo(618–646): カテゴリ+検索フィルタ・更新日降順ソート → **stockFilters.filterAndSortInventories へ抽出**
- `categoryTotals` useMemo(707–720): カテゴリ別在庫金額集計 → **stockView.calcCategoryTotals へ抽出**
- `grandTotal`(722)・`currentCategoryTotal`(728): 1行集計のため残置
- `lookupSellingPrice`(733–761): CSV行からのユーロ建て販売価格照合（純ロジック・csvRows クロージャ参照） → **stockView.lookupSellingPrice へ抽出（csvRows を引数化）**
- 出庫カート操作 `toggleCheck`(763)・`setQuantity`(789)・`setOrderLineSelection`(809): 出庫配線 → 残置
- 在庫数増減 `requestStockChange`(838)・`handleStockChange`(844): mutation+メモ保存配線 → 残置
- 個別出庫（888–961）・まとめて出庫（963–1021）: 出庫実行 → 残置
- 在庫削除（1023–1061）・在庫編集 `openEditDialog`/`handleEditSubmit`(1066–1113)・新規登録（1118–1160）: mutation 配線 → 残置
- 不良在庫移動（restock, 1162–1209）: inboundDesk 配線 → 残置

#### JSX
- ヘッダー・検索バー（1222–1306）・不良個体入力セクション（1308–1339）・合計金額サマリー（1342–1374）・カテゴリプルダウン（1377–1416）・カテゴリ別合計（1419–1424）: state と密結合 → 残置
- 在庫一覧カード（1427–1796）: 出庫チェック・数量・詳細トグル・各種ボタン配線が同居 → 残置
- フッター（出庫/削除モード, 1798–2004）: 出庫配線 → 残置
- 一括削除確認（2007–2029）・出庫確認（2032–2283）・個別出庫（2286–2491）・在庫削除確認（2494–2558）: 出庫/削除配線 → 残置
- 在庫数変更確認ダイアログ（2560–2621）: props のみで動作可能 → **StockChangeConfirmDialog.tsx へ抽出**
- 在庫数変更履歴（メモ）ダイアログ（2623–2680）: 同上 → **MemoHistoryDialog.tsx へ抽出**
- カテゴリ管理ダイアログ（2681–2735）+ カテゴリ削除確認（2736–2755）: 同上 → **CategoryDialogs.tsx へ抽出**
- 在庫編集ダイアログ（2756–2898）: フォーム入力は editForm/setEditForm 経由のみ → **EditInventoryDialog.tsx へ抽出**
- 発注済み登録ダイアログ（2900–3057）: 操作者切替・仕入先追加（localStorage）・発注No取得ローディングと密結合 → 残置
- 新規登録ダイアログ（3059–3177）: → **CreateInventoryDialog.tsx へ抽出**
- 商品詳細ダイアログ（3179–3326）: `detailItem` は常に null（開く箇所なし）の**デッドコード**（「後方互換のためのdetailItem」コメント 462 参照）。detailZaico/detailMemos クエリ配線と同居のため残置（削除しない）
- 不良個体選択ダイアログ（3328–3350）・DefectiveInspectionDialog（3352–3357）: restock 配線 → 残置

## 既存の注意点（修正せず記録のみ）
- 商品詳細ダイアログ（3179–3326）は `setDetailItem` が閉じる操作でしか呼ばれず開く手段がないデッドコード（インライン詳細トグルへ移行済みの名残）。逐語保持
- `lookupSellingPrice` は部分一致で見つからない場合に「同インボイスの最初の sellingPrice 付き行」へフォールバックするため、別商品の価格が表示され得る（既存仕様）
- 行内の販売価格更新ロジック（インボイスNo選択時, 1929–1950）は `lookupSellingPrice` と同等の照合を**インライン再実装**しており、管理番号 prefix を見ない点が異なる（既存の重複・不統一）
- `filteredInventories` の useMemo 終端 `}, [...])` のインデントが1スペース深い（646行）。`openOrderedDialogForInv` の placeholder 文言「取得中...」」に全角カッコの誤字（2955）
- `categoryOptions` は在庫0品も集計対象（quantity null/undefined のみ除外）だが、`categoryTotals` は在庫0を除外 — 表示仕様として既存どおり
- 一括出庫フッターと出庫確認ダイアログで取引先/インボイスNo変更時の出庫No再生成ロジックがほぼ同一のまま3箇所に重複（1887–1964・2041–2107・2326–2389）→ 出庫側担当領域のため触らず

## 進捗
- [x] S-A0: 棚卸し（本ドキュメント）+ 整理前基準テスト（stockFilters.test.ts / stockView.test.ts。抽出予定ロジックの逐語コピーに対して期待出力を固定）（コミット 20fb2dc）
- [x] S-A1: 純ロジック抽出（stockFilters.ts / stockView.ts）（コミット ada8a80）
- [x] S-A2: メモ・カテゴリ系ダイアログ抽出（StockChangeConfirmDialog / MemoHistoryDialog / CategoryDialogs）（コミット 7dcdb66）
- [x] S-A3: 在庫編集・新規登録ダイアログ抽出（EditInventoryDialog / CreateInventoryDialog）（コミット 8283a84）
- [x] 仕上げ: 検証結果・行数変化の記録（本セクション以下）

## 変更ファイル / 検証結果

### S-A0（コミット 20fb2dc）
- 新設 `deliveries/stockFilters.test.ts`（8テスト）・`deliveries/stockView.test.ts`（10テスト）: 抽出予定ロジックの逐語コピーに対し現行出力を固定（S-A1 でモジュール import に差し替え、期待値は不変）

### S-A1（コミット ada8a80）
- 新設 `deliveries/stockFilters.ts`（60行: buildCategoryOptions・filterAndSortInventories）・`deliveries/stockView.ts`（68行: calcCategoryTotals・extractPrefixFromManagementNo・SellingPriceCsvRow・lookupSellingPrice）
- Deliveries.tsx: useMemo 3件の本体とローカル関数2件を呼び出しに置換（+21/−94）。`lookupSellingPrice` はクロージャ参照だった csvRows を第1引数化（構造型 SellingPriceCsvRow は orderManagement.getCsvData の行と互換）
- 逐語性検証: 移動5ブロックと新2ファイルの行単位比較で MISSING/EXTRA = 0（差分は `export ` 付与とシグネチャ行のみ）

### S-A2（コミット 7dcdb66）
- 新設 `deliveries/StockChangeConfirmDialog.tsx`・`MemoHistoryDialog.tsx`（memoHistoryData は構造型 MemoHistoryEntry[] で受領）・`CategoryDialogs.tsx`（管理+削除確認の2ダイアログ、mutation は `{ isPending }` 構造型）
- Deliveries.tsx: 3ブロックをコンポーネント呼び出しに置換（+29/−191）。props 名は元の識別子名と同一で JSX 本体は逐語
- 逐語性検証: MISSING/EXTRA = 0（残置したセクションコメント1行のみ差分）

### S-A3（コミット 8283a84）
- 新設 `deliveries/EditInventoryDialog.tsx`・`CreateInventoryDialog.tsx`（setEditForm/setCreateForm は `Dispatch<SetStateAction<InventoryFormData>>`）
- Deliveries.tsx: 2ブロックを置換（+18/−258）。逐語性検証 MISSING/EXTRA = 0

### 行数変化
- Deliveries.tsx: 3,360行（基準 cbdef4f）→ 2,887行（−473行）
- 混在EOL（CRLF/LF）はバイト単位で保全（未変更行は基準と同一バイト）

### 検証結果（最終）
- `pnpm check`（tsc --noEmit）: エラーなし（各コミット時点+最終）
- `pnpm vitest run client/src/inventory/pages/deliveries`: 3ファイル / 27テスト 全成功（display 9 + stockFilters 8 + stockView 10）
- `pnpm vitest run client/src`: 47ファイル / 442テスト 全成功
- Deliveries.tsx の既存 import は抽出後も全て使用中（除去不要）
