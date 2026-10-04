import { invoiceClientsRouter } from "./invoices/invoiceClientsRouter";
import { invoicesRouter } from "./invoices/invoicesRouter";
import { invoiceSettingsRouter } from "./invoices/invoiceSettingsRouter";
import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { authGateRouter } from "./authGateRouter";
import { authRouter } from "./authRouter";
import { quoteProxyRouter } from "./quoteProxyRouter";
import { inventoryRouter } from "./inventory/routers";
import { whatsappHistoryRouter } from "./whatsappHistoryRouter";
import { whatsappChatsRouter } from "./whatsappChatsRouter";
import { knowledgeBaseRouter } from "./knowledgeBaseRouter";
import { tradeRouter } from "./tradeRouter";
import { shipmentRouter } from "./shipmentRouter";

export const appRouter = router({
  authGate: authGateRouter,
  system: systemRouter,
  inventory: inventoryRouter,
  auth: authRouter,

  quoteProxy: quoteProxyRouter,

  // Trade data management
  trade: tradeRouter,

  // ─── Invoice clients (宛先管理) ───────────────────────────────────────────
  invoiceClients: invoiceClientsRouter,

  // ─── Invoices (請求書) ────────────────────────────────────────────────────
  invoices: invoicesRouter,

  // ─── Invoice Settings (差出人デフォルト設定) ───────────────────────────────────────
  invoiceSettings: invoiceSettingsRouter,
  // ─── WhatsApp history upload & invoice number extraction ──────────────────
  whatsappHistory: whatsappHistoryRouter,

  // ─── WhatsApp会話履歴（読み返し用・和訳つき） ──────────────────────────────────
  whatsappChats: whatsappChatsRouter,

  // ─── Knowledge Base & AI Chat ────────────────────────────────────────────────
  knowledgeBase: knowledgeBaseRouter,

  // ─── Shipment (発送記録) Router ─────────────────────────────────────────────
  shipment: shipmentRouter,
});
export type AppRouter = typeof appRouter;
