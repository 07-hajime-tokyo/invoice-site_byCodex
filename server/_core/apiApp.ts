import express from "express";
import { inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { readActionItemAttachment } from "../inventory/actionItemAttachmentStorage";
import { readListingPhoto } from "../inventory/listingPhotoStorage";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerChatRoutes } from "./chat";
import { registerGasWebhookRoutes } from "./gasWebhook";
import { registerReceiptAckIngestRoutes } from "./receiptAckIngest";
import { registerCronRoutes } from "./cron";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { generateInvoicePdf } from "../pdfGenerator";
import { getDb, getShaftSales } from "../inventory/db";
import { inventoryItemLabels, localInventories, localPurchases, purchaseHistories, workLogs } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { EMAIL_AUTH_LOGIN_METHOD, isAllowedLoginEmail } from "./emailAuth";

type ShaftSalesResponseItem = {
  name: string;
  averageJpy: number;
  count: number;
};

function normalizeShaftName(value: unknown): string {
  return String(value ?? "")
    .replace(/^[\s\u3000]*(シャフト|shaft)\s*[：:\-ー]?\s*/i, "")
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "string") return null;

  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildShaftSalesSummary(rows: Awaited<ReturnType<typeof getShaftSales>>): ShaftSalesResponseItem[] {
  const grouped = new Map<string, { name: string; total: number; count: number }>();

  for (const row of rows) {
    const name = normalizeShaftName(row.title);
    const saleAmount = parseAmount(row.saleAmount);
    if (!name || saleAmount === null) continue;

    const key = name.normalize("NFKC").toLocaleLowerCase("ja-JP");
    const current = grouped.get(key);
    if (current) {
      current.total += saleAmount;
      current.count += 1;
    } else {
      grouped.set(key, { name, total: saleAmount, count: 1 });
    }
  }

  return Array.from(grouped.values())
    .map((item) => ({
      name: item.name,
      averageJpy: Math.round(item.total / item.count),
      count: item.count,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja-JP"));
}

async function canReadInternalAsset(req: express.Request) {
  if (
    process.env.LOCAL_AUTH_BYPASS === "true" ||
    (process.env.NODE_ENV === "development" && process.env.LOCAL_AUTH_BYPASS !== "false")
  ) {
    return true;
  }
  try {
    const user = await sdk.authenticateRequest(req);
    return Boolean(user && user.loginMethod === EMAIL_AUTH_LOGIN_METHOD && isAllowedLoginEmail(user.email));
  } catch {
    return false;
  }
}

const CORRUPT_0909_MANAGEMENT_NOS = ["在庫0909_1", "在庫0909_2", "在庫0909_3"] as const;
const CORRUPT_0909_KNOWN_INVENTORY_IDS = [50, 51, 52] as const;
const CORRUPT_0909_CONFIRM = "delete-corrupt-0909";

function compactRows<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  ));
}

function orConditions(conditions: SQL[]) {
  if (conditions.length === 0) throw new Error("No cleanup conditions");
  return conditions.length === 1 ? conditions[0] : or(...conditions);
}

