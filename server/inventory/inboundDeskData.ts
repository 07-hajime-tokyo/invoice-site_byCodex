export type { InspectionOutcome } from "@shared/inboundDesk";
export { inboundInvoiceAllocation as invoiceAllocation } from "@shared/inboundDesk";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import {
  inventoryItemLabels,
  localPurchases,
  workLogs,
} from "../../drizzle/schema";
import { getDb, getLocalPurchaseById, updateLocalPurchaseStatus } from "./db";

export function normalizeStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function insertIdFromResult(result: unknown): number | null {
  const row = Array.isArray(result) ? result[0] : result;
  const value = Number((row as { insertId?: number } | null)?.insertId ?? 0);
  return value > 0 ? value : null;
}

export function affectedRowsFromResult(result: unknown): number {
  const row = Array.isArray(result) ? result[0] : result;
  return Number((row as { affectedRows?: number } | null)?.affectedRows ?? 0);
}

export function splitSourceIds(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(", ")
    .map(part => part.trim().toUpperCase())
    .filter(Boolean);
}

export function operatorName(
  inputName: string | undefined,
  fallback: string | null | undefined
) {
  return inputName?.trim() || fallback?.trim() || "野田";
}

export async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return db;
}

export async function findPurchaseForLabel(
  label: typeof inventoryItemLabels.$inferSelect
) {
  if (label.purchaseId) {
    const purchase = await getLocalPurchaseById(label.purchaseId);
    if (purchase) return purchase;
  }
  if (!label.localInventoryId) return null;
  const db = await requireDb();
  const purchases = await db
    .select()
    .from(localPurchases)
    .where(eq(localPurchases.localInventoryId, label.localInventoryId));
  const managementNo = String(label.legacyManagementNo ?? "").trim();
  return (
    purchases.find(
      purchase => String(purchase.managementNo ?? "").trim() === managementNo
    ) ??
    purchases[0] ??
    null
  );
}

export async function labelWasAlreadyCounted(
  labelId: string
): Promise<boolean> {
  const db = await requireDb();
  const logs = await db
    .select({ sourceId: workLogs.sourceId })
    .from(workLogs)
    .where(eq(workLogs.sourceType, "purchase-label"));
  const normalized = labelId.trim().toUpperCase();
  return logs.some(log => splitSourceIds(log.sourceId).includes(normalized));
}

export async function markPurchaseReceivedIfComplete(
  purchaseId: number | null
) {
  if (!purchaseId) return;
  const db = await requireDb();
  const labels = await db
    .select({ status: inventoryItemLabels.status })
    .from(inventoryItemLabels)
    .where(eq(inventoryItemLabels.purchaseId, purchaseId));
  if (labels.length === 0) return;
  const complete = labels.every(label =>
    ["received", "stocked", "shipped", "returned", "cancelled"].includes(
      normalizeStatus(label.status)
    )
  );
  if (complete)
    await updateLocalPurchaseStatus(
      purchaseId,
      "purchased",
      new Date().toISOString().slice(0, 10)
    );
}
