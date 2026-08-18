/**
 * Drop-in duplicate guard for the Zaico registration Apps Script.
 *
 * In handleZaicoRegistration(), call this after srnNumber is read and before
 * the "在庫登録確認" dialog:
 *
 *   const duplicateGuard = checkDuplicateManagementNoBeforeRegistration_(sheet, row, srnNumber);
 *   if (!duplicateGuard.ok) {
 *     checkboxRange.setValue(false);
 *     SpreadsheetApp.getUi().alert(duplicateGuard.title, duplicateGuard.message, SpreadsheetApp.getUi().ButtonSet.OK);
 *     return;
 *   }
 */

function normalizeManagementNoForDuplicate_(value) {
  return String(value || "").split(",")[0].trim();
}

function checkDuplicateManagementNoBeforeRegistration_(sheet, currentRow, managementNo) {
  const target = normalizeManagementNoForDuplicate_(managementNo);
  if (!target) return { ok: true };

  const duplicateRows = findDuplicateManagementNoRowsInSheet_(sheet, currentRow, target);
  if (duplicateRows.length > 0) {
    return {
      ok: false,
      title: "管理番号が重複しています",
      message: [
        "登録前に停止しました。",
        "",
        `管理番号: ${target}`,
        `シート内の重複行: ${duplicateRows.join(", ")}行目`,
      ].join("\n"),
    };
  }

  const duplicateCheck = callWebhook({
    action: "checkDuplicateManagementNo",
    srnNumber: target,
  });
  if (!duplicateCheck || duplicateCheck.success === false) {
    return {
      ok: false,
      title: "管理番号の重複確認に失敗しました",
      message: `登録前チェックに失敗したため、登録を停止しました。\n\n${duplicateCheck && duplicateCheck.error ? duplicateCheck.error : "不明なエラー"}`,
    };
  }

  if (duplicateCheck.duplicate) {
    return {
      ok: false,
      title: "管理番号が既にサイトへ登録されています",
      message: buildDuplicateManagementNoWarningMessage_(duplicateCheck),
    };
  }

  return { ok: true };
}

function findDuplicateManagementNoRowsInSheet_(sheet, currentRow, managementNo) {
  const target = normalizeManagementNoForDuplicate_(managementNo);
  const srnColumn = typeof COL_SRN === "number" ? COL_SRN : 3;
  const lastRow = sheet.getLastRow();
  if (!target || lastRow <= 1) return [];

  const values = sheet.getRange(2, srnColumn, lastRow - 1, 1).getDisplayValues();
  const duplicateRows = [];
  values.forEach(function(rowValues, index) {
    const rowNumber = index + 2;
    if (rowNumber === currentRow) return;
    if (normalizeManagementNoForDuplicate_(rowValues[0]) === target) duplicateRows.push(rowNumber);
  });
  return duplicateRows;
}

function buildDuplicateManagementNoWarningMessage_(result) {
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
    inventories.slice(0, 5).forEach(function(item) {
      lines.push(`- ${item.title} / 在庫${item.quantity} / ID:${item.id}`);
    });
  }
  if (purchases.length) {
    lines.push("", "入庫管理:");
    purchases.slice(0, 5).forEach(function(item) {
      lines.push(`- ${item.title || ""} / ${item.status} / ID:${item.id}`);
    });
  }
  if (labels.length) {
    lines.push("", "商品ID:");
    lines.push(labels.slice(0, 10).map(function(label) { return label.labelId; }).join(", "));
  }

  return lines.join("\n");
}
