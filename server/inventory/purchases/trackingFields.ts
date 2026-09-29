import { TRPCError } from "@trpc/server";
import type { InsertLocalPurchase } from "../../../drizzle/schema";

export type PurchaseTrackingSyncInput = {
  zaicoId: number;
  shipDate?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  note?: string | null;
  inventoryId?: number | null;
  managementNo?: string | null;
  labelId?: string | null;
  operatorName?: string | null;
  createdBy?: string | null;
};

export type PurchaseTrackingAuditState = {
  shipDate: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  note: string | null;
  status: string | null;
  stage: string | null;
};

export type PurchaseTrackingAuditUpdate = Partial<
  Pick<
    InsertLocalPurchase,
    "shipDate" | "trackingNumber" | "carrier" | "note" | "status" | "stage"
  >
>;

export function hasOwnPurchaseTrackingField(
  input: PurchaseTrackingSyncInput,
  key: keyof PurchaseTrackingSyncInput
): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

export function normalizePurchaseTrackingValue(
  value: string | null | undefined
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function buildPurchaseTrackingUpdate(input: PurchaseTrackingSyncInput) {
  const update: {
    shipDate?: string | null;
    trackingNumber?: string | null;
    carrier?: string | null;
    note?: string | null;
  } = {};
  if (hasOwnPurchaseTrackingField(input, "shipDate")) {
    update.shipDate = normalizePurchaseTrackingValue(input.shipDate);
  }
  if (hasOwnPurchaseTrackingField(input, "trackingNumber")) {
    update.trackingNumber = normalizePurchaseTrackingValue(
      input.trackingNumber
    );
    update.carrier = hasOwnPurchaseTrackingField(input, "carrier")
      ? normalizePurchaseTrackingValue(input.carrier)
      : null;
  } else if (hasOwnPurchaseTrackingField(input, "carrier")) {
    update.carrier = normalizePurchaseTrackingValue(input.carrier);
  }
  if (hasOwnPurchaseTrackingField(input, "note")) {
    update.note = normalizePurchaseTrackingValue(input.note);
  }
  return update;
}

export function requiresLocalPurchaseTrackingTarget(
  input: PurchaseTrackingSyncInput
): boolean {
  if (!hasOwnPurchaseTrackingField(input, "trackingNumber")) return false;
  return normalizePurchaseTrackingValue(input.trackingNumber) != null;
}

export function assertLocalPurchaseTrackingSynced(
  input: PurchaseTrackingSyncInput,
  updatedCount: number
) {
  if (!requiresLocalPurchaseTrackingTarget(input) || updatedCount > 0) return;
  throw new TRPCError({
    code: "NOT_FOUND",
    message:
      "追跡番号を反映できる発注データが見つかりませんでした。ページを更新してから再度登録してください。",
  });
}
