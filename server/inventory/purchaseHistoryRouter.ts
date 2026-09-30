import { type LocalPurchaseRow } from "./purchaseRowTypes";
import { resolveOperatorToken } from "./workOperator";
import {
  historyDateFrom,
  normalizePurchaseHistoryText,
  firstPurchaseHistoryEtcPart,
  positiveHistoryNumber,
  parseLocalPurchaseItems,
} from "./purchases/legacyValues";
import { getInventoryManagementNo } from "./managementNo";
import { z } from "zod";
import { createPurchase, getMaxPurchaseNum, getPurchaseById, deletePurchase } from "./zaico";
import {
  getPurchaseHistories,
  cancelPurchaseHistory,
  getLocalInventories,
  getLocalInventoryByZaicoIdOrId,
  updateLocalInventory,
  getLocalPurchases,
  updateLocalPurchaseStatus,
  isZaicoEnabled,
} from "./db";
import { protectedProcedure, router } from "../_core/trpc";

const publicProcedure = protectedProcedure;

type PurchaseHistoryRow = Awaited<ReturnType<typeof getPurchaseHistories>>[number];

function historyTimestampFrom(value: unknown, fallback = new Date()): Date {
  const date = value ? new Date(value as string | number | Date) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function purchaseHistoryKey(row: Pick<PurchaseHistoryRow, "zaicoId" | "inventoryId" | "kanriNo" | "title">): string {
  return [row.zaicoId, row.inventoryId ?? "", row.kanriNo ?? "", row.title].join("\u0001");
}

function nonEmptyPurchaseHistoryText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function localPurchaseItemQuantity(item: Record<string, unknown>): number {
  return positiveHistoryNumber(item.quantity ?? item.qty) ?? 0;
}

function localPurchaseItemMatchesHistory(
  row: PurchaseHistoryRow,
  item: Record<string, unknown>,
): boolean {
  const historyManagementNo = firstPurchaseHistoryEtcPart(row.kanriNo);
  const itemManagementNo = firstPurchaseHistoryEtcPart(
    item.etc ?? item.managementNo ?? item.kanriNo,
  );
  if (historyManagementNo && itemManagementNo && historyManagementNo === itemManagementNo) return true;

  const itemInventoryId = positiveHistoryNumber(item.inventory_id ?? item.inventoryId ?? item.zaicoId);
  const historyInventoryIds = [
    positiveHistoryNumber(row.inventoryId),
    positiveHistoryNumber(row.zaicoId),
  ].filter((id): id is number => id != null);
  if (itemInventoryId != null && historyInventoryIds.includes(itemInventoryId)) return true;

  const historyTitle = normalizePurchaseHistoryText(row.title);
  const itemTitle = normalizePurchaseHistoryText(item.title);
  return Boolean(historyTitle && itemTitle && historyTitle === itemTitle);
}

function localPurchaseQuantityForHistory(row: PurchaseHistoryRow, purchase: LocalPurchaseRow): number | null {
  const directQuantity = positiveHistoryNumber(purchase.quantity);
  const items = parseLocalPurchaseItems(purchase);
  const matchingItems = items.filter((item) => localPurchaseItemMatchesHistory(row, item));
  const quantityItems = matchingItems.length > 0
    ? matchingItems
    : items.length === 1
      ? items
      : [];
  const itemQuantity = quantityItems.reduce((sum, item) => sum + localPurchaseItemQuantity(item), 0);

  if (items.length === 1) return Math.max(itemQuantity, directQuantity ?? 0) || null;
  if (matchingItems.length > 0 && itemQuantity > 0) return itemQuantity;
  return items.length === 0 ? directQuantity : null;
}

function purchaseHistoryQuantityWithPurchase(row: PurchaseHistoryRow, purchase: LocalPurchaseRow): string {
  const purchaseQuantity = localPurchaseQuantityForHistory(row, purchase);
  if (purchaseQuantity == null) return row.quantity;
  return maxPurchaseHistoryQuantity(row.quantity, String(purchaseQuantity));
}

function historyRowCreatedMs(row: Pick<PurchaseHistoryRow, "createdAt">): number {
  const ms = new Date(row.createdAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function localPurchaseCreatedMs(row: LocalPurchaseRow): number {
  const ms = new Date(row.updatedAt ?? row.createdAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function preferLocalPurchaseCandidate(candidate: LocalPurchaseRow, current: LocalPurchaseRow): boolean {
  const candidateHasTracking = normalizePurchaseHistoryText(candidate.trackingNumber).length > 0;
  const currentHasTracking = normalizePurchaseHistoryText(current.trackingNumber).length > 0;
  if (candidateHasTracking !== currentHasTracking) return candidateHasTracking;
  return localPurchaseCreatedMs(candidate) > localPurchaseCreatedMs(current);
}

type LocalPurchaseHistoryLookup = {
  byPurchaseId: Map<number, LocalPurchaseRow>;
  byInventoryId: Map<number, LocalPurchaseRow>;
  byManagementNo: Map<string, LocalPurchaseRow>;
};

function buildLocalPurchaseHistoryLookup(rows: LocalPurchaseRow[]): LocalPurchaseHistoryLookup {
  const lookup: LocalPurchaseHistoryLookup = {
    byPurchaseId: new Map(),
    byInventoryId: new Map(),
    byManagementNo: new Map(),
  };

  function setBest<K>(map: Map<K, LocalPurchaseRow>, key: K | null | undefined, row: LocalPurchaseRow) {
    if (key == null || key === "") return;
    const current = map.get(key);
    if (!current || preferLocalPurchaseCandidate(row, current)) {
      map.set(key, row);
    }
  }

  for (const row of rows) {
    setBest(lookup.byPurchaseId, positiveHistoryNumber(row.id), row);
    setBest(lookup.byPurchaseId, positiveHistoryNumber(row.zaicoId), row);
    setBest(lookup.byInventoryId, positiveHistoryNumber(row.localInventoryId), row);
    setBest(lookup.byManagementNo, firstPurchaseHistoryEtcPart(row.managementNo), row);

    for (const item of parseLocalPurchaseItems(row)) {
      setBest(lookup.byInventoryId, positiveHistoryNumber(item.inventory_id ?? item.inventoryId), row);
      setBest(lookup.byManagementNo, firstPurchaseHistoryEtcPart(item.etc), row);
    }
  }

  return lookup;
}

function findLocalPurchaseForHistory(
  row: PurchaseHistoryRow,
  lookup: LocalPurchaseHistoryLookup,
): LocalPurchaseRow | null {
  const candidates: LocalPurchaseRow[] = [];
  const purchaseId = positiveHistoryNumber(row.zaicoId);
  const inventoryId = positiveHistoryNumber(row.inventoryId);
  const managementNo = firstPurchaseHistoryEtcPart(row.kanriNo);

  if (purchaseId != null) {
    const purchase = lookup.byPurchaseId.get(purchaseId);
    if (purchase) candidates.push(purchase);
  }
  if (inventoryId != null) {
    const purchase = lookup.byInventoryId.get(inventoryId);
    if (purchase) candidates.push(purchase);
  }
  if (managementNo) {
    const purchase = lookup.byManagementNo.get(managementNo);
    if (purchase) candidates.push(purchase);
  }

  return candidates.reduce<LocalPurchaseRow | null>((best, candidate) => {
    if (!best || preferLocalPurchaseCandidate(candidate, best)) return candidate;
    return best;
  }, null);
}

function enrichPurchaseHistoryRow(
  row: PurchaseHistoryRow,
  lookup: LocalPurchaseHistoryLookup,
): PurchaseHistoryRow {
  const purchase = findLocalPurchaseForHistory(row, lookup);
  if (!purchase) return row;

  return {
    ...row,
    category: row.category ?? purchase.category ?? null,
    supplier: nonEmptyPurchaseHistoryText(row.supplier) ?? nonEmptyPurchaseHistoryText(purchase.supplierName),
    quantity: purchaseHistoryQuantityWithPurchase(row, purchase),
    unitPrice: row.unitPrice ?? (purchase.unitPrice == null ? null : String(purchase.unitPrice)),
    inventoryId: row.inventoryId ?? purchase.localInventoryId ?? null,
    supplierUrl: nonEmptyPurchaseHistoryText(row.supplierUrl) ?? nonEmptyPurchaseHistoryText(purchase.supplierUrl),
    supplierName: nonEmptyPurchaseHistoryText(row.supplierName) ?? nonEmptyPurchaseHistoryText(purchase.supplierName),
    trackingNumber: nonEmptyPurchaseHistoryText(row.trackingNumber) ?? nonEmptyPurchaseHistoryText(purchase.trackingNumber),
    carrier: nonEmptyPurchaseHistoryText(row.carrier) ?? nonEmptyPurchaseHistoryText(purchase.carrier),
    receiptAckPurchaseId: purchase.id,
    receiptAckStatus: nonEmptyPurchaseHistoryText(purchase.receiptAckStatus),
    receiptAckSource: nonEmptyPurchaseHistoryText(purchase.receiptAckSource),
    receiptAckAt: purchase.receiptAckAt ?? null,
    receiptAckNote: nonEmptyPurchaseHistoryText(purchase.receiptAckNote),
  };
}

function purchaseHistoryMergeKey(row: PurchaseHistoryRow): string {
  const managementNo = firstPurchaseHistoryEtcPart(row.kanriNo);
  if (managementNo) return `management:${managementNo}`;

  const inventoryId = positiveHistoryNumber(row.inventoryId);
  const title = normalizePurchaseHistoryText(row.title);
  const date = normalizePurchaseHistoryText(row.purchaseDate);
  if (inventoryId != null && title) return `inventory:${inventoryId}:${title}:${date}`;

  return `row:${row.id}`;
}

function preferPurchaseHistoryRow(candidate: PurchaseHistoryRow, current: PurchaseHistoryRow): boolean {
  const candidateIsStored = candidate.id > 0;
  const currentIsStored = current.id > 0;
  if (candidateIsStored !== currentIsStored) return candidateIsStored;

  const candidateActive = candidate.cancelled === 0;
  const currentActive = current.cancelled === 0;
  if (candidateActive !== currentActive) return candidateActive;

  return historyRowCreatedMs(candidate) > historyRowCreatedMs(current);
}

function maxPurchaseHistoryQuantity(a: string, b: string): string {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return String(Math.max(na, nb));
  return a || b;
}

function mergePurchaseHistoryRows(a: PurchaseHistoryRow, b: PurchaseHistoryRow): PurchaseHistoryRow {
  const primary = preferPurchaseHistoryRow(b, a) ? b : a;
  const secondary = primary === a ? b : a;

  return {
    ...primary,
    kanriNo: primary.kanriNo ?? secondary.kanriNo,
    title: primary.title || secondary.title,
    category: primary.category ?? secondary.category,
    supplier: primary.supplier ?? secondary.supplier,
    quantity: maxPurchaseHistoryQuantity(primary.quantity, secondary.quantity),
    unitPrice: primary.unitPrice ?? secondary.unitPrice,
    purchaseDate: primary.purchaseDate || secondary.purchaseDate,
    inventoryId: primary.inventoryId ?? secondary.inventoryId,
    cancelled: primary.cancelled === 0 || secondary.cancelled === 0 ? 0 : primary.cancelled,
    operatorName: primary.operatorName ?? secondary.operatorName,
    supplierUrl: nonEmptyPurchaseHistoryText(primary.supplierUrl) ?? nonEmptyPurchaseHistoryText(secondary.supplierUrl),
    supplierName: nonEmptyPurchaseHistoryText(primary.supplierName) ?? nonEmptyPurchaseHistoryText(secondary.supplierName),
    trackingNumber: nonEmptyPurchaseHistoryText(primary.trackingNumber) ?? nonEmptyPurchaseHistoryText(secondary.trackingNumber),
    carrier: nonEmptyPurchaseHistoryText(primary.carrier) ?? nonEmptyPurchaseHistoryText(secondary.carrier),
    receiptAckPurchaseId: primary.receiptAckPurchaseId ?? secondary.receiptAckPurchaseId,
    receiptAckStatus: nonEmptyPurchaseHistoryText(primary.receiptAckStatus) ?? nonEmptyPurchaseHistoryText(secondary.receiptAckStatus),
    receiptAckSource: nonEmptyPurchaseHistoryText(primary.receiptAckSource) ?? nonEmptyPurchaseHistoryText(secondary.receiptAckSource),
    receiptAckAt: primary.receiptAckAt ?? secondary.receiptAckAt,
    receiptAckNote: nonEmptyPurchaseHistoryText(primary.receiptAckNote) ?? nonEmptyPurchaseHistoryText(secondary.receiptAckNote),
  };
}

function collapsePurchaseHistoryRows(rows: PurchaseHistoryRow[]): PurchaseHistoryRow[] {
  const byKey = new Map<string, PurchaseHistoryRow>();
  for (const row of rows) {
    const key = purchaseHistoryMergeKey(row);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergePurchaseHistoryRows(existing, row) : row);
  }
  return Array.from(byKey.values());
}

async function getRecoveredPurchaseHistoriesFromLabels(
  histories: PurchaseHistoryRow[],
  limit: number,
): Promise<PurchaseHistoryRow[]> {
  const existingKeys = new Set(histories.map(purchaseHistoryKey));
  const recovered: PurchaseHistoryRow[] = [];
  const inventories = await getLocalInventories();

  for (const inventory of inventories) {
    const zaicoId = Number(inventory.zaicoId ?? inventory.id);
    if (!Number.isFinite(zaicoId) || zaicoId <= 0) continue;

    for (const label of inventory.itemLabels ?? []) {
      const status = String(label.status ?? "").trim().toLowerCase();
      if (status !== "received" && status !== "stocked") continue;

      const kanriNo = label.legacyManagementNo?.trim() || getInventoryManagementNo(inventory.etc) || null;
      const title = label.title?.trim() || inventory.title;
      const key = purchaseHistoryKey({ zaicoId, inventoryId: inventory.id, kanriNo, title });
      if (existingKeys.has(key)) continue;

      const createdAt = historyTimestampFrom(label.receivedAt ?? label.createdAt ?? inventory.updatedAt);
      recovered.push({
        id: -Math.abs(Number(label.id ?? recovered.length + 1)),
        zaicoId,
        kanriNo,
        title,
        category: inventory.category ?? null,
        supplier: inventory.supplierName ?? null,
        quantity: "1",
        unitPrice: inventory.unitPrice == null ? null : String(inventory.unitPrice),
        purchaseDate: historyDateFrom(label.receivedAt ?? label.createdAt ?? inventory.updatedAt, createdAt),
        inventoryId: inventory.id,
        cancelled: 0,
        operatorName: null,
        createdAt,
        supplierUrl: inventory.supplierUrl ?? null,
        supplierName: inventory.supplierName ?? null,
        trackingNumber: null,
        carrier: null,
        receiptAckPurchaseId: null,
        receiptAckStatus: null,
        receiptAckSource: null,
        receiptAckAt: null,
        receiptAckNote: null,
      });
      existingKeys.add(key);
      if (recovered.length >= limit) return recovered;
    }
  }

  return recovered;
}

export const purchaseHistoryRouter = router({
    list: publicProcedure
      .input(z.object({ limit: z.number().int().positive().max(500).default(200) }))
      .query(async ({ input }) => {
        const histories = await getPurchaseHistories(input.limit);
        const localPurchases = await getLocalPurchases().catch((error) => {
          console.warn("[purchaseHistory.list] failed to load local purchases for enrichment:", error);
          return [] as LocalPurchaseRow[];
        });
        const localLookup = buildLocalPurchaseHistoryLookup(localPurchases);
        try {
          const recovered = await getRecoveredPurchaseHistoriesFromLabels(histories, input.limit);
          return collapsePurchaseHistoryRows([...histories, ...recovered].map((row) => enrichPurchaseHistoryRow(row, localLookup)))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, input.limit);
        } catch (error) {
          console.warn("[purchaseHistory.list] failed to recover QR inbound histories:", error);
          return collapsePurchaseHistoryRows(histories.map((row) => enrichPurchaseHistoryRow(row, localLookup)))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, input.limit);
        }
      }),

    cancel: publicProcedure
      .input(z.object({
        id: z.number().int().positive(),
        purchaseId: z.number().int().positive(),
        purchaseItems: z.array(
          z.object({
            inventory_id: z.number().int().positive(),
            quantity: z.union([z.string(), z.number()]).transform(String),
            unit_price: z.union([z.string(), z.number()]).transform(String),
          })
        ),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
        // 新規発注データ作成用の追加情報
        kanriNo: z.string().optional(),
        title: z.string().optional(),
        category: z.string().optional(),
        supplier: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const operatorToken = resolveOperatorToken(input.operatorKey);

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBの入庫取り消し
          // Step1: 入庫済みの発注をorderedに戺す
          const localPurchaseRows = await getLocalPurchases();
          const localPurchase = localPurchaseRows.find(
            (p) => p.zaicoId === input.purchaseId || p.id === input.purchaseId
          );
          if (localPurchase && localPurchase.status === "purchased") {
            await updateLocalPurchaseStatus(localPurchase.id, "ordered");
          }
          // Step2: 在庫数を入庫数量分減算する
          for (const item of input.purchaseItems) {
            const localInv = await getLocalInventoryByZaicoIdOrId(item.inventory_id);
            if (localInv) {
              const subQty = parseInt(item.quantity, 10) || 1;
              const newQty = Math.max(0, (localInv.quantity ?? 0) - subQty);
              await updateLocalInventory(localInv.id, { quantity: newQty });
            }
          }
          // Step3: DBの履歴を取り消し済みに更新
          await cancelPurchaseHistory(input.id);
          return { success: true };
        }

        // Zaico連携ON: 従来の処理
        // Step1: 元の発注データ情報を保存しておく（削除後に新規発注データを作成するため）
        const originalPurchase = await getPurchaseById(input.purchaseId, operatorToken);

        // Step2: Zaicoの入庫データを削除する
        // 入庫済みの場合、Zaico側で自動的に在庫数が入庫数量分だけ減算される
        try {
          await deletePurchase(input.purchaseId, operatorToken);
        } catch (e) {
          console.error(`[cancel] deletePurchase failed:`, e);
          throw e; // 入庫削除失敗時は処理を中断する
        }

        // Step3: 新規発注データ（orderedステータス）をZaicoに作成する
        try {
          const newPurchaseNum = await getMaxPurchaseNum(operatorToken);
          await createPurchase({
            num: String(newPurchaseNum + 1),
            customer_name: originalPurchase?.customer_name ?? (input.supplier ?? ""),
            status: "ordered",
            memo: originalPurchase?.memo,
            etc: originalPurchase?.etc,
            purchase_items: input.purchaseItems.map((item) => ({
              inventory_id: item.inventory_id,
              quantity: parseInt(item.quantity, 10) || 1,
              unit_price: parseFloat(item.unit_price) || undefined,
            })),
          }, operatorToken);
        } catch (e) {
          console.error(`[cancel] createPurchase failed:`, e);
        }

        // Step4: DBの履歴を取り消し済みに更新
        await cancelPurchaseHistory(input.id);
        return { success: true };
      }),
});
