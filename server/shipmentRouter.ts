import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { tradeRecords, shipments, shipmentItems } from "../drizzle/schema";
import { eq, desc, asc, inArray } from "drizzle-orm";
import { getShipmentAllocationGroupKey, normalizeShipmentTrackingNumber, recalcShippingCosts, toNumber } from "./tradeRouter";

export const shipmentRouter = router({
    /** 全発送記録を取得（明細付き） */
    list: protectedProcedure.query(async () => {
      const db = (await getDb())!;
      const rows = await db.select().from(shipments).orderBy(desc(shipments.shippingDate));
      const items = await db.select().from(shipmentItems);
      const tradeRecordIds = Array.from(new Set(items.map((i) => i.tradeRecordId).filter((id): id is number => typeof id === "number" && id > 0)));
      const tradeRows = tradeRecordIds.length > 0
        ? await db
            .select({ id: tradeRecords.id, productName: tradeRecords.productName })
            .from(tradeRecords)
            .where(inArray(tradeRecords.id, tradeRecordIds))
        : [];
      const productNameByTradeId = new Map(tradeRows.map((row) => [row.id, row.productName ?? ""]));
      return rows.map((s) => ({
        ...s,
        items: items
          .filter((i) => i.shipmentId === s.id)
          .map((i) => ({ ...i, productName: i.tradeRecordId ? productNameByTradeId.get(i.tradeRecordId) ?? null : null })),
      }));
    }),

    /** インボイスNoの発注数合計・発送済み数・残数を返す */
    invoiceSummary: protectedProcedure
      .input(z.object({ invoiceNo: z.number() }))
      .query(async ({ input }) => {
        const db = (await getDb())!;
        // 同一インボイスNoの全商品の発注数合計
        const trades = await db
          .select({
            id: tradeRecords.id,
            productName: tradeRecords.productName,
            quantity: tradeRecords.quantity,
          })
          .from(tradeRecords)
          .where(eq(tradeRecords.no, input.invoiceNo))
          .orderBy(asc(tradeRecords.id));
        const orderedQty = trades.reduce((sum, t) => sum + Number(t.quantity ?? 0), 0);
        // 発送済み合計
        const items = await db
          .select({
            quantity: shipmentItems.quantity,
            tradeRecordId: shipmentItems.tradeRecordId,
          })
          .from(shipmentItems)
          .where(eq(shipmentItems.invoiceNo, input.invoiceNo));
        const shippedByTradeId = new Map<number, number>();
        let unassignedShippedQty = 0;
        for (const item of items) {
          if (item.tradeRecordId) {
            shippedByTradeId.set(item.tradeRecordId, (shippedByTradeId.get(item.tradeRecordId) ?? 0) + item.quantity);
          } else {
            unassignedShippedQty += item.quantity;
          }
        }
        const itemSummaries = trades.map((trade) => {
          const ordered = Number(trade.quantity ?? 0);
          const shipped = shippedByTradeId.get(trade.id) ?? 0;
          return {
            tradeRecordId: trade.id,
            productName: trade.productName ?? "",
            orderedQty: ordered,
            shippedQty: shipped,
            remainingQty: Math.max(0, ordered - shipped),
          };
        });
        const shippedQty = itemSummaries.reduce((sum, item) => sum + item.shippedQty, 0);
        return {
          invoiceNo: input.invoiceNo,
          orderedQty,
          shippedQty,
          remainingQty: Math.max(0, orderedQty - shippedQty),
          isComplete: orderedQty > 0 && shippedQty >= orderedQty,
          unassignedShippedQty,
          items: itemSummaries,
        };
      }),

    /** 特定インボイスの発送記録を取得 */
    byInvoice: protectedProcedure
      .input(z.object({ invoiceNo: z.number() }))
      .query(async ({ input }) => {
        const db = (await getDb())!;
        const items = await db
          .select()
          .from(shipmentItems)
          .where(eq(shipmentItems.invoiceNo, input.invoiceNo));
        if (items.length === 0) return [];
        const tradeRecordIds = Array.from(new Set(items.map((i) => i.tradeRecordId).filter((id): id is number => typeof id === "number" && id > 0)));
        const tradeRows = tradeRecordIds.length > 0
          ? await db
              .select({ id: tradeRecords.id, productName: tradeRecords.productName })
              .from(tradeRecords)
              .where(inArray(tradeRecords.id, tradeRecordIds))
          : [];
        const productNameByTradeId = new Map(tradeRows.map((row) => [row.id, row.productName ?? ""]));
        const shipmentIds = Array.from(new Set(items.map((i) => i.shipmentId)));
        const result: Array<
          typeof shipments.$inferSelect & {
            allocationTotalQty?: number;
            allocationShippingCost?: number;
            items: Array<typeof shipmentItems.$inferSelect & { productName?: string | null }>;
          }
        > = [];
        for (const sid of shipmentIds) {
          const [s] = await db.select().from(shipments).where(eq(shipments.id, sid));
          if (s) {
            const allItems = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, sid));
            result.push({
              ...s,
              items: allItems.map((item) => ({
                ...item,
                productName: item.tradeRecordId ? productNameByTradeId.get(item.tradeRecordId) ?? null : null,
              })),
            });
          }
        }
        const trackingNumbers = new Set(
          result
            .map((shipment) => normalizeShipmentTrackingNumber(shipment.trackingNumber))
            .filter((trackingNumber) => trackingNumber.length > 0)
        );
        const relatedShipments = trackingNumbers.size > 0
          ? (await db.select().from(shipments)).filter((shipment) => {
              const trackingNumber = normalizeShipmentTrackingNumber(shipment.trackingNumber);
              return shipmentIds.includes(shipment.id) || (trackingNumber.length > 0 && trackingNumbers.has(trackingNumber));
            })
          : result;
        const relatedShipmentIds = Array.from(new Set(relatedShipments.map((shipment) => shipment.id)));
        const relatedShipmentItems = relatedShipmentIds.length > 0
          ? await db.select().from(shipmentItems).where(inArray(shipmentItems.shipmentId, relatedShipmentIds))
          : [];
        const shipmentById = new Map(relatedShipments.map((shipment) => [shipment.id, shipment]));
        const groupStats = new Map<string, { totalQty: number; shippingCost: number }>();
        for (const shipment of relatedShipments) {
          const key = getShipmentAllocationGroupKey(shipment);
          const group = groupStats.get(key) ?? { totalQty: 0, shippingCost: 0 };
          const shippingCost = toNumber(shipment.shippingCost);
          if (shippingCost > 0) {
            group.shippingCost = Math.max(group.shippingCost, shippingCost);
          }
          groupStats.set(key, group);
        }
        for (const item of relatedShipmentItems) {
          const shipment = shipmentById.get(item.shipmentId);
          if (!shipment) continue;
          const group = groupStats.get(getShipmentAllocationGroupKey(shipment));
          if (!group) continue;
          group.totalQty += item.quantity;
        }
        return result
          .map((shipment) => {
            const group = groupStats.get(getShipmentAllocationGroupKey(shipment));
            return {
              ...shipment,
              allocationTotalQty: group?.totalQty ?? shipment.items.reduce((sum, item) => sum + item.quantity, 0),
              allocationShippingCost: group?.shippingCost ?? toNumber(shipment.shippingCost),
            };
          })
          .sort((a, b) => a.shippingDate.localeCompare(b.shippingDate));
      }),

    /** 発送記録を新規作成し、送料を按分更新する */
    create: protectedProcedure
      .input(
        z.object({
          shippingDate: z.string(),
          trackingNumber: z.string().optional(),
          shippingCost: z.number(),
          notes: z.string().optional(),
          items: z.array(
            z.object({
              invoiceNo: z.number(),
              tradeRecordId: z.number().int().positive(),
              quantity: z.number(),
            })
          ),
        })
      )
      .mutation(async ({ input }) => {
        const db = (await getDb())!;

        // 1. 発送レコードを作成
        const tradeRecordIds = Array.from(new Set(input.items.map((item) => item.tradeRecordId)));
        const tradeRows = tradeRecordIds.length > 0
          ? await db
              .select({ id: tradeRecords.id, no: tradeRecords.no })
              .from(tradeRecords)
              .where(inArray(tradeRecords.id, tradeRecordIds))
          : [];
        const tradeInvoiceById = new Map(tradeRows.map((row) => [row.id, row.no]));
        for (const item of input.items) {
          if (tradeInvoiceById.get(item.tradeRecordId) !== item.invoiceNo) {
            throw new Error(`出庫明細の商品行がNo.${item.invoiceNo}に紐づいていません。`);
          }
        }

        const [result] = await db.insert(shipments).values({
          shippingDate: input.shippingDate,
          trackingNumber: input.trackingNumber ?? null,
          shippingCost: String(input.shippingCost),
          notes: input.notes ?? null,
        });
        const shipmentId = (result as any).insertId as number;

        // 2. 発送明細を作成
        for (const item of input.items) {
          await db.insert(shipmentItems).values({
            shipmentId,
            invoiceNo: item.invoiceNo,
            tradeRecordId: item.tradeRecordId,
            quantity: item.quantity,
          });
        }

        // 3. 各インボイスの送料を更新（発送完了チェック）
        await recalcShippingCosts(db, input.items.map((i) => i.invoiceNo));

        return { shipmentId };
      }),

    /** 発送記録を更新する（発送日・追跡番号・送料・メモ） */
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          shippingDate: z.string(),
          trackingNumber: z.string().optional(),
          shippingCost: z.number(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = (await getDb())!;
        await db
          .update(shipments)
          .set({
            shippingDate: input.shippingDate,
            trackingNumber: input.trackingNumber ?? null,
            shippingCost: String(input.shippingCost),
            notes: input.notes ?? null,
          })
          .where(eq(shipments.id, input.id));
        // 送料変更後に再計算
        const items = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, input.id));
        const invoiceNos = items.map((i) => i.invoiceNo);
        await recalcShippingCosts(db, invoiceNos);
        return { ok: true };
      }),

    /** 発送記録を削除し、送料を再計算する */
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = (await getDb())!;
        const items = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, input.id));
        const invoiceNos = items.map((i) => i.invoiceNo);
        await db.delete(shipmentItems).where(eq(shipmentItems.shipmentId, input.id));
        await db.delete(shipments).where(eq(shipments.id, input.id));
        // 送料を再計算
        await recalcShippingCosts(db, invoiceNos);
        return { ok: true };
      }),
});
