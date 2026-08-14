/**
 * Google Apps Script action handler for action=writeDefectiveRow.
 * Add `return handleWriteDefectiveRow_(payload);` to the existing doPost action router.
 * This file deliberately updates site-owned columns only. Human-owned columns are
 * created as headers but are never included in an update range.
 */

var DEFECTIVE_SHEET_NAME_ = "不良在庫";
var DEFECTIVE_SITE_HEADERS_ = [
  "商品ID", "検品日", "商品名", "不良タグ", "不良メモ",
  "写真1", "写真2", "写真3", "写真枚数", "仕入単価", "検索キーワード",
  "相場_採用件数", "相場_中央値", "相場_最安", "相場_最高",
  "落札実績1", "落札実績2", "落札実績3", "落札実績4", "落札実績5",
  "相場取得日", "出品タイトル案", "出品説明案"
];
var DEFECTIVE_HUMAN_HEADERS_ = ["開始価格", "出品ステータス", "出品URL", "落札額"];

function defectiveFormulaText_(value) {
  return String(value == null ? "" : value).replace(/"/g, '""');
}

function defectiveSampleCell_(sample) {
  if (!sample) return "";
  var endedAt = sample.endedAt ? Utilities.formatDate(new Date(sample.endedAt), "Asia/Tokyo", "yyyy-MM-dd") : "";
  var label = [sample.title, Number(sample.price || 0).toLocaleString("ja-JP") + "円", Number(sample.bids || 0) + "入札", endedAt].join(" / ");
  if (!sample.url) return label;
  return '=HYPERLINK("' + defectiveFormulaText_(sample.url) + '","' + defectiveFormulaText_(label) + '")';
}

function defectiveImageCell_(url) {
  return url ? '=IMAGE("' + defectiveFormulaText_(url) + '")' : "";
}

function defectiveSiteValues_(payload) {
  var photos = Array.isArray(payload.photos) ? payload.photos : [];
  var samples = Array.isArray(payload.samples) ? payload.samples : [];
  return {
    "商品ID": String(payload.productId || ""),
    "検品日": payload.inspectedAt ? Utilities.formatDate(new Date(payload.inspectedAt), "Asia/Tokyo", "yyyy-MM-dd") : "",
    "商品名": payload.productName || "",
    "不良タグ": payload.defectTags || "",
    "不良メモ": payload.defectNote || "",
    "写真1": defectiveImageCell_(photos[0]),
    "写真2": defectiveImageCell_(photos[1]),
    "写真3": defectiveImageCell_(photos[2]),
    "写真枚数": payload.photoCount === 0 || payload.photoCount == null ? "写真なし" : payload.photoCount,
    "仕入単価": payload.unitPrice == null ? "" : payload.unitPrice,
    "検索キーワード": payload.keyword || "",
    "相場_採用件数": Number(payload.adoptedCount || 0),
    "相場_中央値": payload.median == null ? "該当なし" : payload.median,
    "相場_最安": payload.marketMin == null ? "該当なし" : payload.marketMin,
    "相場_最高": payload.marketMax == null ? "該当なし" : payload.marketMax,
    "落札実績1": defectiveSampleCell_(samples[0]),
    "落札実績2": defectiveSampleCell_(samples[1]),
    "落札実績3": defectiveSampleCell_(samples[2]),
    "落札実績4": defectiveSampleCell_(samples[3]),
    "落札実績5": defectiveSampleCell_(samples[4]),
    "相場取得日": payload.fetchedAt ? Utilities.formatDate(new Date(payload.fetchedAt), "Asia/Tokyo", "yyyy-MM-dd HH:mm") : "",
    "出品タイトル案": payload.listingTitle || "",
    "出品説明案": payload.listingDescription || ""
  };
}

function ensureDefectiveSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(DEFECTIVE_SHEET_NAME_);
  if (!sheet) sheet = spreadsheet.insertSheet(DEFECTIVE_SHEET_NAME_);
  var requiredHeaders = DEFECTIVE_SITE_HEADERS_.concat(DEFECTIVE_HUMAN_HEADERS_);
  var currentHeaders = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : [];
  requiredHeaders.forEach(function(header) {
    if (currentHeaders.indexOf(header) < 0) currentHeaders.push(header);
  });
  sheet.getRange(1, 1, 1, currentHeaders.length).setValues([currentHeaders]);
  sheet.setFrozenRows(1);
  return { sheet: sheet, headers: currentHeaders };
}

function handleWriteDefectiveRow_(payload) {
  if (!payload || payload.action !== "writeDefectiveRow") {
    return { success: false, message: "Invalid writeDefectiveRow payload" };
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var context = ensureDefectiveSheet_(SpreadsheetApp.getActiveSpreadsheet());
    var sheet = context.sheet;
    var headers = context.headers;
    var productIdColumn = headers.indexOf("商品ID") + 1;
    var targetRow = 0;
    if (sheet.getLastRow() >= 2) {
      var ids = sheet.getRange(2, productIdColumn, sheet.getLastRow() - 1, 1).getDisplayValues();
      for (var index = 0; index < ids.length; index += 1) {
        if (String(ids[index][0]).trim() === String(payload.productId).trim()) {
          targetRow = index + 2;
          break;
        }
      }
    }
    if (!targetRow) {
      targetRow = Math.max(2, sheet.getLastRow() + 1);
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([headers.map(function() { return ""; })]);
    }
    var values = defectiveSiteValues_(payload);
    DEFECTIVE_SITE_HEADERS_.forEach(function(header) {
      var column = headers.indexOf(header) + 1;
      if (column > 0) sheet.getRange(targetRow, column).setValue(values[header]);
    });
    sheet.getRange(targetRow, 1, 1, headers.length).setWrap(true);
    return { success: true, row: targetRow, productId: String(payload.productId) };
  } finally {
    lock.releaseLock();
  }
}
