import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerChatRoutes } from "./chat";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { generateInvoicePdf } from "../pdfGenerator";

export async function createApiApp() {
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

  return app;
}
