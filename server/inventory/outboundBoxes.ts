import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  deliveryHistories,
  fedexShipments,
  inventoryItemLabels,
  localInventories,
  outboundBoxes,
  tradeRecords,
  workLogs,
} from "../../drizzle/schema";
import {
  buildOutboundFedexItems,
  formatOutboundBoxCode,
  groupOutboundFedexItemsByInvoice,
  normalizeOutboundScan,
  OUTBOUND_BOX_CODE_PATTERN,
  priorStatusForUnseal,
  PRODUCT_LABEL_PATTERN,
  shipmentSheetForPartner,
  type OutboundFedexItem,
  type ShipmentSheetName,
} from "../../shared/outboundBoxes";
import { protectedProcedure, router } from "../_core/trpc";
import { createFedexShipment, getDb, getLocalInventoryById, updateFedexShipmentStatus } from "./db";
import { processInventoryDelivery } from "./deliveryService";
import { postGasAction } from "./gasClient";
import { recordWorkLog } from "./workLogs";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDuplicateError(error: unknown): boolean {
  return /duplicate|unique|er_dup_entry/i.test(errorText(error));
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

async function getBoxByCode(boxCode: string) {
  const db = await requireDb();
  const rows = await db.select().from(outboundBoxes).where(eq(outboundBoxes.boxCode, boxCode)).limit(1);
  return rows[0] ?? null;
}

async function getBoxLabels(boxId: number) {
  const db = await requireDb();
  return db.select().from(inventoryItemLabels)
    .where(eq(inventoryItemLabels.outboundBoxId, boxId))
    .orderBy(inventoryItemLabels.id);
}

async function getBoxDetail(boxCode: string) {
  const box = await getBoxByCode(boxCode);
  if (!box) return null;
  return { ...box, items: await getBoxLabels(box.id) };
}

async function issueOneBox(operatorName: string | null) {
  const db = await requireDb();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const latest = await db.select({ boxCode: outboundBoxes.boxCode })
      .from(outboundBoxes)
      .orderBy(desc(outboundBoxes.boxCode))
      .limit(1);
    const sequence = Number(latest[0]?.boxCode.slice(1) ?? 0) + 1;
    const boxCode = formatOutboundBoxCode(sequence);
    try {
      await db.insert(outboundBoxes).values({ boxCode, operatorName, status: "open" });
      const box = await getBoxDetail(boxCode);
      if (box) return box;
    } catch (error) {
      if (isDuplicateError(error)) continue;
      throw error;
    }
  }
  throw new Error("箱IDの発番が競合しました。もう一度実行してください");
}

async function resolveShipmentDestinations(items: OutboundFedexItem[]) {
  const invoiceNos = Array.from(new Set(items.map(item => item.invoiceNo)));
  const missingInvoice = items.find(item => !item.invoiceNo);
  if (missingInvoice) {
    throw new Error(`${missingInvoice.labelId} のインボイスNoを特定できません。取引先を確認してください`);
  }
  const numericInvoiceNos = invoiceNos.map(value => Number(value));
  const db = await requireDb();
  const rows = await db
    .select({ invoiceNo: tradeRecords.no, partner: tradeRecords.partner })
    .from(tradeRecords)
    .where(inArray(tradeRecords.no, numericInvoiceNos));
  const destinationByInvoice = new Map<string, { partner: string; sheetName: ShipmentSheetName }>();
  for (const invoiceNo of invoiceNos as string[]) {
    const partners = Array.from(new Set(rows
      .filter(row => Number(row.invoiceNo) === Number(invoiceNo))
      .map(row => String(row.partner ?? "").trim())
      .filter(Boolean)));
    if (partners.length !== 1) {
      throw new Error(`インボイスNo.${invoiceNo} の取引先を一意に特定できません。人が取引データを確認してください`);
    }
    const sheetName = shipmentSheetForPartner(partners[0]);
    if (!sheetName) {
      throw new Error(`インボイスNo.${invoiceNo} の取引先「${partners[0]}」に発送管理シートが設定されていません`);
    }
    destinationByInvoice.set(invoiceNo, { partner: partners[0], sheetName });
  }
  return destinationByInvoice;
}

