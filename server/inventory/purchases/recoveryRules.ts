import type { InventoryItemLabelStatus } from "../db";

export const RECOVERABLE_ORPHAN_LABEL_MANAGEMENT_NOS = new Set([
  "402_マキシム_1/2",
  "402_マキシム_2/2",
  "在庫0807_1&2&3",
  "在庫0807_4",
  "在庫0807_5&6",
  "在庫0807_7",
]);

export const MAXIM_SECOND_LABEL_ID = "NRFZKRM";

export function canRecoverOrphanLabelPurchase(managementNo: string): boolean {
  return RECOVERABLE_ORPHAN_LABEL_MANAGEMENT_NOS.has(managementNo.trim());
}

export function getRecoveredPurchaseOverrides(managementNo: string) {
  if (managementNo === "402_マキシム_1/2") {
    return {
      purchaseNum: "1641259420",
      title: "PSP 3000 ミスティック・シルバー",
      category: "PSP",
      unitPrice: "13720",
      purchaseDate: "2026-08-06",
      trackingNumber: "490731074886",
      carrier: "yamato",
      supplierName: "駿河屋 岐阜マーサ21店",
    };
  }
  if (managementNo === "402_マキシム_2/2") {
    return {
      purchaseNum: "1794101757",
      title: "PSP 3000 ミスティック・シルバー",
      category: "PSP",
      unitPrice: "14426",
      purchaseDate: "2026-08-07",
      supplierName: "駿河屋 豊橋二ノ輪店",
      status: "ordered",
      stage: "ordered",
      labelStatus: "ordered" as InventoryItemLabelStatus,
      receivedDate: null,
      quantity: 1,
    };
  }
  return {};
}

export function recoveredPurchaseValueEquals(
  current: unknown,
  desired: unknown
): boolean {
  const currentText = String(current ?? "");
  const desiredText = String(desired ?? "");
  if (currentText === desiredText) return true;
  if (!currentText || !desiredText) return false;
  const currentNumber = Number(currentText);
  const desiredNumber = Number(desiredText);
  return (
    Number.isFinite(currentNumber) &&
    Number.isFinite(desiredNumber) &&
    currentNumber === desiredNumber
  );
}

export function recoveredPurchaseJsonEquals(
  current: unknown,
  desired: string
): boolean {
  return String(current ?? "") === desired;
}
