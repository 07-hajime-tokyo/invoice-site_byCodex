import { getDb } from "../../db";
import {
  getAllPurchaseExtras,
  getLocalInventories,
  getLocalPurchases,
  getPurchaseHistories,
} from "../db";
import {
  createPurchaseInventoryMap,
  type PurchaseInventoryInfo,
} from "./localRows";

/** 一覧の初期取得。全件取得だけが、従来どおり履歴2,000件を先に読み始める。 */
export async function loadLocalPurchaseListData(mode: "page" | "all") {
  let purchaseHistoriesMs = 0;
  const purchaseHistoriesStartedAt = mode === "all" ? Date.now() : 0;
  const purchaseHistories =
    mode === "all"
      ? getPurchaseHistories(2000).finally(() => {
          purchaseHistoriesMs = Date.now() - purchaseHistoriesStartedAt;
        })
      : undefined;
  const [
    localPurchaseRows,
    purchaseHistRows,
    localInventoryRows,
    purchaseExtras,
  ] = await Promise.all([
    getLocalPurchases(),
    purchaseHistories,
    getLocalInventories(),
    getAllPurchaseExtras(),
  ]);
  return {
    localPurchaseRows,
    localInventoryRows,
    purchaseExtras,
    purchaseHistRows: purchaseHistRows ?? [],
    purchaseHistoriesMs,
  };
}

/**
 * 復旧・分類・ラベル取得の後に呼び、発注が参照する在庫情報だけを再取得する。
 * 削除済み在庫も対象。DB不在・取得されなかったIDは初回取得の情報を保持する。
 */
export async function refreshPurchaseInventoryMap(
  inventoryIds: number[],
  inventoryMap: Map<number, PurchaseInventoryInfo>
): Promise<void> {
  if (inventoryIds.length === 0) return;
  const { localInventories } = await import("../../../drizzle/schema");
  const { inArray } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return;
  const rows = await db
    .select({
      id: localInventories.id,
      supplierName: localInventories.supplierName,
      supplierUrl: localInventories.supplierUrl,
      ebayListingUrl: localInventories.ebayListingUrl,
      quantity: localInventories.quantity,
    })
    .from(localInventories)
    .where(inArray(localInventories.id, inventoryIds));
  for (const [id, info] of createPurchaseInventoryMap(rows)) {
    inventoryMap.set(id, info);
  }
}
