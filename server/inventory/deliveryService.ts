import { eq } from "drizzle-orm";
import { inventoryItemLabels } from "../../drizzle/schema";
import { createDelivery as createZaicoDelivery } from "./zaico";
import {
  createDeliveryHistory,
  getDb,
  getLocalInventoryByZaicoIdOrId,
  isZaicoEnabled,
  updateLocalInventory,
} from "./db";
import { recordWorkLog } from "./workLogs";

export type InventoryDeliveryInput = {
  deliveryNo: string;
  deliveryDate: string;
  items: Array<{
    inventoryId: number;
    title: string;
    quantity: number;
    unitPrice?: number;
    tradeRecordId?: number | null;
    csvProductName?: string | null;
    labelId?: string;
    previousStatus?: "received" | "stocked";
  }>;
  trackingNumber?: string;
  operatorName?: string;
};

export async function processInventoryDelivery(input: InventoryDeliveryInput) {
  const zaicoEnabled = await isZaicoEnabled();
  let zaicoResult: { code: number; status: string; message: string; data_id: number } | null = null;
  let historyStatus: "success" | "error" = "success";
  let errorMessage: string | undefined;

  if (zaicoEnabled) {
    try {
      zaicoResult = await createZaicoDelivery({
        num: input.deliveryNo,
        status: "completed_delivery",
        delivery_date: input.deliveryDate,
        deliveries: input.items.map((item) => ({
          inventory_id: item.inventoryId,
          quantity: item.quantity,
          ...(item.unitPrice !== undefined ? { unit_price: item.unitPrice } : {}),
        })),
      });
    } catch (error) {
      historyStatus = "error";
      errorMessage = error instanceof Error ? error.message : "不明なエラー";
    }
  } else {
    try {
      for (const item of input.items) {
        const localInventory = await getLocalInventoryByZaicoIdOrId(item.inventoryId);
        if (!localInventory) continue;
        await updateLocalInventory(localInventory.id, {
          quantity: Math.max(0, (localInventory.quantity ?? 0) - item.quantity),
        });
      }
    } catch (error) {
      historyStatus = "error";
      errorMessage = error instanceof Error ? error.message : "ローカルDB在庫更新エラー";
    }
  }

  const historyItems = await Promise.all(input.items.map(async (item) => {
    const localInventory = await getLocalInventoryByZaicoIdOrId(item.inventoryId).catch(() => null);
    const managementNo = localInventory?.etc?.split(",")[0]?.trim() || null;
    const csvProductName = item.csvProductName === undefined
      ? undefined
      : item.csvProductName === null
        ? null
        : item.csvProductName.trim();
    const labelId = item.labelId?.trim().toUpperCase();
    return {
      inventoryId: item.inventoryId,
      title: item.title,
      quantity: item.quantity,
      ...(labelId ? { labelId } : {}),
      ...(item.previousStatus ? { previousStatus: item.previousStatus } : {}),
      ...(managementNo ? { managementNo } : {}),
      ...(item.tradeRecordId ? { tradeRecordId: item.tradeRecordId } : {}),
      ...(csvProductName !== undefined ? { csvProductName } : {}),
    };
  }));

  const historyId = await createDeliveryHistory({
    deliveryNo: input.deliveryNo,
    zaicoDeliveryId: zaicoResult?.data_id ?? null,
    itemsJson: JSON.stringify(historyItems),
    status: historyStatus,
    errorMessage: errorMessage ?? null,
  });
  if (historyStatus === "error") throw new Error(errorMessage ?? "出庫処理に失敗しました");

  const shippedLabelIds = Array.from(new Set(input.items
    .map((item) => item.labelId?.trim().toUpperCase())
    .filter((labelId): labelId is string => Boolean(labelId))));
  if (shippedLabelIds.length > 0) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const now = new Date();
    for (const labelId of shippedLabelIds) {
      await db.update(inventoryItemLabels)
        .set({ status: "shipped", shippedAt: now })
        .where(eq(inventoryItemLabels.labelId, labelId));
    }
  }

  await recordWorkLog({
    workerName: input.operatorName?.trim() || "野田",
    category: "出庫登録",
    status: "done",
    startedAt: new Date(),
    endedAt: new Date(),
    quantity: Math.round(historyItems.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)),
    memo: `出庫No: ${input.deliveryNo}`,
    createdBy: input.operatorName?.trim() || "出庫登録",
    sourceType: "delivery",
    sourceId: input.deliveryNo,
    detailsJson: JSON.stringify({
      deliveryNo: input.deliveryNo,
      deliveryDate: input.deliveryDate,
      trackingNumber: input.trackingNumber ?? null,
      items: historyItems,
    }),
  });

  return { historyId, historyItems, zaicoDeliveryId: zaicoResult?.data_id };
}
