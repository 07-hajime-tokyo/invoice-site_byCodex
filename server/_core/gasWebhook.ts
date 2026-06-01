import { createHash, timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import { and, desc, eq, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  localInventories,
  localPurchases,
  purchaseHistories,
} from "../../drizzle/schema";
import { getDb } from "../inventory/db";

const gasPayloadSchema = z.object({
  row: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const stringKeys = {
  sourceKey: ["sourceKey", "source_key", "idempotencyKey", "idempotency_key"],
  sheetName: ["sheetName", "sheet_name", "シート名"],
  rowNumber: ["rowNumber", "row_number", "rowIndex", "row_index", "rowNo", "row_no", "row", "行番号"],
  title: ["title", "productName", "product_name", "name", "商品名", "タイトル"],
  category: ["category", "カテゴリ", "カテゴリー"],
  place: ["place", "保管場所"],
  unit: ["unit", "単位"],
  managementNo: ["managementNo", "management_no", "kanriNo", "kanri_no", "srnNumber", "srn_number", "etc", "etcText", "etc_text", "管理番号", "管理No"],
  purchaseNum: ["purchaseNum", "purchase_num", "発注No", "発注番号"],
  purchaseDate: ["purchaseDate", "purchase_date", "発注日"],
  receivedDate: ["receivedDate", "received_date", "purchaseDateReceived", "入庫日"],
  shipDate: ["shipDate", "ship_date", "発送日"],
  trackingNumber: ["trackingNumber", "tracking_number", "追跡番号"],
  carrier: ["carrier", "配送業者"],
  note: ["note", "memo", "etcText", "etc_text", "備考", "メモ"],
  supplierUrl: ["supplierUrl", "supplier_url", "仕入先URL", "URL"],
  supplierName: ["supplierName", "supplier_name", "supplier", "supplierDetail", "supplier_detail", "仕入先", "仕入先名"],
  operatorName: ["operatorName", "operator_name", "担当者", "作業者"],
} as const;

const numberKeys = {
  inventoryId: ["inventoryId", "inventory_id", "在庫ID"],
  inventoryQuantity: ["inventoryQuantity", "inventory_quantity", "initialInventoryQuantity", "初期在庫数", "在庫数"],
  quantity: ["quantity", "qty", "数量", "入庫数", "発注数"],
  orderQuantity: ["orderQuantity", "order_quantity", "orderedQuantity", "ordered_quantity", "発注数量", "発注数"],
  unitPrice: ["unitPrice", "unit_price", "purchasePrice", "purchase_price", "price", "仕入単価", "単価"],
} as const;

const booleanKeys = {
  createInventory: ["createInventory", "create_inventory", "在庫登録"],
  markPurchased: ["markPurchased", "mark_purchased", "入庫済みにする"],
  dryRun: ["dryRun", "dry_run"],
} as const;

function getCandidate(payload: Record<string, unknown>, keys: readonly string[]) {
  const row = typeof payload.row === "object" && payload.row !== null
    ? (payload.row as Record<string, unknown>)
    : {};
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== "") return payload[key];
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return undefined;
}

function textField(payload: Record<string, unknown>, keys: readonly string[]) {
  const value = getCandidate(payload, keys);
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function numberField(payload: Record<string, unknown>, keys: readonly string[], fallback: number | null) {
  const value = getCandidate(payload, keys);
  if (value == null || value === "") return fallback;
  const normalized = String(value).replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanField(payload: Record<string, unknown>, keys: readonly string[], fallback: boolean) {
  const value = getCandidate(payload, keys);
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on", "checked"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off", "unchecked"].includes(normalized)) return false;
  return fallback;
}

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getCategoryFromProductContext(productName: string, ...context: Array<string | null | undefined>): string {
  const targetText = [productName, ...context].filter(Boolean).join(" ");
  if (!targetText) return "未分類";

  if (/(ゴルフ|golf|ゴルフパートナー|テーラーメイド|taylormade|キャロウェイ|callaway|タイトリスト|titleist|ピン(?!ク)|ping|ミズノ|mizuno|ダンロップ|dunlop|スリクソン|srixon|ゼクシオ|xxio|ブリヂストン|bridgestone|コブラ|cobra|クリーブランド|cleveland|ホンマ|honma|ツアーステージ|tourstage|オノフ|onoff|プロギア|prgr|マルマン|maruman|シャフト|ドライバー|アイアン|ウェッジ|パター|ユーティリティ|フェアウェイ|クラブ|ヘッド|ロフト|フレックス|tour\s*spec|speeder|スピーダー|diamana|ディアマナ|modus|モーダス|ns\s*pro|ventus|ベンタス|tensei|テンセイ)/i.test(targetText)) return "ゴルフ";
  if (/\b(sim|stealth|qi10|m[1-6])\b.*(\d{1,2}(?:\.\d)?\s*[°度]|driver|shaft|fw|ut)/i.test(targetText)) return "ゴルフ";
  if (/(\d{1,2}(?:\.\d)?\s*[°度]).*(シャフト|ドライバー|ヘッド|テーラーメイド|キャロウェイ|タイトリスト|ピン)/i.test(targetText)) return "ゴルフ";

  if (/switch\s*lite|スイッチ\s*ライト|switchlite/i.test(productName)) return "スイッチライト";
  if (/switch|スイッチ/i.test(productName)) return "スイッチ";
  if (/vita\s*2000|vita2000|pch-2/i.test(productName)) return "Vita2000";
  if (/vita\s*1000|vita1000|pch-1/i.test(productName)) return "Vita1000";
  if (/new\s*3ds\s*ll|new3dsll|new\s*3ds\s*xl/i.test(productName)) return "New3DSLL";
  if (/new\s*3ds(?!\s*ll|\s*xl)/i.test(productName)) return "New3DS";
  if (/new\s*2ds\s*ll|new2dsll/i.test(productName)) return "New2DSLL";
  if (/3ds\s*ll|3dsll|3ds\s*xl/i.test(productName)) return "3DSLL";
  if (/3ds(?!\s*ll|\s*xl)/i.test(productName)) return "3DS";
  if (/ds\s*lite|dslite/i.test(productName)) return "DS lite";
  if (/dsi\s*ll|dsi\s*xl/i.test(productName)) return "DSi LL";
  if (/dsi(?!\s*ll|\s*xl)/i.test(productName)) return "DSi";
  if (/psp/i.test(productName)) return "PSP";
  return "未分類";
}

function resolveSupplierName(supplier?: string | null, supplierDetail?: string | null): string | null {
  const base = supplier?.trim() ?? "";
  const detail = supplierDetail?.trim() ?? "";
  if (base && detail) {
    if (base.includes(detail)) return base;
    if (detail.includes(base)) return detail;
    return `${base} ${detail}`;
  }
  return base || detail || null;
}

function resolveWebhookCategory(
  productName: string,
  incomingCategory: string,
  ...context: Array<string | null | undefined>
): string | null {
  const incoming = incomingCategory.trim();
  const detected = getCategoryFromProductContext(productName, ...context);
  if (!incoming || incoming === "ゲーム" || incoming === "未分類") return detected;
  return incoming;
}

function combineOr(conditions: SQL<unknown>[]) {
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return or(...conditions);
}

function makeSourceKey(payload: Record<string, unknown>, managementNo: string, purchaseNum: string) {
  const explicit = textField(payload, stringKeys.sourceKey);
  if (explicit) return explicit;
  if (managementNo) return `management:${managementNo}`;
  if (purchaseNum) return `purchase:${purchaseNum}`;
  const sheetName = textField(payload, stringKeys.sheetName);
  const rowNumber = textField(payload, stringKeys.rowNumber);
  if (sheetName || rowNumber) return `sheet:${sheetName || "unknown"}:${rowNumber || "unknown"}`;
  return `payload:${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24)}`;
}

function syntheticZaicoId(sourceKey: string) {
  const hash = createHash("sha256").update(sourceKey).digest();
  return 1_500_000_000 + (hash.readUInt32BE(0) % 500_000_000);
}

function getProvidedSecret(req: Request) {
  const authorization = req.header("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const headerSecret = req.header("x-gas-secret");
  const bodySecret = typeof req.body?.secret === "string" ? req.body.secret : undefined;
  return (bearer || headerSecret || bodySecret || "").trim();
}

function secretsMatch(expected: string, provided: string) {
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function requireGasSecret(req: Request) {
  const expected = process.env.GAS_WEBHOOK_SECRET?.trim();
  if (!expected) {
    return { ok: false as const, status: 503, message: "GAS_WEBHOOK_SECRET is not configured" };
  }
  if (!secretsMatch(expected, getProvidedSecret(req))) {
    return { ok: false as const, status: 401, message: "Unauthorized" };
  }
  return { ok: true as const };
}

function sendError(res: Response, status: number, message: string, extra: Record<string, unknown> = {}) {
  res.status(status).json({ success: false, ok: false, status, message, error: message, ...extra });
}

export function registerGasWebhookRoutes(app: Express) {
  function sendHealth(res: Response, endpoint: string) {
    res.json({
      success: true,
      ok: true,
      endpoint,
      message: "GAS webhook is reachable. Send inventory data with POST.",
      requiredSecret: "GAS_WEBHOOK_SECRET",
    });
  }

  async function handlePurchaseWebhook(req: Request, res: Response, defaultMarkPurchased: boolean) {
    const auth = requireGasSecret(req);
    if (!auth.ok) {
      sendError(res, auth.status, auth.message);
      return;
    }

    try {
      const payload = gasPayloadSchema.parse(req.body) as Record<string, unknown>;
      const title = textField(payload, stringKeys.title);
      const rawQuantity = numberField(payload, numberKeys.quantity, null);
      const orderQuantity = numberField(payload, numberKeys.orderQuantity, null);
      const quantity = orderQuantity ?? (rawQuantity != null && rawQuantity > 0 ? rawQuantity : 1);
      if (!title) {
        const row = typeof payload.row === "object" && payload.row !== null
          ? (payload.row as Record<string, unknown>)
          : {};
        sendError(res, 400, "商品名が取得できませんでした。GAS payload の title または productName を確認してください。", {
          receivedKeys: Object.keys(payload).filter((key) => key !== "secret").slice(0, 40),
          rowKeys: Object.keys(row).slice(0, 40),
        });
        return;
      }
      if (!quantity || quantity <= 0) {
        sendError(res, 400, "発注数量が取得できませんでした。GAS payload の orderQuantity または quantity を確認してください。");
        return;
      }

      const place = textField(payload, stringKeys.place) || null;
      const unit = textField(payload, stringKeys.unit) || "個";
      const unitPriceNumber = numberField(payload, numberKeys.unitPrice, null);
      const unitPrice = unitPriceNumber == null ? null : String(unitPriceNumber);
      const supplierUrl = textField(payload, stringKeys.supplierUrl) || null;
      const supplierBase = textField(payload, ["supplierName", "supplier_name", "supplier", "仕入先", "仕入先名"]);
      const supplierDetail = textField(payload, ["supplierDetail", "supplier_detail", "仕入先詳細", "仕入先詳細名"]);
      const supplierName = resolveSupplierName(supplierBase, supplierDetail);
      const category = resolveWebhookCategory(
        title,
        textField(payload, stringKeys.category),
        supplierName,
        supplierDetail,
        supplierUrl,
      );
      const purchaseNum = textField(payload, stringKeys.purchaseNum);
      const receivedDate = textField(payload, stringKeys.receivedDate) || todayJst();
      const purchaseDate = textField(payload, stringKeys.purchaseDate) || receivedDate;
      const shipDate = textField(payload, stringKeys.shipDate) || null;
      const trackingNumber = textField(payload, stringKeys.trackingNumber) || null;
      const carrier = textField(payload, stringKeys.carrier) || null;
      const note = textField(payload, stringKeys.note) || null;
      const operatorName = textField(payload, stringKeys.operatorName) || "Google Apps Script";
      const explicitInventoryId = numberField(payload, numberKeys.inventoryId, null);
      const markPurchased = booleanField(payload, booleanKeys.markPurchased, defaultMarkPurchased);
      const createInventory = booleanField(payload, booleanKeys.createInventory, true);
      const inventoryQuantity = numberField(payload, numberKeys.inventoryQuantity, null)
        ?? (rawQuantity != null && rawQuantity >= 0 && orderQuantity != null ? rawQuantity : markPurchased ? quantity : 0);
      const dryRun = booleanField(payload, booleanKeys.dryRun, false);
      const sourceManagementNo = textField(payload, stringKeys.managementNo);
      const sourceKey = makeSourceKey(payload, sourceManagementNo, purchaseNum);
      const managementNo = sourceManagementNo || `gas:${sourceKey}`;
      const gasZaicoId = syntheticZaicoId(sourceKey);

      if (dryRun) {
        res.json({
          success: true,
          dryRun: true,
          normalized: {
            sourceKey,
            title,
            quantity,
            inventoryQuantity,
            unitPrice,
            managementNo,
            purchaseNum,
            purchaseDate,
            category,
            supplierName,
            supplierUrl,
            markPurchased,
            createInventory,
          },
        });
        return;
      }

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const existingHistory = await db
        .select({ id: purchaseHistories.id })
        .from(purchaseHistories)
        .where(and(eq(purchaseHistories.zaicoId, gasZaicoId), eq(purchaseHistories.cancelled, 0)))
        .limit(1);
      const alreadyReceived = existingHistory.length > 0;

      let inventoryId: number | null = null;
      let previousQuantity = 0;
      const inventoryConditions: SQL<unknown>[] = [];
      if (explicitInventoryId) inventoryConditions.push(eq(localInventories.id, explicitInventoryId));
      if (managementNo) inventoryConditions.push(eq(localInventories.etc, managementNo));
      const inventoryWhere = combineOr(inventoryConditions);
      const existingInventory = inventoryWhere
        ? await db
            .select()
            .from(localInventories)
            .where(inventoryWhere)
            .orderBy(desc(localInventories.updatedAt))
            .limit(1)
        : [];

      if (existingInventory[0]) {
        inventoryId = existingInventory[0].id;
        previousQuantity = existingInventory[0].quantity ?? 0;
        if (createInventory) {
          await db
            .update(localInventories)
            .set({
              title,
              category,
              place,
              quantity: markPurchased && !alreadyReceived ? previousQuantity + quantity : previousQuantity,
              unit,
              unitPrice,
              etc: managementNo,
              supplierUrl,
              supplierName,
              isDeleted: 0,
            })
            .where(eq(localInventories.id, inventoryId));
        }
      } else if (createInventory) {
        const [result] = await db.insert(localInventories).values({
          zaicoId: null,
          title,
          category,
          place,
          quantity: markPurchased ? quantity : inventoryQuantity,
          unit,
          unitPrice,
          etc: managementNo,
          supplierUrl,
          supplierName,
          isDeleted: 0,
        });
        inventoryId = Number((result as { insertId?: number }).insertId ?? 0) || null;
      }

      const purchaseItemsJson = JSON.stringify([{
        id: 0,
        title,
        quantity: String(quantity),
        unit_price: unitPrice,
        etc: managementNo,
        status: markPurchased ? "purchased" : "ordered",
        inventory_id: inventoryId,
        category,
      }]);

      const purchaseConditions: SQL<unknown>[] = [];
      if (managementNo) purchaseConditions.push(eq(localPurchases.managementNo, managementNo));
      if (purchaseNum) purchaseConditions.push(eq(localPurchases.purchaseNum, purchaseNum));
      const purchaseWhere = combineOr(purchaseConditions);
      const existingPurchase = purchaseWhere
        ? await db
            .select()
            .from(localPurchases)
            .where(purchaseWhere)
            .orderBy(desc(localPurchases.updatedAt))
            .limit(1)
        : [];

      let purchaseId: number | null = null;
      if (existingPurchase[0]) {
        purchaseId = existingPurchase[0].id;
        const nextStatus = markPurchased ? "purchased" : existingPurchase[0].status ?? "ordered";
        await db
          .update(localPurchases)
          .set({
            purchaseNum: purchaseNum || existingPurchase[0].purchaseNum,
            status: nextStatus,
            itemsJson: purchaseItemsJson,
            localInventoryId: inventoryId,
            title,
            category,
            quantity,
            unitPrice,
            managementNo,
            purchaseDate,
            receivedDate: nextStatus === "purchased" ? (markPurchased ? receivedDate : existingPurchase[0].receivedDate) : null,
            shipDate,
            trackingNumber,
            carrier,
            note,
            supplierUrl,
            supplierName,
          })
          .where(eq(localPurchases.id, purchaseId));
      } else {
        const [result] = await db.insert(localPurchases).values({
          zaicoId: null,
          purchaseNum: purchaseNum || String(gasZaicoId),
          status: markPurchased ? "purchased" : "ordered",
          itemsJson: purchaseItemsJson,
          localInventoryId: inventoryId,
          title,
          category,
          quantity,
          unitPrice,
          managementNo,
          purchaseDate,
          receivedDate: markPurchased ? receivedDate : null,
          shipDate,
          trackingNumber,
          carrier,
          note,
          supplierUrl,
          supplierName,
        });
        purchaseId = Number((result as { insertId?: number }).insertId ?? 0) || null;
      }

      let historyInserted = false;
      if (markPurchased && !alreadyReceived) {
        await db.insert(purchaseHistories).values({
          zaicoId: gasZaicoId,
          kanriNo: managementNo,
          title,
          category,
          supplier: supplierName,
          quantity: String(quantity),
          unitPrice,
          purchaseDate: receivedDate,
          inventoryId,
          cancelled: 0,
          operatorName,
        });
        historyInserted = true;
      }

      res.json({
        success: true,
        sourceKey,
        inventoryId,
        purchaseId,
        purchaseHistoryZaicoId: gasZaicoId,
        historyInserted,
        alreadyReceived,
        results: {
          inventory: inventoryId == null ? null : { id: inventoryId },
          purchase: purchaseId == null ? null : { id: purchaseId },
        },
      });
    } catch (error) {
      console.error("[GAS purchase webhook] failed", error);
      sendError(res, 500, error instanceof Error ? error.message : "Unknown error");
    }
  }

  app.post("/api/gas/purchase-order", (req, res) => {
    void handlePurchaseWebhook(req, res, false);
  });

  app.get("/api/gas/purchase-order", (_req, res) => {
    sendHealth(res, "/api/gas/purchase-order");
  });

  app.post("/api/gas-webhook/register-product", (req, res) => {
    void handlePurchaseWebhook(req, res, false);
  });

  app.get("/api/gas-webhook/register-product", (_req, res) => {
    sendHealth(res, "/api/gas-webhook/register-product");
  });

  app.get("/api/gas-webhook/health", (_req, res) => {
    sendHealth(res, "/api/gas-webhook/register-product");
  });

  app.post("/api/gas/purchase-receive", (req, res) => {
    void handlePurchaseWebhook(req, res, true);
  });

  app.get("/api/gas/purchase-receive", (_req, res) => {
    sendHealth(res, "/api/gas/purchase-receive");
  });
}
