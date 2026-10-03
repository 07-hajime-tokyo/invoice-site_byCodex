import type { LocalPurchaseWithLabels as LocalPurchaseRow } from "../db";
import { recordWorkLog } from "../workLogs";
import { resolveWorkOperatorName } from "../workOperator";
import {
  localPurchasePrimaryManagementNo,
  parseLocalPurchaseItems,
} from "./legacyValues";
import type {
  PurchaseTrackingSyncInput,
  PurchaseTrackingAuditState,
  PurchaseTrackingAuditUpdate,
} from "./trackingFields";

export function purchaseTrackingAuditValue(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return text ? text : null;
}

export function getPurchaseTrackingAuditState(
  row: LocalPurchaseRow
): PurchaseTrackingAuditState {
  return {
    shipDate: purchaseTrackingAuditValue(row.shipDate),
    trackingNumber: purchaseTrackingAuditValue(row.trackingNumber),
    carrier: purchaseTrackingAuditValue(row.carrier),
    note: purchaseTrackingAuditValue(row.note),
    status: purchaseTrackingAuditValue(row.status),
    stage: purchaseTrackingAuditValue(row.stage),
  };
}

export function getNextPurchaseTrackingAuditState(
  previous: PurchaseTrackingAuditState,
  update: PurchaseTrackingAuditUpdate
): PurchaseTrackingAuditState {
  return {
    shipDate: Object.prototype.hasOwnProperty.call(update, "shipDate")
      ? purchaseTrackingAuditValue(update.shipDate)
      : previous.shipDate,
    trackingNumber: Object.prototype.hasOwnProperty.call(
      update,
      "trackingNumber"
    )
      ? purchaseTrackingAuditValue(update.trackingNumber)
      : previous.trackingNumber,
    carrier: Object.prototype.hasOwnProperty.call(update, "carrier")
      ? purchaseTrackingAuditValue(update.carrier)
      : previous.carrier,
    note: Object.prototype.hasOwnProperty.call(update, "note")
      ? purchaseTrackingAuditValue(update.note)
      : previous.note,
    status: Object.prototype.hasOwnProperty.call(update, "status")
      ? purchaseTrackingAuditValue(update.status)
      : previous.status,
    stage: Object.prototype.hasOwnProperty.call(update, "stage")
      ? purchaseTrackingAuditValue(update.stage)
      : previous.stage,
  };
}

export function getPurchaseTrackingChangedFields(
  previous: PurchaseTrackingAuditState,
  next: PurchaseTrackingAuditState
): Array<keyof PurchaseTrackingAuditState> {
  const keys: Array<keyof PurchaseTrackingAuditState> = [
    "shipDate",
    "trackingNumber",
    "carrier",
    "note",
    "status",
    "stage",
  ];
  return keys.filter(key => (previous[key] ?? null) !== (next[key] ?? null));
}

export function getPurchaseTrackingAuditLabelIds(
  row: LocalPurchaseRow,
  input: PurchaseTrackingSyncInput
): string[] {
  const labels = new Set<string>();
  const addLabel = (value: unknown) => {
    const label = String(value ?? "")
      .trim()
      .toUpperCase();
    if (label) labels.add(label);
  };

  addLabel(input.labelId);
  for (const label of row.itemLabels ?? []) {
    addLabel(label.labelId);
  }
  for (const item of parseLocalPurchaseItems(row)) {
    const itemLabels = (item as { itemLabels?: Array<{ labelId?: unknown }> })
      .itemLabels;
    for (const label of itemLabels ?? []) {
      addLabel(label.labelId);
    }
  }

  return Array.from(labels);
}

export async function recordPurchaseTrackingAuditLog(
  input: PurchaseTrackingSyncInput,
  purchase: LocalPurchaseRow,
  previous: PurchaseTrackingAuditState,
  next: PurchaseTrackingAuditState,
  changedFields: Array<keyof PurchaseTrackingAuditState>
) {
  if (changedFields.length === 0) return;

  const labelIds = getPurchaseTrackingAuditLabelIds(purchase, input);
  const managementNo =
    localPurchasePrimaryManagementNo(purchase) ||
    String(input.managementNo ?? purchase.managementNo ?? "").trim() ||
    null;
  const workerName = resolveWorkOperatorName(
    input.operatorName,
    input.createdBy
  );
  const trackingBefore = previous.trackingNumber ?? "未設定";
  const trackingAfter = next.trackingNumber ?? "未設定";

  try {
    await recordWorkLog({
      workerName,
      category: "追跡番号登録",
      status: "done",
      startedAt: new Date(),
      endedAt: new Date(),
      quantity: 1,
      memo: [
        managementNo ? `管理番号: ${managementNo}` : null,
        `追跡番号: ${trackingBefore} -> ${trackingAfter}`,
        labelIds.length > 0 ? `商品ID: ${labelIds.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" / "),
      createdBy: input.createdBy ?? workerName,
      sourceType: "purchase-tracking-audit",
      sourceId: `purchase:${purchase.id}`,
      detailsJson: JSON.stringify({
        version: 1,
        action: "purchase_tracking_update",
        target: {
          purchaseId: purchase.id,
          zaicoId: purchase.zaicoId ?? null,
          localInventoryId:
            purchase.localInventoryId ?? input.inventoryId ?? null,
          purchaseNum: purchase.purchaseNum ?? null,
          title: purchase.title ?? null,
          managementNo,
          labelIds,
        },
        input: {
          zaicoId: input.zaicoId,
          inventoryId: input.inventoryId ?? null,
          managementNo: input.managementNo ?? null,
          labelId: input.labelId ?? null,
        },
        before: previous,
        after: next,
        changedFields,
      }),
    });
  } catch (error) {
    console.warn("[purchaseTrackingAudit] failed to record work log", error);
  }
}
