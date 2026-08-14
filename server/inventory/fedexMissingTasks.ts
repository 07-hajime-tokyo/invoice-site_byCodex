import { and, desc, eq } from "drizzle-orm";
import { actionItems, deliveryHistories, fedexShipments, outboundBoxes } from "../../drizzle/schema";
import { getDb } from "./db";

type JsonObject = Record<string, unknown>;

type DeliveryScanResult = {
  historyId: number;
  deliveryNo: string;
  deliveryDate: string;
  invoiceNo: string;
  directQuantity: number;
  fedexQuantity: number;
  missingQuantity: number;
  products: string[];
  managementNos: string[];
};

function parseJsonArray(value: string | null | undefined): JsonObject[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function parseJsonList(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseNumber(value: unknown) {
  const num = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function getItemTitle(item: JsonObject) {
  return String(
    item.title ??
      item.name ??
      item.productName ??
      item.productNameJa ??
      item.productNameEn ??
      "",
  ).trim();
}

function getItemQuantity(item: JsonObject) {
  return parseNumber(item.quantity ?? item.qty ?? item.stockQty ?? 1) || 1;
}

function getItemInventoryId(item: JsonObject) {
  const value = item.inventoryId ?? item.inventory_id ?? item.id ?? item.zaicoId;
  return value == null ? "" : String(value);
}

function getItemManagementNo(item: JsonObject) {
  return String(item.etc ?? item.managementNo ?? item.kanriNo ?? "").split(",")[0]?.trim() ?? "";
}

function isFedexExcludedManagementNo(managementNo: string) {
  const raw = managementNo.normalize("NFKC").trim();
  if (!raw) return false;
  return /^(ebay|e\d|在庫|シャフト|shaft)/i.test(raw) || /ebay/i.test(raw);
}

function isDirectTradeFedexTarget(deliveryNo: unknown, managementNo: string) {
  const raw = managementNo.normalize("NFKC").trim();
  if (isFedexExcludedManagementNo(raw)) return false;
  const normalizedDeliveryNo = String(deliveryNo ?? "").normalize("NFKC").trim();
  return /^\d{3,4}(?:$|[_-])/.test(normalizedDeliveryNo);
}

function extractInvoiceNo(deliveryNo: string) {
  return deliveryNo.match(/^(\d{3,4})/)?.[1] ?? deliveryNo;
}

function dateFromDeliveryNo(deliveryNo: string) {
  const match = deliveryNo.match(/20\d{6}/);
  if (!match) return null;
  const raw = match[0];
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function toTime(value: unknown) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toJstDateText(value: unknown, deliveryNo: string) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
  return dateFromDeliveryNo(deliveryNo)?.replace(/-/g, "/") ?? "日付不明";
}

function getDeletedIds(value: string | null | undefined) {
  return new Set(
    parseJsonList(value)
      .map((item) => {
        if (item && typeof item === "object") {
          const row = item as JsonObject;
          return String(row.inventoryId ?? row.id ?? row.zaicoId ?? "");
        }
        return String(item ?? "");
      })
      .filter(Boolean),
  );
}

function getCancelledQuantityByInventoryId(value: string | null | undefined) {
  const map = new Map<string, number>();
  for (const item of parseJsonArray(value)) {
    const inventoryId = String(item.inventoryId ?? item.id ?? item.zaicoId ?? "");
    if (!inventoryId) continue;
    map.set(inventoryId, (map.get(inventoryId) ?? 0) + (parseNumber(item.quantity) || 1));
  }
  return map;
}

function getActiveDirectDeliveryItems(history: typeof deliveryHistories.$inferSelect) {
  const deletedIds = getDeletedIds(history.deletedInventoryIdsJson);
  const cancelledQtyByInventoryId = getCancelledQuantityByInventoryId(history.cancelledItemsJson);
  const items = parseJsonArray(history.itemsJson);

  return items.flatMap((item) => {
    const inventoryId = getItemInventoryId(item);
    if (inventoryId && deletedIds.has(inventoryId)) return [];
    const managementNo = getItemManagementNo(item);
    if (!isDirectTradeFedexTarget(history.deliveryNo, managementNo)) return [];

    const quantity = Math.max(0, getItemQuantity(item) - (inventoryId ? (cancelledQtyByInventoryId.get(inventoryId) ?? 0) : 0));
    if (quantity <= 0) return [];
    return [{
      title: getItemTitle(item),
      managementNo,
      quantity,
    }];
  });
}

function getFedexShipmentQuantity(shipment: typeof fedexShipments.$inferSelect) {
  if (!String(shipment.trackingNumber ?? "").trim()) return 0;
  const items = parseJsonArray(shipment.itemsJson);
  return items.reduce((sum, item) => sum + getItemQuantity(item), 0);
}

function buildTaskDetail(result: DeliveryScanResult) {
  const productSummary = result.products.slice(0, 6).join(" / ") || "商品名不明";
  const managementSummary = result.managementNos.length ? `\n管理番号: ${result.managementNos.slice(0, 8).join(" / ")}` : "";
  return [
    `${result.deliveryDate}出庫のNo.${result.invoiceNo}で、FedEx発送登録漏れがあります。`,
    "",
    `出庫No: ${result.deliveryNo}`,
    `出庫数: ${result.directQuantity}`,
    `FedEx登録数: ${result.fedexQuantity}`,
    `不足数: ${result.missingQuantity}`,
    `商品: ${productSummary}${managementSummary}`,
    "",
    "出庫履歴を確認して、必要であればFedEx発送登録を追加してください。",
  ].join("\n");
}

export async function createFedexMissingActionItems() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const lookbackDays = Math.max(1, Number(process.env.FEDEX_MISSING_LOOKBACK_DAYS ?? 7) || 7);
  const graceHours = Math.max(0, Number(process.env.FEDEX_MISSING_GRACE_HOURS ?? 6) || 6);
  const now = Date.now();
  const fromMs = now - lookbackDays * 24 * 60 * 60 * 1000;
  const beforeMs = now - graceHours * 60 * 60 * 1000;

  // 箱経由は個体名・数量の曖昧マッチをせず、箱の状態をそのまま正本にする。
  const boxes = await db.select().from(outboundBoxes).orderBy(desc(outboundBoxes.createdAt)).limit(500);
  let boxCreated = 0;
  let boxSkippedExisting = 0;
  let boxCompleted = 0;
  for (const box of boxes) {
    const sourceKey = `fedex-missing-box:${box.id}`;
    const existingOpenTasks = await db
      .select()
      .from(actionItems)
      .where(and(eq(actionItems.sourceKey, sourceKey), eq(actionItems.status, "open")));
    if (box.status !== "sealed") {
      if (existingOpenTasks.length > 0) {
        await db.update(actionItems)
          .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(actionItems.sourceKey, sourceKey), eq(actionItems.status, "open")));
        boxCompleted += existingOpenTasks.length;
      }
      continue;
    }
    const sealedMs = toTime(box.sealedAt ?? box.createdAt);
    if (sealedMs == null || sealedMs > beforeMs) continue;
    if (existingOpenTasks.length > 0) {
      boxSkippedExisting += existingOpenTasks.length;
      continue;
    }
    await db.insert(actionItems).values({
      title: "FedEx発送登録待ちの箱",
      assignee: "出荷担当",
      detail: `${box.boxCode} は封箱済みですが、追跡番号がまだ紐付いていません。出庫画面で箱ID→FedExラベルの順にスキャンしてください。`,
      status: "open",
      source: "cron-fedex-missing",
      sourceKey,
      sourceQuestion: "毎朝7時の箱ステータスチェック",
      createdBy: "cron",
    });
    boxCreated += 1;
  }

  const [histories, shipments] = await Promise.all([
    db.select().from(deliveryHistories).orderBy(desc(deliveryHistories.createdAt)).limit(500),
    db.select().from(fedexShipments).orderBy(desc(fedexShipments.createdAt)).limit(1500),
  ]);

  const results: DeliveryScanResult[] = [];
  for (const history of histories) {
    if (history.status !== "success") continue;
    const createdMs = toTime(history.createdAt);
    if (createdMs == null || createdMs < fromMs || createdMs > beforeMs) continue;

    const activeDirectItems = getActiveDirectDeliveryItems(history);
    const directQuantity = activeDirectItems.reduce((sum, item) => sum + item.quantity, 0);
    if (directQuantity <= 0) continue;

    const relatedShipments = shipments.filter((shipment) =>
      shipment.historyId === history.id ||
      (!shipment.historyId && shipment.deliveryNo === history.deliveryNo),
    );
    const fedexQuantity = relatedShipments.reduce((sum, shipment) => sum + getFedexShipmentQuantity(shipment), 0);
    const missingQuantity = Math.max(0, directQuantity - fedexQuantity);

    results.push({
      historyId: history.id,
      deliveryNo: history.deliveryNo,
      deliveryDate: toJstDateText(history.createdAt, history.deliveryNo),
      invoiceNo: extractInvoiceNo(history.deliveryNo),
      directQuantity,
      fedexQuantity,
      missingQuantity,
      products: Array.from(new Set(activeDirectItems.map((item) => item.title).filter(Boolean))),
      managementNos: Array.from(new Set(activeDirectItems.map((item) => item.managementNo).filter(Boolean))),
    });
  }

  let created = 0;
  let skippedExisting = 0;
  let completed = 0;

  for (const result of results) {
    const sourceKey = `fedex-missing-history:${result.historyId}`;
    const existingOpenTasks = await db
      .select()
      .from(actionItems)
      .where(and(eq(actionItems.sourceKey, sourceKey), eq(actionItems.status, "open")));

    if (result.missingQuantity <= 0) {
      if (existingOpenTasks.length > 0) {
        await db
          .update(actionItems)
          .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(actionItems.sourceKey, sourceKey), eq(actionItems.status, "open")));
        completed += existingOpenTasks.length;
      }
      continue;
    }

    if (existingOpenTasks.length > 0) {
      skippedExisting += existingOpenTasks.length;
      continue;
    }

    await db.insert(actionItems).values({
      title: "FedEx発送登録漏れ",
      assignee: "出荷担当",
      detail: buildTaskDetail(result),
      status: "open",
      source: "cron-fedex-missing",
      sourceKey,
      sourceQuestion: "毎朝7時の自動チェック",
      createdBy: "cron",
    });
    created += 1;
  }

  return {
    ok: true,
    lookbackDays,
    graceHours,
    scanned: histories.length,
    candidates: results.length,
    missing: results.filter((result) => result.missingQuantity > 0).length,
    created,
    skippedExisting,
    completed,
    boxesScanned: boxes.length,
    sealedBoxes: boxes.filter((box) => box.status === "sealed").length,
    boxCreated,
    boxSkippedExisting,
    boxCompleted,
  };
}
