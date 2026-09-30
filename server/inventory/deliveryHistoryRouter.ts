import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createDeletedInventory,
  createDeliveryHistory,
  deleteDeliveryHistoryById,
  deleteLocalInventory,
  getDeliveryHistories,
  getDeliveryHistoriesByDeliveryNo,
  getDeliveryHistoriesByInvoicePrefix,
  getDeliveryHistoryById,
  getFedexShipmentsByDeliveryNo,
  getFedexShipmentsByHistoryId,
  getLocalInventoryByZaicoIdOrId,
  isZaicoEnabled,
  markDeliveryItemsDeleted,
  updateDeliveryCancelledItems,
  updateDeliveryHistoryItemsJson,
  updateDeliveryNo,
  updateFedexShipmentHistoryAndDeliveryNo,
  updateFedexShipmentStatus,
  updateLocalInventory,
} from "./db";
import { invoiceNoFromDeliveryNo } from "./deliveryInvoiceAttribution";
import { resolveOperatorToken } from "./workOperator";
import {
  deleteDelivery,
  deleteInventory,
  getInventory,
  updateDeliveryNum,
  updateInventory,
} from "./zaico";

const publicProcedure = protectedProcedure;

export const deliveryHistoryRouter = router({
    list: publicProcedure
      .input(z.object({ limit: z.number().int().positive().max(500).default(100) }))
      .query(async ({ input }) => {
        const histories = await getDeliveryHistories(input.limit);
        return histories.map((h) => ({
          ...h,
          items: JSON.parse(h.itemsJson) as Array<{
            inventoryId: number;
            title: string;
            quantity: number;
          }>,
          deletedInventoryIds: h.deletedInventoryIdsJson
            ? (JSON.parse(h.deletedInventoryIdsJson) as number[])
            : [],
          cancelledItems: h.cancelledItemsJson
            ? (JSON.parse(h.cancelledItemsJson) as Array<{ inventoryId: number; quantity: number; cancelledAt: string }>)
            : [],
        }));
      }),
    listByInvoicePrefix: publicProcedure
      .input(z.object({ invoiceNo: z.string().min(1) }))
      .query(async ({ input }) => {
        const histories = await getDeliveryHistoriesByInvoicePrefix(input.invoiceNo);
        return histories.map((h) => ({
          ...h,
          items: JSON.parse(h.itemsJson) as Array<{
            inventoryId: number;
            title: string;
            quantity: number;
          }>,
        }));
      }),
    markDeleted: publicProcedure
      .input(z.object({
        historyId: z.number().int().positive(),
        deletedIds: z.array(z.number().int()),
      }))
      .mutation(async ({ input }) => {
        await markDeliveryItemsDeleted(input.historyId, input.deletedIds);
        return { ok: true };
      }),
    updateDeliveryNo: publicProcedure
      .input(z.object({
        historyId: z.number().int().positive(),
        zaicoDeliveryId: z.number().int().positive().nullable(),
        deliveryNo: z.string(),
      }))
      .mutation(async ({ input }) => {
        // DBの出庫Noを更新
        await updateDeliveryNo(input.historyId, input.deliveryNo);
        // Zaico APIにも反映（zaicoDeliveryIdがある場合のみ）
        if ((await isZaicoEnabled()) && input.zaicoDeliveryId) {
          await updateDeliveryNum(input.zaicoDeliveryId, input.deliveryNo);
        }
        return { ok: true };
      }),
    /**
     * 出庫Noを一括更新する（複数履歴をまとめて変更）
     */
    bulkUpdateDeliveryNo: publicProcedure
      .input(z.object({
        historyIds: z.array(z.number().int().positive()).min(1),
        deliveryNo: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        for (const historyId of input.historyIds) {
          await updateDeliveryNo(historyId, input.deliveryNo);
        }
        return { ok: true, updatedCount: input.historyIds.length };
      }),
    /**
     * 商品単位で出庫Noを変更する
     * 指定した出庫履歴から商品（inventoryIdで指定）を分離し、新しい出庫Noの出庫履歴を新規作成する
     * - 元の出庫履歴から対象商品を除去（残りの商品が0になれば元履歴も削除）
     * - 新しい出庫Noで新規出庫履歴を作成（zaicoDeliveryIdは新規登録なし、status=success）
     */
    moveItemsToDeliveryNo: publicProcedure
      .input(z.object({
        historyId: z.number().int().positive(),
        inventoryIds: z.array(z.number().int().positive()).min(1),
        newDeliveryNo: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        // 元の出庫履歴を取得
        const history = await getDeliveryHistoryById(input.historyId);
        if (!history) throw new Error("出庫履歴が見つかりません");

        const allItems: Array<{ inventoryId: number; title: string; quantity: number }> =
          JSON.parse(history.itemsJson);

        // 対象商品と残りの商品に分割
        const moveSet = new Set(input.inventoryIds);
        const movedItems = allItems.filter((item) => moveSet.has(item.inventoryId));
        const remainingItems = allItems.filter((item) => !moveSet.has(item.inventoryId));

        if (movedItems.length === 0) throw new Error("対象商品が見つかりません");

        // 元の出庫履歴を更新（残りの商品が0なら履歴を削除、それ以外はitemsJsonを更新）
        if (remainingItems.length === 0) {
          await deleteDeliveryHistoryById(input.historyId);
        } else {
          await updateDeliveryHistoryItemsJson(input.historyId, JSON.stringify(remainingItems));
        }

        // 移動先の出庫Noに既存の出庫履歴があればマージ、なければ新規作成
        const existingHistories = await getDeliveryHistoriesByDeliveryNo(input.newDeliveryNo);
        let targetHistoryId: number | null = null;
        if (existingHistories.length > 0) {
          // 既存行にマージ（同じinventoryIdがあれば数量を加算）
          const existHistory = existingHistories[0];
          const existItems: Array<{ inventoryId: number; title: string; quantity: number }> =
            JSON.parse(existHistory.itemsJson);
          const mergedMap = new Map<number, { inventoryId: number; title: string; quantity: number }>();
          for (const item of existItems) mergedMap.set(item.inventoryId, { ...item });
          for (const item of movedItems) {
            if (mergedMap.has(item.inventoryId)) mergedMap.get(item.inventoryId)!.quantity += item.quantity;
            else mergedMap.set(item.inventoryId, { ...item });
          }
          await updateDeliveryHistoryItemsJson(existHistory.id, JSON.stringify(Array.from(mergedMap.values())));
          targetHistoryId = existHistory.id;
        } else {
          // 新規作成
          await createDeliveryHistory({
            deliveryNo: input.newDeliveryNo,
            zaicoDeliveryId: null,
            itemsJson: JSON.stringify(movedItems),
            status: "success",
            errorMessage: null,
            deletedInventoryIdsJson: null,
            cancelledItemsJson: null,
          });
          // 新規作成した履歴のIDを取得
          const newHistories = await getDeliveryHistoriesByDeliveryNo(input.newDeliveryNo);
          targetHistoryId = newHistories[0]?.id ?? null;
        }

        // 追跡番号引き継ぎ: 移動元historyIdに紐付くfedex_shipmentsを移動先historyIdに更新
        if (targetHistoryId !== null) {
          const srcFedexByHistory = await getFedexShipmentsByHistoryId(input.historyId);
          for (const shipment of srcFedexByHistory) {
            await updateFedexShipmentHistoryAndDeliveryNo(shipment.id, targetHistoryId, input.newDeliveryNo);
          }
        }

        // GAS自動反映: 元の出庫Noと移動先の出庫Noに紐付くfedex_shipmentsを更新
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
        const gasResults: Array<{ trackingNumber: string; success: boolean; message?: string }> = [];

        if (gasUrl) {
          // 元出庫Noに紐付くfedex_shipmentsを取得（historyIdまたはdeliveryNoで紐付）
          const srcShipments = await getFedexShipmentsByDeliveryNo(history.deliveryNo);
          const srcByHistoryId = history.id ? await getFedexShipmentsByHistoryId(input.historyId) : [];
          const srcAll = Array.from(new Map([...srcShipments, ...srcByHistoryId].map((s) => [s.id, s])).values());

          // 移動先出庫Noに紐付くfedex_shipmentsを取得
          const dstShipments = await getFedexShipmentsByDeliveryNo(input.newDeliveryNo);
          const dstByHistoryId = targetHistoryId ? await getFedexShipmentsByHistoryId(targetHistoryId) : [];
          const dstAll = Array.from(new Map([...dstShipments, ...dstByHistoryId].map((s) => [s.id, s])).values());

          // 各追跡番号についてスプシを再書き込み
          const allAffected = Array.from(new Map([...srcAll, ...dstAll].map((s) => [s.id, s])).values());
          const trackingGroups = new Map<string, typeof allAffected[0]>();
          for (const s of allAffected) {
            if (!trackingGroups.has(s.trackingNumber)) trackingGroups.set(s.trackingNumber, s);
          }

          for (const [trackingNumber, shipment] of Array.from(trackingGroups.entries())) {
            try {
              // 削除
              const delPayload = { secret, action: "deleteShipmentBatch", sheetName: shipment.sheetName, trackingNumber };
              const delRes = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(delPayload), redirect: "manual" });
              if (delRes.status === 302 || delRes.status === 301) { const loc = delRes.headers.get("location") ?? gasUrl; await fetch(loc, { method: "GET" }); }

              // 再書き込み（同じ追跡番号の全記録を取得して合算）
              const allSameTracking = allAffected.filter((s) => s.trackingNumber === trackingNumber);
              type GasItem = { productNameJa: string; productNameEn: string; quantity: number };
              const mergedGasMap = new Map<string, GasItem>();
              for (const s of allSameTracking) {
                let items: GasItem[] = [];
                try { items = JSON.parse(s.itemsJson); } catch { items = []; }
                for (const item of items) {
                  if (mergedGasMap.has(item.productNameJa)) mergedGasMap.get(item.productNameJa)!.quantity += item.quantity;
                  else mergedGasMap.set(item.productNameJa, { ...item });
                }
              }
              const mergedGasItems = Array.from(mergedGasMap.values());
              const invoiceNo = invoiceNoFromDeliveryNo(shipment.deliveryNo);
              const writePayload = { secret, action: "writeShipmentBatch", deliveryNo: shipment.deliveryNo, invoiceNo, sheetName: shipment.sheetName, shippingDate: shipment.shippingDate, trackingNumber, items: mergedGasItems };
              const writeRes = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(writePayload), redirect: "manual" });
              let writeText: string;
              if (writeRes.status === 302 || writeRes.status === 301) { const loc = writeRes.headers.get("location") ?? gasUrl; const r2 = await fetch(loc, { method: "GET" }); writeText = await r2.text(); }
              else { writeText = await writeRes.text(); }
              let writeResult: { success: boolean; message?: string };
              try { writeResult = JSON.parse(writeText); } catch { writeResult = { success: false, message: writeText }; }
              gasResults.push({ trackingNumber, success: writeResult.success, message: writeResult.message });
              // スプシ書き込みステータスを更新
              for (const s of allSameTracking) {
                await updateFedexShipmentStatus(s.id, writeResult.success ? "success" : "error", writeResult.success ? undefined : (writeResult.message ?? "不明なエラー"));
              }
            } catch (e) {
              gasResults.push({ trackingNumber, success: false, message: e instanceof Error ? e.message : String(e) });
            }
          }
        }

        return {
          ok: true,
          movedCount: movedItems.length,
          remainingCount: remainingItems.length,
          merged: existingHistories.length > 0,
          gasResults,
        };
      }),
    /**
     * 出庫取り消し（個別）
     * 指定した出庫履歴内の1商品分の出庫を取り消すす
     *
     * 出庫履歴に zaicoDeliveryId がある場合：
     *   - 出庫商品が1商品のみ → Zaico出庫データを削除（Zaico側で在庫数自動復元）
     *   - 出庫商品が複数 → Zaico在庫数を直接増加（出庫データ全体を削除すると他商品も取り消されるため）
     * zaicoDeliveryId がない場合： Zaico在庫数を直接増加
     */
    cancelItem: publicProcedure
      .input(z.object({
        historyId: z.number().int().positive(),
        inventoryId: z.number().int().positive(),
        quantity: z.number().int().positive(),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const operatorToken = resolveOperatorToken(input.operatorKey);

        // Step1: 出庫履歴を取得して取り消し済みかチェック
        const history = await getDeliveryHistoryById(input.historyId);
        if (!history) throw new Error("出庫履歴が見つかりません");

        const cancelledItems: Array<{ inventoryId: number; quantity: number; cancelledAt: string }> =
          history.cancelledItemsJson ? JSON.parse(history.cancelledItemsJson) : [];

        // 既に取り消し済みかチェック
        const alreadyCancelled = cancelledItems.some((c) => c.inventoryId === input.inventoryId);
        if (alreadyCancelled) throw new Error("この商品は既に取り消し済みです");

        const allItems = JSON.parse(history.itemsJson) as Array<{ inventoryId: number; title: string; quantity: number }>;
        const notCancelledItems = allItems.filter((item) =>
          !cancelledItems.some((c) => c.inventoryId === item.inventoryId)
        );
        const isSingleItem = notCancelledItems.length === 1 && notCancelledItems[0].inventoryId === input.inventoryId;

        let newQty: number | undefined;

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBの在庫数を直接増加
          const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
          if (localInv) {
            newQty = (localInv.quantity ?? 0) + input.quantity;
            await updateLocalInventory(localInv.id, { quantity: newQty });
          }
        } else if (history.zaicoDeliveryId && isSingleItem) {
          // 取り消し対象が1商品のみの場合：Zaico出庫データを削除（Zaico側で在庫数自動復元）
          await deleteDelivery(history.zaicoDeliveryId, operatorToken);
          // 復元後の在庫数を取得して返却値に使用
          const inv = await getInventory(input.inventoryId);
          newQty = Math.floor(parseFloat(inv.quantity ?? "0"));
        } else {
          // 複数商品またはzaicoDeliveryIdなしの場合：在庫数を直接増加
          const inv = await getInventory(input.inventoryId);
          const currentQty = Math.floor(parseFloat(inv.quantity ?? "0"));
          newQty = currentQty + input.quantity;
          await updateInventory(
            input.inventoryId,
            {
              title: inv.title,
              quantity: String(newQty),
              unit: inv.unit,
              category: inv.categories?.[0] ?? inv.category,
              place: inv.place,
              etc: inv.etc,
            },
            operatorToken
          );
        }

        // Step4: DBの取り消し済みリストを更新
        const updatedCancelledItems = [
          ...cancelledItems,
          { inventoryId: input.inventoryId, quantity: input.quantity, cancelledAt: new Date().toISOString() },
        ];
        await updateDeliveryCancelledItems(input.historyId, updatedCancelledItems);

        return { success: true, newQuantity: newQty };
      }),

    /**
     * 出庫取り消し（一括）
     * 指定した出庫履歴内の複数商品の出庫を一括取り消しする
     *
     * 全商品を選択した場合： Zaico出庫データを削除（Zaico側で全商品の在庫数自動復元）
     * 一部商品のみ選択した場合： 各商品のZaico在庫数を直接増加
     */
    /**
     * 出庫履歴グループを一括削除
     * - 出庫No内の全商品をZaicoから削除
     * - DBの出庫履歴レコードを削除
     */
    deleteGroup: publicProcedure
      .input(z.object({
        historyId: z.number().int().positive(),
        inventoryIds: z.array(z.number().int().positive()),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const operatorToken = resolveOperatorToken(input.operatorKey);
        const results: Array<{ inventoryId: number; success: boolean; error?: string }> = [];

        if (zaicoEnabled) {
          // Zaico連携ON: 各商品をZaicoから削除
          for (const inventoryId of input.inventoryIds) {
            try {
              await deleteInventory(inventoryId, operatorToken);
              results.push({ inventoryId, success: true });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : "不明なエラー";
              results.push({ inventoryId, success: false, error: errMsg });
            }
          }
        } else {
          // Zaico連携OFF: ローカル在庫を在庫一覧から非表示にする
          for (const inventoryId of input.inventoryIds) {
            try {
              const localInv = await getLocalInventoryByZaicoIdOrId(inventoryId);
              if (localInv) {
                await createDeletedInventory({
                  zaicoId: localInv.zaicoId ?? localInv.id,
                  title: localInv.title,
                  category: localInv.category ?? undefined,
                  place: localInv.place ?? undefined,
                  quantity: localInv.quantity != null ? String(localInv.quantity) : undefined,
                  unit: localInv.unit ?? undefined,
                  unitPrice: localInv.unitPrice ?? undefined,
                  etc: localInv.etc ?? undefined,
                  snapshotJson: JSON.stringify(localInv),
                }).catch(() => {});
                await deleteLocalInventory(localInv.id);
              }
              results.push({ inventoryId, success: true });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : "不明なエラー";
              results.push({ inventoryId, success: false, error: errMsg });
            }
          }
        }

        // 全商品をdeletedInventoryIdsに記録（取り消し線表示のためDBレコードは削除せず残す）
        const history = await getDeliveryHistoryById(input.historyId);
        if (history) {
          const currentDeleted = history.deletedInventoryIdsJson
            ? (JSON.parse(history.deletedInventoryIdsJson as string) as number[])
            : [];
          const newDeleted = Array.from(new Set([...currentDeleted, ...input.inventoryIds]));
          await markDeliveryItemsDeleted(input.historyId, newDeleted);
        }

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;
        return { ok: true, successCount, failCount, results };
      }),

    cancelItems: publicProcedure
      .input(z.object({
        historyId: z.number().int().positive(),
        items: z.array(z.object({
          inventoryId: z.number().int().positive(),
          quantity: z.number().int().positive(),
        })).min(1),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const operatorToken = resolveOperatorToken(input.operatorKey);

        // Step1: 出庫履歴を取得して取り消し済みかチェック
        const history = await getDeliveryHistoryById(input.historyId);
        if (!history) throw new Error("出庫履歴が見つかりません");

        const cancelledItems: Array<{ inventoryId: number; quantity: number; cancelledAt: string }> =
          history.cancelledItemsJson ? JSON.parse(history.cancelledItemsJson) : [];

        const cancelledIds = new Set(cancelledItems.map((c) => c.inventoryId));

        // 取り消し対象のフィルタリング（既に取り消し済みは除外）
        const targetItems = input.items.filter((item) => !cancelledIds.has(item.inventoryId));
        if (targetItems.length === 0) throw new Error("選択した商品はすべて既に取り消し済みです");

        const allItems = JSON.parse(history.itemsJson) as Array<{ inventoryId: number; title: string; quantity: number }>;
        const notCancelledItems = allItems.filter((item) => !cancelledIds.has(item.inventoryId));
        const targetIds = new Set(targetItems.map((i) => i.inventoryId));
        const isCancellingAll = notCancelledItems.every((item) => targetIds.has(item.inventoryId));

        const results: Array<{ inventoryId: number; success: boolean; error?: string }> = [];
        const newCancelledItems = [...cancelledItems];

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBの在庫数を直接増加
          for (const item of targetItems) {
            try {
              const localInv = await getLocalInventoryByZaicoIdOrId(item.inventoryId);
              if (localInv) {
                const newQty = (localInv.quantity ?? 0) + item.quantity;
                await updateLocalInventory(localInv.id, { quantity: newQty });
              }
              newCancelledItems.push({
                inventoryId: item.inventoryId,
                quantity: item.quantity,
                cancelledAt: new Date().toISOString(),
              });
              results.push({ inventoryId: item.inventoryId, success: true });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : "不明なエラー";
              results.push({ inventoryId: item.inventoryId, success: false, error: errMsg });
            }
          }
        } else if (history.zaicoDeliveryId && isCancellingAll) {
          // 全商品取り消し：Zaico出庫データを削除（Zaico側で在庫数自動復元）
          try {
            await deleteDelivery(history.zaicoDeliveryId, operatorToken);
            for (const item of targetItems) {
              newCancelledItems.push({
                inventoryId: item.inventoryId,
                quantity: item.quantity,
                cancelledAt: new Date().toISOString(),
              });
              results.push({ inventoryId: item.inventoryId, success: true });
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "不明なエラー";
            for (const item of targetItems) {
              results.push({ inventoryId: item.inventoryId, success: false, error: errMsg });
            }
          }
        } else {
          // 一部商品のみ取り消し：各商品のZaico在庫数を直接増加
          for (const item of targetItems) {
            try {
              const inv = await getInventory(item.inventoryId);
              const currentQty = Math.floor(parseFloat(inv.quantity ?? "0"));
              const newQty = currentQty + item.quantity;

              await updateInventory(
                item.inventoryId,
                {
                  title: inv.title,
                  quantity: String(newQty),
                  unit: inv.unit,
                  category: inv.categories?.[0] ?? inv.category,
                  place: inv.place,
                  etc: inv.etc,
                },
                operatorToken
              );

              newCancelledItems.push({
                inventoryId: item.inventoryId,
                quantity: item.quantity,
                cancelledAt: new Date().toISOString(),
              });
              results.push({ inventoryId: item.inventoryId, success: true });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : "不明なエラー";
              results.push({ inventoryId: item.inventoryId, success: false, error: errMsg });
            }
          }
        }

        // Step3: DBの取り消し済みリストを更新（成功分のみ）
        await updateDeliveryCancelledItems(input.historyId, newCancelledItems);

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;
        return { success: true, successCount, failCount, results };
      }),
});
