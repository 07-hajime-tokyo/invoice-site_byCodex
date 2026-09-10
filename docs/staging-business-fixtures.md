# 検証サイト用の架空業務データ

`scripts/staging/business-fixtures.ts` は、DBへ接続せず、現行 `drizzle/schema.ts` と主要APIが読む形の架空データをJSONへ出力する。DDL適用やDB投入は行わない。出力先以外のファイルや外部サービスにも書き込まない。

## 生成方法

既存の依存を利用できる作業ツリーで実行する。

```powershell
.\node_modules\.bin\tsx.CMD scripts\staging\business-fixtures.ts --output .\tmp\staging-business-fixtures.json
```

出力は `format`、`version`、固定生成日時、ID方針、期待値、テーブル別行データ、後付け引当前の差分、カバー範囲を持つ。日時列はJSONではISO 8601文字列になる。これはオフライン検証用の交換形式であり、そのままDBへ投入するローダーではない。

## シナリオ

全行は架空である。主キーは既存seedのID 1などと衝突しない `9600000` 以上、請求書・取引Noは `96001`、個体ラベルは現行の「IとOを除く英大文字7文字」、箱IDは `B960001` を使う。URL列は `null`、メールは予約済みの `.invalid` ドメイン、追跡番号等は `FAKE-` 接頭辞とした。

収録する数量遷移は次のとおり。

- 5個発注、0個入庫。発注とラベルは `ordered`、在庫は0。
- 5個発注、2個入庫。2ラベルだけ `stocked`、在庫は2。
- 5個発注、5個入庫。全ラベルが `stocked`、在庫は5。
- 10個発注・入庫後、5個発送。5ラベルが `shipped`、残る5ラベルと在庫数が一致する。
- 部分発送の箱に、管理番号から請求先を判定できない在庫振替ラベルを1個含める。`tables` は後付け前で、この1個は申告金額の未照合。`afterLateInvoiceAssignment.inventory_item_labels` は同じラベルへ `assignedInvoiceNo: "96001"` を設定した状態で、申告集計が EUR 800（4個）から EUR 1000（5個）へ変わる。

入庫数は `purchase_histories.quantity` と `inventory_item_labels.receivedAt`、現存数は `local_inventories.quantity` と `stocked` ラベル数、発送数は `shipment_items.quantity`、`delivery_histories.itemsJson`、`fedex_shipments.itemsJson`、`shipped` ラベル数で相互確認できる。

## カバー範囲

現行54テーブルのうち、業務シナリオを成立させる次の16テーブルへ行を用意する。

`invoice_clients`、`invoices`、`invoice_items`、`trade_records`、`customers`、`local_inventories`、`local_purchases`、`purchase_histories`、`inventory_item_labels`、`outbound_boxes`、`delivery_histories`、`shipments`、`shipment_items`、`fedex_shipments`、`action_items`、`work_logs`。

未カバーは38テーブルである。認証・権限、WhatsApp/AIチャット、請求書設定・採番履歴、入庫補足・在庫メモ・削除復元、充足日次スナップショット、月次レポート、国内商品、やることの返信・添付・候補マスタ、作業者・作業分類マスタ、不良品写真・Yahoo連携、取引先ポータル・メッセージ、発送チェック、手動発送などは対象外とした。空配列を並べて画面対応済みとは扱わず、JSONにも未カバーテーブルの疑似行は入れない。

## 検証

`server/stagingBusinessFixtures.test.ts` は、発注数＝個体ラベル数、入庫数＝入庫履歴数＝入庫済みラベル数、在庫数＝未発送の入庫済みラベル数、部分発送5個・残5個、後付け引当による金額再計算、ID帯、個体ID形式、外部URL不在、JSON出力を検証する。型検査では各配列をDrizzleの `$inferInsert` に合わせて確認する。
