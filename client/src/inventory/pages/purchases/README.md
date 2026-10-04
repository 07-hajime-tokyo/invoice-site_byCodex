# 入庫一覧画面の担当範囲

`../Purchases.tsx` は画面部品の組み立て、`usePurchasesPage.ts` は状態・取得・操作の接続を担当します。
ルートURL、文言、CSS、表示順、入力の初期値、API名は整理前と同じです。

| 役割 | 正本・担当ファイル |
| --- | --- |
| 表示用の型・選択肢 | `types.ts`、`constants.ts` |
| 価格・状態・管理番号の表示 | `format.ts`。日付・完了条件は既存 `shared/purchaseVisibility.ts` を参照 |
| 配送業者と追跡リンク | `carrier.ts`。PCとスマホは `getPurchaseTrackingInfo` を共有 |
| 検索・件数の補助計算 | `filters.ts` |
| 検索条件・URL・保存済み選択 | `usePurchaseFilters.ts`、`useDebouncedValue.ts` |
| 取得・集計・カテゴリ・タブ件数 | `usePurchaseListData.ts` |
| 担当者と複数選択 | `usePurchaseOperator.ts`、`usePurchaseSelection.ts` |
| 編集の状態・初期値・保存 | `usePurchaseEditorState.ts`、`editState.ts`、`usePurchaseEditor.ts` |
| 単件/一括入庫 | `usePurchaseCompletion.ts`。API入力は `completionInput.ts` で共有 |
| 発注登録・削除・分類/工程 | `useOrderedPurchase.ts`、`usePurchaseDeletion.ts`、`usePurchaseStages.ts` |
| 追跡番号一括登録 | `usePurchaseBulkTracking.ts`、`BulkTrackingDialog.tsx` |
| CSV取得・ファイル生成 | `usePurchaseCsv.ts`、`csv.ts` |
| 上部操作・合計・検索条件 | `PurchasesToolbar.tsx`、`PurchaseTotals.tsx`、`PurchaseFilters.tsx` |
| 一覧構造・PC行・スマホカード | `PurchaseList.tsx`、`PurchaseDesktopRows.tsx`、`PurchaseCardMobile.tsx` |
| 商品表・配送編集・配送表示 | `PurchaseItemsTable.tsx`、`PurchaseShippingEditor.tsx`、`PurchaseShipmentSummary.tsx` |
| ラベル・分類工程・追跡一覧 | `ItemLabelsBlock.tsx`、`InboundRowControls.tsx`、`TrackingNumberPanel.tsx` |
| 確認画面・一括操作バー | `PurchaseReceiptDialog.tsx`、`BulkReceiptDialog.tsx`、`OrderedPurchaseDialog.tsx`、`PurchaseSelectionBar.tsx` |

部品が必要とする操作の型は `PurchasePageModel` から `Pick` で取り出します。
モデルへの参照は `import type` なので、部品からコントローラーへの実行時循環参照を作りません。
取得は編集中のIDを受け取り、従来どおり編集中だけ定期再取得を止めます。

## 維持する違い

- サーバーの一覧検索とクライアントのCSVフィルターには、検索時の条件・入庫済み行の扱いなどの違いがあります。似た処理でも同じ規則と見なして統合しません。
- 追跡一覧の未知業者の扱いと、カードの保存済み手動業者の扱いも異なります。名前・色の補完と追跡リンク生成は別の関数です。
- 商品→仕入先→追跡情報の順に保存します。追跡番号やメモの空欄、手動業者の解除、ゼロ円の入力は従来の意味を保持します。
- 入庫日には既存のUTC日付、編集開始時の発送日には既存のローカル日付を使います。日付の仕様変更は今回行いません。
- CSVは現在の全件取得とフィルターを維持し、BOM・引用符・ヘッダー順・ファイル名を `csv.ts` で定義します。

## 検証

`presentation.test.tsx` の23スナップショットは、分割前の画面と関数から取得した基準です。
HTML19件（5種類の状態×行/分類操作/ラベル、追跡一覧の開閉、全体の有/無データ）と表示用データ4件を比較します。
`contracts.test.ts` ではCSVのバイト列・保存処理、単件/一括入庫の入力、編集初期値、手動配送リンクを確認します。
イベントやEffect全体をSSRで保証しているわけではないため、実ブラウザー操作は `tests/regression/browser-checklist.md` に別途記録します。
