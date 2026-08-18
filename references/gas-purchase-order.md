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
  const duplicateRows = findDuplicateManagementNoRowsInSheet_(sheet, rowNumber, payload.managementNo);
  if (duplicateRows.length > 0) {
    range.setValue(false);
    range.setNote(`管理番号重複: ${payload.managementNo}`);
    SpreadsheetApp.getUi().alert(
      "管理番号が重複しています",
      `登録前に停止しました。\n\n管理番号: ${payload.managementNo}\nシート内の重複行: ${duplicateRows.join(", ")}行目`,
      SpreadsheetApp.getUi().ButtonSet.OK,
    );
    return;
  }

  const duplicateCheck = callManagementNoDuplicateCheck_(payload.managementNo, secret);
  if (!duplicateCheck.success) {
    range.setValue(false);
    range.setNote(`重複確認失敗: ${duplicateCheck.error || "不明なエラー"}`);
    throw new Error(duplicateCheck.error || "管理番号の重複確認に失敗しました。");
  }
  if (duplicateCheck.duplicate) {
    range.setValue(false);
    range.setNote(`管理番号重複: ${payload.managementNo}`);
    SpreadsheetApp.getUi().alert(
      "管理番号が既にサイトへ登録されています",
      buildDuplicateManagementNoMessage_(duplicateCheck),
      SpreadsheetApp.getUi().ButtonSet.OK,
    );
    return;
  }

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

function normalizeManagementNo_(value) {
  return String(value || "").split(",")[0].trim();
}

function findDuplicateManagementNoRowsInSheet_(sheet, currentRow, managementNo) {
  const target = normalizeManagementNo_(managementNo);
  if (!target) return [];

  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const managementColumnIndex = headers.findIndex((header) => ["管理番号", "管理No", "SRN管理番号"].includes(header));
  if (managementColumnIndex < 0) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, managementColumnIndex + 1, lastRow - 1, 1).getDisplayValues();
  const duplicateRows = [];
  values.forEach((rowValues, index) => {
    const rowNumber = index + 2;
    if (rowNumber === currentRow) return;
    if (normalizeManagementNo_(rowValues[0]) === target) duplicateRows.push(rowNumber);
  });
  return duplicateRows;
}

function callManagementNoDuplicateCheck_(managementNo, secret) {
  const target = normalizeManagementNo_(managementNo);
  if (!target) return { success: true, duplicate: false };
  try {
    const response = UrlFetchApp.fetch(WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${secret}` },
      payload: JSON.stringify({
        action: "checkDuplicateManagementNo",
        managementNo: target,
      }),
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    const body = response.getContentText();
    if (code < 200 || code >= 300) return { success: false, error: `${code} ${body}` };
    return JSON.parse(body);
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function buildDuplicateManagementNoMessage_(result) {
  const lines = [
    "登録前に停止しました。",
    "",
    `管理番号: ${result.managementNo || ""}`,
  ];
  const inventories = result.inventories || [];
  const purchases = result.purchases || [];
  const labels = result.labels || [];
  if (inventories.length) {
    lines.push("", "在庫一覧:");
    inventories.slice(0, 5).forEach((item) => lines.push(`- ${item.title} / 在庫${item.quantity} / ID:${item.id}`));
  }
  if (purchases.length) {
    lines.push("", "入庫管理:");
    purchases.slice(0, 5).forEach((item) => lines.push(`- ${item.title || ""} / ${item.status} / ID:${item.id}`));
  }
  if (labels.length) {
    lines.push("", "商品ID:");
    lines.push(labels.slice(0, 10).map((label) => label.labelId).join(", "));
  }
  return lines.join("\n");
}
```

## Payload fields

最低限必要なのは `title` と `quantity` です。`managementNo` または `purchaseNum` があると、同じ行を再実行しても既存データを更新できます。重複事故を避ける場合は、上記サンプルのように登録前に `action: "checkDuplicateManagementNo"` を呼び出してから登録してください。どちらもない場合は `sourceKey` が重複防止キーになります。
