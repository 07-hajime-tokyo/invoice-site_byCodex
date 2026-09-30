import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ADMIN_EMAILS } from "@shared/const";
import { normalizeEbayOrderStatus } from "@shared/ebayInventory";
import { protectedProcedure, router } from "../_core/trpc";
import { recordInventoryChange } from "./changeLog";
import {
  ensureInventoryItemLabels,
  ensureInventoryItemLabelsForInventory,
  getAllInventoryMemos,
  getDeletedInventories,
  getInventoryMemos,
  getLocalInventories,
  getLocalInventoryById,
  removeDeletedInventory,
  updateLocalInventory,
  upsertLocalInventory,
} from "./db";
import {
  fullRestoreSnapshotHaystack,
  parseFullRestoreSnapshotMemo,
  restoreInventoryFromFullSnapshot,
  restoreLabelsFromFullSnapshot,
  restorePurchasesFromFullSnapshot,
  uniqueFullRestoreLabels,
} from "./fullRestoreSnapshot";
import { inventoryInitialLabelStatus, inventoryLabelQuantity } from "./labelQuantity";
import { getInventoryManagementNo } from "./managementNo";
import {
  INVENTORY_RESTORE_FIELDS,
  type InventoryRestoreField,
  normalizeRestoreSearchText,
  parseInventoryRestoreMemo,
  parsedRestoreFieldsForMemo,
  restoreSearchDeletedHaystack,
  restoreSearchInventoryHaystack,
} from "./restoreFields";

type LocalInventoryRow = Awaited<ReturnType<typeof getLocalInventories>>[number];

