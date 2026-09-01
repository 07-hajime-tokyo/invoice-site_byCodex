import { timingSafeEqual } from "crypto";
import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { ingestReceiptAckCrawlResult } from "../inventory/receiptAck";

function getProvidedSecretInfo(req: Request) {
  const authorization = req.header("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const headerSecret = req.header("x-receipt-ack-secret");
  const bodySecret = typeof req.body?.secret === "string" ? req.body.secret : undefined;
  const rawValue = bearer ?? headerSecret ?? bodySecret ?? "";
  const value = rawValue.trim();
  const source = bearer != null
    ? "authorization"
    : headerSecret != null
      ? "x-receipt-ack-secret"
      : bodySecret != null
        ? "body.secret"
        : "none";
  return { value, source, length: value.length };
}

function secretsMatch(expected: string, provided: string) {
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function requireReceiptAckSecret(req: Request) {
  const expected = process.env.RECEIPT_ACK_INGEST_SECRET?.trim();
  if (!expected) {
    return { ok: false as const, status: 503, message: "RECEIPT_ACK_INGEST_SECRET is not configured" };
  }
  const provided = getProvidedSecretInfo(req);
  if (!secretsMatch(expected, provided.value)) {
    console.warn("[receipt ack ingest] auth failed", {
      providedSource: provided.source,
      providedLength: provided.length,
      hasAuthorizationHeader: Boolean(req.header("authorization")),
      hasReceiptAckSecretHeader: Boolean(req.header("x-receipt-ack-secret")),
      hasBodySecret: typeof req.body?.secret === "string",
    });
    return {
      ok: false as const,
      status: 401,
      message: `Unauthorized: RECEIPT_ACK_INGEST_SECRET mismatch or missing (received ${provided.source}, length ${provided.length})`,
    };
  }
  return { ok: true as const };
}

function sendError(res: Response, status: number, message: string, extra: Record<string, unknown> = {}) {
  res.status(status).json({ ok: false, success: false, status, message, error: message, ...extra });
}

export function registerReceiptAckIngestRoutes(app: Express) {
  app.get("/api/ingest/receipt-ack", (_req, res) => {
    res.json({
      ok: true,
      endpoint: "/api/ingest/receipt-ack",
      method: "POST",
      requiredSecret: "RECEIPT_ACK_INGEST_SECRET",
    });
  });

  app.post("/api/ingest/receipt-ack", async (req, res) => {
    const auth = requireReceiptAckSecret(req);
    if (!auth.ok) {
      sendError(res, auth.status, auth.message);
      return;
    }

    try {
      const result = await ingestReceiptAckCrawlResult(req.body);
      res.json(result);
    } catch (error) {
      if (error instanceof ZodError) {
        sendError(res, 400, "巡回結果の形式が正しくありません", { issues: error.issues });
        return;
      }
      console.error("[receipt ack ingest] failed:", error);
      sendError(res, 500, error instanceof Error ? error.message : "受取連絡チェックの取り込みに失敗しました");
    }
  });
}
