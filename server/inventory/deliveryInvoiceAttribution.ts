import {
  getDb,
  isZaicoEnabled,
  getLocalInventories,
  getDeletedInventories,
  getPurchaseHistories,
} from "./db";
import {
  normalizeAssignedInvoiceNo,
  invoiceNoFromDeliveryNo as invoiceNoFromDeliveryNoStrict,
  invoiceGroupKeyFromDeliveryNo,
} from "@shared/invoiceKey";
import { getInventories } from "./zaico";

export type StoredDeliveryItem = {
  inventoryId?: number;
  labelId?: string | null;
  title?: string;
  quantity?: unknown;
  managementNo?: string | null;
  tradeRecordId?: number | null;
  csvProductName?: string | null;
};

/**
 * 個体ID -> 人が指定した引当先インボイスNo。
 * 在庫から充当したぶんや、別インボイスの在庫を回したぶんは推測できないので、
 * 画面で指定した値をここから引いて集計に効かせる。
 */
export async function buildAssignedInvoiceNoMap(): Promise<
  Map<string, string>
> {
  const db = await getDb();
  if (!db) return new Map();
  const { inventoryItemLabels: labelTbl } = await import(
    "../../drizzle/schema"
  );
  const rows = await db
    .select({
      labelId: labelTbl.labelId,
      assignedInvoiceNo: labelTbl.assignedInvoiceNo,
    })
    .from(labelTbl);
  const map = new Map<string, string>();
  for (const row of rows) {
    const invoiceNo = normalizeAssignedInvoiceNo(row.assignedInvoiceNo);
    if (invoiceNo) map.set(String(row.labelId).trim().toUpperCase(), invoiceNo);
  }
  return map;
}

/** 出庫明細に、人が指定した引当先を載せて返す。 */
export function withAssignedInvoiceNo<T extends StoredDeliveryItem>(
  item: T,
  assignedMap: Map<string, string>
): T & { assignedInvoiceNo?: string | null } {
  const labelId = String(item.labelId ?? "")
    .trim()
    .toUpperCase();
  return labelId
    ? { ...item, assignedInvoiceNo: assignedMap.get(labelId) ?? null }
    : item;
}

export function parseDeliveryItemsJson(
  value: string | null | undefined
): StoredDeliveryItem[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function buildInventoryManagementNoMap(): Promise<
  Map<number, string>
> {
  const zaicoEnabled = await isZaicoEnabled();
  const [inventories, deletedInvList, purchaseHistList] = await Promise.all([
    zaicoEnabled ? getInventories() : getLocalInventories(),
    getDeletedInventories(2000),
    getPurchaseHistories(3000),
  ]);
  const inventoryEtcMap = new Map<number, string>();
  for (const inv of inventories as Array<{
    id: number;
    etc?: string | null;
    managementNo?: string | null;
  }>) {
    inventoryEtcMap.set(Number(inv.id), inv.etc ?? inv.managementNo ?? "");
  }
  for (const del of deletedInvList) {
    if (del.zaicoId && del.etc && !inventoryEtcMap.has(del.zaicoId)) {
      inventoryEtcMap.set(del.zaicoId, del.etc);
    }
  }
  for (const ph of purchaseHistList) {
    if (ph.inventoryId && ph.kanriNo && !inventoryEtcMap.has(ph.inventoryId)) {
      inventoryEtcMap.set(ph.inventoryId, ph.kanriNo);
    }
  }
  return inventoryEtcMap;
}

// 読み取りの正本は shared/invoiceKey.ts。従来の呼び出し名だけ残す。
export const invoiceNoPrefixFromDeliveryNo = invoiceNoFromDeliveryNoStrict;

export const invoiceNoFromDeliveryNo = invoiceGroupKeyFromDeliveryNo;
