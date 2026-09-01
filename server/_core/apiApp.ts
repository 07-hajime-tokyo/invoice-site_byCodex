import express from "express";
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
import { getShaftSales } from "../inventory/db";
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

export async function createApiApp() {
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerOAuthRoutes(app);
  registerChatRoutes(app);
  registerGasWebhookRoutes(app);
  registerReceiptAckIngestRoutes(app);
  registerCronRoutes(app);

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
