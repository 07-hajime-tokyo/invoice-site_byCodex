import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createDeletedInventory,
  deleteLocalInventory,
  getDeletedInventories,
  getLocalInventoryByZaicoIdOrId,
  removeDeletedInventory,
  upsertLocalInventory,
} from "./db";
import { resolveOperatorToken } from "./workOperator";
import { createInventory } from "./zaico";

export const deletedItemsRouter = router({
    // 削除済み商品一覧取得
    list: protectedProcedure.query(async () => {
      return getDeletedInventories();
    }),
    // 在庫商品を削除してDBに保存
    deleteAndRecord: protectedProcedure
      .input(z.object({
        zaicoId: z.number(),
        title: z.string(),
        category: z.string().optional(),
        place: z.string().optional(),
        quantity: z.string().optional(),
        unit: z.string().optional(),
        unitPrice: z.string().optional(),
        etc: z.string().optional(),
        snapshotJson: z.string(),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
        deletedBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const token = resolveOperatorToken(input.operatorKey);
        // Zaicoから削除
        const localInv = await getLocalInventoryByZaicoIdOrId(input.zaicoId);
        if (localInv) {
          await deleteLocalInventory(localInv.id);
        }
        // DBに履歴を保存
        await createDeletedInventory({
          zaicoId: input.zaicoId,
          title: input.title,
          category: input.category ?? null,
          place: input.place ?? null,
          quantity: input.quantity ?? null,
          unit: input.unit ?? null,
          unitPrice: input.unitPrice ?? null,
          etc: input.etc ?? null,
          snapshotJson: input.snapshotJson,
          deletedBy: input.deletedBy ?? null,
        });
        return { success: true };
      }),
    // 削除済み商品を復元（Zaicoに再登録）
    restore: protectedProcedure
      .input(z.object({
        id: z.number(),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const records = await getDeletedInventories(1000);
        const record = records.find(r => r.id === input.id);
        if (!record) throw new Error("削除済み商品が見つかりません");
        const snapshot = JSON.parse(record.snapshotJson);
        await upsertLocalInventory({
          zaicoId: record.zaicoId ?? null,
          title: String(snapshot.title ?? record.title),
          quantity: Math.round(parseFloat(String(snapshot.quantity ?? record.quantity ?? "0")) || 0),
          unit: snapshot.unit ?? record.unit ?? "個",
          category: snapshot.category ?? record.category ?? null,
          place: snapshot.place ?? record.place ?? null,
          etc: snapshot.etc ?? record.etc ?? null,
          unitPrice: snapshot.unit_price != null ? String(snapshot.unit_price) : record.unitPrice ?? null,
          supplierUrl: null,
          supplierName: null,
          isDeleted: 0,
        });
        await removeDeletedInventory(input.id);
        return { success: true };
        const token = resolveOperatorToken(input.operatorKey);
        // Zaicoに再登録
        await createInventory({
          title: snapshot.title,
          quantity: snapshot.quantity ? String(snapshot.quantity) : "0",
          unit: snapshot.unit,
          category: snapshot.category,
          place: snapshot.place,
          etc: snapshot.etc,
          purchase_unit_price: snapshot.unit_price != null ? parseFloat(snapshot.unit_price) : undefined,
        }, token);
        // DBから削除済みレコードを削除
        await removeDeletedInventory(input.id);
        return { success: true };
      }),
    // DBから削除済みレコードを永久削除
    permanentDelete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await removeDeletedInventory(input.id);
        return { success: true };
    }),
});