export async function deleteShipmentRowsForUnlink(
  shipments: Array<{ sheetName: string; trackingNumber: string }>,
  post: typeof postGasAction = postGasAction,
) {
  for (const shipment of shipments) {
    const result = await post({
      action: "deleteShipmentBatch",
      sheetName: shipment.sheetName,
      trackingNumber: shipment.trackingNumber,
    });
    if (!result.success) {
      throw new Error(`Googleスプレッドシートの行を削除できませんでした: ${result.message ?? "要確認"}`);
    }
  }
}

export const outboundBoxesRouter = router({
  list: protectedProcedure.query(async () => {
    const db = await requireDb();
    const boxes = await db.select().from(outboundBoxes)
      .where(isNull(outboundBoxes.discardedAt))
      .orderBy(desc(outboundBoxes.createdAt)).limit(200);
    return Promise.all(boxes.map(async (box) => ({ ...box, items: await getBoxLabels(box.id) })));
  }),

  create: protectedProcedure
    .input(z.object({ count: z.number().int().min(1).max(20), operatorName: z.string().max(200).optional() }))
    .mutation(async ({ input, ctx }) => {
      const operatorName = input.operatorName?.trim() || ctx.user.name || ctx.user.email || null;
      const boxes = [];
      for (let index = 0; index < input.count; index += 1) boxes.push(await issueOneBox(operatorName));
      return boxes;
    }),

  open: protectedProcedure
    .input(z.object({ boxCode: z.string(), operatorName: z.string().max(200).optional() }))
    .mutation(async ({ input, ctx }) => {
      const boxCode = normalizeOutboundScan(input.boxCode);
      if (!OUTBOUND_BOX_CODE_PATTERN.test(boxCode)) throw new Error("箱IDはB+6桁で読み取ってください");
      const existing = await getBoxDetail(boxCode);
      if (existing) {
        if (existing.discardedAt) throw new Error(`${boxCode}は破棄済みです`);
        if (existing.status !== "open") throw new Error(`${boxCode}は${existing.status}のため再開できません`);
        return existing;
      }
      const db = await requireDb();
      await db.insert(outboundBoxes).values({
        boxCode,
        status: "open",
        operatorName: input.operatorName?.trim() || ctx.user.name || ctx.user.email || null,
      });
      return getBoxDetail(boxCode);
    }),

  addItem: protectedProcedure
    .input(z.object({ boxCode: z.string(), labelId: z.string() }))
    .mutation(async ({ input }) => {
      const boxCode = normalizeOutboundScan(input.boxCode);
      const labelId = normalizeOutboundScan(input.labelId);
      if (!PRODUCT_LABEL_PATTERN.test(labelId)) throw new Error("個体ラベルは指定英字7文字です");
      const box = await getBoxByCode(boxCode);
      if (!box) throw new Error("先に箱IDをスキャンしてください");
      if (box.status !== "open") throw new Error("封をした箱には商品を追加できません");
      const db = await requireDb();
      const labels = await db.select().from(inventoryItemLabels).where(eq(inventoryItemLabels.labelId, labelId)).limit(1);
      const label = labels[0];
      if (!label) throw new Error(`${labelId}は登録されていません`);
      const status = label.status.trim().toLowerCase();
      if (status !== "received" && status !== "stocked") {
        throw new Error(`${labelId}は${label.status}のため出庫できません（入庫済み・在庫のみ）`);
      }
      if (label.outboundBoxId && label.outboundBoxId !== box.id) throw new Error(`${labelId}は別の箱に入っています`);
      await db.update(inventoryItemLabels).set({ outboundBoxId: box.id }).where(eq(inventoryItemLabels.id, label.id));
      return getBoxDetail(boxCode);
    }),

  removeItem: protectedProcedure
    .input(z.object({ boxCode: z.string(), labelId: z.string() }))
    .mutation(async ({ input }) => {
      const box = await getBoxByCode(normalizeOutboundScan(input.boxCode));
      if (!box || box.status !== "open") throw new Error("開いている箱からのみ取り消せます");
      const db = await requireDb();
      await db.update(inventoryItemLabels).set({ outboundBoxId: null }).where(and(
        eq(inventoryItemLabels.outboundBoxId, box.id),
        eq(inventoryItemLabels.labelId, normalizeOutboundScan(input.labelId)),
      ));
      return getBoxDetail(box.boxCode);
    }),

  discard: protectedProcedure
    .input(z.object({ boxCode: z.string() }))
    .mutation(async ({ input }) => {
      const box = await getBoxByCode(normalizeOutboundScan(input.boxCode));
      if (!box || box.status !== "open") throw new Error("未使用で開いている箱だけ破棄できます");
      if ((await getBoxLabels(box.id)).length > 0) throw new Error("中身をすべて取り消してから破棄してください");
      const db = await requireDb();
      await db.update(outboundBoxes).set({ discardedAt: new Date() }).where(eq(outboundBoxes.id, box.id));
      return { success: true };
    }),

  seal: protectedProcedure
    .input(z.object({
      boxCode: z.string(),
      deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      operatorName: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const box = await getBoxByCode(normalizeOutboundScan(input.boxCode));
      if (!box) throw new Error("箱が見つかりません");
      if (box.status !== "open") {
        if (box.deliveryHistoryId) return getBoxDetail(box.boxCode);
        throw new Error("この箱は封済みです");
      }
      const labels = await getBoxLabels(box.id);
      if (labels.length === 0) throw new Error("空の箱は封をできません");
      if (labels.some((label) => !label.localInventoryId)) throw new Error("在庫ID未反映の個体が含まれています");
      const db = await requireDb();
      const claimed = await db.update(outboundBoxes).set({ status: "sealed", sealedAt: new Date() })
        .where(and(eq(outboundBoxes.id, box.id), eq(outboundBoxes.status, "open")));
      const affectedRows = Number((claimed[0] as { affectedRows?: number }).affectedRows ?? 0);
      if (affectedRows !== 1) {
        const latest = await getBoxDetail(box.boxCode);
        if (latest?.deliveryHistoryId) return latest;
        throw new Error("別の操作がこの箱を処理中です。更新して確認してください");
      }
      try {
        const deliveryItems = await Promise.all(labels.map(async (label) => {
          const localInventory = await getLocalInventoryById(Number(label.localInventoryId));
          return {
            inventoryId: Number(localInventory?.zaicoId ?? label.localInventoryId),
            title: label.title,
            quantity: 1,
            labelId: label.labelId,
            previousStatus: priorStatusForUnseal(label.status),
          };
        }));
        const result = await processInventoryDelivery({
          deliveryNo: box.boxCode,
          deliveryDate: input.deliveryDate,
          operatorName: input.operatorName?.trim() || ctx.user.name || ctx.user.email || undefined,
          items: deliveryItems,
        });
        await db.update(outboundBoxes).set({ deliveryHistoryId: result.historyId }).where(eq(outboundBoxes.id, box.id));
        return getBoxDetail(box.boxCode);
      } catch (error) {
        const { getDeliveryHistoriesByDeliveryNo } = await import("./db");
        const completedHistory = (await getDeliveryHistoriesByDeliveryNo(box.boxCode))
          .find((history) => history.status === "success");
        if (completedHistory) {
          await db.update(outboundBoxes)
            .set({ status: "sealed", sealedAt: new Date(), deliveryHistoryId: completedHistory.id })
            .where(eq(outboundBoxes.id, box.id));
        } else {
          await db.update(outboundBoxes).set({ status: "open", sealedAt: null }).where(eq(outboundBoxes.id, box.id));
        }
        throw error;
      }
    }),

  linkTracking: protectedProcedure
    .input(z.object({
      boxCode: z.string(),
      trackingNumber: z.string().min(6).max(100),
      shippingDate: z.string().min(3).max(20),
      operatorName: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const box = await getBoxByCode(normalizeOutboundScan(input.boxCode));
      if (!box) throw new Error("箱が見つかりません");
      const trackingNumber = input.trackingNumber.normalize("NFKC").trim();
      if (box.status === "shipped") {
        if (box.trackingNumber === trackingNumber) return { ...(await getBoxDetail(box.boxCode)), spreadsheetSuccess: true };
        throw new Error("この箱には別の追跡番号が登録済みです");
      }
      if (box.status !== "sealed" || !box.deliveryHistoryId) throw new Error("先に箱を封じてください");
      const labels = await getBoxLabels(box.id);
      const items = buildOutboundFedexItems(labels);
      const destinationByInvoice = await resolveShipmentDestinations(items);
      const operatorName = input.operatorName?.trim() || ctx.user.name || ctx.user.email || "出荷担当";
      const invoiceGroups = groupOutboundFedexItemsByInvoice(items);
      const itemsBySheet = new Map<ShipmentSheetName, OutboundFedexItem[]>();
      for (const [invoiceNo, invoiceItems] of invoiceGroups) {
        const destination = destinationByInvoice.get(invoiceNo);
        if (!destination) throw new Error(`インボイスNo.${invoiceNo} の取引先を特定できません`);
        itemsBySheet.set(destination.sheetName, [
          ...(itemsBySheet.get(destination.sheetName) ?? []),
          ...invoiceItems,
        ]);
      }
      const shipmentIds = new Map<ShipmentSheetName, number>();
      for (const [sheetName, sheetItems] of itemsBySheet) {
        shipmentIds.set(sheetName, await createFedexShipment({
          deliveryNo: box.boxCode,
          sheetName,
          shippingDate: input.shippingDate,
          trackingNumber,
          itemsJson: JSON.stringify(sheetItems),
          spreadsheetStatus: "pending",
          operatorName,
          historyId: box.deliveryHistoryId,
        }));
      }

      const gasResults: Array<{ sheetName: ShipmentSheetName; success: boolean; message?: string }> = [];
      for (const [invoiceNo, invoiceItems] of groupOutboundFedexItemsByInvoice(items)) {
        const destination = destinationByInvoice.get(invoiceNo)!;
        const result = await postGasAction({
          action: "writeShipmentBatch",
          deliveryNo: box.boxCode,
          invoiceNo,
          sheetName: destination.sheetName,
          shippingDate: input.shippingDate,
          trackingNumber,
          items: invoiceItems,
        });
        gasResults.push({ sheetName: destination.sheetName, ...result });
      }
      const spreadsheetSuccess = gasResults.every((result) => result.success);
      const spreadsheetError = gasResults.filter((result) => !result.success).map((result) => result.message).join(" / ");
      for (const [sheetName, shipmentId] of shipmentIds) {
        const sheetResults = gasResults.filter(result => result.sheetName === sheetName);
        const sheetSuccess = sheetResults.every(result => result.success);
        const sheetError = sheetResults.filter(result => !result.success).map(result => result.message).join(" / ");
        await updateFedexShipmentStatus(shipmentId, sheetSuccess ? "success" : "error", sheetError || undefined);
      }
      const db = await requireDb();
      await db.update(outboundBoxes).set({
        status: "shipped",
        trackingNumber,
        fedexShipmentId: shipmentIds.values().next().value ?? null,
        linkedAt: new Date(),
      }).where(eq(outboundBoxes.id, box.id));
      await recordWorkLog({
        workerName: operatorName,
        category: "FedEx発送登録",
        status: "done",
        startedAt: new Date(),
        endedAt: new Date(),
        quantity: labels.length,
        memo: `箱ID: ${box.boxCode} / 追跡番号: ${trackingNumber}`,
        createdBy: operatorName,
        sourceType: "fedex",
        sourceId: `${box.boxCode}:${trackingNumber}`,
        detailsJson: JSON.stringify({ boxCode: box.boxCode, trackingNumber, items }),
      });
      return { ...(await getBoxDetail(box.boxCode)), spreadsheetSuccess, spreadsheetError: spreadsheetError || null };
    }),

  unlinkTracking: protectedProcedure
    .input(z.object({
      boxCode: z.string(),
      operatorName: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const box = await getBoxByCode(normalizeOutboundScan(input.boxCode));
      if (!box) throw new Error("箱が見つかりません");
      if (box.status !== "shipped" || !box.trackingNumber || !box.deliveryHistoryId) {
        throw new Error("追跡番号が紐付いている箱だけ解除できます");
      }
      const db = await requireDb();
      const shipments = await db.select().from(fedexShipments).where(and(
        eq(fedexShipments.historyId, box.deliveryHistoryId),
        isNull(fedexShipments.cancelledAt),
      ));
      if (shipments.length === 0) throw new Error("解除対象のFedEx発送記録が見つかりません");

      await deleteShipmentRowsForUnlink(shipments);

      const now = new Date();
      const workerName = input.operatorName?.trim() || ctx.user.name || ctx.user.email || "出荷担当";
      await db.transaction(async tx => {
        await tx.update(fedexShipments).set({
          cancelledAt: now,
          cancellationReason: `箱 ${box.boxCode} の追跡紐付け解除`,
          spreadsheetStatus: "success",
          spreadsheetError: null,
        }).where(and(
          eq(fedexShipments.historyId, box.deliveryHistoryId!),
          isNull(fedexShipments.cancelledAt),
        ));
        await tx.update(outboundBoxes).set({
          status: "sealed",
          trackingNumber: null,
          fedexShipmentId: null,
          linkedAt: null,
          trackingUnlinkedAt: now,
        }).where(and(eq(outboundBoxes.id, box.id), eq(outboundBoxes.status, "shipped")));
        await tx.insert(workLogs).values({
          workerName,
          category: "箱追跡解除",
          status: "done",
          startedAt: now,
          endedAt: now,
          quantity: shipments.length,
          memo: `箱ID: ${box.boxCode} / 追跡番号: ${box.trackingNumber}`,
          createdBy: workerName,
          sourceType: "box-unlink-tracking",
          sourceId: box.boxCode,
          detailsJson: JSON.stringify({ boxCode: box.boxCode, trackingNumber: box.trackingNumber, shipmentIds: shipments.map(row => row.id) }),
        });
      });
      return getBoxDetail(box.boxCode);
    }),

  unseal: protectedProcedure
    .input(z.object({
      boxCode: z.string(),
      operatorName: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const box = await getBoxByCode(normalizeOutboundScan(input.boxCode));
      if (!box) throw new Error("箱が見つかりません");
      if (box.status === "open") return { ...(await getBoxDetail(box.boxCode)), restoredCount: 0, alreadyOpen: true };
      if (box.status === "shipped") {
        throw new Error("先に追跡番号の紐付けを解除してください。Googleスプレッドシートの行削除確認が必要です");
      }
      if (!box.deliveryHistoryId) throw new Error("取消対象の出庫履歴が見つかりません");
      const db = await requireDb();
      const [history] = await db.select().from(deliveryHistories)
        .where(eq(deliveryHistories.id, box.deliveryHistoryId)).limit(1);
      if (!history) throw new Error("取消対象の出庫履歴が見つかりません");
      const labels = await getBoxLabels(box.id);
      type HistoryItem = { inventoryId?: number; quantity?: number; labelId?: string; previousStatus?: string };
      const historyItems = JSON.parse(history.itemsJson || "[]") as HistoryItem[];
      const previousStatusByLabel = new Map(historyItems
        .filter(item => item.labelId)
        .map(item => [normalizeOutboundScan(item.labelId!), priorStatusForUnseal(item.previousStatus)]));
      const now = new Date();
      const workerName = input.operatorName?.trim() || ctx.user.name || ctx.user.email || "出荷担当";
      let restoredCount = 0;

      await db.transaction(async tx => {
        const claimed = await tx.update(outboundBoxes).set({
          status: "open",
          sealedAt: null,
          deliveryHistoryId: null,
          unsealedAt: now,
        }).where(and(eq(outboundBoxes.id, box.id), eq(outboundBoxes.status, "sealed")));
        const affectedRows = Number((claimed[0] as { affectedRows?: number }).affectedRows ?? 0);
        if (affectedRows !== 1) return;

        const cancelledItems = (() => {
          try {
            const parsed = JSON.parse(history.cancelledItemsJson || "[]");
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })();
        for (const label of labels) {
          const restoredStatus = previousStatusByLabel.get(label.labelId) ?? "stocked";
          const changed = await tx.update(inventoryItemLabels).set({
            status: restoredStatus,
            shippedAt: null,
          }).where(and(
            eq(inventoryItemLabels.id, label.id),
            eq(inventoryItemLabels.outboundBoxId, box.id),
            eq(inventoryItemLabels.status, "shipped"),
          ));
          const labelChanged = Number((changed[0] as { affectedRows?: number }).affectedRows ?? 0) === 1;
          if (!labelChanged) continue;
          restoredCount += 1;
          if (label.localInventoryId) {
            await tx.update(localInventories)
              .set({ quantity: sql`${localInventories.quantity} + 1` })
              .where(eq(localInventories.id, label.localInventoryId));
          }
          const historyItem = historyItems.find(item => normalizeOutboundScan(item.labelId ?? "") === label.labelId);
          cancelledItems.push({
            inventoryId: historyItem?.inventoryId ?? label.localInventoryId,
            quantity: historyItem?.quantity ?? 1,
            labelId: label.labelId,
            cancelledAt: now.toISOString(),
            reason: "box-unseal",
            boxCode: box.boxCode,
          });
        }
        await tx.update(deliveryHistories)
          .set({ cancelledItemsJson: JSON.stringify(cancelledItems) })
          .where(eq(deliveryHistories.id, history.id));
        await tx.insert(workLogs).values({
          workerName,
          category: "箱の封解き",
          status: "done",
          startedAt: now,
          endedAt: now,
          quantity: restoredCount,
          memo: `箱ID: ${box.boxCode} / 在庫復元: ${restoredCount}点`,
          createdBy: workerName,
          sourceType: "box-unseal",
          sourceId: box.boxCode,
          detailsJson: JSON.stringify({ boxCode: box.boxCode, labelIds: labels.map(label => label.labelId), deliveryHistoryId: history.id }),
        });
      });
      return { ...(await getBoxDetail(box.boxCode)), restoredCount, alreadyOpen: restoredCount === 0 };
    }),

  traceByLabel: protectedProcedure
    .input(z.object({ labelId: z.string() }))
    .query(async ({ input }) => {
      const labelId = normalizeOutboundScan(input.labelId);
      const db = await requireDb();
      const labels = await db.select().from(inventoryItemLabels).where(eq(inventoryItemLabels.labelId, labelId)).limit(1);
      const label = labels[0] ?? null;
      const box = label?.outboundBoxId
        ? (await db.select().from(outboundBoxes).where(eq(outboundBoxes.id, label.outboundBoxId)).limit(1))[0] ?? null
        : null;
      return { label, box };
    }),
});
