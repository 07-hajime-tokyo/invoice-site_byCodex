import express from "express";
import type { Server } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerChatRoutes } from "./chat";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { generateInvoicePdf } from "../pdfGenerator";

type CreateAppOptions = {
  server?: Server;
  serveClient?: boolean;
};

export async function createApp(options: CreateAppOptions = {}) {
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerOAuthRoutes(app);
  registerChatRoutes(app);

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

  if (options.serveClient) {
    if (process.env.NODE_ENV === "development") {
      if (!options.server) {
        throw new Error("A server instance is required for Vite middleware");
      }
      await setupVite(app, options.server);
    } else {
      serveStatic(app);
    }
  }

  return app;
}