async function loadCorrupt0909Targets() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const targetManagementNos = [...CORRUPT_0909_MANAGEMENT_NOS];
  const targetInventoryIds = [...CORRUPT_0909_KNOWN_INVENTORY_IDS];
  const targetSourceKeys = [
    ...targetManagementNos.map((managementNo) => `management:${managementNo}`),
    ...targetInventoryIds.map((id) => `inventory:${id}`),
  ];

  const inventories = await db
    .select({
      id: localInventories.id,
      zaicoId: localInventories.zaicoId,
      title: localInventories.title,
      quantity: localInventories.quantity,
      unitPrice: localInventories.unitPrice,
      supplierName: localInventories.supplierName,
      etc: localInventories.etc,
      isDeleted: localInventories.isDeleted,
      createdAt: localInventories.createdAt,
      updatedAt: localInventories.updatedAt,
    })
    .from(localInventories)
    .where(orConditions([
      inArray(localInventories.id, targetInventoryIds),
      inArray(sql<string>`SUBSTRING_INDEX(COALESCE(${localInventories.etc}, ''), ',', 1)`, targetManagementNos),
    ]))
    .orderBy(localInventories.id);

  const inventoryIds = Array.from(new Set(inventories.map((row) => Number(row.id)).filter(Number.isFinite)));

  const purchases = await db
    .select({
      id: localPurchases.id,
      zaicoId: localPurchases.zaicoId,
      purchaseNum: localPurchases.purchaseNum,
      status: localPurchases.status,
      localInventoryId: localPurchases.localInventoryId,
      title: localPurchases.title,
      quantity: localPurchases.quantity,
      unitPrice: localPurchases.unitPrice,
      managementNo: localPurchases.managementNo,
      trackingNumber: localPurchases.trackingNumber,
      receivedDate: localPurchases.receivedDate,
      createdAt: localPurchases.createdAt,
      updatedAt: localPurchases.updatedAt,
    })
    .from(localPurchases)
    .where(orConditions([
      ...(inventoryIds.length > 0 ? [inArray(localPurchases.localInventoryId, inventoryIds)] : []),
      inArray(sql<string>`SUBSTRING_INDEX(COALESCE(${localPurchases.managementNo}, ''), ',', 1)`, targetManagementNos),
    ]))
    .orderBy(localPurchases.id);

  const purchaseIds = Array.from(new Set(purchases.map((row) => Number(row.id)).filter(Number.isFinite)));

  const labels = await db
    .select({
      id: inventoryItemLabels.id,
      labelId: inventoryItemLabels.labelId,
      purchaseId: inventoryItemLabels.purchaseId,
      localInventoryId: inventoryItemLabels.localInventoryId,
      legacyManagementNo: inventoryItemLabels.legacyManagementNo,
      title: inventoryItemLabels.title,
      status: inventoryItemLabels.status,
      sourceKey: inventoryItemLabels.sourceKey,
      receivedAt: inventoryItemLabels.receivedAt,
      shippedAt: inventoryItemLabels.shippedAt,
      createdAt: inventoryItemLabels.createdAt,
      updatedAt: inventoryItemLabels.updatedAt,
    })
    .from(inventoryItemLabels)
    .where(orConditions([
      ...(inventoryIds.length > 0 ? [inArray(inventoryItemLabels.localInventoryId, inventoryIds)] : []),
      ...(purchaseIds.length > 0 ? [inArray(inventoryItemLabels.purchaseId, purchaseIds)] : []),
      inArray(sql<string>`SUBSTRING_INDEX(COALESCE(${inventoryItemLabels.legacyManagementNo}, ''), ',', 1)`, targetManagementNos),
      inArray(inventoryItemLabels.sourceKey, targetSourceKeys),
    ]))
    .orderBy(inventoryItemLabels.id);

  const labelDbIds = Array.from(new Set(labels.map((row) => Number(row.id)).filter(Number.isFinite)));
  const labelIds = Array.from(new Set(labels.map((row) => row.labelId).filter(Boolean)));

  const histories = await db
    .select({
      id: purchaseHistories.id,
      zaicoId: purchaseHistories.zaicoId,
      kanriNo: purchaseHistories.kanriNo,
      title: purchaseHistories.title,
      quantity: purchaseHistories.quantity,
      unitPrice: purchaseHistories.unitPrice,
      purchaseDate: purchaseHistories.purchaseDate,
      inventoryId: purchaseHistories.inventoryId,
      cancelled: purchaseHistories.cancelled,
      createdAt: purchaseHistories.createdAt,
    })
    .from(purchaseHistories)
    .where(orConditions([
      ...(inventoryIds.length > 0 ? [inArray(purchaseHistories.inventoryId, inventoryIds)] : []),
      inArray(sql<string>`SUBSTRING_INDEX(COALESCE(${purchaseHistories.kanriNo}, ''), ',', 1)`, targetManagementNos),
    ]))
    .orderBy(purchaseHistories.id);

  const workLogConditions = [
    ...(labelIds.length > 0 ? [inArray(workLogs.sourceId, labelIds)] : []),
    ...labelIds.map((labelId) => sql`${workLogs.detailsJson} LIKE ${`%${labelId}%`}`),
  ];
  const logs = workLogConditions.length > 0
    ? await db
        .select({
          id: workLogs.id,
          sourceType: workLogs.sourceType,
          sourceId: workLogs.sourceId,
          category: workLogs.category,
          status: workLogs.status,
          quantity: workLogs.quantity,
          createdAt: workLogs.createdAt,
        })
        .from(workLogs)
        .where(orConditions(workLogConditions))
        .orderBy(workLogs.id)
    : [];

  return {
    db,
    inventoryIds,
    purchaseIds,
    labelDbIds,
    historyIds: Array.from(new Set(histories.map((row) => Number(row.id)).filter(Number.isFinite))),
    workLogIds: Array.from(new Set(logs.map((row) => Number(row.id)).filter(Number.isFinite))),
    preview: {
      managementNos: targetManagementNos,
      counts: {
        inventories: inventories.length,
        purchases: purchases.length,
        labels: labels.length,
        histories: histories.length,
        workLogs: logs.length,
      },
      inventories: compactRows(inventories),
      purchases: compactRows(purchases),
      labels: compactRows(labels),
      histories: compactRows(histories),
      workLogs: compactRows(logs),
    },
  };
}

