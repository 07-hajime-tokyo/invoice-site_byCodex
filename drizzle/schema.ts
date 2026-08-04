import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  mediumtext,
  timestamp,
  varchar,
  boolean,
  decimal,
  json,
  bigint,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Invoice clients (recipients / bill-to parties)
 */
export const invoiceClients = mysqlTable("invoice_clients", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  company: varchar("company", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 64 }),
  address: text("address"),
  city: varchar("city", { length: 128 }),
  country: varchar("country", { length: 128 }),
  notes: text("notes"),
  /** Extra info line (e.g. customs/tax number) shown below country in invoice */
  extraInfo: text("extraInfo"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type InvoiceClient = typeof invoiceClients.$inferSelect;
export type InsertInvoiceClient = typeof invoiceClients.$inferInsert;

/**
 * Invoices
 */
export const invoices = mysqlTable("invoices", {
  id: int("id").autoincrement().primaryKey(),
  invoiceNumber: varchar("invoiceNumber", { length: 64 }).notNull(),
  /** Client ID (FK to invoice_clients) */
  clientId: int("clientId"),
  /** Snapshot of client info at time of invoice creation (in case client is edited later) */
  clientSnapshot: json("clientSnapshot"),
  /** Invoice date (ISO string) */
  invoiceDate: varchar("invoiceDate", { length: 32 }),
  /** Due date (ISO string) */
  dueDate: varchar("dueDate", { length: 32 }),
  /** Currency: EUR, USD, JPY, etc. */
  currency: varchar("currency", { length: 8 }).default("EUR").notNull(),
  /** Whether to show currency/total columns in the invoice */
  showAmounts: boolean("showAmounts").default(false).notNull(),
  /** Notes / memo */
  notes: text("notes"),
  /** Raw WhatsApp chat text used to generate this invoice */
  rawChat: text("rawChat"),
  /** Status: draft | sent | paid */
  status: mysqlEnum("status", ["draft", "sent", "paid"]).default("draft").notNull(),
  /** Accent color for invoice header bar (hex, e.g. "#db8b1a") */
  accentColor: varchar("accentColor", { length: 16 }).default("#db8b1a"),
  /** Soft-delete timestamp — non-null means this invoice is deleted */
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

/**
 * Invoice line items
 */
export const invoiceItems = mysqlTable("invoice_items", {
  id: int("id").autoincrement().primaryKey(),
  invoiceId: int("invoiceId").notNull(),
  /** Sort order */
  sortOrder: int("sortOrder").default(0).notNull(),
  description: text("description").notNull(),
  /** Variant / color / subtext (e.g. "ブルー", "New 2DS LL") */
  variant: varchar("variant", { length: 255 }),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).default("1").notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).default("0").notNull(),
  /** Currency for this line (inherits from invoice by default) */
  currency: varchar("currency", { length: 8 }),
  /** Tax rate for this line item (e.g. 0.00 = 0%) */
  tax: decimal("tax", { precision: 5, scale: 2 }).default("0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type InsertInvoiceItem = typeof invoiceItems.$inferInsert;

/**
 * Invoice sender settings (default "From" info)
 * Only one row is used (id=1), upserted on save.
 */
export const invoiceSettings = mysqlTable("invoice_settings", {
  id: int("id").autoincrement().primaryKey(),
  senderName: varchar("senderName", { length: 255 }),
  senderCompany: varchar("senderCompany", { length: 255 }),
  senderEmail: varchar("senderEmail", { length: 320 }),
  senderPhone: varchar("senderPhone", { length: 64 }),
  senderAddress: text("senderAddress"),
  senderCity: varchar("senderCity", { length: 128 }),
  senderCountry: varchar("senderCountry", { length: 128 }),
  /** Logo image URL (S3) */
  logoUrl: text("logoUrl"),
  /** Logo image S3 key */
  logoKey: varchar("logoKey", { length: 512 }),
  /** Default tax rate (e.g. 0.00 = 0%) */
  taxRate: decimal("taxRate", { precision: 5, scale: 2 }).default("0"),
  /** Extra info line (e.g. customs/tax number) shown below country in invoice */
  senderExtraInfo: text("senderExtraInfo"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type InvoiceSettings = typeof invoiceSettings.$inferSelect;
export type InsertInvoiceSettings = typeof invoiceSettings.$inferInsert;

/**
 * Invoice numbers extracted from WhatsApp chat history uploads.
 * Used to determine the next invoice number automatically.
 */
export const invoiceNumberHistory = mysqlTable("invoice_number_history", {
  id: int("id").autoincrement().primaryKey(),
  /** Extracted invoice number as integer (e.g. 372 from "Invoice - 0372.pdf") */
  number: int("number").notNull(),
  /** Source: 'filename' | 'chat_text' | 'screenshot' */
  source: varchar("source", { length: 32 }).notNull(),
  /** Original raw string that was parsed (e.g. "Invoice - 0372.pdf") */
  rawValue: varchar("rawValue", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type InvoiceNumberHistory = typeof invoiceNumberHistory.$inferSelect;
export type InsertInvoiceNumberHistory = typeof invoiceNumberHistory.$inferInsert;

/**
 * WhatsApp chat history uploads.
 * Stores uploaded chat screenshots/text so they can be re-analyzed without re-uploading.
 */
export const whatsappChatHistory = mysqlTable("whatsapp_chat_history", {
  id: int("id").autoincrement().primaryKey(),
  /** Display name for this upload (e.g. "Luca - 2026-03") */
  label: varchar("label", { length: 255 }).notNull(),
  /** Type: 'screenshot' | 'chat_text' */
  type: varchar("type", { length: 32 }).notNull(),
  /** Original filename */
  fileName: varchar("fileName", { length: 255 }),
  /** S3 URL for image files */
  imageUrl: text("imageUrl"),
  /** S3 key for image files */
  imageKey: varchar("imageKey", { length: 512 }),
  /** Plain text content for chat text files */
  textContent: text("textContent"),
  /** MIME type */
  mimeType: varchar("mimeType", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WhatsappChatHistory = typeof whatsappChatHistory.$inferSelect;
export type InsertWhatsappChatHistory = typeof whatsappChatHistory.$inferInsert;

/**
 * Chat knowledge base — parsed/extracted content from uploaded files.
 * Each row represents one "chunk" of knowledge extracted by AI from
 * a WhatsApp text file, screenshot, or invoice PDF.
 * Used as the context source for AI chat and auto-extraction features.
 */
export const chatKnowledge = mysqlTable("chat_knowledge", {
  id: int("id").autoincrement().primaryKey(),
  /** Source upload ID (FK to whatsapp_chat_history) */
  sourceId: int("sourceId"),
  /** Source type for display: 'chat_text' | 'screenshot' | 'invoice_pdf' */
  sourceType: varchar("sourceType", { length: 32 }).notNull(),
  /** Original filename or label */
  sourceLabel: varchar("sourceLabel", { length: 255 }),
  /** Extracted/parsed text content (plain text, ready for AI context) - MEDIUMTEXT for large files */
  content: mediumtext("content").notNull(),
  /** Approximate date range covered (e.g. "2025-01 ~ 2025-03") */
  dateRange: varchar("dateRange", { length: 64 }),
  /** S3 URL if this came from an image/PDF */
  imageUrl: text("imageUrl"),
  /** S3 key if this came from an image/PDF */
  imageKey: varchar("imageKey", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatKnowledge = typeof chatKnowledge.$inferSelect;
export type InsertChatKnowledge = typeof chatKnowledge.$inferInsert;

/**
 * AI chat conversations — each conversation is a separate session.
 */
export const chatConversations = mysqlTable("chat_conversations", {
  id: int("id").autoincrement().primaryKey(),
  /** Display title (auto-generated from first message or user-set) */
  title: varchar("title", { length: 255 }).notNull().default("新しいチャット"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ChatConversation = typeof chatConversations.$inferSelect;
export type InsertChatConversation = typeof chatConversations.$inferInsert;

/**
 * AI chat sessions — stores conversation history for the WhatsApp analysis chat.
 */
export const aiChatMessages = mysqlTable("ai_chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  /** FK to chat_conversations */
  conversationId: int("conversationId"),
  /** 'user' | 'assistant' */
  role: varchar("role", { length: 16 }).notNull(),
  /** Message content */
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type InsertAiChatMessage = typeof aiChatMessages.$inferInsert;

/**
 * Trade records — game console trading data (migrated from Google Sheets)
 * Mirrors the CSV columns exactly so existing data can be imported.
 */
export const tradeRecords = mysqlTable("trade_records", {
  id: int("id").autoincrement().primaryKey(),
  /** 月 (e.g. "1", "12") */
  month: varchar("month", { length: 8 }),
  /** 取引相手 */
  partner: varchar("partner", { length: 255 }),
  /** No. (取引番号) */
  no: int("no"),
  /** 支払い日 (ISO string) */
  paymentDate: varchar("paymentDate", { length: 64 }),
  /** 商品名 */
  productName: text("productName"),
  /** 注文数 */
  quantity: decimal("quantity", { precision: 10, scale: 2 }).default("0"),
  /** 商品価格 (original currency) */
  unitPrice: decimal("unitPrice", { precision: 12, scale: 4 }).default("0"),
  /** 通貨 (e.g. "ユーロ", "ドル") */
  currency: varchar("currency", { length: 16 }),
  /** 商品価格(円) */
  unitPriceJPY: decimal("unitPriceJPY", { precision: 14, scale: 4 }).default("0"),
  /** 状況 (e.g. "complete", "incomplete") */
  status: varchar("status", { length: 64 }),
  /** 仕入れ */
  procurement: varchar("procurement", { length: 64 }),
  /** 東京からの発送(仕入れ終了) */
  shippingFromTokyo: varchar("shippingFromTokyo", { length: 64 }),
  /** 数量×商品価格(円) = totalSales */
  totalSales: decimal("totalSales", { precision: 16, scale: 4 }).default("0"),
  /** 仕入れ合計 */
  procurementTotal: decimal("procurementTotal", { precision: 16, scale: 4 }).default("0"),
  /** 還付 */
  refund: decimal("refund", { precision: 14, scale: 4 }).default("0"),
  /** 送料 */
  shippingCost: decimal("shippingCost", { precision: 14, scale: 4 }).default("0"),
  /** 関税 (USD取引のみ: 商品価格円換算×数量×10%) */
  customsDuty: decimal("customsDuty", { precision: 14, scale: 4 }),
  /** 還付込み利益 */
  profitWithRefund: decimal("profitWithRefund", { precision: 16, scale: 4 }).default("0"),
  /** 累積利益 */
  cumulativeProfit: decimal("cumulativeProfit", { precision: 16, scale: 4 }).default("0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TradeRecord = typeof tradeRecords.$inferSelect;
export type InsertTradeRecord = typeof tradeRecords.$inferInsert;

/**
 * Verified users — users who have passed the access code check.
 * Once verified, they can access all tabs without re-entering the code.
 */
export const verifiedUsers = mysqlTable("verified_users", {
  id: int("id").autoincrement().primaryKey(),
  /** Manus openId of the verified user */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  /** When the user was verified */
  verifiedAt: timestamp("verifiedAt").defaultNow().notNull(),
});

export type VerifiedUser = typeof verifiedUsers.$inferSelect;
export type InsertVerifiedUser = typeof verifiedUsers.$inferInsert;

/**
 * Shipments — actual shipping records per dispatch
 * One shipment can include multiple invoices (split shipping supported)
 */
export const shipments = mysqlTable("shipments", {
  id: int("id").autoincrement().primaryKey(),
  /** Shipping date */
  shippingDate: varchar("shippingDate", { length: 10 }).notNull(), // YYYY-MM-DD
  /** FedEx tracking number */
  trackingNumber: varchar("trackingNumber", { length: 128 }),
  /** Actual shipping cost in JPY */
  shippingCost: decimal("shippingCost", { precision: 14, scale: 2 }).notNull(),
  /** Optional notes */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Shipment = typeof shipments.$inferSelect;
export type InsertShipment = typeof shipments.$inferInsert;

/**
 * Shipment items — which invoice numbers and how many units were shipped in each shipment
 */
export const shipmentItems = mysqlTable("shipment_items", {
  id: int("id").autoincrement().primaryKey(),
  /** FK to shipments */
  shipmentId: int("shipmentId").notNull(),
  /** Invoice number (e.g. 371, 372) */
  invoiceNo: int("invoiceNo").notNull(),
  /** Optional FK to trade_records.id for item-level shipment tracking */
  tradeRecordId: int("tradeRecordId"),
  /** Number of units shipped for this invoice in this shipment */
  quantity: int("quantity").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ShipmentItem = typeof shipmentItems.$inferSelect;
export type InsertShipmentItem = typeof shipmentItems.$inferInsert;

/**
 * Inventory management tables imported from zaico-inventory_byCodex.
 */
/**
 * 入庫補足情報テーブル
 * Zaico側に保存できない発送日・追跡番号などを本システムで管理する
 */
export const purchaseExtras = mysqlTable("purchase_extras", {
  id: int("id").autoincrement().primaryKey(),
  /** Zaico側の入庫データID */
  zaicoId: int("zaicoId").notNull().unique(),
  /** 仕入先発送日 */
  shipDate: varchar("shipDate", { length: 20 }),
  /** 追跡番号 */
  trackingNumber: varchar("trackingNumber", { length: 200 }),
  /** 配送業者（手動上書き用） */
  carrier: varchar("carrier", { length: 50 }),
  /** 備考 */
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PurchaseExtra = typeof purchaseExtras.$inferSelect;
export type InsertPurchaseExtra = typeof purchaseExtras.$inferInsert;

/**
 * 出庫履歴テーブル
 * まとめて出庫処理の結果を保存する
 */
export const deliveryHistories = mysqlTable("delivery_histories", {
  id: int("id").autoincrement().primaryKey(),
  /** 出庫No（ユーザー入力） */
  deliveryNo: varchar("deliveryNo", { length: 200 }).notNull(),
  /** Zaico側で作成された出庫データID */
  zaicoDeliveryId: int("zaicoDeliveryId"),
  /** 出庫商品情報（JSON文字列） */
  itemsJson: text("itemsJson").notNull(),
  /** 出庫処理ステータス */
  status: mysqlEnum("status", ["success", "error"]).notNull(),
  /** エラーメッセージ（エラー時） */
  errorMessage: text("errorMessage"),
  /** Zaicoから削除済みと判明した商品のinventoryIdのJSON配列文字列 */
  deletedInventoryIdsJson: text("deletedInventoryIdsJson"),
  /** 出庫取り消し済み商品情報（JSON文字列: [{inventoryId, quantity, cancelledAt}]） */
  cancelledItemsJson: text("cancelledItemsJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DeliveryHistory = typeof deliveryHistories.$inferSelect;
export type InsertDeliveryHistory = typeof deliveryHistories.$inferInsert;

/**
 * 入庫履歴テーブル
 * 入庫ボタン押下時の入庫処理結果を保存する
 */
export const purchaseHistories = mysqlTable("purchase_histories", {
  id: int("id").autoincrement().primaryKey(),
  /** Zaico側の入庫データID */
  zaicoId: int("zaicoId").notNull(),
  /** 管理番号（etcフィールドの1番目） */
  kanriNo: varchar("kanriNo", { length: 200 }),
  /** 商品名 */
  title: varchar("title", { length: 500 }).notNull(),
  /** カテゴリ */
  category: varchar("category", { length: 200 }),
  /** 仕入れ先 */
  supplier: varchar("supplier", { length: 200 }),
  /** 入庫数量 */
  quantity: varchar("quantity", { length: 50 }).notNull(),
  /** 入庫単価 */
  unitPrice: varchar("unitPrice", { length: 50 }),
  /** 入庫日 */
  purchaseDate: varchar("purchaseDate", { length: 20 }).notNull(),
  /** Zaico側の在庫ID */
  inventoryId: int("inventoryId"),
  /** 入庫取り消し済みか */
  cancelled: int("cancelled").default(0).notNull(),
  /** 入庫処理したユーザー名 */
  operatorName: varchar("operatorName", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PurchaseHistory = typeof purchaseHistories.$inferSelect;
export type InsertPurchaseHistory = typeof purchaseHistories.$inferInsert;

/**
 * 削除済み商品テーブル
 * 在庫一覧から削除した商品のスナップショットを保存する（復元機能用）
 */
export const deletedInventories = mysqlTable("deleted_inventories", {
  id: int("id").autoincrement().primaryKey(),
  /** Zaico側の元在庫データid */
  zaicoId: int("zaicoId").notNull(),
  /** 商品名 */
  title: varchar("title", { length: 500 }).notNull(),
  /** カテゴリ */
  category: varchar("category", { length: 200 }),
  /** 保管場所 */
  place: varchar("place", { length: 200 }),
  /** 在庫数 */
  quantity: varchar("quantity", { length: 50 }),
  /** 単位 */
  unit: varchar("unit", { length: 50 }),
  /** 仕入単価 */
  unitPrice: varchar("unitPrice", { length: 50 }),
  /** 備考 */
  etc: text("etc"),
  /** 元在庫データのJSON全体（復元用） */
  snapshotJson: text("snapshotJson").notNull(),
  /** 削除したオペレーター名 */
  deletedBy: varchar("deletedBy", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DeletedInventory = typeof deletedInventories.$inferSelect;
export type InsertDeletedInventory = typeof deletedInventories.$inferInsert;

/**
 * 在庫補足情報テーブル
 * Zaico側に保存できない在庫商品の補足情報（仕入先URL等）を管理する
 */
export const inventoryExtras = mysqlTable("inventory_extras", {
  id: int("id").autoincrement().primaryKey(),
  /** Zaico側の在庫ID */
  zaicoInventoryId: int("zaicoInventoryId").notNull().unique(),
  /** 仕入先URL */
  supplierUrl: text("supplierUrl"),
  /** 仕入先名 */
  supplierName: varchar("supplierName", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type InventoryExtra = typeof inventoryExtras.$inferSelect;
export type InsertInventoryExtra = typeof inventoryExtras.$inferInsert;

/**
 * 在庫メモテーブル
 * 在庫数増減時に入力したメモを保存する
 */
export const inventoryMemos = mysqlTable("inventory_memos", {
  id: int("id").autoincrement().primaryKey(),
  /** Zaico側の在庫ID */
  zaicoInventoryId: int("zaicoInventoryId").notNull(),
  /** 商品名 */
  title: varchar("title", { length: 500 }),
  /** 数量変更の種類（increase/decrease/set） */
  changeType: varchar("changeType", { length: 20 }).notNull(),
  /** 変更前の数量 */
  quantityBefore: int("quantityBefore"),
  /** 変更後の数量 */
  quantityAfter: int("quantityAfter"),
  /** 変更量（正数＝増加、負数＝減少） */
  quantityDelta: int("quantityDelta"),
  /** メモ */
  memo: text("memo"),
  /** 操作者名 */
  operatorName: varchar("operatorName", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type InventoryMemo = typeof inventoryMemos.$inferSelect;
export type InsertInventoryMemo = typeof inventoryMemos.$inferInsert;

/**
 * ローカル在庫マスタテーブル
 * Zaicoから移行・またはサイト内で管理する在庫商品マスタ
 * Zaico連携ON時はZaico APIと同期、OFF時はこのテーブルのみを参照する
 */
export const localInventories = mysqlTable("local_inventories", {
  id: int("id").autoincrement().primaryKey(),
  /** ZaicoのID（Zaicoから同期した場合のみ設定） */
  zaicoId: int("zaicoId").unique(),
  /** 商品名 */
  title: varchar("title", { length: 500 }).notNull(),
  /** カテゴリ */
  category: varchar("category", { length: 200 }),
  /** 保管場所 */
  place: varchar("place", { length: 200 }),
  /** 在庫数 */
  quantity: int("quantity").default(0).notNull(),
  /** 単位 */
  unit: varchar("unit", { length: 50 }).default("個"),
  /** 仕入単価 */
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }),
  /** 備考欄（管理番号等） */
  etc: text("etc"),
  /** 仕入先URL */
  supplierUrl: text("supplierUrl"),
  /** 仕入先名 */
  supplierName: varchar("supplierName", { length: 200 }),
  /** eBay listing page URL */
  ebayListingUrl: text("ebayListingUrl"),
  /** eBay order page URL */
  ebayOrderUrl: text("ebayOrderUrl"),
  /** eBay order status */
  ebayOrderStatus: varchar("ebayOrderStatus", { length: 20 }).default("normal").notNull(),
  /** 削除済みフラグ */
  isDeleted: int("isDeleted").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LocalInventory = typeof localInventories.$inferSelect;
export type InsertLocalInventory = typeof localInventories.$inferInsert;

/**
 * シャフト売上一覧テーブル
 * 在庫削除後も売上・利益確認用に残すスナップショット
 */
export const shaftSales = mysqlTable("shaft_sales", {
  id: int("id").autoincrement().primaryKey(),
  /** localInventories.id（削除後も参照用に残す） */
  inventoryId: int("inventoryId"),
  /** 管理番号 */
  managementNo: varchar("managementNo", { length: 200 }).notNull(),
  /** 商品名スナップショット */
  title: varchar("title", { length: 500 }).notNull(),
  /** カテゴリ */
  category: varchar("category", { length: 200 }),
  /** 売上数量 */
  quantity: int("quantity").default(1).notNull(),
  /** 仕入単価 */
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }),
  /** 売上金額 */
  saleAmount: decimal("saleAmount", { precision: 12, scale: 2 }).notNull(),
  saleUrl: text("saleUrl"),
  profitAmount: decimal("profitAmount", { precision: 12, scale: 2 }),
  /** 売上日 */
  soldAt: varchar("soldAt", { length: 20 }),
  /** 仕入先名 */
  supplierName: varchar("supplierName", { length: 200 }),
  /** 仕入先URL */
  supplierUrl: text("supplierUrl"),
  /** 登録時点の在庫データ */
  snapshotJson: text("snapshotJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ShaftSale = typeof shaftSales.$inferSelect;
export type InsertShaftSale = typeof shaftSales.$inferInsert;

/**
 * ローカル発注テーブル
 * Zaicoから移行・またはサイト内で管理する発注データ
 * Zaico連携ON時はZaico APIと同期、OFF時はこのテーブルのみを参照する
 */
export const localPurchases = mysqlTable("local_purchases", {
  id: int("id").autoincrement().primaryKey(),
  /** ZaicoのID（Zaicoから同期した場合のみ設定） */
  zaicoId: bigint("zaicoId", { mode: "number" }).unique(),
  /** Zaico発注No */
  purchaseNum: varchar("purchaseNum", { length: 100 }),
  /** ステータス（ordered/purchased） */
  status: varchar("status", { length: 50 }).notNull().default("ordered"),
  /** 発注商品情報（JSON: [{inventory_id, title, quantity, unit_price, etc}]） */
  itemsJson: text("itemsJson").notNull(),
  /** 在庫ID（localInventories.id） */
  localInventoryId: int("localInventoryId"),
  /** 商品名（スナップショット） */
  title: varchar("title", { length: 500 }),
  /** カテゴリ */
  category: varchar("category", { length: 200 }),
  /** 数量 */
  quantity: int("quantity").default(1).notNull(),
  /** 仕入単価 */
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }),
  /** 管理番号（etcフィールド） */
  managementNo: varchar("managementNo", { length: 200 }),
  /** 発注日 */
  purchaseDate: varchar("purchaseDate", { length: 20 }),
  /** 入庫日 */
  receivedDate: varchar("receivedDate", { length: 20 }),
  /** 仕入先発送日 */
  shipDate: varchar("shipDate", { length: 20 }),
  /** 追跡番号 */
  trackingNumber: varchar("trackingNumber", { length: 200 }),
  /** 配送業者 */
  carrier: varchar("carrier", { length: 50 }),
  /** 備考 */
  note: text("note"),
  /** 仕入先URL */
  supplierUrl: varchar("supplierUrl", { length: 500 }),
  /** 仕入先名（「Amazon モノモロストア」等「サイト名+出品者名」） */
  supplierName: varchar("supplierName", { length: 500 }),
  /**
   * 入庫分類（T22）: ebay / oregon / direct / domestic。NULL=未仕訳。
   * 追跡番号到着時に classifyInbound() で自動判定、または人間が上書き。
   */
  inboundClass: varchar("inboundClass", { length: 20 }),
  /** 分類の判定根拠（T22）: auto=自動判定 / manual=人間上書き。manualは自動再判定で上書きしない */
  classSource: varchar("classSource", { length: 10 }).notNull().default("auto"),
  /** 現在の作業工程（T22）: 分類ごとに取りうる値が変わる（inboundPipeline定義）。既定=received */
  stage: varchar("stage", { length: 20 }).notNull().default("received"),
  /** 最終工程更新者（T22・担当表示/監査用） */
  stageUpdatedBy: varchar("stageUpdatedBy", { length: 100 }),
  /** 最終工程更新時刻（T22） */
  stageUpdatedAt: timestamp("stageUpdatedAt"),
  /**
   * シャフト分離元の発注ID（T22）。
   * eBay/オレゴンのゴルフヘッド行から「シャフト分離」で生成された
   * 国内出品・発送待ち行が、親（ヘッド側）発注を参照するために保持する。
   */
  shaftParentPurchaseId: int("shaftParentPurchaseId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LocalPurchase = typeof localPurchases.$inferSelect;
export type InsertLocalPurchase = typeof localPurchases.$inferInsert;

/**
 * Individual item label IDs generated by the transaction hub.
 * These IDs are separate from the legacy management number used by existing flows.
 */
export const inventoryItemLabels = mysqlTable("inventory_item_labels", {
  id: int("id").autoincrement().primaryKey(),
  labelId: varchar("labelId", { length: 7 }).notNull().unique(),
  purchaseId: int("purchaseId"),
  localInventoryId: int("localInventoryId"),
  legacyManagementNo: varchar("legacyManagementNo", { length: 200 }),
  title: varchar("title", { length: 500 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("ordered"),
  sourceKey: varchar("sourceKey", { length: 255 }),
  receivedAt: timestamp("receivedAt"),
  shippedAt: timestamp("shippedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type InventoryItemLabel = typeof inventoryItemLabels.$inferSelect;
export type InsertInventoryItemLabel = typeof inventoryItemLabels.$inferInsert;

/**
 * システム設定テーブル
 * Zaico連携ON/OFF等のシステム設定を保存する
 */
export const systemSettings = mysqlTable("system_settings", {
  id: int("id").autoincrement().primaryKey(),
  /** 設定キー */
  key: varchar("key", { length: 100 }).notNull().unique(),
  /** 設定値 */
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;

/** インボイス商品種別メモ（発注管理画面のカラー別メモ） */
export const invoiceMemos = mysqlTable("invoice_memos", {
  id: int("id").autoincrement().primaryKey(),
  /** インボイスNo（例: "371"） */
  invoiceKey: varchar("invoice_key", { length: 50 }).notNull(),
  /** 商品種別キー（例: "New3DS ランダムカラー"） */
  colorKey: varchar("color_key", { length: 200 }).notNull(),
  /** メモ内容 */
  memo: text("memo").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type InvoiceMemo = typeof invoiceMemos.$inferSelect;
export type InsertInvoiceMemo = typeof invoiceMemos.$inferInsert;

/**
 * 月次棚卸しレポートテーブル
 * 月末に生成・保存する棚卸しレポートのヘッダー情報
 */
export const monthlyReports = mysqlTable("monthly_reports", {
  id: int("id").autoincrement().primaryKey(),
  /** レポート対象年月（例: "2026-03"） */
  yearMonth: varchar("year_month", { length: 7 }).notNull(),
  /** レポート名（任意） */
  label: varchar("label", { length: 200 }),
  /** 在庫金額サマリー（JSON文字列） */
  inventorySummaryJson: text("inventory_summary_json"),
  /** 支払済み未完了インボイス一覧（JSON文字列） */
  invoiceListJson: text("invoice_list_json"),
  /** 作成者名 */
  createdBy: varchar("created_by", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MonthlyReport = typeof monthlyReports.$inferSelect;
export type InsertMonthlyReport = typeof monthlyReports.$inferInsert;

/**
 * 月次レポート インボイス別仕入れコストテーブル
 * 各インボイスの商品別仕入れ単価（手入力分）を保存する
 */
export const monthlyReportCosts = mysqlTable("monthly_report_costs", {
  id: int("id").autoincrement().primaryKey(),
  /** 月次レポートID */
  reportId: int("report_id").notNull(),
  /** インボイスNo */
  invoiceKey: varchar("invoice_key", { length: 50 }).notNull(),
  /** 商品識別キー（Zaico商品IDまたは商品名） */
  itemKey: varchar("item_key", { length: 500 }).notNull(),
  /** 商品名 */
  title: varchar("title", { length: 500 }),
  /** 数量 */
  quantity: int("quantity").default(0).notNull(),
  /** 仕入れ単価（手入力またはZaicoから自動取得） */
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
  /** 小計（単価xd7数量） */
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }),
  /** アイテム種別（"ordered"展開済み / "stock"在庫） */
  itemType: varchar("item_type", { length: 20 }).notNull().default("ordered"),
  /** 小数入力か（true=手入力） */
  isManual: int("is_manual").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MonthlyReportCost = typeof monthlyReportCosts.$inferSelect;
export type InsertMonthlyReportCost = typeof monthlyReportCosts.$inferInsert;

/**
 * 月次棚卸し インボイス別手動入力行テーブル
 * 未完了インボイスの在庫一覧に自由に追加できる手動入力行を保存する
 */
export const invoiceManualItems = mysqlTable("invoice_manual_items", {
  id: int("id").autoincrement().primaryKey(),
  /** インボイスNo（例: "371"） */
  invoiceNo: varchar("invoice_no", { length: 50 }).notNull(),
  /** 商品名 */
  title: varchar("title", { length: 500 }).notNull().default(""),
  /** 数量 */
  quantity: int("quantity").notNull().default(1),
  /** 仕入単価（円） */
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
  /** 表示順 */
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type InvoiceManualItem = typeof invoiceManualItems.$inferSelect;
export type InsertInvoiceManualItem = typeof invoiceManualItems.$inferInsert;

/**
 * 国内卸商品マスタテーブル
 * 月次棚卸しレポートで使用する国内卸（toynet等）の発注商品を管理する
 */
export const domesticProducts = mysqlTable("domestic_products", {
  id: int("id").autoincrement().primaryKey(),
  /** 商品名 */
  title: varchar("title", { length: 500 }).notNull(),
  /** 仕入単価（円） */
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
  /** 仕入先名（例: toynet, 益子商会） */
  supplierName: varchar("supplier_name", { length: 200 }),
  /** メモ */
  note: text("note"),
  /** 表示順 */
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DomesticProduct = typeof domesticProducts.$inferSelect;
export type InsertDomesticProduct = typeof domesticProducts.$inferInsert;

/**
 * 月次棚卸し 国内卸発注行テーブル
 * 月次レポートの国内卸セクションに追加する行（マスタ選択または手動入力）
 */
export const monthlyDomesticItems = mysqlTable("monthly_domestic_items", {
  id: int("id").autoincrement().primaryKey(),
  /** 対象年月（例: "2026-03"） */
  yearMonth: varchar("year_month", { length: 7 }).notNull(),
  /** 国内卸商品マスタID（マスタから選択した場合） */
  domesticProductId: int("domestic_product_id"),
  /** 商品名（手動入力または選択時のスナップショット） */
  title: varchar("title", { length: 500 }).notNull().default(""),
  /** 数量 */
  quantity: int("quantity").notNull().default(1),
  /** 仕入単価（円）（手動入力または選択時のスナップショット） */
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
  /** 仕入先名 */
  supplierName: varchar("supplier_name", { length: 200 }),
  /** メモ */
  note: text("note"),
  /** 支払済みフラグ（0=未払い, 1=支払済み） */
  isPaid: int("is_paid").notNull().default(0),
  /** 表示順 */
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MonthlyDomesticItem = typeof monthlyDomesticItems.$inferSelect;
export type InsertMonthlyDomesticItem = typeof monthlyDomesticItems.$inferInsert;

/**
 * 取引先マスタテーブル
 * 出庫Noの自動生成に使用する取引先情報を管理する
 * 管理番号の2番目のセグメント（例: 371_ルカ_... の「ルカ」）と照合する
 */
export const customers = mysqlTable("customers", {
  id: int("id").autoincrement().primaryKey(),
  /** 表示名（例: ルカ） */
  displayName: varchar("displayName", { length: 100 }).notNull(),
  /** 出庫Noに使うコード（例: luca） */
  code: varchar("code", { length: 100 }).notNull(),
  /** 管理番号内のキーワード（カンマ区切りで複数指定可、例: ルカ,luca） */
  keywords: varchar("keywords", { length: 500 }).notNull(),
  /** 表示順 */
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

/**
 * 認証済みユーザーテーブル
 * 認証コードを入力して認証済みになったユーザーを記録する
 * 一度認証したユーザーは次回以降コード入力不要
 */
export const authorizedUsers = mysqlTable("authorized_users", {
  id: int("id").autoincrement().primaryKey(),
  /** ログインユーザーの openId */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  /** ユーザー名（表示用） */
  name: text("name"),
  /** メールアドレス */
  email: varchar("email", { length: 320 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuthorizedUser = typeof authorizedUsers.$inferSelect;
export type InsertAuthorizedUser = typeof authorizedUsers.$inferInsert;

export const actionItemAssignees = mysqlTable("action_item_assignees", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ActionItemAssignee = typeof actionItemAssignees.$inferSelect;
export type InsertActionItemAssignee = typeof actionItemAssignees.$inferInsert;

export const actionItemTitlePresets = mysqlTable("action_item_title_presets", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull().unique(),
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ActionItemTitlePreset = typeof actionItemTitlePresets.$inferSelect;
export type InsertActionItemTitlePreset = typeof actionItemTitlePresets.$inferInsert;

export const actionItemAuthors = mysqlTable("action_item_authors", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ActionItemAuthor = typeof actionItemAuthors.$inferSelect;
export type InsertActionItemAuthor = typeof actionItemAuthors.$inferInsert;

export const actionItems = mysqlTable("action_items", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  assignee: varchar("assignee", { length: 100 }).notNull(),
  detail: text("detail").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  source: varchar("source", { length: 50 }),
  sourceKey: varchar("sourceKey", { length: 255 }),
  sourceQuestion: text("sourceQuestion"),
  reviewerChecksJson: text("reviewerChecksJson"),
  createdBy: varchar("createdBy", { length: 200 }),
  isPinned: boolean("isPinned").default(false).notNull(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ActionItem = typeof actionItems.$inferSelect;
export type InsertActionItem = typeof actionItems.$inferInsert;

export const actionItemReplies = mysqlTable("action_item_replies", {
  id: int("id").autoincrement().primaryKey(),
  actionItemId: int("actionItemId").notNull(),
  body: text("body").notNull(),
  author: varchar("author", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ActionItemReply = typeof actionItemReplies.$inferSelect;
export type InsertActionItemReply = typeof actionItemReplies.$inferInsert;

export const workLogWorkers = mysqlTable("work_log_workers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type WorkLogWorker = typeof workLogWorkers.$inferSelect;
export type InsertWorkLogWorker = typeof workLogWorkers.$inferInsert;

export const workLogCategories = mysqlTable("work_log_categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type WorkLogCategory = typeof workLogCategories.$inferSelect;
export type InsertWorkLogCategory = typeof workLogCategories.$inferInsert;

export const workLogs = mysqlTable("work_logs", {
  id: int("id").autoincrement().primaryKey(),
  workerName: varchar("workerName", { length: 100 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("done"),
  startedAt: timestamp("startedAt"),
  endedAt: timestamp("endedAt"),
  manualMinutes: int("manualMinutes"),
  quantity: int("quantity").notNull().default(0),
  memo: text("memo"),
  sourceType: varchar("sourceType", { length: 50 }),
  sourceId: varchar("sourceId", { length: 200 }),
  detailsJson: text("detailsJson"),
  createdBy: varchar("createdBy", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type WorkLog = typeof workLogs.$inferSelect;
export type InsertWorkLog = typeof workLogs.$inferInsert;

/**
 * FedEx発送記録テーブル
 * 出庫グループ（deliveryNo）に紐づくFedEx発送情報を管理する
 * スプレッドシートへの自動書き込みに使用
 */
export const fedexShipments = mysqlTable("fedex_shipments", {
  id: int("id").autoincrement().primaryKey(),
  /** 出庫No（deliveryHistoriesのdeliveryNoと対応） */
  deliveryNo: varchar("deliveryNo", { length: 200 }).notNull(),
  /** 書き込み先スプシシート名（例: 独発送管理、サミー発送管理） */
  sheetName: varchar("sheetName", { length: 100 }).notNull(),
  /** 発送日（スプシのヘッダーと一致する形式: 例 3/26） */
  shippingDate: varchar("shippingDate", { length: 20 }).notNull(),
  /** FedEx追跡番号 */
  trackingNumber: varchar("trackingNumber", { length: 100 }).notNull(),
  /** 発送商品情報JSON（[{productNameJa, productNameEn, quantity}]） */
  itemsJson: text("itemsJson").notNull(),
  /** スプシ書き込みステータス */
  spreadsheetStatus: mysqlEnum("spreadsheetStatus", ["pending", "success", "error"]).default("pending").notNull(),
  /** スプシ書き込みエラーメッセージ */
  spreadsheetError: text("spreadsheetError"),
  /** 登録したオペレーター名 */
  operatorName: varchar("operatorName", { length: 200 }),
  /** 紐付く出庫履歴ID（delivery_histories.id）。1件のFedEx発送が1件の出庫履歴に対応 */
  historyId: int("historyId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type FedexShipment = typeof fedexShipments.$inferSelect;
export type InsertFedexShipment = typeof fedexShipments.$inferInsert;

/**
 * 取引先ポータル認証テーブル
 * 取引先（ルカ、サミー等）のパスワードとセッショントークンを管理する
 */
export const partnerPortals = mysqlTable("partner_portals", {
  id: int("id").autoincrement().primaryKey(),
  /** 取引先コード（例: luca, sammy）— URLスラグとして使用 */
  partnerCode: varchar("partnerCode", { length: 100 }).notNull().unique(),
  /** 取引先表示名（英語、例: Luca, Sammy） */
  partnerName: varchar("partnerName", { length: 200 }).notNull(),
  /** 対応するスプシシート名（例: 独発送管理、サミー発送管理） */
  sheetName: varchar("sheetName", { length: 100 }).notNull(),
  /** パスワード（平文保存、管理者が設定） */
  password: varchar("password", { length: 200 }).notNull(),
  /** セッショントークン（ログイン時に発行） */
  sessionToken: varchar("sessionToken", { length: 200 }),
  /** セッション有効期限 */
  sessionExpiresAt: timestamp("sessionExpiresAt"),
  /** 有効フラグ */
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PartnerPortal = typeof partnerPortals.$inferSelect;
export type InsertPartnerPortal = typeof partnerPortals.$inferInsert;

/**
 * 受取確認チェックテーブル
 * 取引先が発送記録の各商品行にチェックを入れた状態を保存する
 */
export const shipmentChecks = mysqlTable("shipment_checks", {
  id: int("id").autoincrement().primaryKey(),
  /** FedEx発送記録ID（fedexShipments.id） */
  fedexShipmentId: int("fedexShipmentId").notNull(),
  /** 商品インデックス（itemsJson内の配列インデックス） */
  itemIndex: int("itemIndex").notNull(),
  /** チェック済みフラグ（0=未確認, 1=確認済み） */
  isChecked: int("isChecked").default(0).notNull(),
  /** チェックした取引先コード */
  partnerCode: varchar("partnerCode", { length: 100 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ShipmentCheck = typeof shipmentChecks.$inferSelect;
export type InsertShipmentCheck = typeof shipmentChecks.$inferInsert;

/**
 * 取引先メッセージテーブル
 * 取引先から管理者へのメッセージ（不足・不備報告等）を保存する
 */
export const partnerMessages = mysqlTable("partner_messages", {
  id: int("id").autoincrement().primaryKey(),
  /** 送信した取引先コード */
  partnerCode: varchar("partnerCode", { length: 100 }).notNull(),
  /** 取引先表示名 */
  partnerName: varchar("partnerName", { length: 200 }).notNull(),
  /** 関連するFedEx発送記録ID（任意） */
  fedexShipmentId: int("fedexShipmentId"),
  /** メッセージ内容 */
  message: text("message").notNull(),
  /** 管理者が既読にしたか */
  isRead: int("isRead").default(0).notNull(),
  /** 管理者からの返信テキスト */
  replyText: text("replyText"),
  /** 返信日時 */
  repliedAt: timestamp("repliedAt"),
  /** 削除フラグ（管理者が削除した場合） */
  isDeleted: int("isDeleted").default(0).notNull(),
  /** 取引先側削除フラグ */
  isDeletedByPartner: int("isDeletedByPartner").default(0).notNull(),
  /** 取引先が管理者からの返信を既読にしたか */
  isReadByPartner: int("isReadByPartner").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PartnerMessage = typeof partnerMessages.$inferSelect;
export type InsertPartnerMessage = typeof partnerMessages.$inferInsert;

/**
 * メッセージスレッドテーブル
 * partner_messagesの最初のメッセージに対するスレッド形式の追加返信を保存する
 */
export const partnerMessageThreads = mysqlTable("partner_message_threads", {
  id: int("id").autoincrement().primaryKey(),
  /** 親メッセージID (partner_messages.id) */
  parentMessageId: int("parentMessageId").notNull(),
  /** 送信者種別: 'admin' | 'partner' */
  senderType: varchar("senderType", { length: 20 }).notNull(),
  /** 送信者名 */
  senderName: varchar("senderName", { length: 200 }).notNull(),
  /** メッセージ内容 */
  content: text("content").notNull(),
  /** 取引先が既読にしたか（admin送信時に使用） */
  isReadByPartner: int("isReadByPartner").default(0).notNull(),
  /** 管理者が既読にしたか（partner送信時に使用） */
  isReadByAdmin: int("isReadByAdmin").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PartnerMessageThread = typeof partnerMessageThreads.$inferSelect;
export type InsertPartnerMessageThread = typeof partnerMessageThreads.$inferInsert;

/**
 * 手動発送記録テーブル
 * スプシ連携なしで手動入力した発送データを管理する
 */
export const manualShipments = mysqlTable("manual_shipments", {
  id: int("id").autoincrement().primaryKey(),
  /** インボイスNo */
  invoiceNo: varchar("invoiceNo", { length: 50 }).notNull(),
  /** 書き込み先スプシシート名（例: 独発送管理、サミー発送管理） */
  sheetName: varchar("sheetName", { length: 100 }).notNull(),
  /** 発送日（例: 3/26） */
  shippingDate: varchar("shippingDate", { length: 20 }).notNull(),
  /** 追跡番号 */
  trackingNumber: varchar("trackingNumber", { length: 100 }).notNull(),
  /** 発送商品情報JSON（[{productNameJa, productNameEn, quantity}]） */
  itemsJson: text("itemsJson").notNull(),
  /** 登録したオペレーター名 */
  operatorName: varchar("operatorName", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ManualShipment = typeof manualShipments.$inferSelect;
export type InsertManualShipment = typeof manualShipments.$inferInsert;
