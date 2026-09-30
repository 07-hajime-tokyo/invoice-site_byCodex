import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createFedexShipment,
  deleteFedexShipment,
  getAllDeliveryHistories,
  getAllFedexShipments,
  getDeliveryHistoryById,
  getFedexShipmentsByDeliveryNo,
  updateFedexShipment,
  updateFedexShipmentHistoryAndDeliveryNo,
  updateFedexShipmentStatus,
} from "./db";
import { invoiceNoFromDeliveryNo } from "./deliveryInvoiceAttribution";
import { expandMaxim415416OrderRows, getOrderRowsFromTradeRecords } from "./orderTradeRows";
import { type ShipmentGasItem } from "./shipmentDeclarationRules";
import { resolveWorkOperatorName } from "./workOperator";
import { recordWorkLog } from "./workLogs";
import { allocateShipmentItemsToCsvProducts } from "@shared/productMatching";

export const shipmentSheetNameSchema = z.enum(["独発送管理", "サミー発送管理", "デボン発送管理", "サイモン発送管理", "ネレ発送管理"]);
type ShipmentSheetName = z.infer<typeof shipmentSheetNameSchema>;

function detectShipmentSheetNameInText(text: string | null | undefined): ShipmentSheetName | null {
  const haystack = text?.toLowerCase() ?? "";
  if (!haystack) return null;
  if (haystack.includes("デボン") || haystack.includes("devon")) return "デボン発送管理";
  if (haystack.includes("サイモン") || haystack.includes("simon") || haystack.includes("hennes kamusien")) return "サイモン発送管理";
  if (haystack.includes("ネレ") || haystack.includes("nele")) return "ネレ発送管理";
  if (haystack.includes("サミー") || haystack.includes("samee") || haystack.includes("sami") || haystack.includes("sammy")) return "サミー発送管理";
  if (haystack.includes("マキシム") || haystack.includes("maxim") || haystack.includes("ルカ") || haystack.includes("luca")) return "独発送管理";
  return null;
}

function detectShipmentSheetName(primaryText?: string | null, ...fallbackTexts: Array<string | null | undefined>): ShipmentSheetName {
  const primary = detectShipmentSheetNameInText(primaryText);
  if (primary) return primary;

  const haystack = fallbackTexts.filter(Boolean).join(" ").toLowerCase();
  if (haystack.includes("デボン") || haystack.includes("devon")) return "デボン発送管理";
  if (haystack.includes("サイモン") || haystack.includes("simon")) return "サイモン発送管理";
  if (haystack.includes("ネレ") || haystack.includes("nele")) return "ネレ発送管理";
  if (haystack.includes("サミー") || haystack.includes("samee") || haystack.includes("sami") || haystack.includes("sammy")) {
    return "サミー発送管理";
  }
  if (haystack.includes("マキシム") || haystack.includes("maxim")) return "独発送管理";
  return "独発送管理";
}

function mergeShipmentGasItems(items: ShipmentGasItem[]): ShipmentGasItem[] {
  const grouped = new Map<string, ShipmentGasItem>();
  for (const item of items) {
    const name = (item.productNameJa || item.productNameEn).trim();
    if (!name || item.quantity <= 0) continue;
    const key = item.labelId ? `${name}\u0000${item.labelId}` : name;
    const current = grouped.get(key);
    if (current) current.quantity += item.quantity;
    else grouped.set(key, {
      productNameJa: name,
      productNameEn: item.productNameEn || name,
      quantity: item.quantity,
      ...(item.managementNo !== undefined ? { managementNo: item.managementNo } : {}),
      ...(item.labelId ? { labelId: item.labelId } : {}),
    });
  }
  return Array.from(grouped.values()).filter((item) => item.quantity > 0);
}

async function alignShipmentItemsToOrderRows(invoiceNo: string, items: ShipmentGasItem[]): Promise<ShipmentGasItem[]> {
  // 個体IDを持つ箱経由の行はidentityを落とさないことを優先する。
  if (items.some((item) => item.labelId)) return mergeShipmentGasItems(items);
  const orderRows = (await getOrderRowsFromTradeRecords().catch(() => []))
    .filter((row) => row.invoiceNo === invoiceNo && row.productName.trim());
  if (orderRows.length === 0) return mergeShipmentGasItems(items);

  const expandedOrderRows = expandMaxim415416OrderRows(orderRows);
  const csvProducts = expandedOrderRows.map((row) => ({ name: row.productName, qty: row.orderQty }));
  return allocateShipmentItemsToCsvProducts(items, csvProducts);
}

