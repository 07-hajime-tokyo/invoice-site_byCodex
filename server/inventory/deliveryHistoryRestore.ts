import { eq, isNotNull } from "drizzle-orm";
import { deliveryHistories } from "../../drizzle/schema";
import { getDb } from "./db";

export async function restoreDeliveryItemsForInventory(inventoryIds: Array<number | null | undefined>): Promise<number> {
  const restoredIds = new Set(inventoryIds.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0));
  if (restoredIds.size === 0) return 0;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    // Lock histories so a concurrent delete cannot be lost during restoration.
    const histories = await tx
      .select({ id: deliveryHistories.id, deletedInventoryIdsJson: deliveryHistories.deletedInventoryIdsJson })
      .from(deliveryHistories)
      .where(isNotNull(deliveryHistories.deletedInventoryIdsJson))
      .for("update");
    let updated = 0;
    for (const history of histories) {
      let deletedIds: unknown;
      try {
        deletedIds = JSON.parse(history.deletedInventoryIdsJson ?? "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(deletedIds)) continue;
      const next = deletedIds.filter((id) => !restoredIds.has(Number(id)));
      if (next.length === deletedIds.length) continue;
      await tx.update(deliveryHistories)
        .set({ deletedInventoryIdsJson: next.length > 0 ? JSON.stringify(next) : null })
        .where(eq(deliveryHistories.id, history.id));
      updated += 1;
    }
    return updated;
  });
}
