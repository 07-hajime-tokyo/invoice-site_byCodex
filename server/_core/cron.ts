import type { Express, Request } from "express";
import { createFedexMissingActionItems } from "../inventory/fedexMissingTasks";

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
}