type ShipmentDisplayItem = {
  productNameJa: string;
  productNameEn: string;
  quantity: number;
  managementNo?: string | null;
};

function deliveryHistoryItemsToShipmentItems(itemsJson: string): ShipmentDisplayItem[] {
  let items: Array<{ title?: string; productNameJa?: string; productNameEn?: string; quantity?: unknown; managementNo?: string | null }> = [];
  try {
    const parsed = JSON.parse(itemsJson || "[]");
    items = Array.isArray(parsed) ? parsed : [];
  } catch {
    items = [];
  }
  return items
    .map((item) => {
      const name = String(item.title ?? item.productNameJa ?? item.productNameEn ?? "").trim();
      const quantity = Number(item.quantity ?? 0);
      return { productNameJa: name, productNameEn: name, quantity, managementNo: item.managementNo ?? null };
    })
    .filter((item) => item.productNameJa && item.quantity > 0);
}

function sumShipmentDisplayItems(items: ShipmentDisplayItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export async function alignShipmentItemsWithDeliveryHistories<
  T extends { deliveryNo: string; itemsJson: string; historyId?: number | null; isManual?: boolean },
>(shipments: T[]): Promise<T[]> {
  if (shipments.length === 0) return shipments;

  const histories = await getAllDeliveryHistories().catch(() => []);
  const latestHistories = [...histories]
    .filter((history) => history.status === "success")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const historyById = new Map<number, (typeof latestHistories)[number]>();
  const historyByDeliveryNo = new Map<string, (typeof latestHistories)[number]>();
  for (const history of latestHistories) {
    historyById.set(history.id, history);
    if (!historyByDeliveryNo.has(history.deliveryNo)) {
      historyByDeliveryNo.set(history.deliveryNo, history);
    }
  }

  return shipments.map((shipment) => {
    if (shipment.isManual) return shipment;
    const history = shipment.historyId
      ? historyById.get(shipment.historyId)
      : historyByDeliveryNo.get(shipment.deliveryNo);
    if (!history) return shipment;

    const historyItems = deliveryHistoryItemsToShipmentItems(history.itemsJson);
    if (historyItems.length === 0) return shipment;
    const storedItems = deliveryHistoryItemsToShipmentItems(shipment.itemsJson);
    const storedTotal = sumShipmentDisplayItems(storedItems);
    const historyTotal = sumShipmentDisplayItems(historyItems);
    if (storedItems.length === 0 || storedTotal !== historyTotal) {
      return shipment;
    }
    return { ...shipment, itemsJson: JSON.stringify(historyItems) };
  });
}

async function getShipmentItemsForHistory(historyId?: number | null): Promise<ShipmentGasItem[] | null> {
  if (!historyId) return null;
  const history = await getDeliveryHistoryById(historyId).catch(() => null);
  if (!history || history.status !== "success") return null;
  const items = deliveryHistoryItemsToShipmentItems(history.itemsJson).map((item) => ({
    productNameJa: item.productNameJa,
    productNameEn: item.productNameEn,
    quantity: item.quantity,
    ...(item.managementNo !== undefined ? { managementNo: item.managementNo } : {}),
  }));
  return items.length > 0 ? items : null;
}

async function getLiveDeliveryHistoryIds(): Promise<Set<number>> {
  const histories = await getAllDeliveryHistories().catch(() => []);
  return new Set(histories.filter((history) => history.status === "success").map((history) => history.id));
}

function shouldUseExistingShipmentForGas(
  record: { deliveryNo: string; sheetName: string; trackingNumber: string; historyId?: number | null },
  target: { deliveryNo: string; sheetName: string; trackingNumber: string; invoiceNo: string; historyId?: number | null },
  liveHistoryIds: Set<number>,
): boolean {
  if (record.sheetName !== target.sheetName) return false;
  if (record.trackingNumber !== target.trackingNumber) return false;
  if (invoiceNoFromDeliveryNo(record.deliveryNo) !== target.invoiceNo) return false;
  if (record.historyId) return liveHistoryIds.has(record.historyId);
  if (target.historyId) return false;
  return record.deliveryNo === target.deliveryNo;
}



export function sumWorkQuantity(items: Array<{ quantity: string | number }>): number {
  return Math.round(items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0));
}

const publicProcedure = protectedProcedure;

