import type { Express, Request } from "express";
import { createFedexMissingActionItems } from "../inventory/fedexMissingTasks";
import { reclassifyInboundAuto } from "../inventory/inboundClassify";
import { captureDailySnapshot } from "../inventory/dailySnapshot";
import { appRouter } from "../routers";
import { ADMIN_EMAILS } from "@shared/const";
import { EMAIL_AUTH_LOGIN_METHOD } from "./emailAuth";

function isAuthorizedCronRequest(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== "production" ||
      req.get("x-vercel-cron") === "1" ||
      String(req.get("user-agent") ?? "").toLowerCase().includes("vercel-cron");
  }
  return req.get("authorization") === `Bearer ${secret}`;
}

export function registerCronRoutes(app: Express) {
  app.get("/api/cron/fedex-missing", async (req, res) => {
    if (!isAuthorizedCronRequest(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const result = await createFedexMissingActionItems();
      res.json(result);
    } catch (error) {
      console.error("[cron/fedex-missing] failed", error);
      res.status(500).json({
        error: "FedEx missing check failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * 日次在庫スナップショット
   * 月次棚卸しは「今この瞬間の在庫」しか返せず過去を再現できないため、
   * 毎日1回その日の在庫の姿を保存して履歴を残す。同じ日に二重実行しても増えない。
   */
  app.get("/api/cron/inventory-snapshot", async (req, res) => {
    if (!isAuthorizedCronRequest(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      // 在庫APIは publicProcedure が protectedProcedure の別名になっており、
      // user が null だと UNAUTHORIZED で落ちる。cron用のシステムユーザーを渡す。
      const now = new Date();
      const caller = appRouter.createCaller({
        req: req as never,
        res: res as never,
        user: {
          id: 0,
          openId: "cron-inventory-snapshot",
          name: "cron",
          email: ADMIN_EMAILS[0] ?? "cron@localhost",
          loginMethod: EMAIL_AUTH_LOGIN_METHOD,
          role: "admin",
          createdAt: now,
          updatedAt: now,
          lastSignedIn: now,
        },
      });
      const preview = await caller.inventory.monthlyReport.preview();
      const result = await captureDailySnapshot(preview, { createdBy: "cron" });
      res.json(result);
    } catch (error) {
      console.error("[cron/inventory-snapshot] failed", error);
      res.status(500).json({
        error: "Inventory snapshot failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // T22: 入庫自動仕訳の日次再判定（未仕訳/auto行のみ、manualは保護）
  app.get("/api/cron/inbound-classify", async (req, res) => {
    if (!isAuthorizedCronRequest(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const result = await reclassifyInboundAuto();
      res.json(result);
    } catch (error) {
      console.error("[cron/inbound-classify] failed", error);
      res.status(500).json({
        error: "Inbound classify failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