export async function createApiApp() {
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerOAuthRoutes(app);
  registerChatRoutes(app);
  registerGasWebhookRoutes(app);
  registerReceiptAckIngestRoutes(app);
  registerCronRoutes(app);

  const handleCorrupt0909Cleanup: express.RequestHandler = async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!(await canReadInternalAsset(req))) {
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }

      const targets = await loadCorrupt0909Targets();
      const confirmed = req.query.confirm === CORRUPT_0909_CONFIRM;
      if (!confirmed) {
        res.json({
          ok: true,
          dryRun: true,
          confirmHint: `Add ?confirm=${CORRUPT_0909_CONFIRM} to delete these fixed targets.`,
          ...targets.preview,
        });
        return;
      }

      await targets.db.transaction(async (tx) => {
        if (targets.workLogIds.length > 0) {
          await tx.delete(workLogs).where(inArray(workLogs.id, targets.workLogIds));
        }
        if (targets.historyIds.length > 0) {
          await tx.delete(purchaseHistories).where(inArray(purchaseHistories.id, targets.historyIds));
        }
        if (targets.labelDbIds.length > 0) {
          await tx.delete(inventoryItemLabels).where(inArray(inventoryItemLabels.id, targets.labelDbIds));
        }
        if (targets.purchaseIds.length > 0) {
          await tx.delete(localPurchases).where(inArray(localPurchases.id, targets.purchaseIds));
        }
        if (targets.inventoryIds.length > 0) {
          await tx
            .update(localInventories)
            .set({ quantity: 0, isDeleted: 1 })
            .where(inArray(localInventories.id, targets.inventoryIds));
        }
      });

      console.info("[maintenance/cleanup-corrupt-0909] done", targets.preview.counts);
      res.json({
        ok: true,
        dryRun: false,
        deleted: {
          workLogs: targets.workLogIds.length,
          histories: targets.historyIds.length,
          labels: targets.labelDbIds.length,
          purchases: targets.purchaseIds.length,
          inventoriesSoftDeleted: targets.inventoryIds.length,
        },
        preview: targets.preview,
      });
    } catch (err) {
      console.error("[maintenance/cleanup-corrupt-0909] failed", err);
      res.status(500).json({ ok: false, error: "Cleanup failed" });
    }
  };

  app.get("/api/maintenance/cleanup-corrupt-0909", handleCorrupt0909Cleanup);
  app.get("/maintenance/cleanup-corrupt-0909", handleCorrupt0909Cleanup);

  const setShaftSalesHeaders = (res: express.Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "no-store");
  };

  app.options("/api/shaft-sales", (_req, res) => {
    setShaftSalesHeaders(res);
    res.status(204).end();
  });

  app.get("/api/shaft-sales", async (_req, res) => {
    const fetchedAt = new Date().toISOString();
    setShaftSalesHeaders(res);

    try {
      const rows = await getShaftSales();
      res.json({
        ok: true,
        source: "shaft_sales",
        fetchedAt,
        shafts: buildShaftSalesSummary(rows),
      });
    } catch (err) {
      console.error("shaft sales API error:", err);
      res.status(500).json({
        ok: false,
        source: "shaft_sales",
        fetchedAt,
        error: "Failed to fetch shaft sales",
      });
    }
  });

  // 出品写真の配信。スプレッドシートの =IMAGE() をGoogle側が取りに来るので認証は掛けない
  app.get(/^\/api\/listing-photos\/(.+)$/, async (req, res) => {
    try {
      const key = decodeURIComponent(req.params[0] ?? "");
      const photo = await readListingPhoto(key);
      if (!photo) {
        res.status(404).json({ error: "Photo not found" });
        return;
      }
      res.setHeader("Content-Type", photo.contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(photo.body);
    } catch (err) {
      console.error("listing photo error:", err);
      res.status(500).json({ error: "Failed to read photo" });
    }
  });

  app.get("/api/action-item-attachments/:id", async (req, res) => {
    try {
      if (!(await canReadInternalAsset(req))) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "Invalid attachment id" });
        return;
      }
      const attachment = await readActionItemAttachment(id);
      if (!attachment) {
        res.status(404).json({ error: "Attachment not found" });
        return;
      }
      res.setHeader("Content-Type", attachment.contentType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(attachment.body);
    } catch (err) {
      console.error("action item attachment error:", err);
      res.status(500).json({ error: "Failed to read attachment" });
    }
  });

  app.post("/api/invoice-pdf", async (req, res) => {
    try {
      const params = req.body;
      if (!params || !params.invoiceNumber) {
        res.status(400).json({ error: "Missing invoice data" });
        return;
      }

      const pdfBuffer = await generateInvoicePdf(params);
      const numMatch = (params.invoiceNumber as string).match(/(\d+)$/);
      const numStr = numMatch ? numMatch[1].padStart(4, "0") : params.invoiceNumber;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Invoice-${numStr}.pdf"`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error("PDF generation error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: String(err) });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  return app;
}