export const fedexRouter = router({
    /**
     * 出庫Noに紐づくFedEx発送記録を取得する
     */
    getByDeliveryNo: protectedProcedure
      .input(z.object({ deliveryNo: z.string() }))
      .query(async ({ input }) => {
        return alignShipmentItemsWithDeliveryHistories(await getFedexShipmentsByDeliveryNo(input.deliveryNo));
      }),

    /**
     * 全FedEx発送記録を取得する
     */
    getAll: protectedProcedure.query(async () => {
      return alignShipmentItemsWithDeliveryHistories(await getAllFedexShipments());
    }),

    /**
     * 当日登録された追跡番号の一覧を返す（プルダウン再利用用）
     */
    getTodayTrackingNumbers: publicProcedure.query(async () => {
      const all = await getAllFedexShipments();
      const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const todayRecords = all.filter((r) => {
        const d = new Date(r.createdAt);
        return d.toISOString().slice(0, 10) === todayStr;
      });
      // 重複除去して一覧返す
      const seen = new Set<string>();
      const result: Array<{ trackingNumber: string; sheetName: string }> = [];
      for (const r of todayRecords) {
        if (!seen.has(r.trackingNumber)) {
          seen.add(r.trackingNumber);
          result.push({ trackingNumber: r.trackingNumber, sheetName: r.sheetName });
        }
      }
      return result;
    }),

    /**
     * FedEx発送記録を登録し、GASを通じてスプシに書き込む
     */
    create: protectedProcedure
      .input(z.object({
        deliveryNo: z.string(),
        sheetName: shipmentSheetNameSchema,
        shippingDate: z.string(), // 例: "3/26"
        trackingNumber: z.string(),
        historyId: z.number().int().positive().optional(),
        items: z.array(z.object({
          productNameJa: z.string(),
          productNameEn: z.string(),
          quantity: z.number().int().positive(),
          managementNo: z.string().nullable().optional(),
        })),
        operatorName: z.string().max(200).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        type MergeItem = ShipmentGasItem;
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
        const invoiceNo = invoiceNoFromDeliveryNo(input.deliveryNo);
        const sourceItems = (await getShipmentItemsForHistory(input.historyId)) ?? input.items;
        const gasItems = await alignShipmentItemsToOrderRows(invoiceNo, sourceItems);
        const workOperatorName = resolveWorkOperatorName(input.operatorName, ctx.user.name ?? ctx.user.email ?? null);

        // GAS呼び出しヘルパー
        async function callGasWrite(items: MergeItem[]): Promise<{ success: boolean; message?: string }> {
          if (!gasUrl) return { success: false, message: "GAS_WEBHOOK_URLが未設定" };
          try {
            const payload = {
              secret, action: "writeShipmentBatch",
              deliveryNo: input.deliveryNo,
              invoiceNo,
              sheetName: input.sheetName,
              shippingDate: input.shippingDate,
              trackingNumber: input.trackingNumber,
              items,
            };
            const res = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "manual" });
            let text: string;
            if (res.status === 302 || res.status === 301) { const loc = res.headers.get("location") ?? gasUrl; const r2 = await fetch(loc, { method: "GET" }); text = await r2.text(); }
            else { text = await res.text(); }
            try { return JSON.parse(text); } catch { return { success: false, message: text }; }
          } catch (e) { return { success: false, message: e instanceof Error ? e.message : String(e) }; }
        }
        // 同一追跡番号かつ同一出庫Noの既存記録を確認
        const allRecords = await alignShipmentItemsWithDeliveryHistories(await getAllFedexShipments());
        const liveHistoryIds = await getLiveDeliveryHistoryIds();

        function parseShipmentRecordItems(itemsJson: string): MergeItem[] {
          try {
            return JSON.parse(itemsJson) as MergeItem[];
          } catch {
            return [];
          }
        }

        function getExistingGasItemsForWrite(): MergeItem[] {
          return mergeShipmentGasItems(allRecords
            .filter((record) => shouldUseExistingShipmentForGas(record, {
              deliveryNo: input.deliveryNo,
              sheetName: input.sheetName,
              trackingNumber: input.trackingNumber,
              invoiceNo,
              historyId: input.historyId ?? null,
            }, liveHistoryIds))
            .flatMap((record) => parseShipmentRecordItems(record.itemsJson)));
        }

        function getGasItemsForWrite(additionalItems: MergeItem[]): MergeItem[] {
          return mergeShipmentGasItems([
            ...getExistingGasItemsForWrite(),
            ...additionalItems,
          ]);
        }

        const sameTracking = allRecords.filter((r) =>
          r.trackingNumber === input.trackingNumber &&
          r.deliveryNo === input.deliveryNo &&
          (input.historyId ? r.historyId === input.historyId : !r.historyId)
        );

        if (sameTracking.length > 0) {
          // 自動合算: 既存記録と新規分をマージ
          const mergedMap = new Map<string, MergeItem>();
          for (const rec of sameTracking) {
            let items: MergeItem[] = [];
            try { items = JSON.parse(rec.itemsJson); } catch { items = []; }
            for (const item of items) {
              const key = item.productNameJa;
              if (mergedMap.has(key)) mergedMap.get(key)!.quantity += item.quantity;
              else mergedMap.set(key, { ...item });
            }
          }
          for (const item of gasItems) {
            const key = item.productNameJa;
            if (mergedMap.has(key)) mergedMap.get(key)!.quantity += item.quantity;
            else mergedMap.set(key, { ...item });
          }
          const mergedItems = Array.from(mergedMap.values());
          const keepId = sameTracking[0].id;
          // 既存記録を合算内容で更新
          await updateFedexShipment(keepId, {
            sheetName: input.sheetName,
            shippingDate: input.shippingDate,
            itemsJson: JSON.stringify(mergedItems),
            spreadsheetStatus: "pending",
          });
          // 既存の山積み記録の山積み分（2件目以降）を削除
          for (const rec of sameTracking.slice(1)) await deleteFedexShipment(rec.id);
          // Keep the displayed delivery number and linked history in sync after merging.
          await updateFedexShipmentHistoryAndDeliveryNo(keepId, input.historyId ?? null, input.deliveryNo);
          await recordWorkLog({
            workerName: workOperatorName,
            category: "FedEx発送登録",
            status: "done",
            startedAt: new Date(),
            endedAt: new Date(),
            quantity: sumWorkQuantity(gasItems),
            memo: `出庫No: ${input.deliveryNo} / 追跡番号: ${input.trackingNumber}`,
            createdBy: workOperatorName,
            sourceType: "fedex",
            sourceId: `${input.deliveryNo}:${input.trackingNumber}`,
            detailsJson: JSON.stringify({
              deliveryNo: input.deliveryNo,
              sheetName: input.sheetName,
              shippingDate: input.shippingDate,
              trackingNumber: input.trackingNumber,
              items: gasItems,
            }),
          });
          const gasResult = await callGasWrite(getGasItemsForWrite(gasItems));
          if (gasResult.success) {
            await updateFedexShipmentStatus(keepId, "success");
            return { id: keepId, success: true, message: `同一追跡番号の既存記録と合算してスプシを更新しました（合計: ${mergedItems.map((i) => `${i.productNameJa} x${i.quantity}`).join(", ")}）` };
          } else {
            await updateFedexShipmentStatus(keepId, "error", gasResult.message ?? "不明なエラー");
            return { id: keepId, success: false, message: `DB合算済み。スプシ更新失敗: ${gasResult.message}` };
          }
        }

        // 同一追跡番号なし: 通常登録
        const id = await createFedexShipment({
          deliveryNo: input.deliveryNo,
          sheetName: input.sheetName,
          shippingDate: input.shippingDate,
          trackingNumber: input.trackingNumber,
          itemsJson: JSON.stringify(gasItems),
          spreadsheetStatus: "pending",
          operatorName: workOperatorName,
          historyId: input.historyId ?? null,
        });
        await recordWorkLog({
          workerName: workOperatorName,
          category: "FedEx発送登録",
          status: "done",
          startedAt: new Date(),
          endedAt: new Date(),
          quantity: sumWorkQuantity(gasItems),
          memo: `出庫No: ${input.deliveryNo} / 追跡番号: ${input.trackingNumber}`,
          createdBy: workOperatorName,
          sourceType: "fedex",
          sourceId: `${input.deliveryNo}:${input.trackingNumber}`,
          detailsJson: JSON.stringify({
            deliveryNo: input.deliveryNo,
            sheetName: input.sheetName,
            shippingDate: input.shippingDate,
            trackingNumber: input.trackingNumber,
            items: gasItems,
          }),
        });

        if (!gasUrl) {
          await updateFedexShipmentStatus(id, "error", "GAS_WEBHOOK_URL が未設定です");
          return { id, success: false, message: "GAS_WEBHOOK_URL が未設定です。管理者に連絡してください。" };
        }

        const gasResult = await callGasWrite(getGasItemsForWrite(gasItems));
        if (gasResult.success) {
          await updateFedexShipmentStatus(id, "success");
          return { id, success: true, message: "スプシへの書き込みが完了しました" };
        } else {
          await updateFedexShipmentStatus(id, "error", gasResult.message ?? "不明なエラー");
          return { id, success: false, message: gasResult.message ?? "スプシへの書き込みに失敗しました" };
        }
      }),

    /**
     * FedEx発送記録を削除する（DBのみ、GASには通知しない旧バージョン）
     */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await deleteFedexShipment(input.id);
        return { success: true };
      }),

    /**
     * FedEx発送記録を削除し、GASを通じてスプシからも削除する
     */
    deleteWithGas: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const records = await getAllFedexShipments();
        const record = records.find((r) => r.id === input.id);
        if (!record) {
          await deleteFedexShipment(input.id);
          return { success: true, message: "発送記録を削除しました" };
        }
        // DBから削除
        await deleteFedexShipment(input.id);
        // GASを通じてスプシからも削除
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        if (!gasUrl) {
          return { success: true, message: "DBから削除しました（GAS_WEBHOOK_URLが未設定のためスプシは未反映）" };
        }
        try {
          const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
          const payload = {
            secret,
            action: "deleteShipmentBatch",
            sheetName: record.sheetName,
            trackingNumber: record.trackingNumber,
          };
          const res1 = await fetch(gasUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            redirect: "manual",
          });
          let text: string;
          if (res1.status === 302 || res1.status === 301) {
            const redirectUrl = res1.headers.get("location") ?? gasUrl;
            const res2 = await fetch(redirectUrl, { method: "GET" });
            text = await res2.text();
          } else {
            text = await res1.text();
          }
          let result: { success: boolean; message?: string };
          try { result = JSON.parse(text); } catch { result = { success: false, message: text }; }
          if (result.success) {
            return { success: true, message: "DBとスプシから削除しました" };
          } else {
            return { success: true, message: `DBから削除しました（スプシ削除失敗: ${result.message}）` };
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { success: true, message: `DBから削除しました（GASエラー: ${msg}）` };
        }
      }),

    /**
     * FedEx発送記録を更新し、GASを通じてスプシも更新する
     */
    updateWithGas: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        trackingNumber: z.string(),
        shippingDate: z.string(),
        items: z.array(z.object({
          productNameJa: z.string(),
          productNameEn: z.string(),
          quantity: z.number().int().positive(),
          managementNo: z.string().nullable().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const records = await getAllFedexShipments();
        const record = records.find((r) => r.id === input.id);
        if (!record) {
          return { success: false, message: "発送記録が見つかりません" };
        }
        const oldTrackingNumber = record.trackingNumber;
        // GASを通じてスプシも更新
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        if (!gasUrl) {
          await updateFedexShipment(input.id, { spreadsheetStatus: "error", spreadsheetError: "GAS_WEBHOOK_URLが未設定" });
          return { success: false, message: "GAS_WEBHOOK_URL が未設定です。管理者に連絡してください。" };
        }
        try {
          const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
          const history = record.historyId ? await getDeliveryHistoryById(record.historyId).catch(() => null) : null;
          const deliveryNoForGas = history?.deliveryNo?.trim() || record.deliveryNo;
          if (deliveryNoForGas !== record.deliveryNo) {
            await updateFedexShipmentHistoryAndDeliveryNo(input.id, record.historyId ?? null, deliveryNoForGas);
          }
          const invoiceNo = invoiceNoFromDeliveryNo(deliveryNoForGas);
          const sourceItems = (await getShipmentItemsForHistory(record.historyId)) ?? input.items;
          const gasItems = await alignShipmentItemsToOrderRows(invoiceNo, sourceItems);
          // DBを更新
          await updateFedexShipment(input.id, {
            trackingNumber: input.trackingNumber,
            shippingDate: input.shippingDate,
            itemsJson: JSON.stringify(gasItems),
            spreadsheetStatus: "pending",
          });
          const postGas = async (payload: Record<string, unknown>): Promise<{ success: boolean; message?: string }> => {
            const res1 = await fetch(gasUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              redirect: "manual",
            });
            let text: string;
            if (res1.status === 302 || res1.status === 301) {
              const redirectUrl = res1.headers.get("location") ?? gasUrl;
              const res2 = await fetch(redirectUrl, { method: "GET" });
              text = await res2.text();
            } else {
              text = await res1.text();
            }
            try { return JSON.parse(text); } catch { return { success: false, message: text }; }
          };
          const payload = {
            secret,
            action: "updateShipmentBatch",
            sheetName: record.sheetName,
            oldTrackingNumber,
            trackingNumber: input.trackingNumber,
            shippingDate: input.shippingDate,
            invoiceNo,
            items: gasItems,
          };
          let result = await postGas(payload);
          if (!result.success && /見つかりません|not\s*found/i.test(result.message ?? "")) {
            result = await postGas({
              secret,
              action: "writeShipmentBatch",
              deliveryNo: deliveryNoForGas,
              invoiceNo,
              sheetName: record.sheetName,
              shippingDate: input.shippingDate,
              trackingNumber: input.trackingNumber,
              items: gasItems,
            });
          }
          if (result.success) {
            await updateFedexShipment(input.id, { spreadsheetStatus: "success", spreadsheetError: null });
            return { success: true, message: "発送情報を更新しました" };
          } else {
            await updateFedexShipment(input.id, { spreadsheetStatus: "error", spreadsheetError: result.message ?? "不明なエラー" });
            return { success: false, message: result.message ?? "スプシへの更新に失敗しました" };
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await updateFedexShipment(input.id, { spreadsheetStatus: "error", spreadsheetError: msg });
          return { success: false, message: `GAS呼び出しエラー: ${msg}` };
        }
      }),

    /**
     * 複数グループをまとめてFedEx発送登録する（バッチ登録）
     * 出庫Noから取引先を自動判別してシートを振り分ける
     */
    createBatch: protectedProcedure
      .input(z.object({
        shippingDate: z.string(),
        shipments: z.array(z.object({
          deliveryNo: z.string(),
          sheetName: shipmentSheetNameSchema.optional(),
          trackingNumber: z.string(),
          historyId: z.number().int().positive().optional(),
          items: z.array(z.object({
            productNameJa: z.string(),
            productNameEn: z.string(),
            quantity: z.number().int().positive(),
            managementNo: z.string().nullable().optional(),
          })),
        })),
        operatorName: z.string().max(200).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        type MergeItem = ShipmentGasItem;
        const results: Array<{ deliveryNo: string; sheetName: string; trackingNumber: string; id: number; success: boolean; message: string }> = [];
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
        const workOperatorName = resolveWorkOperatorName(input.operatorName, ctx.user.name ?? ctx.user.email ?? null);
        const alignedShipments = await Promise.all(input.shipments.map(async (shipment) => {
          const sheetName = shipment.sheetName ?? detectShipmentSheetName(shipment.deliveryNo);
          const invoiceNo = invoiceNoFromDeliveryNo(shipment.deliveryNo);
          const sourceItems = (await getShipmentItemsForHistory(shipment.historyId)) ?? shipment.items;
          const gasItems = await alignShipmentItemsToOrderRows(invoiceNo, sourceItems);
          return { ...shipment, sheetName, invoiceNo, gasItems };
        }));

        function getBatchGasItemsForWrite(target: { deliveryNo: string; sheetName: ShipmentSheetName; trackingNumber: string; invoiceNo: string; historyId?: number | null }): MergeItem[] {
          return mergeShipmentGasItems(alignedShipments
            .filter((shipment) =>
              shipment.sheetName === target.sheetName &&
              shipment.trackingNumber === target.trackingNumber &&
              shipment.invoiceNo === target.invoiceNo
            )
            .flatMap((shipment) => shipment.gasItems));
        }

        async function callGasBatchWrite(sheetName: string, deliveryNo: string, trackingNumber: string, items: MergeItem[]): Promise<{ success: boolean; message?: string }> {
          if (!gasUrl) return { success: false, message: "GAS_WEBHOOK_URLが未設定" };
          try {
            const invoiceNo = invoiceNoFromDeliveryNo(deliveryNo);
            const payload = { secret, action: "writeShipmentBatch", deliveryNo, invoiceNo, sheetName, shippingDate: input.shippingDate, trackingNumber, items };
            const res = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "manual" });
            let text: string;
            if (res.status === 302 || res.status === 301) { const loc = res.headers.get("location") ?? gasUrl; const r2 = await fetch(loc, { method: "GET" }); text = await r2.text(); }
            else { text = await res.text(); }
            try { return JSON.parse(text); } catch { return { success: false, message: text }; }
          } catch (e) { return { success: false, message: e instanceof Error ? e.message : String(e) }; }
        }
        const allRecords = await alignShipmentItemsWithDeliveryHistories(await getAllFedexShipments());
        const liveHistoryIds = await getLiveDeliveryHistoryIds();

        function parseShipmentRecordItems(itemsJson: string): MergeItem[] {
          try {
            return JSON.parse(itemsJson) as MergeItem[];
          } catch {
            return [];
          }
        }

        function getExistingGasItemsForWrite(target: { deliveryNo: string; sheetName: ShipmentSheetName; trackingNumber: string; invoiceNo: string; historyId?: number | null }): MergeItem[] {
          return mergeShipmentGasItems(allRecords
            .filter((record) => shouldUseExistingShipmentForGas(record, {
              deliveryNo: target.deliveryNo,
              sheetName: target.sheetName,
              trackingNumber: target.trackingNumber,
              invoiceNo: target.invoiceNo,
              historyId: target.historyId ?? null,
            }, liveHistoryIds))
            .flatMap((record) => parseShipmentRecordItems(record.itemsJson)));
        }

        function getGasItemsForWrite(target: { deliveryNo: string; sheetName: ShipmentSheetName; trackingNumber: string; invoiceNo: string; historyId?: number | null }): MergeItem[] {
          return mergeShipmentGasItems([
            ...getExistingGasItemsForWrite(target),
            ...getBatchGasItemsForWrite(target),
          ]);
        }

        for (const shipment of alignedShipments) {
          const { sheetName, gasItems } = shipment;
          // 同一追跡番号かつ同一出庫Noの既存記録を確認
          const sameTracking = allRecords.filter((r) =>
            r.trackingNumber === shipment.trackingNumber &&
            r.deliveryNo === shipment.deliveryNo &&
            (shipment.historyId ? r.historyId === shipment.historyId : !r.historyId)
          );

          if (sameTracking.length > 0) {
            // 自動合算
            const existingItems: MergeItem[] = [];
            for (const rec of sameTracking) {
              existingItems.push(...parseShipmentRecordItems(rec.itemsJson));
            }
            const mergedItems = mergeShipmentGasItems([...existingItems, ...gasItems]);
            const gasItemsForWrite = getGasItemsForWrite(shipment);
            const keepId = sameTracking[0].id;
            await updateFedexShipment(keepId, { sheetName, shippingDate: input.shippingDate, itemsJson: JSON.stringify(mergedItems), spreadsheetStatus: "pending" });
            for (const rec of sameTracking.slice(1)) await deleteFedexShipment(rec.id);
            await updateFedexShipmentHistoryAndDeliveryNo(keepId, shipment.historyId ?? null, shipment.deliveryNo);
            await recordWorkLog({
              workerName: workOperatorName,
              category: "FedEx発送登録",
              status: "done",
              startedAt: new Date(),
              endedAt: new Date(),
              quantity: sumWorkQuantity(gasItems),
              memo: `出庫No: ${shipment.deliveryNo} / 追跡番号: ${shipment.trackingNumber}`,
              createdBy: workOperatorName,
              sourceType: "fedex",
              sourceId: `${shipment.deliveryNo}:${shipment.trackingNumber}`,
              detailsJson: JSON.stringify({
                deliveryNo: shipment.deliveryNo,
                sheetName,
                shippingDate: input.shippingDate,
                trackingNumber: shipment.trackingNumber,
                items: gasItems,
              }),
            });
            const gasResult = await callGasBatchWrite(sheetName, shipment.deliveryNo, shipment.trackingNumber, gasItemsForWrite);
            if (gasResult.success) {
              await updateFedexShipmentStatus(keepId, "success");
              results.push({ deliveryNo: shipment.deliveryNo, sheetName, trackingNumber: shipment.trackingNumber, id: keepId, success: true, message: `合算してスプシ更新` });
            } else {
              await updateFedexShipmentStatus(keepId, "error", gasResult.message ?? "不明なエラー");
              results.push({ deliveryNo: shipment.deliveryNo, sheetName, trackingNumber: shipment.trackingNumber, id: keepId, success: false, message: `DB合算済み。スプシ失敗: ${gasResult.message}` });
            }
            continue;
          }

          // 通常登録
          const gasItemsForWrite = getGasItemsForWrite(shipment);
          const id = await createFedexShipment({
            deliveryNo: shipment.deliveryNo,
            sheetName,
            shippingDate: input.shippingDate,
            trackingNumber: shipment.trackingNumber,
            itemsJson: JSON.stringify(gasItems),
            spreadsheetStatus: "pending",
            operatorName: workOperatorName,
            historyId: shipment.historyId ?? null,
          });
          await recordWorkLog({
            workerName: workOperatorName,
            category: "FedEx発送登録",
            status: "done",
            startedAt: new Date(),
            endedAt: new Date(),
            quantity: sumWorkQuantity(gasItems),
            memo: `出庫No: ${shipment.deliveryNo} / 追跡番号: ${shipment.trackingNumber}`,
            createdBy: workOperatorName,
            sourceType: "fedex",
            sourceId: `${shipment.deliveryNo}:${shipment.trackingNumber}`,
            detailsJson: JSON.stringify({
              deliveryNo: shipment.deliveryNo,
              sheetName,
              shippingDate: input.shippingDate,
              trackingNumber: shipment.trackingNumber,
              items: gasItems,
            }),
          });
          if (!gasUrl) {
            await updateFedexShipmentStatus(id, "error", "GAS_WEBHOOK_URL が未設定です");
            results.push({ deliveryNo: shipment.deliveryNo, sheetName, trackingNumber: shipment.trackingNumber, id, success: false, message: "GAS_WEBHOOK_URL が未設定です" });
            continue;
          }
          const gasResult = await callGasBatchWrite(sheetName, shipment.deliveryNo, shipment.trackingNumber, gasItemsForWrite);
          if (gasResult.success) {
            await updateFedexShipmentStatus(id, "success");
            results.push({ deliveryNo: shipment.deliveryNo, sheetName, trackingNumber: shipment.trackingNumber, id, success: true, message: "書き込み完了" });
          } else {
            await updateFedexShipmentStatus(id, "error", gasResult.message ?? "不明なエラー");
            results.push({ deliveryNo: shipment.deliveryNo, sheetName, trackingNumber: shipment.trackingNumber, id, success: false, message: gasResult.message ?? "スプシへの書き込みに失敗" });
          }
        }
        const allSuccess = results.every((r) => r.success);
        const successCount = results.filter((r) => r.success).length;
        return {
          results,
          success: allSuccess,
          message: allSuccess
            ? `${successCount}件の発送情報をスプシに登録しました`
            : `${successCount}/${results.length}件成功（一部失敗あり）`,
        };
      }),
    /**
     * 同一追跡番号の複数FedEx発送記録を合算して1件にまとめ、スプシに再送信する
     */
    mergeByTracking: protectedProcedure
      .input(z.object({
        trackingNumber: z.string(),
        sheetName: z.string(),
        shippingDate: z.string(),
      }))
      .mutation(async ({ input }) => {
        const allRecords = await getAllFedexShipments();
        const targets = allRecords.filter((r) => r.trackingNumber === input.trackingNumber);
        if (targets.length === 0) return { success: false, message: "記録が見つかりません" };
        if (targets.length === 1) return { success: false, message: "合算対象が1件のみです（複数件必要）" };
        type Item = { productNameJa: string; productNameEn: string; quantity: number };
        const mergedMap = new Map<string, Item>();
        for (const rec of targets) {
          let items: Item[] = [];
          try { items = JSON.parse(rec.itemsJson); } catch { items = []; }
          for (const item of items) {
            const key = item.productNameJa;
            if (mergedMap.has(key)) mergedMap.get(key)!.quantity += item.quantity;
            else mergedMap.set(key, { ...item });
          }
        }
        const mergedItems = Array.from(mergedMap.values());
        const keepId = targets[0].id;
        await updateFedexShipment(keepId, {
          sheetName: input.sheetName,
          shippingDate: input.shippingDate,
          itemsJson: JSON.stringify(mergedItems),
          spreadsheetStatus: "pending",
        });
        for (const rec of targets.slice(1)) await deleteFedexShipment(rec.id);
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        if (!gasUrl) return { success: true, message: `DBで${targets.length}件を合算しました（GAS未設定）` };
        try {
          const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
          const delPayload = { secret, action: "deleteShipmentBatch", sheetName: input.sheetName, trackingNumber: input.trackingNumber };
          const delRes = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(delPayload), redirect: "manual" });
          if (delRes.status === 302 || delRes.status === 301) { const loc = delRes.headers.get("location") ?? gasUrl; await fetch(loc, { method: "GET" }); }
          const writePayload = { secret, action: "writeShipmentBatch", sheetName: input.sheetName, shippingDate: input.shippingDate, trackingNumber: input.trackingNumber, items: mergedItems };
          const writeRes = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(writePayload), redirect: "manual" });
          let text: string;
          if (writeRes.status === 302 || writeRes.status === 301) { const loc = writeRes.headers.get("location") ?? gasUrl; const r2 = await fetch(loc, { method: "GET" }); text = await r2.text(); } else { text = await writeRes.text(); }
          let result: { success: boolean; message?: string };
          try { result = JSON.parse(text); } catch { result = { success: false, message: text }; }
          if (result.success) {
            await updateFedexShipmentStatus(keepId, "success");
            return { success: true, message: `${targets.length}件を合算してスプシに再送信しました（合計: ${mergedItems.map((i) => `${i.productNameJa} x${i.quantity}`).join(", ")}）` };
          } else {
            await updateFedexShipmentStatus(keepId, "error", result.message ?? "不明なエラー");
            return { success: true, message: `DBで合算しましたがスプシへの書き込みに失敗: ${result.message}` };
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await updateFedexShipmentStatus(keepId, "error", msg);
          return { success: false, message: `GASエラー: ${msg}` };
        }
      }),
});