export const restoreManagementRouter = router({
    search: protectedProcedure
      .input(z.object({
        query: z.string().max(200).optional(),
        limit: z.number().int().positive().max(200).default(80),
      }))
      .query(async ({ input, ctx }) => {
        if (!ADMIN_EMAILS.includes(ctx.user.email ?? "")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "復元管理は管理者のみ利用できます" });
        }

        const q = normalizeRestoreSearchText(input.query);
        const [inventories, deletedItems, memos] = await Promise.all([
          getLocalInventories(true),
          getDeletedInventories(500),
          getAllInventoryMemos(1000),
        ]);

        const inventoryByMemoId = new Map<number, LocalInventoryRow>();
        const inventorySummaries = inventories
          .filter((inventory) => !q || restoreSearchInventoryHaystack(inventory).includes(q))
          .slice(0, input.limit)
          .map((inventory) => {
            const memoInventoryId = inventory.zaicoId ?? inventory.id;
            inventoryByMemoId.set(memoInventoryId, inventory);
            return {
              id: inventory.id,
              zaicoId: inventory.zaicoId,
              memoInventoryId,
              title: inventory.title,
              category: inventory.category,
              quantity: inventory.quantity,
              unit: inventory.unit,
              unitPrice: inventory.unitPrice == null ? null : String(inventory.unitPrice),
              etc: inventory.etc,
              managementNo: getInventoryManagementNo(inventory.etc),
              supplierName: inventory.supplierName,
              supplierUrl: inventory.supplierUrl,
              isDeleted: Number(inventory.isDeleted ?? 0) === 1,
              itemLabels: (inventory.itemLabels ?? []).map((label) => ({
                labelId: label.labelId,
                status: label.status ?? null,
                legacyManagementNo: label.legacyManagementNo ?? null,
              })),
              updatedAt: inventory.updatedAt,
            };
          });

        for (const inventory of inventories) {
          inventoryByMemoId.set(inventory.zaicoId ?? inventory.id, inventory);
        }

        const deletedSummaries = deletedItems
          .filter((item) => !q || restoreSearchDeletedHaystack(item).includes(q))
          .slice(0, input.limit)
          .map((item) => ({
            id: item.id,
            zaicoId: item.zaicoId,
            title: item.title,
            category: item.category,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            etc: item.etc,
            managementNo: getInventoryManagementNo(item.etc),
            deletedBy: item.deletedBy,
            createdAt: item.createdAt,
          }));

        const matchedInventoryIds = new Set(inventorySummaries.map((inventory) => inventory.memoInventoryId));
        const fullSnapshotSummaries = memos
          .map((memo) => {
            const snapshot = parseFullRestoreSnapshotMemo(memo.memo);
            if (!snapshot) return null;
            const inventory = snapshot.inventory;
            const managementNo = inventory
              ? getInventoryManagementNo(inventory.etc)
              : getInventoryManagementNo(snapshot.purchases[0]?.managementNo);
            return {
              id: memo.id,
              zaicoInventoryId: memo.zaicoInventoryId,
              title: String(inventory?.title ?? snapshot.purchases[0]?.title ?? memo.title ?? ""),
              managementNo,
              source: snapshot.source,
              reason: snapshot.reason,
              capturedAt: snapshot.capturedAt,
              createdAt: memo.createdAt,
              inventoryLocalId: inventory?.id ?? null,
              hasInventory: Boolean(inventory),
              purchaseCount: snapshot.purchases.length,
              labelCount: uniqueFullRestoreLabels(snapshot).length,
              canRestore: Boolean(inventory || snapshot.purchases.length > 0),
              _matches: !q || fullRestoreSnapshotHaystack(memo, snapshot).includes(q),
            };
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row?._matches))
          .slice(0, input.limit)
          .map(({ _matches, ...row }) => row);

        const historySummaries = memos
          .filter((memo) => !parseFullRestoreSnapshotMemo(memo.memo))
          .map((memo) => {
            const inventory = inventoryByMemoId.get(memo.zaicoInventoryId);
            const fields = parsedRestoreFieldsForMemo(memo, inventory ?? null);
            const haystack = normalizeRestoreSearchText([
              memo.id,
              memo.zaicoInventoryId,
              memo.title,
              memo.changeType,
              memo.memo,
              memo.operatorName,
              inventory?.title,
              inventory?.etc,
              inventory ? getInventoryManagementNo(inventory.etc) : null,
            ].filter(Boolean).join(" "));
            return {
              id: memo.id,
              zaicoInventoryId: memo.zaicoInventoryId,
              inventoryLocalId: inventory?.id ?? null,
              title: inventory?.title ?? memo.title ?? "",
              managementNo: inventory ? getInventoryManagementNo(inventory.etc) : "",
              changeType: memo.changeType,
              quantityBefore: memo.quantityBefore,
              quantityAfter: memo.quantityAfter,
              quantityDelta: memo.quantityDelta,
              memo: memo.memo,
              operatorName: memo.operatorName,
              createdAt: memo.createdAt,
              fields,
              canRestore: Boolean(inventory && fields.length > 0),
              _matches: !q || haystack.includes(q) || matchedInventoryIds.has(memo.zaicoInventoryId),
            };
          })
          .filter((memo) => memo._matches)
          .slice(0, input.limit)
          .map(({ _matches, ...memo }) => memo);

        return {
          inventories: inventorySummaries,
          deletedItems: deletedSummaries,
          fullSnapshots: fullSnapshotSummaries,
          histories: historySummaries,
        };
      }),

    restoreDeleted: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        if (!ADMIN_EMAILS.includes(ctx.user.email ?? "")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "復元管理は管理者のみ利用できます" });
        }

        const records = await getDeletedInventories(1000);
        const record = records.find((item) => item.id === input.id);
        if (!record) throw new Error("削除済み商品が見つかりません");
        const snapshot = JSON.parse(record.snapshotJson);
        await upsertLocalInventory({
          zaicoId: record.zaicoId ?? null,
          title: String(snapshot.title ?? record.title),
          quantity: Math.max(0, Math.round(parseFloat(String(snapshot.quantity ?? record.quantity ?? "0")) || 0)),
          unit: snapshot.unit ?? record.unit ?? "個",
          category: snapshot.category ?? record.category ?? null,
          place: snapshot.place ?? record.place ?? null,
          etc: snapshot.etc ?? record.etc ?? null,
          unitPrice: snapshot.unit_price != null ? String(snapshot.unit_price) : record.unitPrice ?? null,
          supplierUrl: snapshot.supplierUrl ?? snapshot.supplier_url ?? null,
          supplierName: snapshot.supplierName ?? snapshot.supplier_name ?? null,
          ebayListingUrl: snapshot.ebayListingUrl ?? null,
          ebayOrderUrl: snapshot.ebayOrderUrl ?? null,
          ebayOrderStatus: normalizeEbayOrderStatus(snapshot.ebayOrderStatus ?? "normal"),
          isDeleted: 0,
        });
        await removeDeletedInventory(input.id);
        return { success: true };
      }),

    restoreFullSnapshot: protectedProcedure
      .input(z.object({ memoId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        if (!ADMIN_EMAILS.includes(ctx.user.email ?? "")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "復元管理は管理者のみ利用できます" });
        }

        const memo = (await getAllInventoryMemos(2000)).find((row) => row.id === input.memoId);
        if (!memo) throw new Error("完全復元スナップショットが見つかりません");
        const snapshot = parseFullRestoreSnapshotMemo(memo.memo);
        if (!snapshot) throw new Error("この履歴は完全復元スナップショットではありません");

        const previousInventoryId = snapshot.inventory?.id == null ? null : Number(snapshot.inventory.id);
        const restoredInventoryId = await restoreInventoryFromFullSnapshot(snapshot.inventory);
        const purchaseIdMap = await restorePurchasesFromFullSnapshot(
          snapshot.purchases,
          previousInventoryId,
          restoredInventoryId,
        );
        const labelCount = await restoreLabelsFromFullSnapshot(
          snapshot,
          previousInventoryId,
          restoredInventoryId,
          purchaseIdMap,
        );

        if (labelCount === 0 && restoredInventoryId != null && snapshot.inventory) {
          await ensureInventoryItemLabelsForInventory({
            localInventoryId: restoredInventoryId,
            legacyManagementNo: getInventoryManagementNo(snapshot.inventory.etc),
            title: String(snapshot.inventory.title ?? ""),
            quantity: inventoryLabelQuantity(snapshot.inventory.quantity),
            status: inventoryInitialLabelStatus(snapshot.inventory.quantity),
            sourceKey: `inventory:${restoredInventoryId}`,
          }).catch(() => {});
        }
        if (labelCount === 0) {
          for (const purchase of snapshot.purchases) {
            const snapshotPurchaseId = Number(purchase.id ?? 0);
            const restoredPurchaseId = snapshotPurchaseId > 0 ? purchaseIdMap.get(snapshotPurchaseId) ?? snapshotPurchaseId : null;
            if (!restoredPurchaseId) continue;
            await ensureInventoryItemLabels({
              purchaseId: restoredPurchaseId,
              localInventoryId: purchase.localInventoryId == null ? restoredInventoryId : Number(purchase.localInventoryId),
              legacyManagementNo: getInventoryManagementNo(purchase.managementNo),
              title: String(purchase.title ?? snapshot.inventory?.title ?? ""),
              quantity: Math.max(1, Math.round(Number(purchase.quantity) || 1)),
              status: purchase.status === "purchased" ? "received" : "ordered",
              sourceKey: purchase.managementNo ? `management:${getInventoryManagementNo(purchase.managementNo)}` : null,
            }).catch(() => {});
          }
        }

        await recordInventoryChange({
          inventoryId: restoredInventoryId ?? memo.zaicoInventoryId,
          title: String(snapshot.inventory?.title ?? snapshot.purchases[0]?.title ?? memo.title ?? "完全復元"),
          changeType: "updated",
          source: "ui",
          note: `復元管理から完全復元スナップショット #${memo.id} を復元（入庫管理 ${snapshot.purchases.length}件 / 商品ID ${labelCount}件）`,
          operatorName: ctx.user.name ?? ctx.user.email ?? null,
        });

        return {
          success: true,
          restoredInventoryId,
          purchaseCount: snapshot.purchases.length,
          labelCount,
        };
      }),

    restoreFromHistory: protectedProcedure
      .input(z.object({
        localInventoryId: z.number().int().positive(),
        memoId: z.number().int().positive(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ADMIN_EMAILS.includes(ctx.user.email ?? "")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "復元管理は管理者のみ利用できます" });
        }

        const inventory = await getLocalInventoryById(input.localInventoryId);
        if (!inventory) throw new Error("復元対象の商品が見つかりません");
        const memoInventoryId = inventory.zaicoId ?? inventory.id;
        const memo = (await getInventoryMemos(memoInventoryId, 200)).find((row) => row.id === input.memoId);
        if (!memo) throw new Error("対象の変更履歴が見つかりません");

        const restored = parseInventoryRestoreMemo(memo.memo);
        const fields = (Object.keys(restored) as InventoryRestoreField[]).filter((field) =>
          INVENTORY_RESTORE_FIELDS.includes(field)
        );
        if (fields.length === 0) throw new Error("この履歴には復元できる変更前データがありません");

        const nextValues = {
          title: restored.title ?? inventory.title,
          quantity: restored.quantity == null
            ? inventory.quantity
            : Math.max(0, Math.round(Number(restored.quantity) || 0)),
          unit: restored.unit ?? inventory.unit,
          category: restored.category ?? inventory.category,
          place: restored.place ?? inventory.place,
          etc: restored.etc ?? inventory.etc,
          unitPrice: restored.unitPrice ?? inventory.unitPrice,
          supplierName: restored.supplierName ?? inventory.supplierName,
          supplierUrl: restored.supplierUrl ?? inventory.supplierUrl,
          ebayListingUrl: restored.ebayListingUrl ?? inventory.ebayListingUrl,
          ebayOrderUrl: restored.ebayOrderUrl ?? inventory.ebayOrderUrl,
          ebayOrderStatus: normalizeEbayOrderStatus(restored.ebayOrderStatus ?? inventory.ebayOrderStatus),
        };

        await updateLocalInventory(inventory.id, nextValues);
        await ensureInventoryItemLabelsForInventory({
          localInventoryId: inventory.id,
          legacyManagementNo: getInventoryManagementNo(nextValues.etc),
          title: nextValues.title,
          quantity: inventoryLabelQuantity(nextValues.quantity),
          status: inventoryInitialLabelStatus(nextValues.quantity),
          sourceKey: `inventory:${inventory.id}`,
        });
        await recordInventoryChange({
          inventoryId: memoInventoryId,
          title: nextValues.title,
          changeType: "updated",
          source: "ui",
          quantityBefore: inventory.quantity,
          quantityAfter: nextValues.quantity,
          note: `復元管理から変更履歴 #${memo.id} の変更前に復元`,
          operatorName: ctx.user.name ?? ctx.user.email ?? null,
        });

        return { success: true };
      }),
});
