# GAS purchase order webhook

スプレッドシートのA列チェックから、このサイトの「入庫管理」に発注済みデータを登録するためのWebhookです。

## Vercel environment

本番環境に次の環境変数を設定します。GAS側のScript propertiesにも同じ値を入れてください。

```text
GAS_WEBHOOK_SECRET=任意の長いランダム文字列
```

## Endpoint

```text
POST https://invoice-site-bycodex.vercel.app/api/gas/purchase-order
```

`/api/gas/purchase-order` は、デフォルトで「発注済み」として登録し、在庫数は増やしません。入庫数を直接増やす必要がある場合だけ `markPurchased: true` をpayloadに入れます。

## Apps Script sample

既存GASのA列チェック処理を、下記のPOST処理に置き換えるか追加してください。列名はスプレッドシートに合わせて `rowData["..."]` の部分を調整します。

```javascript
const WEBHOOK_URL = "https://invoice-site-bycodex.vercel.app/api/gas/purchase-order";

function onEdit(e) {
  const range = e.range;
  if (!range || range.getColumn() !== 1 || e.value !== "TRUE") return;

  const sheet = range.getSheet();
  const rowNumber = range.getRow();
  if (rowNumber === 1) return;

  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, lastColumn).getDisplayValues()[0];
  const rowData = {};

  headers.forEach((header, index) => {
    if (header) rowData[header] = values[index];
  });

  const payload = {
    sourceKey: `${sheet.getName()}:${rowNumber}`,
    sheetName: sheet.getName(),
    rowNumber,

    // 必須
    title: rowData["商品名"] || rowData["タイトル"],
    quantity: rowData["数量"] || rowData["発注数"] || 1,

    // 任意
    managementNo: rowData["管理番号"] || rowData["管理No"],
    purchaseNum: rowData["発注No"] || rowData["発注番号"],
    purchaseDate: rowData["発注日"] || Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd"),
    unitPrice: rowData["仕入単価"] || rowData["単価"],
    category: rowData["カテゴリ"] || rowData["カテゴリー"],
    place: rowData["保管場所"],
    unit: rowData["単位"] || "個",
    supplierName: rowData["仕入先"] || rowData["仕入先名"],
    supplierUrl: rowData["仕入先URL"] || rowData["URL"],
    note: rowData["備考"] || rowData["メモ"],
    createInventory: true,
    markPurchased: false,
    row: rowData,
  };

  const secret = PropertiesService.getScriptProperties().getProperty("GAS_WEBHOOK_SECRET");
  const response = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${secret}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) {
    range.setNote(`サイト反映失敗: ${code} ${body}`);
    throw new Error(body);
  }

  range.setNote(`サイト反映済み: ${Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss")}`);
}
```

## Payload fields

最低限必要なのは `title` と `quantity` です。`managementNo` または `purchaseNum` があると、同じ行を再実行しても既存データを更新できます。どちらもない場合は `sourceKey` が重複防止キーになります。
