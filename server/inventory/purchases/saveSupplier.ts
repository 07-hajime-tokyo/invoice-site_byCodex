import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  isZaicoEnabled,
  getLocalInventoryByZaicoIdOrId,
  updateLocalInventory,
  getLocalPurchases,
  getInventoryExtraByZaicoId,
  upsertInventoryExtra,
} from "../db";
import type { PurchaseSupplierInput } from "./saveInput";
export async function savePurchaseSupplier(input: PurchaseSupplierInput) {
  const zaicoEnabled = await isZaicoEnabled();
  const normalizedSupplierUrl = (() => {
    const value = input.supplierUrl?.trim();
    if (!value) return null;
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  })();
  if (!zaicoEnabled) {
    const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
    if (localInv) {
      await updateLocalInventory(localInv.id, {
        supplierName: input.supplierName,
        supplierUrl: normalizedSupplierUrl,
      });
    }
    const db = await getDb();
    if (db) {
      const { localPurchases: lpTbl } = await import("../../../drizzle/schema");
      const purchaseRows = await getLocalPurchases();
      const targets = purchaseRows.filter(p => {
        if (
          input.purchaseId &&
          (p.id === input.purchaseId || p.zaicoId === input.purchaseId)
        )
          return true;
        if (localInv?.id && p.localInventoryId === localInv.id) return true;
        try {
          const items = JSON.parse(p.itemsJson ?? "[]");
          return (
            Array.isArray(items) &&
            items.some(
              item =>
                Number(item.inventory_id ?? item.inventoryId) ===
                input.inventoryId
            )
          );
        } catch {
          return false;
        }
      });
      await Promise.all(
        targets.map(p =>
          db
            .update(lpTbl)
            .set({
              supplierName: input.supplierName,
              supplierUrl: normalizedSupplierUrl,
            })
            .where(eq(lpTbl.id, p.id))
        )
      );
    }
  } else {
    const existing = await getInventoryExtraByZaicoId(input.inventoryId);
    await upsertInventoryExtra({
      zaicoInventoryId: input.inventoryId,
      supplierName: input.supplierName,
      supplierUrl: normalizedSupplierUrl ?? existing?.supplierUrl ?? null,
    }).catch(() => {});
  }
  return { success: true };
}
