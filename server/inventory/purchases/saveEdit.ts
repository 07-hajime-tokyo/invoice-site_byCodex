import { getDb } from "../../db";
import {
  isZaicoEnabled,
  getLocalInventoryById,
  getLocalPurchases,
  ensureInventoryItemLabels,
  type LocalPurchaseWithLabels as LocalPurchaseRow,
} from "../db";
import { getInventory, updateInventory, updatePurchase } from "../zaico";
import { normalizeCategoryName } from "../categoryName";
import { resolveOperatorToken } from "../workOperator";
import type { PurchaseEditInput } from "./saveInput";
import type { PurchaseSnapshotRecorder } from "./snapshotContract";
export async function savePurchaseEdit(
  input: PurchaseEditInput,
  deps: {
    recordSnapshot: PurchaseSnapshotRecorder;
    getOperatorName: () => string | null;
  }
) {
  const zaicoEnabled = await isZaicoEnabled();
  const operatorToken = resolveOperatorToken(input.operatorKey);

  if (!zaicoEnabled) {
    // Zaico連携OFF: ローカルDBを直接更新
    const { localPurchases: lpTbl, localInventories: liTbl } = await import(
      "../../../drizzle/schema"
    );
    const { eq, or } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    // purchaseIdはlocal_purchases.idまたは同期元のzaicoIdとして渡る。
    const [lp] = await db
      .select()
      .from(lpTbl)
      .where(
        or(eq(lpTbl.id, input.purchaseId), eq(lpTbl.zaicoId, input.purchaseId))
      )
      .limit(1);
    if (lp) {
      // purchaseItemsの先頭要素からunitPrice・etcを取得
      const firstItem = input.purchaseItems?.[0];
      const firstInventoryId = firstItem?.inventoryId ?? lp.localInventoryId;
      const snapshotInventory = firstInventoryId
        ? await getLocalInventoryById(firstInventoryId)
        : null;
      const snapshotPurchase =
        (await getLocalPurchases().catch(() => [] as LocalPurchaseRow[])).find(
          row => row.id === lp.id
        ) ?? lp;
      await deps.recordSnapshot({
        inventory: snapshotInventory ?? null,
        purchases: [snapshotPurchase],
        source: "purchase",
        reason: "入庫管理編集前",
        operatorName: deps.getOperatorName(),
      });
      const lpUpdateData: Partial<typeof lpTbl.$inferInsert> = {};
      if (firstInventoryId && lp.localInventoryId !== firstInventoryId) {
        lpUpdateData.localInventoryId = firstInventoryId;
      }
      let itemsJsonCache: Array<Record<string, unknown>> | null = null;
      const updateFirstItemJson = (changes: Record<string, unknown>) => {
        try {
          if (!itemsJsonCache) {
            const parsed = JSON.parse(lp.itemsJson ?? "[]");
            itemsJsonCache = Array.isArray(parsed)
              ? (parsed as Array<Record<string, unknown>>)
              : [];
          }
          if (itemsJsonCache.length > 0) {
            itemsJsonCache[0] = { ...itemsJsonCache[0], ...changes };
            lpUpdateData.itemsJson = JSON.stringify(itemsJsonCache);
          }
        } catch {
          // Snapshot updates are best-effort.
        }
      };
      if (firstItem?.unitPrice !== undefined) {
        // decimal型は数値をそのまま渡せる
        const unitPrice = String(firstItem.unitPrice);
        (lpUpdateData as Record<string, unknown>).unitPrice = unitPrice;
        updateFirstItemJson({ unit_price: unitPrice, unitPrice });
        // local_inventoriesの単価も更新
        if (firstInventoryId) {
          await db
            .update(liTbl)
            .set({ unitPrice })
            .where(eq(liTbl.id, firstInventoryId));
        }
      }
      if (firstItem?.quantity !== undefined) {
        const quantity = Math.max(
          1,
          Math.round(Number(firstItem.quantity) || 1)
        );
        lpUpdateData.quantity = quantity;
        updateFirstItemJson({ quantity: String(quantity) });
      }
      if (firstItem?.title !== undefined) {
        const nextTitle = firstItem.title.trim();
        (lpUpdateData as Record<string, unknown>).title = nextTitle;
        updateFirstItemJson({ title: nextTitle });
        if (firstInventoryId) {
          await db
            .update(liTbl)
            .set({ title: nextTitle })
            .where(eq(liTbl.id, firstInventoryId));
        }
      }
      if (firstItem?.etc !== undefined) {
        const nextManagementNo =
          firstItem.etc.split(",")[0]?.trim() ?? lp.managementNo ?? undefined;
        lpUpdateData.managementNo = nextManagementNo;
        updateFirstItemJson({ etc: firstItem.etc });
        if (firstInventoryId) {
          await db
            .update(liTbl)
            .set({ etc: firstItem.etc || nextManagementNo || null })
            .where(eq(liTbl.id, firstInventoryId));
        }
      }
      if (firstItem?.category !== undefined) {
        const nextCategory = normalizeCategoryName(firstItem.category) || null;
        (lpUpdateData as Record<string, unknown>).category = nextCategory;
        updateFirstItemJson({ category: nextCategory });
        if (firstInventoryId) {
          await db
            .update(liTbl)
            .set({ category: nextCategory })
            .where(eq(liTbl.id, firstInventoryId));
        }
      }
      if (Object.keys(lpUpdateData).length > 0) {
        await db.update(lpTbl).set(lpUpdateData).where(eq(lpTbl.id, lp.id));
      }
      if (firstItem) {
        const nextManagementNo =
          firstItem.etc !== undefined
            ? firstItem.etc.split(",")[0]?.trim() || null
            : (lp.managementNo ?? null);
        await ensureInventoryItemLabels({
          purchaseId: lp.id,
          localInventoryId: firstInventoryId ?? null,
          legacyManagementNo: nextManagementNo,
          title: firstItem.title?.trim() || lp.title || "",
          quantity: Math.max(
            1,
            Math.round(Number(firstItem.quantity ?? lp.quantity ?? 1) || 1)
          ),
          status: lp.status === "purchased" ? "received" : "ordered",
          sourceKey: nextManagementNo ? `management:${nextManagementNo}` : null,
        });
      }
    }
    return { success: true };
  }

  const payload: Parameters<typeof updatePurchase>[1] = {};
  if (input.customerName !== undefined)
    payload.customer_name = input.customerName;
  if (input.estimatedPurchaseDate !== undefined)
    payload.estimated_purchase_date = input.estimatedPurchaseDate;
  if (input.memo !== undefined) payload.memo = input.memo;
  if (input.purchaseItems) {
    const invalidItem = input.purchaseItems.find(
      item => !item.id || item.id <= 0
    );
    if (invalidItem) {
      throw new Error("Zaico連携ONでは発注明細IDが必要です");
    }
    payload.purchase_items = input.purchaseItems.map(item => ({
      id: item.id!,
      inventory_id: item.inventoryId,
      ...(item.unitPrice !== undefined && { unit_price: item.unitPrice }),
      ...(item.quantity !== undefined && { quantity: item.quantity }),
      ...(item.estimatedPurchaseDate !== undefined && {
        estimated_purchase_date: item.estimatedPurchaseDate,
      }),
      ...(item.etc !== undefined && { etc: item.etc }),
    }));
  }
  await updatePurchase(input.purchaseId, payload, operatorToken);
  if (input.purchaseItems) {
    const itemsWithInventoryChanges = input.purchaseItems.filter(
      item =>
        item.title !== undefined ||
        item.unitPrice !== undefined ||
        item.category !== undefined ||
        item.etc !== undefined
    );
    await Promise.all(
      itemsWithInventoryChanges.map(async item => {
        try {
          const inv = await getInventory(item.inventoryId);
          await updateInventory(
            item.inventoryId,
            {
              title: item.title ?? inv.title,
              quantity: String(inv.quantity ?? 0),
              unit: inv.unit ?? undefined,
              category:
                item.category !== undefined
                  ? normalizeCategoryName(item.category) || undefined
                  : (inv.categories?.[0] ?? inv.category ?? undefined),
              place: inv.place ?? undefined,
              etc: item.etc !== undefined ? item.etc : (inv.etc ?? undefined),
              purchase_unit_price:
                item.unitPrice ?? inv.purchase_unit_price ?? undefined,
            },
            operatorToken
          );
        } catch {
          // 在庫同期の失敗はログのみ（発注更新自体は成功している）
        }
      })
    );
  }
  return { success: true };
}
