import { randomInt } from "node:crypto";
import { eq, desc, and, inArray, gt, like, isNotNull, sql } from "drizzle-orm";
import {
  InsertUser,
  User,
  users,
  purchaseExtras,
  PurchaseExtra,
  InsertPurchaseExtra,
  deliveryHistories,
  DeliveryHistory,
  InsertDeliveryHistory,
  purchaseHistories,
  PurchaseHistory,
  InsertPurchaseHistory,
  deletedInventories,
  DeletedInventory,
  InsertDeletedInventory,
  inventoryExtras,
  InventoryExtra,
  InsertInventoryExtra,
  inventoryMemos,
  InventoryMemo,
  InsertInventoryMemo,
  invoiceMemos,
  monthlyReports,
  MonthlyReport,
  InsertMonthlyReport,
  monthlyReportCosts,
  MonthlyReportCost,
  InsertMonthlyReportCost,
  invoiceManualItems,
  InvoiceManualItem,
  domesticProducts,
  DomesticProduct,
  InsertDomesticProduct,
  monthlyDomesticItems,
  MonthlyDomesticItem,
  InsertMonthlyDomesticItem,
  customers,
  Customer,
  InsertCustomer,
  authorizedUsers,
  InsertAuthorizedUser,
  fedexShipments,
  InsertFedexShipment,
  FedexShipment,
  partnerPortals,
  PartnerPortal,
  InsertPartnerPortal,
  shipmentChecks,
  ShipmentCheck,
  partnerMessages,
  InsertPartnerMessage,
  PartnerMessage,
  partnerMessageThreads,
  PartnerMessageThread,
  InsertPartnerMessageThread,
  manualShipments,
  InsertManualShipment,
  ManualShipment,
  shaftSales,
  ShaftSale,
  InsertShaftSale,
  invoices,
} from "../../drizzle/schema";
import { ADMIN_EMAILS } from "../../shared/const";
import { createDrizzleDatabase, type AppDatabase } from "../_core/database";
import { getLocalDumpTable } from "./localDump";

let _db: AppDatabase | null = null;
let _inventorySchemaReady: Promise<void> | null = null;

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
    } else if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (typeof record.message === "string") parts.push(record.message);
      if (typeof record.code === "string") parts.push(record.code);
      current = record.cause;
    } else {
      parts.push(String(current));
      current = undefined;
    }
  }
  return parts.join(" ");
}

function getRawRows(result: unknown): unknown[] {
  if (Array.isArray(result)) {
    const first = result[0];
    if (Array.isArray(first)) return first;
    return result;
  }
  if (result && typeof result === "object") {
    const rows = (result as { rows?: unknown[] }).rows;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

async function ensureInventoryRuntimeSchema(db: AppDatabase) {
  try {
    const existing = await db.execute(sql`SHOW COLUMNS FROM local_inventories LIKE 'ebayListingUrl'`);
    const rows = getRawRows(existing);
    if (rows.length === 0) {
      await db.execute(sql`ALTER TABLE local_inventories ADD COLUMN ebayListingUrl text`);
    }
    const existingOrderUrl = await db.execute(sql`SHOW COLUMNS FROM local_inventories LIKE 'ebayOrderUrl'`);
    const orderUrlRows = getRawRows(existingOrderUrl);
    if (orderUrlRows.length === 0) {
      await db.execute(sql`ALTER TABLE local_inventories ADD COLUMN ebayOrderUrl text`);
    }
    const existingOrderStatus = await db.execute(sql`SHOW COLUMNS FROM local_inventories LIKE 'ebayOrderStatus'`);
    const orderStatusRows = getRawRows(existingOrderStatus);
    if (orderStatusRows.length === 0) {
      await db.execute(sql`ALTER TABLE local_inventories ADD COLUMN ebayOrderStatus varchar(20) NOT NULL DEFAULT 'normal'`);
    }
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS shaft_sales (
        id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
        inventoryId int NULL,
        managementNo varchar(200) NOT NULL,
        title varchar(500) NOT NULL,
        category varchar(200) NULL,
        quantity int NOT NULL DEFAULT 1,
        unitPrice decimal(10,2) NULL,
        saleAmount decimal(12,2) NOT NULL,
        saleUrl text NULL,
        profitAmount decimal(12,2) NULL,
        soldAt varchar(20) NULL,
        supplierName varchar(200) NULL,
        supplierUrl text NULL,
        snapshotJson text NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_shaft_sales_inventory_id (inventoryId),
        INDEX idx_shaft_sales_management_no (managementNo)
      )
    `);
    const existingShaftProfit = await db.execute(sql`SHOW COLUMNS FROM shaft_sales LIKE 'profitAmount'`);
    if (getRawRows(existingShaftProfit).length === 0) {
      await db.execute(sql`ALTER TABLE shaft_sales ADD COLUMN profitAmount decimal(12,2) NULL AFTER saleAmount`);
    }
    const existingShaftSaleUrl = await db.execute(sql`SHOW COLUMNS FROM shaft_sales LIKE 'saleUrl'`);
    if (getRawRows(existingShaftSaleUrl).length === 0) {
      await db.execute(sql`ALTER TABLE shaft_sales ADD COLUMN saleUrl text NULL AFTER saleAmount`);
    }
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS inventory_item_labels (
        id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
        labelId varchar(7) NOT NULL UNIQUE,
        purchaseId int NULL,
        localInventoryId int NULL,
        legacyManagementNo varchar(200) NULL,
        title varchar(500) NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'ordered',
        sourceKey varchar(255) NULL,
        receivedAt timestamp NULL,
        shippedAt timestamp NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_inventory_item_labels_purchase_id (purchaseId),
        INDEX idx_inventory_item_labels_inventory_id (localInventoryId),
        INDEX idx_inventory_item_labels_legacy_management_no (legacyManagementNo),
        INDEX idx_inventory_item_labels_source_key (sourceKey)
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS action_item_assignees (
        id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name varchar(100) NOT NULL UNIQUE,
        sortOrder int NOT NULL DEFAULT 0,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS action_item_title_presets (
        id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
        title varchar(255) NOT NULL UNIQUE,
        sortOrder int NOT NULL DEFAULT 0,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS action_item_authors (
        id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name varchar(100) NOT NULL UNIQUE,
        sortOrder int NOT NULL DEFAULT 0,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS action_items (
        id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
        title varchar(255) NOT NULL,
        assignee varchar(100) NOT NULL,
        detail text NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'open',
        source varchar(50) NULL,
        sourceKey varchar(255) NULL,
        sourceQuestion text NULL,
        reviewerChecksJson text NULL,
        createdBy varchar(200) NULL,
        isPinned boolean NOT NULL DEFAULT false,
        completedAt timestamp NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_action_items_status (status),
        INDEX idx_action_items_assignee (assignee),
        INDEX idx_action_items_source_key (sourceKey)
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS action_item_replies (
        id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
        actionItemId int NOT NULL,
        body text NOT NULL,
        author varchar(200) NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_action_item_replies_item (actionItemId),
        INDEX idx_action_item_replies_created (createdAt)
      )
    `);
    const existingActionSourceKey = await db.execute(sql`SHOW COLUMNS FROM action_items LIKE 'sourceKey'`);
    const actionSourceKeyRows = getRawRows(existingActionSourceKey);
    if (actionSourceKeyRows.length === 0) {
      await db.execute(sql`ALTER TABLE action_items ADD COLUMN sourceKey varchar(255) NULL`);
    }
    const existingActionReviewerChecks = await db.execute(sql`SHOW COLUMNS FROM action_items LIKE 'reviewerChecksJson'`);
    const actionReviewerChecksRows = getRawRows(existingActionReviewerChecks);
    if (actionReviewerChecksRows.length === 0) {
      await db.execute(sql`ALTER TABLE action_items ADD COLUMN reviewerChecksJson text NULL`);
    }
    const existingActionPinned = await db.execute(sql`SHOW COLUMNS FROM action_items LIKE 'isPinned'`);
    const actionPinnedRows = getRawRows(existingActionPinned);
    if (actionPinnedRows.length === 0) {
      await db.execute(sql`ALTER TABLE action_items ADD COLUMN isPinned boolean NOT NULL DEFAULT false`);
    }
    const existingActionSourceKeyIndex = await db.execute(sql`SHOW INDEX FROM action_items WHERE Key_name = 'idx_action_items_source_key'`);
    const actionSourceKeyIndexRows = getRawRows(existingActionSourceKeyIndex);
    if (actionSourceKeyIndexRows.length === 0) {
      await db.execute(sql`ALTER TABLE action_items ADD INDEX idx_action_items_source_key (sourceKey)`);
    }
    await db.execute(sql`
      INSERT IGNORE INTO action_item_assignees (name, sortOrder)
      VALUES ('仕入れ担当', 1), ('荷受担当', 2), ('出荷担当', 3), ('その他', 4)
    `);
    await db.execute(sql`
      INSERT IGNORE INTO action_item_authors (name, sortOrder)
      VALUES ('村上', 1), ('鈴木', 2), ('藤本', 3), ('野田', 4)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS work_log_workers (
        id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name varchar(100) NOT NULL UNIQUE,
        sortOrder int NOT NULL DEFAULT 0,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS work_log_categories (
        id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name varchar(100) NOT NULL UNIQUE,
        sortOrder int NOT NULL DEFAULT 0,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS work_logs (
        id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
        workerName varchar(100) NOT NULL,
        category varchar(100) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'done',
        startedAt timestamp NULL,
        endedAt timestamp NULL,
        manualMinutes int NULL,
        quantity int NOT NULL DEFAULT 0,
        memo text NULL,
        sourceType varchar(50) NULL,
        sourceId varchar(200) NULL,
        detailsJson text NULL,
        createdBy varchar(200) NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_work_logs_worker (workerName),
        INDEX idx_work_logs_category (category),
        INDEX idx_work_logs_status (status),
        INDEX idx_work_logs_started (startedAt),
        INDEX idx_work_logs_created (createdAt)
      )
    `);
    const existingWorkLogSourceType = await db.execute(sql`SHOW COLUMNS FROM work_logs LIKE 'sourceType'`);
    if (getRawRows(existingWorkLogSourceType).length === 0) {
      await db.execute(sql`ALTER TABLE work_logs ADD COLUMN sourceType varchar(50) NULL`);
    }
    const existingWorkLogSourceId = await db.execute(sql`SHOW COLUMNS FROM work_logs LIKE 'sourceId'`);
    if (getRawRows(existingWorkLogSourceId).length === 0) {
      await db.execute(sql`ALTER TABLE work_logs ADD COLUMN sourceId varchar(200) NULL`);
    }
    const existingWorkLogDetailsJson = await db.execute(sql`SHOW COLUMNS FROM work_logs LIKE 'detailsJson'`);
    if (getRawRows(existingWorkLogDetailsJson).length === 0) {
      await db.execute(sql`ALTER TABLE work_logs ADD COLUMN detailsJson text NULL`);
    }
    // T22: 入庫仕訳・工程カラム（local_purchases）を安全追加（drizzleマイグレーション0019と二重化）
    const existingInboundClass = await db.execute(sql`SHOW COLUMNS FROM local_purchases LIKE 'inboundClass'`);
    if (getRawRows(existingInboundClass).length === 0) {
      await db.execute(sql`ALTER TABLE local_purchases ADD COLUMN inboundClass varchar(20) NULL`);
    }
    const existingClassSource = await db.execute(sql`SHOW COLUMNS FROM local_purchases LIKE 'classSource'`);
    if (getRawRows(existingClassSource).length === 0) {
      await db.execute(sql`ALTER TABLE local_purchases ADD COLUMN classSource varchar(10) NOT NULL DEFAULT 'auto'`);
    }
    const existingStage = await db.execute(sql`SHOW COLUMNS FROM local_purchases LIKE 'stage'`);
    if (getRawRows(existingStage).length === 0) {
      await db.execute(sql`ALTER TABLE local_purchases ADD COLUMN stage varchar(20) NOT NULL DEFAULT 'received'`);
    }
    const existingStageUpdatedBy = await db.execute(sql`SHOW COLUMNS FROM local_purchases LIKE 'stageUpdatedBy'`);
    if (getRawRows(existingStageUpdatedBy).length === 0) {
      await db.execute(sql`ALTER TABLE local_purchases ADD COLUMN stageUpdatedBy varchar(100) NULL`);
    }
    const existingStageUpdatedAt = await db.execute(sql`SHOW COLUMNS FROM local_purchases LIKE 'stageUpdatedAt'`);
    if (getRawRows(existingStageUpdatedAt).length === 0) {
      await db.execute(sql`ALTER TABLE local_purchases ADD COLUMN stageUpdatedAt timestamp NULL`);
    }
    const existingShaftParent = await db.execute(sql`SHOW COLUMNS FROM local_purchases LIKE 'shaftParentPurchaseId'`);
    if (getRawRows(existingShaftParent).length === 0) {
      await db.execute(sql`ALTER TABLE local_purchases ADD COLUMN shaftParentPurchaseId int NULL`);
    }
    await db.execute(sql`
      INSERT IGNORE INTO work_log_workers (name, sortOrder)
      VALUES ('鈴木', 1), ('藤本', 2), ('野田', 3)
    `);
    await db.execute(sql`
      INSERT IGNORE INTO work_log_categories (name, sortOrder)
      VALUES
        ('仕入れ確認', 1),
        ('入庫登録', 2),
        ('検品', 3),
        ('清掃', 4),
        ('撮影', 5),
        ('出品', 6),
        ('梱包', 7),
        ('出庫登録', 8),
        ('FedEx発送登録', 9),
        ('スプシ確認', 10),
        ('その他', 99)
    `);
  } catch (error) {
    const message = errorText(error);
    if (
      message.includes("Duplicate column") ||
      message.includes("ER_DUP_FIELDNAME") ||
      message.includes("already exists") ||
      message.includes("1060")
    ) {
      return;
    }
    console.warn("[Inventory DB] Runtime schema check skipped:", message);
  }
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = createDrizzleDatabase(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  if (_db) {
    _inventorySchemaReady ??= ensureInventoryRuntimeSchema(_db);
    await _inventorySchemaReady;
  }
  return _db;
}

type DumpRow = Record<string, any>;
type PurchaseHistoryWithDetails = PurchaseHistory & {
  supplierUrl: string | null;
  supplierName: string | null;
  trackingNumber: string | null;
  carrier: string | null;
};

async function getDumpRows<T extends DumpRow = DumpRow>(tableName: string): Promise<T[]> {
  return getLocalDumpTable<T>(tableName);
}

function byCreatedDesc<T extends DumpRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

function byUpdatedDesc<T extends DumpRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
}

function byFieldsAsc<T extends DumpRow>(rows: T[], fields: string[]): T[] {
  return [...rows].sort((a, b) => {
    for (const field of fields) {
      const result = String(a[field] ?? "").localeCompare(String(b[field] ?? ""), "ja", { numeric: true });
      if (result !== 0) return result;
    }
    return 0;
  });
}

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    }

    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<User>("users");
    return rows.find((row) => row.openId === openId);
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============================================================
// 入庫補足情報（purchase_extras）
// ============================================================

export async function upsertPurchaseExtra(data: InsertPurchaseExtra) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateSet: Partial<InsertPurchaseExtra> = {};
  if (data.shipDate !== undefined) updateSet.shipDate = data.shipDate;
  if (data.trackingNumber !== undefined) updateSet.trackingNumber = data.trackingNumber;
  if (data.carrier !== undefined) updateSet.carrier = data.carrier;
  if (data.note !== undefined) updateSet.note = data.note;

  await db
    .insert(purchaseExtras)
    .values(data)
    .onDuplicateKeyUpdate({ set: updateSet });
}

export async function getPurchaseExtraByZaicoId(zaicoId: number): Promise<PurchaseExtra | undefined> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<PurchaseExtra>("purchase_extras");
    return rows.find((row) => row.zaicoId === zaicoId);
  }
  const result = await db
    .select()
    .from(purchaseExtras)
    .where(eq(purchaseExtras.zaicoId, zaicoId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllPurchaseExtras(): Promise<PurchaseExtra[]> {
  const db = await getDb();
  if (!db) return getDumpRows<PurchaseExtra>("purchase_extras");
  return db.select().from(purchaseExtras);
}

// ============================================================
// 出庫履歴（delivery_histories）
// ============================================================

export async function createDeliveryHistory(data: InsertDeliveryHistory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(deliveryHistories).values(data);
}

export async function getDeliveryHistories(limit = 100): Promise<DeliveryHistory[]> {
  const db = await getDb();
  if (!db) return byCreatedDesc(await getDumpRows<DeliveryHistory>("delivery_histories")).slice(0, limit);
  return db
    .select()
    .from(deliveryHistories)
    .orderBy(desc(deliveryHistories.createdAt))
    .limit(limit);
}

/**
 * 出庫履歴を全件取得する（月次レポート用）
 */
export async function getAllDeliveryHistories(): Promise<DeliveryHistory[]> {
  const db = await getDb();
  if (!db) return byCreatedDesc(await getDumpRows<DeliveryHistory>("delivery_histories"));
  return db
    .select()
    .from(deliveryHistories)
    .orderBy(desc(deliveryHistories.createdAt));
}

/**
 * 出庫履歴の出庫Noを更新する
 */
export async function updateDeliveryNo(historyId: number, deliveryNo: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(deliveryHistories)
    .set({ deliveryNo })
    .where(eq(deliveryHistories.id, historyId));
}

/**
 * 出庫履歴の削除済みIDリストを更新する
 */
export async function markDeliveryItemsDeleted(historyId: number, deletedIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(deliveryHistories)
    .set({ deletedInventoryIdsJson: JSON.stringify(deletedIds) })
    .where(eq(deliveryHistories.id, historyId));
}

/**
 * 出庫履歴の取り消し済み商品リストを更新する
 * cancelledItems: [{inventoryId, quantity, cancelledAt}]
 */
export async function updateDeliveryCancelledItems(
  historyId: number,
  cancelledItems: Array<{ inventoryId: number; quantity: number; cancelledAt: string }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(deliveryHistories)
    .set({ cancelledItemsJson: JSON.stringify(cancelledItems) })
    .where(eq(deliveryHistories.id, historyId));
}

export async function getDeletedInventoryIdsFromDeliveryHistories(): Promise<Set<number>> {
  const ids = new Set<number>();
  const collect = (value: string | null | undefined) => {
    if (!value) return;
    try {
      const parsed = JSON.parse(value) as number[];
      for (const id of parsed) {
        const n = Number(id);
        if (Number.isFinite(n)) ids.add(n);
      }
    } catch {
      // ignore broken legacy JSON
    }
  };

  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<DeliveryHistory>("delivery_histories");
    for (const row of rows) collect(row.deletedInventoryIdsJson);
    return ids;
  }

  const rows = await db
    .select({ deletedInventoryIdsJson: deliveryHistories.deletedInventoryIdsJson })
    .from(deliveryHistories)
    .where(isNotNull(deliveryHistories.deletedInventoryIdsJson));
  for (const row of rows) collect(row.deletedInventoryIdsJson);
  return ids;
}

/**
 * 出庫Noに紐づく出庫履歴を全件取得する（マージ判定用）
 */
export async function getDeliveryHistoriesByDeliveryNo(deliveryNo: string): Promise<DeliveryHistory[]> {
  const db = await getDb();
  if (!db) {
    return byCreatedDesc((await getDumpRows<DeliveryHistory>("delivery_histories")).filter((row) => row.deliveryNo === deliveryNo));
  }
  return db
    .select()
    .from(deliveryHistories)
    .where(eq(deliveryHistories.deliveryNo, deliveryNo))
    .orderBy(desc(deliveryHistories.createdAt));
}

/**
 * インボイスNoをプレフィックスとして持つ出庫履歴を取得する
 * 例: invoiceNo="379" → deliveryNoが"379_"で始まるもの
 */
export async function getDeliveryHistoriesByInvoicePrefix(invoiceNo: string): Promise<DeliveryHistory[]> {
  const db = await getDb();
  if (!db) {
    const prefix = `${invoiceNo}_`;
    return byCreatedDesc((await getDumpRows<DeliveryHistory>("delivery_histories")).filter((row) => String(row.deliveryNo ?? "").startsWith(prefix)));
  }
  return db
    .select()
    .from(deliveryHistories)
    .where(like(deliveryHistories.deliveryNo, `${invoiceNo}_%`))
    .orderBy(desc(deliveryHistories.createdAt));
}

/**
 * 出庫履歴を1件取得する
 */
export async function getDeliveryHistoryById(historyId: number): Promise<DeliveryHistory | null> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<DeliveryHistory>("delivery_histories");
    return rows.find((row) => row.id === historyId) ?? null;
  }
  const rows = await db
    .select()
    .from(deliveryHistories)
    .where(eq(deliveryHistories.id, historyId))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteDeliveryHistoryById(historyId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(deliveryHistories).where(eq(deliveryHistories.id, historyId));
  return { ok: true };
}

/**
 * 出庫履歴のitemsJsonを更新する（商品単位の出庫No変更時に使用）
 */
export async function updateDeliveryHistoryItemsJson(
  historyId: number,
  itemsJson: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(deliveryHistories)
    .set({ itemsJson })
    .where(eq(deliveryHistories.id, historyId));
}

// ============================================================
// 入庫履歴（purchase_histories）
// ============================================================

export async function createPurchaseHistory(data: InsertPurchaseHistory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(purchaseHistories).values(data);
  return result;
}

export async function getPurchaseHistories(limit = 200): Promise<PurchaseHistoryWithDetails[]> {
  const db = await getDb();
  if (!db) {
    const rows = byCreatedDesc(await getDumpRows<PurchaseHistory>("purchase_histories"));
    const invExtras = new Map((await getDumpRows<InventoryExtra>("inventory_extras")).map((row) => [row.zaicoInventoryId, row]));
    const purchExtras = new Map((await getDumpRows<PurchaseExtra>("purchase_extras")).map((row) => [row.zaicoId, row]));
    return rows.slice(0, limit).map((row) => {
      const invExtra = row.inventoryId == null ? undefined : invExtras.get(row.inventoryId);
      const purchExtra = purchExtras.get(row.zaicoId);
      return {
        id: row.id,
        zaicoId: row.zaicoId,
        kanriNo: row.kanriNo,
        title: row.title,
        category: row.category,
        supplier: row.supplier,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        purchaseDate: row.purchaseDate,
        inventoryId: row.inventoryId,
        cancelled: row.cancelled,
        operatorName: row.operatorName,
        createdAt: row.createdAt,
        supplierUrl: invExtra?.supplierUrl ?? null,
        supplierName: invExtra?.supplierName ?? null,
        trackingNumber: purchExtra?.trackingNumber ?? null,
        carrier: purchExtra?.carrier ?? null,
      };
    });
  }
  const rows = await db
    .select({
      id: purchaseHistories.id,
      zaicoId: purchaseHistories.zaicoId,
      kanriNo: purchaseHistories.kanriNo,
      title: purchaseHistories.title,
      category: purchaseHistories.category,
      supplier: purchaseHistories.supplier,
      quantity: purchaseHistories.quantity,
      unitPrice: purchaseHistories.unitPrice,
      purchaseDate: purchaseHistories.purchaseDate,
      inventoryId: purchaseHistories.inventoryId,
      cancelled: purchaseHistories.cancelled,
      operatorName: purchaseHistories.operatorName,
      createdAt: purchaseHistories.createdAt,
      supplierUrl: inventoryExtras.supplierUrl,
      supplierName: inventoryExtras.supplierName,
      trackingNumber: purchaseExtras.trackingNumber,
      carrier: purchaseExtras.carrier,
    })
    .from(purchaseHistories)
    .leftJoin(
      inventoryExtras,
      eq(purchaseHistories.inventoryId, inventoryExtras.zaicoInventoryId)
    )
    .leftJoin(
      purchaseExtras,
      eq(purchaseHistories.zaicoId, purchaseExtras.zaicoId)
    )
    .orderBy(desc(purchaseHistories.createdAt))
    .limit(limit);
  return rows;
}

/**
 * DBの入庫履歴から inventoryId ごとの最新入庫日マップを返す
 * キャンセル済みは除外する
 */
export async function getLatestPurchaseDateMapFromDB(): Promise<Record<number, string>> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<PurchaseHistory>("purchase_histories");
    const map: Record<number, string> = {};
    for (const row of rows) {
      if (row.cancelled !== 0 || !row.inventoryId || !row.purchaseDate) continue;
      if (!map[row.inventoryId] || row.purchaseDate > map[row.inventoryId]) {
        map[row.inventoryId] = row.purchaseDate;
      }
    }
    return map;
  }
  const rows = await db
    .select({
      inventoryId: purchaseHistories.inventoryId,
      purchaseDate: purchaseHistories.purchaseDate,
    })
    .from(purchaseHistories)
    .where(eq(purchaseHistories.cancelled, 0));

  const map: Record<number, string> = {};
  for (const row of rows) {
    if (!row.inventoryId || !row.purchaseDate) continue;
    // より新しい日付で上書き
    if (!map[row.inventoryId] || row.purchaseDate > map[row.inventoryId]) {
      map[row.inventoryId] = row.purchaseDate;
    }
  }
  return map;
}

/** 手動在庫増加（quantityDelta > 0）の最新日時を在庫IDごとに返す */
export async function getLatestIncreaseMemosMap(): Promise<Record<number, string>> {
  const db = await getDb();
  if (!db) {
    const rows = (await getDumpRows<InventoryMemo>("inventory_memos")).filter((row) => numericValue(row.quantityDelta) != null && numericValue(row.quantityDelta)! > 0);
    const map: Record<number, string> = {};
    for (const row of rows) {
      if (!row.zaicoInventoryId || !row.createdAt) continue;
      const dateStr = String(row.createdAt).slice(0, 10);
      if (!map[row.zaicoInventoryId] || dateStr > map[row.zaicoInventoryId]) {
        map[row.zaicoInventoryId] = dateStr;
      }
    }
    return map;
  }
  const rows = await db
    .select({
      zaicoInventoryId: inventoryMemos.zaicoInventoryId,
      createdAt: inventoryMemos.createdAt,
    })
    .from(inventoryMemos)
    .where(gt(inventoryMemos.quantityDelta, 0));

  const map: Record<number, string> = {};
  for (const row of rows) {
    if (!row.zaicoInventoryId || !row.createdAt) continue;
    const dateStr = row.createdAt instanceof Date
      ? row.createdAt.toISOString().slice(0, 10)
      : String(row.createdAt).slice(0, 10);
    if (!map[row.zaicoInventoryId] || dateStr > map[row.zaicoInventoryId]) {
      map[row.zaicoInventoryId] = dateStr;
    }
  }
  return map;
}

export async function cancelPurchaseHistory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(purchaseHistories)
    .set({ cancelled: 1 })
    .where(eq(purchaseHistories.id, id));
}

// ============================================================
// 削除済み商品（deleted_inventories）
// ============================================================

export async function createDeletedInventory(data: InsertDeletedInventory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(deletedInventories).values(data);
}

export async function getDeletedInventories(limit = 500): Promise<DeletedInventory[]> {
  const db = await getDb();
  if (!db) return byCreatedDesc(await getDumpRows<DeletedInventory>("deleted_inventories")).slice(0, limit);
  return db
    .select()
    .from(deletedInventories)
    .orderBy(desc(deletedInventories.createdAt))
    .limit(limit);
}

export async function removeDeletedInventory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(deletedInventories).where(eq(deletedInventories.id, id));
}

// ============================================================
// 在庫補足情報（inventory_extras）
// ============================================================

export async function upsertInventoryExtra(data: InsertInventoryExtra) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Partial<InsertInventoryExtra> = {};
  if (data.supplierUrl !== undefined) updateSet.supplierUrl = data.supplierUrl;
  if (data.supplierName !== undefined) updateSet.supplierName = data.supplierName;
  await db
    .insert(inventoryExtras)
    .values(data)
    .onDuplicateKeyUpdate({ set: updateSet });
}

export async function getInventoryExtraByZaicoId(zaicoInventoryId: number): Promise<InventoryExtra | undefined> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<InventoryExtra>("inventory_extras");
    return rows.find((row) => row.zaicoInventoryId === zaicoInventoryId);
  }
  const result = await db
    .select()
    .from(inventoryExtras)
    .where(eq(inventoryExtras.zaicoInventoryId, zaicoInventoryId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllInventoryExtras(): Promise<InventoryExtra[]> {
  const db = await getDb();
  if (!db) return getDumpRows<InventoryExtra>("inventory_extras");
  return db.select().from(inventoryExtras);
}

export async function deleteInventoryExtra(zaicoInventoryId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(inventoryExtras).where(eq(inventoryExtras.zaicoInventoryId, zaicoInventoryId));
}

// ============================================================
// 在庫メモ（inventory_memos）
// ============================================================

export async function createInventoryMemo(data: InsertInventoryMemo) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(inventoryMemos).values(data);
  return result;
}

export async function getInventoryMemos(zaicoInventoryId: number, limit = 50): Promise<InventoryMemo[]> {
  const db = await getDb();
  if (!db) {
    return byCreatedDesc((await getDumpRows<InventoryMemo>("inventory_memos")).filter((row) => row.zaicoInventoryId === zaicoInventoryId)).slice(0, limit);
  }
  return db
    .select()
    .from(inventoryMemos)
    .where(eq(inventoryMemos.zaicoInventoryId, zaicoInventoryId))
    .orderBy(desc(inventoryMemos.createdAt))
    .limit(limit);
}

export async function getAllInventoryMemos(limit = 500): Promise<InventoryMemo[]> {
  const db = await getDb();
  if (!db) return byCreatedDesc(await getDumpRows<InventoryMemo>("inventory_memos")).slice(0, limit);
  return db
    .select()
    .from(inventoryMemos)
    .orderBy(desc(inventoryMemos.createdAt))
    .limit(limit);
}

// ============================================================
// ローカル在庫マスタ（local_inventories）
// ============================================================

import {
  localInventories,
  LocalInventory,
  InsertLocalInventory,
  localPurchases,
  LocalPurchase,
  InsertLocalPurchase,
  inventoryItemLabels,
  InventoryItemLabel,
  InsertInventoryItemLabel,
  systemSettings,
} from "../../drizzle/schema";
import { isNull, or, ne } from "drizzle-orm";

export type InventoryItemLabelStatus =
  | "ordered"
  | "received"
  | "stocked"
  | "shipped"
  | "returned"
  | "cancelled";

export type LocalInventoryWithLabels = LocalInventory & {
  itemLabels?: InventoryItemLabel[];
};

export type LocalPurchaseWithLabels = LocalPurchase & {
  itemLabels?: InventoryItemLabel[];
};

const LABEL_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LABEL_ID_LENGTH = 7;

function createLabelIdCandidate(): string {
  let id = "";
  for (let i = 0; i < LABEL_ID_LENGTH; i++) {
    id += LABEL_ID_ALPHABET[randomInt(0, LABEL_ID_ALPHABET.length)];
  }
  return id;
}

function normalizeLabelQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.max(0, Math.floor(quantity));
}

function labelTimestampMs(value: unknown): number {
  const ms = value ? new Date(value as string | number | Date).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function labelKeepPriority(label: InventoryItemLabel): number {
  const status = String(label.status ?? "").trim().toLowerCase();
  if (status === "shipped" || status === "returned") return 0;
  if (status === "received" || status === "stocked") return 1;
  if (status === "ordered" || !status) return 2;
  if (status === "cancelled") return 3;
  return 2;
}

function mustKeepPurchaseLabel(label: InventoryItemLabel): boolean {
  const status = String(label.status ?? "").trim().toLowerCase();
  return status === "shipped" || status === "returned";
}

async function trimPurchaseLabelsToQuantity(
  db: AppDatabase,
  labels: InventoryItemLabel[],
  desiredQuantity: number,
): Promise<InventoryItemLabel[]> {
  if (labels.length <= desiredQuantity) return labels;
  const protectedCount = labels.filter(mustKeepPurchaseLabel).length;
  const keepCount = Math.max(desiredQuantity, protectedCount);
  if (labels.length <= keepCount) return labels;

  const keepIds = new Set(
    [...labels]
      .sort((a, b) => (
        labelKeepPriority(a) - labelKeepPriority(b) ||
        labelTimestampMs(a.receivedAt ?? a.createdAt) - labelTimestampMs(b.receivedAt ?? b.createdAt) ||
        Number(a.id ?? 0) - Number(b.id ?? 0)
      ))
      .slice(0, keepCount)
      .map((label) => label.id),
  );
  const deleteIds = labels
    .filter((label) => !keepIds.has(label.id))
    .map((label) => Number(label.id))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (deleteIds.length > 0) {
    await db.delete(inventoryItemLabels).where(inArray(inventoryItemLabels.id, deleteIds));
  }

  return labels.filter((label) => keepIds.has(label.id));
}

function groupLabelsByNumber<T extends InventoryItemLabel>(
  labels: T[],
  key: "purchaseId" | "localInventoryId",
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const label of labels) {
    const rawId = label[key];
    if (rawId == null) continue;
    const id = Number(rawId);
    if (!Number.isFinite(id)) continue;
    const current = map.get(id) ?? [];
    current.push(label);
    map.set(id, current);
  }
  return map;
}

function isDuplicateLabelError(error: unknown): boolean {
  const message = errorText(error);
  return (
    message.includes("Duplicate entry") ||
    message.includes("ER_DUP_ENTRY") ||
    message.includes("1062") ||
    message.toLowerCase().includes("unique")
  );
}

async function insertInventoryLabelWithRetry(
  db: AppDatabase,
  values: Omit<InsertInventoryItemLabel, "id" | "labelId" | "createdAt" | "updatedAt">,
): Promise<InventoryItemLabel> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const labelId = createLabelIdCandidate();
    try {
      const [result] = await db.insert(inventoryItemLabels).values({ ...values, labelId });
      const insertedId = Number((result as { insertId?: number }).insertId ?? 0);
      const rows = insertedId
        ? await db.select().from(inventoryItemLabels).where(eq(inventoryItemLabels.id, insertedId)).limit(1)
        : await db.select().from(inventoryItemLabels).where(eq(inventoryItemLabels.labelId, labelId)).limit(1);
      const inserted = rows[0];
      if (inserted) return inserted;
    } catch (error) {
      if (isDuplicateLabelError(error)) continue;
      throw error;
    }
  }
  throw new Error("Failed to generate unique item label ID");
}

async function attachInventoryItemLabelsToPurchases(
  rows: LocalPurchase[],
  db: AppDatabase | null,
): Promise<LocalPurchaseWithLabels[]> {
  if (rows.length === 0) return [];
  if (!db) {
    const labels = await getDumpRows<InventoryItemLabel>("inventory_item_labels");
    const byPurchase = groupLabelsByNumber(labels, "purchaseId");
    return rows.map((row) => ({ ...row, itemLabels: byPurchase.get(row.id) ?? [] }));
  }
  const purchaseIds = rows.map((row) => row.id).filter((id) => Number.isFinite(id));
  if (purchaseIds.length === 0) return rows.map((row) => ({ ...row, itemLabels: [] }));
  const labels = await db
    .select()
    .from(inventoryItemLabels)
    .where(inArray(inventoryItemLabels.purchaseId, purchaseIds))
    .orderBy(desc(inventoryItemLabels.createdAt));
  const byPurchase = groupLabelsByNumber(labels, "purchaseId");
  return rows.map((row) => ({ ...row, itemLabels: byPurchase.get(row.id) ?? [] }));
}

async function attachInventoryItemLabelsToInventories(
  rows: LocalInventory[],
  db: AppDatabase | null,
): Promise<LocalInventoryWithLabels[]> {
  if (rows.length === 0) return [];
  if (!db) {
    const labels = await getDumpRows<InventoryItemLabel>("inventory_item_labels");
    const byInventory = groupLabelsByNumber(labels, "localInventoryId");
    return rows.map((row) => ({ ...row, itemLabels: byInventory.get(row.id) ?? [] }));
  }
  const inventoryIds = rows.map((row) => row.id).filter((id) => Number.isFinite(id));
  if (inventoryIds.length === 0) return rows.map((row) => ({ ...row, itemLabels: [] }));
  const labels = await db
    .select()
    .from(inventoryItemLabels)
    .where(inArray(inventoryItemLabels.localInventoryId, inventoryIds))
    .orderBy(desc(inventoryItemLabels.createdAt));
  const byInventory = groupLabelsByNumber(labels, "localInventoryId");
  return rows.map((row) => ({ ...row, itemLabels: byInventory.get(row.id) ?? [] }));
}

export async function getInventoryItemLabelsByInventoryIds(inventoryIds: number[]): Promise<Map<number, InventoryItemLabel[]>> {
  const ids = Array.from(new Set(inventoryIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (ids.length === 0) return new Map();
  const db = await getDb();
  if (!db) {
    const labels = await getDumpRows<InventoryItemLabel>("inventory_item_labels");
    return groupLabelsByNumber(labels.filter((label) => {
      const id = Number(label.localInventoryId);
      return Number.isFinite(id) && ids.includes(id);
    }), "localInventoryId");
  }
  const labels = await db
    .select()
    .from(inventoryItemLabels)
    .where(inArray(inventoryItemLabels.localInventoryId, ids))
    .orderBy(desc(inventoryItemLabels.createdAt));
  return groupLabelsByNumber(labels, "localInventoryId");
}

function isStockInventoryLabel(label: InventoryItemLabel): boolean {
  const status = String(label.status ?? "").trim().toLowerCase();
  return !status || status === "stocked" || status === "received";
}

export async function ensureInventoryItemLabelsForInventory(input: {
  localInventoryId: number;
  legacyManagementNo?: string | null;
  title: string;
  quantity: number;
  status?: InventoryItemLabelStatus;
  sourceKey?: string | null;
}): Promise<InventoryItemLabel[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const localInventoryId = Number(input.localInventoryId);
  if (!Number.isFinite(localInventoryId) || localInventoryId <= 0) return [];

  const desiredQuantity = normalizeLabelQuantity(input.quantity);
  const status = input.status ?? "stocked";
  const now = new Date();
  const sourceKey = input.sourceKey?.trim() || `inventory:${localInventoryId}`;
  const legacyManagementNo = input.legacyManagementNo?.trim() || null;

  const existing = await db
    .select()
    .from(inventoryItemLabels)
    .where(eq(inventoryItemLabels.localInventoryId, localInventoryId))
    .orderBy(desc(inventoryItemLabels.createdAt));

  for (const label of existing) {
    const stockLabel = isStockInventoryLabel(label);
    const currentStatus = String(label.status ?? "").trim().toLowerCase();
    const promotesToStock = (status === "stocked" || status === "received") && currentStatus === "ordered";
    const nextStatus = promotesToStock
      ? status
      : stockLabel
        ? (currentStatus ? label.status : status)
        : label.status;
    const nextStatusText = String(nextStatus ?? "").trim().toLowerCase();
    await db
      .update(inventoryItemLabels)
      .set({
        localInventoryId,
        legacyManagementNo,
        title: input.title,
        status: nextStatus,
        sourceKey: label.sourceKey ?? sourceKey,
        receivedAt: (nextStatusText === "stocked" || nextStatusText === "received") && !label.receivedAt ? now : label.receivedAt,
      })
      .where(eq(inventoryItemLabels.id, label.id));
  }

  const shouldCreateStockLabels = status === "stocked" || status === "received";
  const countableLabelCount = shouldCreateStockLabels
    ? existing.filter((label) => isStockInventoryLabel(label) || String(label.status ?? "").trim().toLowerCase() === "ordered").length
    : existing.length;
  const missingCount = Math.max(0, desiredQuantity - countableLabelCount);
  for (let i = 0; i < missingCount; i++) {
    await insertInventoryLabelWithRetry(db, {
      purchaseId: null,
      localInventoryId,
      legacyManagementNo,
      title: input.title,
      status,
      sourceKey,
      receivedAt: status === "received" || status === "stocked" ? now : null,
      shippedAt: null,
    });
  }

  return db
    .select()
    .from(inventoryItemLabels)
    .where(eq(inventoryItemLabels.localInventoryId, localInventoryId))
    .orderBy(desc(inventoryItemLabels.createdAt));
}

export async function ensureInventoryItemLabels(input: {
  purchaseId: number;
  localInventoryId?: number | null;
  legacyManagementNo?: string | null;
  title: string;
  quantity: number;
  status?: InventoryItemLabelStatus;
  sourceKey?: string | null;
}): Promise<InventoryItemLabel[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const desiredQuantity = normalizeLabelQuantity(input.quantity);
  const status = input.status ?? "ordered";
  const now = new Date();
  const sourceKey = input.sourceKey?.trim() || null;
  const legacyManagementNo = input.legacyManagementNo?.trim() || null;

  const existingByPurchase = await db
    .select()
    .from(inventoryItemLabels)
    .where(eq(inventoryItemLabels.purchaseId, input.purchaseId))
    .orderBy(desc(inventoryItemLabels.createdAt));
  let existing = existingByPurchase;

  if (existing.length === 0 && sourceKey) {
    existing = await db
      .select()
      .from(inventoryItemLabels)
      .where(eq(inventoryItemLabels.sourceKey, sourceKey))
      .orderBy(desc(inventoryItemLabels.createdAt));
  }

  if (existing.length === 0 && legacyManagementNo) {
    existing = await db
      .select()
      .from(inventoryItemLabels)
      .where(eq(inventoryItemLabels.legacyManagementNo, legacyManagementNo))
      .orderBy(desc(inventoryItemLabels.createdAt));
  }

  if (existingByPurchase.length > 0) {
    existing = await trimPurchaseLabelsToQuantity(db, existing, desiredQuantity);
  }

  for (const label of existing) {
    const nextStatus = status === "received" && label.status === "ordered" ? "received" : label.status;
    await db
      .update(inventoryItemLabels)
      .set({
        purchaseId: input.purchaseId,
        localInventoryId: input.localInventoryId ?? label.localInventoryId,
        legacyManagementNo,
        title: input.title,
        status: nextStatus,
        sourceKey,
        receivedAt: nextStatus === "received" && !label.receivedAt ? now : label.receivedAt,
      })
      .where(eq(inventoryItemLabels.id, label.id));
  }

  const missingCount = Math.max(0, desiredQuantity - existing.length);
  for (let i = 0; i < missingCount; i++) {
    await insertInventoryLabelWithRetry(db, {
      purchaseId: input.purchaseId,
      localInventoryId: input.localInventoryId ?? null,
      legacyManagementNo,
      title: input.title,
      status,
      sourceKey,
      receivedAt: status === "received" ? now : null,
      shippedAt: null,
    });
  }

  return db
    .select()
    .from(inventoryItemLabels)
    .where(eq(inventoryItemLabels.purchaseId, input.purchaseId))
    .orderBy(desc(inventoryItemLabels.createdAt));
}

export async function upsertLocalInventory(data: InsertLocalInventory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Partial<InsertLocalInventory> = {
    title: data.title,
    category: data.category,
    place: data.place,
    quantity: data.quantity,
    unit: data.unit,
    unitPrice: data.unitPrice,
    etc: data.etc,
    supplierUrl: data.supplierUrl,
    supplierName: data.supplierName,
    ebayListingUrl: data.ebayListingUrl,
    ebayOrderUrl: data.ebayOrderUrl,
    ebayOrderStatus: data.ebayOrderStatus,
    isDeleted: data.isDeleted,
  };
  const result = await db.insert(localInventories).values(data).onDuplicateKeyUpdate({ set: updateSet });
  // 変動履歴に残すため、採番されたIDを返す（既存行の更新時は0が返ることがある）
  return (result as unknown as { insertId?: number }).insertId ?? 0;
}

export async function getLocalInventories(includeDeleted = false): Promise<LocalInventoryWithLabels[]> {
  const db = await getDb();
  if (!db) {
    const rows = byUpdatedDesc(await getDumpRows<LocalInventory>("local_inventories"));
    const filtered = includeDeleted ? rows : rows.filter((row) => !row.isDeleted);
    return attachInventoryItemLabelsToInventories(filtered, null);
  }
  const rows = await db.select().from(localInventories).orderBy(desc(localInventories.updatedAt));
  const filtered = includeDeleted ? rows : rows.filter((r) => !r.isDeleted);
  return attachInventoryItemLabelsToInventories(filtered, db);
}

export async function getLocalInventoryById(id: number): Promise<LocalInventory | null> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<LocalInventory>("local_inventories");
    return rows.find((row) => row.id === id) ?? null;
  }
  const rows = await db.select().from(localInventories).where(eq(localInventories.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getLocalInventoryByZaicoId(zaicoId: number): Promise<LocalInventory | null> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<LocalInventory>("local_inventories");
    return rows.find((row) => row.zaicoId === zaicoId) ?? null;
  }
  const rows = await db.select().from(localInventories).where(eq(localInventories.zaicoId, zaicoId)).limit(1);
  return rows[0] ?? null;
}
/**
 * zaicoIdで検索し、見つからなければidでフォールバック検索する。
 * GAS登録などzaicoId=nullの商品に対応するために使用する。
 */
export async function getLocalInventoryByZaicoIdOrId(inventoryId: number): Promise<LocalInventory | null> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<LocalInventory>("local_inventories");
    return rows.find((row) => row.zaicoId === inventoryId) ?? rows.find((row) => row.id === inventoryId) ?? null;
  }
  // ませzaicoIdで検索
  const byZaico = await db.select().from(localInventories).where(eq(localInventories.zaicoId, inventoryId)).limit(1);
  if (byZaico[0]) return byZaico[0];
  // 見つからなければidで検索
  const byId = await db.select().from(localInventories).where(eq(localInventories.id, inventoryId)).limit(1);
  return byId[0] ?? null;
}

export async function updateLocalInventory(id: number, data: Partial<InsertLocalInventory>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(localInventories).set(data).where(eq(localInventories.id, id));
}

export async function deleteLocalInventory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(localInventories).set({ isDeleted: 1 }).where(eq(localInventories.id, id));
}

export async function countLocalInventories() {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<LocalInventory>("local_inventories");
    return rows.filter((row) => !row.isDeleted).length;
  }
  const rows = await db.select().from(localInventories).where(eq(localInventories.isDeleted, 0));
  return rows.length;
}

export async function getShaftSales(): Promise<ShaftSale[]> {
  const db = await getDb();
  if (!db) return byUpdatedDesc(await getDumpRows<ShaftSale>("shaft_sales"));
  return db.select().from(shaftSales).orderBy(desc(shaftSales.soldAt), desc(shaftSales.updatedAt));
}

export async function upsertShaftSale(data: InsertShaftSale): Promise<ShaftSale | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existingByInventory = data.inventoryId
    ? await db.select().from(shaftSales).where(eq(shaftSales.inventoryId, data.inventoryId)).limit(1)
    : [];
  const existingByManagement = existingByInventory.length === 0
    ? await db.select().from(shaftSales).where(eq(shaftSales.managementNo, data.managementNo)).orderBy(desc(shaftSales.updatedAt)).limit(1)
    : [];
  const existing = existingByInventory[0] ?? existingByManagement[0] ?? null;

  if (existing) {
    await db.update(shaftSales).set({
      inventoryId: data.inventoryId ?? existing.inventoryId,
      managementNo: data.managementNo,
      title: data.title,
      category: data.category,
      quantity: data.quantity,
      unitPrice: data.unitPrice,
      saleAmount: data.saleAmount,
      saleUrl: data.saleUrl !== undefined ? data.saleUrl : existing.saleUrl,
      profitAmount: data.profitAmount,
      soldAt: data.soldAt,
      supplierName: data.supplierName,
      supplierUrl: data.supplierUrl,
      snapshotJson: data.snapshotJson,
    }).where(eq(shaftSales.id, existing.id));
    const rows = await db.select().from(shaftSales).where(eq(shaftSales.id, existing.id)).limit(1);
    return rows[0] ?? null;
  }

  const [result] = await db.insert(shaftSales).values(data);
  const insertedId = Number((result as { insertId?: number }).insertId ?? 0);
  if (!insertedId) return null;
  const rows = await db.select().from(shaftSales).where(eq(shaftSales.id, insertedId)).limit(1);
  return rows[0] ?? null;
}

export async function updateShaftSaleDate(id: number, soldAt: string): Promise<ShaftSale | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(shaftSales).set({ soldAt }).where(eq(shaftSales.id, id));
  const rows = await db.select().from(shaftSales).where(eq(shaftSales.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateShaftSaleProfit(id: number, profitAmount: string | null): Promise<ShaftSale | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(shaftSales).set({ profitAmount }).where(eq(shaftSales.id, id));
  const rows = await db.select().from(shaftSales).where(eq(shaftSales.id, id)).limit(1);
  return rows[0] ?? null;
}

// ============================================================
// CSVインポート（Zaico CSV一括取り込み）
// ============================================================

/**
 * ZaicoのCSVエクスポートデータをlocal_inventoriesテーブルに一括upsertする
 * zaicoIdが一致する既存レコードは上書き更新、なければ新規挿入
 */
export async function bulkUpsertLocalInventoriesFromCsv(
  items: InsertLocalInventory[]
): Promise<{ inserted: number; updated: number; errors: string[] }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  let inserted = 0;
  let updated = 0;
  const errors: string[] = [];
  for (const item of items) {
    try {
      if (item.zaicoId != null) {
        const existing = await db
          .select({ id: localInventories.id })
          .from(localInventories)
          .where(eq(localInventories.zaicoId, item.zaicoId))
          .limit(1);
        if (existing.length > 0) {
          await db
            .update(localInventories)
            .set({
              title: item.title,
              category: item.category,
              place: item.place,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              etc: item.etc,
              supplierName: item.supplierName,
              supplierUrl: item.supplierUrl,
              ebayListingUrl: item.ebayListingUrl,
              ebayOrderUrl: item.ebayOrderUrl,
              ebayOrderStatus: item.ebayOrderStatus,
              isDeleted: item.isDeleted ?? 0,
            })
            .where(eq(localInventories.zaicoId, item.zaicoId));
          updated++;
        } else {
          await db.insert(localInventories).values(item);
          inserted++;
        }
      } else {
        await db.insert(localInventories).values(item);
        inserted++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${item.title}: ${msg}`);
    }
  }
  return { inserted, updated, errors };
}

// ============================================================
// ローカル発注（local_purchases）
// ============================================================

export async function upsertLocalPurchase(data: InsertLocalPurchase) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Partial<InsertLocalPurchase> = {
    purchaseNum: data.purchaseNum,
    status: data.status,
    itemsJson: data.itemsJson,
    localInventoryId: data.localInventoryId,
    title: data.title,
    category: data.category,
    quantity: data.quantity,
    unitPrice: data.unitPrice,
    managementNo: data.managementNo,
    purchaseDate: data.purchaseDate,
    receivedDate: data.receivedDate,
    supplierUrl: data.supplierUrl,
    supplierName: data.supplierName,
  };
  // T22: 明示的に渡された仕訳/工程フィールドのみ上書き対象に含める（既存の分類を意図せず消さない）
  if (data.inboundClass !== undefined) updateSet.inboundClass = data.inboundClass;
  if (data.classSource !== undefined) updateSet.classSource = data.classSource;
  if (data.stage !== undefined) updateSet.stage = data.stage;
  if (data.stageUpdatedBy !== undefined) updateSet.stageUpdatedBy = data.stageUpdatedBy;
  if (data.stageUpdatedAt !== undefined) updateSet.stageUpdatedAt = data.stageUpdatedAt;
  if (data.shaftParentPurchaseId !== undefined) updateSet.shaftParentPurchaseId = data.shaftParentPurchaseId;
  await db.insert(localPurchases).values(data).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getLocalPurchases(status?: string): Promise<LocalPurchaseWithLabels[]> {
  const db = await getDb();
  if (!db) {
    const rows = byCreatedDesc(await getDumpRows<LocalPurchase>("local_purchases"));
    const filtered = status ? rows.filter((row) => row.status === status) : rows;
    return attachInventoryItemLabelsToPurchases(filtered, null);
  }
  const rows = status
    ? await db.select().from(localPurchases).where(eq(localPurchases.status, status)).orderBy(desc(localPurchases.createdAt))
    : await db.select().from(localPurchases).orderBy(desc(localPurchases.createdAt));
  return attachInventoryItemLabelsToPurchases(rows, db);
}

export async function getLocalPurchaseByIdWithLabels(id: number): Promise<LocalPurchaseWithLabels | null> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<LocalPurchase>("local_purchases");
    const row = rows.find((purchase) => purchase.id === id || purchase.zaicoId === id);
    if (!row) return null;
    const withLabels = await attachInventoryItemLabelsToPurchases([row], null);
    return withLabels[0] ?? null;
  }
  const rows = await db
    .select()
    .from(localPurchases)
    .where(or(eq(localPurchases.id, id), eq(localPurchases.zaicoId, id)))
    .limit(1);
  if (!rows[0]) return null;
  const withLabels = await attachInventoryItemLabelsToPurchases(rows, db);
  return withLabels[0] ?? null;
}

export async function updateLocalPurchaseStatus(id: number, status: string, receivedDate?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData: Partial<InsertLocalPurchase> = { status };
  if (receivedDate) updateData.receivedDate = receivedDate;
  await db.update(localPurchases).set(updateData).where(eq(localPurchases.id, id));
}

// ============================================================
// T22: 入庫仕訳・工程（local_purchases の inboundClass / stage 系）
// ============================================================

/** 単一発注の分類を更新する。classSource も併せて記録する（manual=人間上書き） */
export async function setLocalPurchaseInboundClass(
  id: number,
  inboundClass: string | null,
  classSource: "auto" | "manual",
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(localPurchases)
    .set({ inboundClass, classSource })
    .where(eq(localPurchases.id, id));
}

/** 単一発注の工程を更新する。更新者・時刻・必要ならstatus連動も反映する */
export async function updateLocalPurchaseStage(
  id: number,
  stage: string,
  options?: { updatedBy?: string | null; status?: string; receivedDate?: string | null },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData: Partial<InsertLocalPurchase> = {
    stage,
    stageUpdatedAt: new Date(),
  };
  if (options?.updatedBy !== undefined) updateData.stageUpdatedBy = options.updatedBy;
  if (options?.status !== undefined) updateData.status = options.status;
  if (options?.receivedDate !== undefined && options.receivedDate !== null) {
    updateData.receivedDate = options.receivedDate;
  }
  await db.update(localPurchases).set(updateData).where(eq(localPurchases.id, id));
}

/** 発注1件をIDで取得（分類/工程操作の前提確認用） */
export async function getLocalPurchaseById(id: number): Promise<LocalPurchase | null> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<LocalPurchase>("local_purchases");
    return rows.find((row) => row.id === id) ?? null;
  }
  const rows = await db.select().from(localPurchases).where(eq(localPurchases.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 新規発注行を1件作成してその id を返す（シャフト分離で国内在庫行を生む用） */
export async function insertLocalPurchase(data: InsertLocalPurchase): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(localPurchases).values(data).$returningId();
  const first = Array.isArray(result) ? result[0] : undefined;
  return Number((first as { id?: number } | undefined)?.id ?? 0);
}

/**
 * 発行済みインボイスの「番号（末尾の数値）」集合を返す。
 * invoiceNumber は "INV-YYYYMMDD-NNN" 形式のため、末尾の連続数字を取り出して整数化する。
 * 直取判定 (b) の「発行済みインボイスに紐づく」を、管理番号の数値プレフィックスと突き合わせるために使う。
 */
export async function getPublishedInvoiceNumberSet(): Promise<Set<number>> {
  const db = await getDb();
  const numbers = new Set<number>();
  const addFrom = (raw: unknown) => {
    const match = String(raw ?? "").match(/(\d+)\s*$/);
    if (!match) return;
    const n = Number(match[1]);
    if (Number.isFinite(n)) numbers.add(n);
  };
  if (!db) {
    for (const row of await getDumpRows<{ invoiceNumber?: string; deletedAt?: unknown }>("invoices")) {
      if (row.deletedAt) continue;
      addFrom(row.invoiceNumber);
    }
    return numbers;
  }
  const rows = await db
    .select({ invoiceNumber: invoices.invoiceNumber, deletedAt: invoices.deletedAt })
    .from(invoices);
  for (const row of rows) {
    if (row.deletedAt) continue;
    addFrom(row.invoiceNumber);
  }
  return numbers;
}

export async function countLocalPurchases() {
  const db = await getDb();
  if (!db) return (await getDumpRows<LocalPurchase>("local_purchases")).length;
  const rows = await db.select().from(localPurchases);
  return rows.length;
}

// ============================================================
// システム設定（system_settings）
// ============================================================

export async function getSystemSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows("system_settings");
    return String(rows.find((row) => row.key === key)?.value ?? "") || null;
  }
  const rows = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setSystemSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn(`[Database] Cannot persist system setting "${key}": database not available`);
    return;
  }
  await db
    .insert(systemSettings)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value } });
}

/** Zaico連携が有効かどうかを返す（デフォルトはfalse、トークン未設定時もfalse） */
export async function isZaicoEnabled(): Promise<boolean> {
  const val = await getSystemSetting("zaico_enabled");
  if (val === null) return false; // デフォルトはOFF
  return false;
}

// ============================================================
// インボイスメモ（invoice_memos）
// ============================================================
export async function upsertInvoiceMemo(invoiceKey: string, colorKey: string, memo: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // 既存レコードを確認
  const existing = await db
    .select()
    .from(invoiceMemos)
    .where(and(eq(invoiceMemos.invoiceKey, invoiceKey), eq(invoiceMemos.colorKey, colorKey)))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(invoiceMemos)
      .set({ memo })
      .where(and(eq(invoiceMemos.invoiceKey, invoiceKey), eq(invoiceMemos.colorKey, colorKey)));
  } else {
    await db.insert(invoiceMemos).values({ invoiceKey, colorKey, memo });
  }
}

export async function getInvoiceMemos(invoiceKey: string): Promise<Array<{ colorKey: string; memo: string }>> {
  const db = await getDb();
  if (!db) {
    return (await getDumpRows("invoice_memos"))
      .filter((row) => row.invoiceKey === invoiceKey)
      .map((row) => ({ colorKey: String(row.colorKey ?? ""), memo: String(row.memo ?? "") }));
  }
  const rows = await db
    .select({ colorKey: invoiceMemos.colorKey, memo: invoiceMemos.memo })
    .from(invoiceMemos)
    .where(eq(invoiceMemos.invoiceKey, invoiceKey));
  return rows;
}

export async function getAllInvoiceMemos(): Promise<Array<{ invoiceKey: string; colorKey: string; memo: string }>> {
  const db = await getDb();
  if (!db) {
    return (await getDumpRows("invoice_memos")).map((row) => ({
      invoiceKey: String(row.invoiceKey ?? ""),
      colorKey: String(row.colorKey ?? ""),
      memo: String(row.memo ?? ""),
    }));
  }
  return db.select({ invoiceKey: invoiceMemos.invoiceKey, colorKey: invoiceMemos.colorKey, memo: invoiceMemos.memo }).from(invoiceMemos);
}

// ============================================================
// 月次棚卸しレポート（monthly_reports / monthly_report_costs）
// ============================================================

export async function createMonthlyReport(data: InsertMonthlyReport): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(monthlyReports).values(data);
  return (result as unknown as { insertId: number }).insertId;
}

export async function getMonthlyReports(limit = 50): Promise<MonthlyReport[]> {
  const db = await getDb();
  if (!db) return byCreatedDesc(await getDumpRows<MonthlyReport>("monthly_reports")).slice(0, limit);
  return db
    .select()
    .from(monthlyReports)
    .orderBy(desc(monthlyReports.createdAt))
    .limit(limit);
}

export async function getMonthlyReportById(id: number): Promise<MonthlyReport | null> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<MonthlyReport>("monthly_reports");
    return rows.find((row) => row.id === id) ?? null;
  }
  const rows = await db
    .select()
    .from(monthlyReports)
    .where(eq(monthlyReports.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteMonthlyReport(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // コスト明細も一緒に削除
  await db.delete(monthlyReportCosts).where(eq(monthlyReportCosts.reportId, id));
  await db.delete(monthlyReports).where(eq(monthlyReports.id, id));
}

export async function upsertMonthlyReportCost(data: InsertMonthlyReportCost) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db
    .select()
    .from(monthlyReportCosts)
    .where(
      and(
        eq(monthlyReportCosts.reportId, data.reportId),
        eq(monthlyReportCosts.invoiceKey, data.invoiceKey),
        eq(monthlyReportCosts.itemKey, data.itemKey)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(monthlyReportCosts)
      .set({ unitPrice: data.unitPrice, subtotal: data.subtotal, isManual: data.isManual })
      .where(
        and(
          eq(monthlyReportCosts.reportId, data.reportId),
          eq(monthlyReportCosts.invoiceKey, data.invoiceKey),
          eq(monthlyReportCosts.itemKey, data.itemKey)
        )
      );
  } else {
    await db.insert(monthlyReportCosts).values(data);
  }
}

export async function getMonthlyReportCosts(reportId: number): Promise<MonthlyReportCost[]> {
  const db = await getDb();
  if (!db) return (await getDumpRows<MonthlyReportCost>("monthly_report_costs")).filter((row) => row.reportId === reportId);
  return db
    .select()
    .from(monthlyReportCosts)
    .where(eq(monthlyReportCosts.reportId, reportId));
}

/**
 * inventoryIdのリストからpurchase_historiesの仕入単価マップを返す
 * キー: inventoryId, 値: unitPrice (数値)
 */
export async function getUnitPricesByInventoryIds(inventoryIds: number[]): Promise<Map<number, number>> {
  const db = await getDb();
  const map = new Map<number, number>();
  if (inventoryIds.length === 0) return map;
  if (!db) {
    const idSet = new Set(inventoryIds);
    const rows = await getDumpRows<PurchaseHistory>("purchase_histories");
    for (const row of rows) {
      const inventoryId = row.inventoryId;
      if (inventoryId == null || !idSet.has(inventoryId) || row.unitPrice == null) continue;
      const price = parseFloat(String(row.unitPrice));
      if (!isNaN(price)) map.set(inventoryId, price);
    }
    return map;
  }
  const rows = await db
    .select({
      inventoryId: purchaseHistories.inventoryId,
      unitPrice: purchaseHistories.unitPrice,
    })
    .from(purchaseHistories)
    .where(inArray(purchaseHistories.inventoryId, inventoryIds));
  for (const row of rows) {
    if (row.inventoryId == null || row.unitPrice == null) continue;
    const price = parseFloat(row.unitPrice);
    if (!isNaN(price)) map.set(row.inventoryId, price);
  }
  return map;
}

/**
 * local_purchasesの管理番号→仕入単価マップを返す
 * キー: managementNoの先頭部分（最初のカンマ前）, 値: unitPrice (数値)
 * 同じ管理番号が複数ある場合は最新のものを使用
 */
export async function getLocalPurchaseUnitPriceMap(): Promise<Map<string, number>> {
  const db = await getDb();
  const map = new Map<string, number>();
  if (!db) {
    const rows = byCreatedDesc(await getDumpRows<LocalPurchase>("local_purchases"));
    for (const row of rows) {
      if (!row.managementNo || row.unitPrice == null) continue;
      const key = String(row.managementNo).split(",")[0]?.trim() ?? "";
      const price = parseFloat(String(row.unitPrice));
      if (key && !isNaN(price) && !map.has(key)) map.set(key, price);
    }
    return map;
  }
  const rows = await db
    .select({
      managementNo: localPurchases.managementNo,
      unitPrice: localPurchases.unitPrice,
    })
    .from(localPurchases)
    .orderBy(desc(localPurchases.createdAt));
  for (const row of rows) {
    if (!row.managementNo || row.unitPrice == null) continue;
    const key = row.managementNo.split(",")[0]?.trim() ?? "";
    if (!key) continue;
    const price = parseFloat(String(row.unitPrice));
    if (!isNaN(price) && !map.has(key)) {
      map.set(key, price);
    }
  }
  return map;
}

/**
 * zaicoIdのリストからlocal_inventoriesの仕入単価マップを返す
 * キー: zaicoId (number), 値: unitPrice (number)
 * purchase_historiesに仕入単価がない場合のフォールバックとして使用
 */
export async function getLocalInventoryUnitPriceByZaicoIds(zaicoIds: number[]): Promise<Map<number, number>> {
  const db = await getDb();
  const map = new Map<number, number>();
  if (zaicoIds.length === 0) return map;
  if (!db) {
    const idSet = new Set(zaicoIds);
    const rows = await getDumpRows<LocalInventory>("local_inventories");
    for (const row of rows) {
      const zaicoId = row.zaicoId;
      if (zaicoId == null || !idSet.has(zaicoId) || row.unitPrice == null) continue;
      const price = parseFloat(String(row.unitPrice));
      if (!isNaN(price)) map.set(zaicoId, price);
    }
    return map;
  }
  const rows = await db
    .select({
      zaicoId: localInventories.zaicoId,
      unitPrice: localInventories.unitPrice,
    })
    .from(localInventories)
    .where(inArray(localInventories.zaicoId, zaicoIds));
  for (const row of rows) {
    const zaicoId = row.zaicoId;
    if (zaicoId == null || row.unitPrice == null) continue;
    const price = parseFloat(String(row.unitPrice));
    if (!isNaN(price)) map.set(zaicoId, price);
  }
  return map;
}

/**
 * local_inventoriesからzaicoIdベースの仕入先・仕入単価マップを返す
 * キー: zaicoId (number), 値: { unitPrice, supplierName, supplierUrl }
 */
export async function getLocalInventoryInfoByZaicoIds(
  zaicoIds: number[]
): Promise<Map<number, { unitPrice: string; supplierName: string; supplierUrl: string }>> {
  const db = await getDb();
  const map = new Map<number, { unitPrice: string; supplierName: string; supplierUrl: string }>();
  if (zaicoIds.length === 0) return map;
  if (!db) {
    const idSet = new Set(zaicoIds);
    const rows = await getDumpRows<LocalInventory>("local_inventories");
    for (const row of rows) {
      const zaicoId = row.zaicoId;
      if (zaicoId == null || !idSet.has(zaicoId)) continue;
      map.set(zaicoId, {
        unitPrice: row.unitPrice != null ? String(row.unitPrice) : "",
        supplierName: row.supplierName ?? "",
        supplierUrl: row.supplierUrl ?? "",
      });
    }
    return map;
  }
  const rows = await db
    .select({
      zaicoId: localInventories.zaicoId,
      unitPrice: localInventories.unitPrice,
      supplierName: localInventories.supplierName,
      supplierUrl: localInventories.supplierUrl,
    })
    .from(localInventories)
    .where(inArray(localInventories.zaicoId, zaicoIds));
  for (const row of rows) {
    const zaicoId = row.zaicoId;
    if (zaicoId == null) continue;
    map.set(zaicoId, {
      unitPrice: row.unitPrice != null ? String(row.unitPrice) : "",
      supplierName: row.supplierName ?? "",
      supplierUrl: row.supplierUrl ?? "",
    });
  }
  return map;
}
/**
 * deleted_inventoriesからzaicoIdベースの仕入単価マップを返す
 * 在庫削除後も月次棚卸しの仕入単価を保持するためのフォールバック
 * キー: zaicoId (number), 値: unitPrice (number)
 */
export async function getDeletedInventoryUnitPriceByZaicoIds(zaicoIds: number[]): Promise<Map<number, number>> {
  const db = await getDb();
  const map = new Map<number, number>();
  if (zaicoIds.length === 0) return map;
  if (!db) {
    const idSet = new Set(zaicoIds);
    const rows = byCreatedDesc(await getDumpRows<DeletedInventory>("deleted_inventories"));
    for (const row of rows) {
      if (!idSet.has(row.zaicoId) || row.unitPrice == null || map.has(row.zaicoId)) continue;
      const price = parseFloat(String(row.unitPrice));
      if (!isNaN(price)) map.set(row.zaicoId, price);
    }
    return map;
  }
  const rows = await db
    .select({
      zaicoId: deletedInventories.zaicoId,
      unitPrice: deletedInventories.unitPrice,
    })
    .from(deletedInventories)
    .where(inArray(deletedInventories.zaicoId, zaicoIds))
    .orderBy(desc(deletedInventories.createdAt));
  for (const row of rows) {
    if (row.zaicoId == null || row.unitPrice == null) continue;
    const price = parseFloat(String(row.unitPrice));
    if (!isNaN(price) && !map.has(row.zaicoId)) map.set(row.zaicoId, price);
  }
  return map;
}

// ============================================================
// invoice_manual_items CRUD
// ============================================================

/**
 * 指定インボイスNoの手動入力行を全件取得
 */
export async function getInvoiceManualItems(invoiceNo: string): Promise<InvoiceManualItem[]> {
  const db = await getDb();
  if (!db) {
    return byFieldsAsc((await getDumpRows<InvoiceManualItem>("invoice_manual_items")).filter((row) => row.invoiceNo === invoiceNo), ["sortOrder", "createdAt"]);
  }
  return db
    .select()
    .from(invoiceManualItems)
    .where(eq(invoiceManualItems.invoiceNo, invoiceNo))
    .orderBy(invoiceManualItems.sortOrder, invoiceManualItems.createdAt);
}

/**
 * 複数インボイスNoの手動入力行を一括取得
 */
export async function getInvoiceManualItemsByInvoiceNos(invoiceNos: string[]): Promise<InvoiceManualItem[]> {
  const db = await getDb();
  if (invoiceNos.length === 0) return [];
  if (!db) {
    const invoiceSet = new Set(invoiceNos);
    return byFieldsAsc((await getDumpRows<InvoiceManualItem>("invoice_manual_items")).filter((row) => invoiceSet.has(row.invoiceNo)), ["sortOrder", "createdAt"]);
  }
  return db
    .select()
    .from(invoiceManualItems)
    .where(inArray(invoiceManualItems.invoiceNo, invoiceNos))
    .orderBy(invoiceManualItems.sortOrder, invoiceManualItems.createdAt);
}

/**
 * 手動入力行を作成
 */
export async function createInvoiceManualItem(data: {
  invoiceNo: string;
  title: string;
  quantity: number;
  unitPrice: number | null;
  sortOrder?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(invoiceManualItems).values({
    invoiceNo: data.invoiceNo,
    title: data.title,
    quantity: data.quantity,
    unitPrice: data.unitPrice != null ? String(data.unitPrice) : null,
    sortOrder: data.sortOrder ?? 0,
  });
  return result;
}

/**
 * 手動入力行を更新
 */
export async function updateInvoiceManualItem(id: number, data: {
  title?: string;
  quantity?: number;
  unitPrice?: number | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(invoiceManualItems).set({
    title: data.title,
    quantity: data.quantity,
    unitPrice: data.unitPrice != null ? String(data.unitPrice) : null,
  }).where(eq(invoiceManualItems.id, id));
}

/**
 * 手動入力行を削除
 */
export async function deleteInvoiceManualItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(invoiceManualItems).where(eq(invoiceManualItems.id, id));
}

// ============================================================
// 国内卸商品マスタ (domestic_products)
// ============================================================
/** 国内卸商品マスタ一覧を取得 */
export async function getDomesticProducts(): Promise<DomesticProduct[]> {
  const db = await getDb();
  if (!db) return byFieldsAsc(await getDumpRows<DomesticProduct>("domestic_products"), ["sortOrder", "createdAt"]);
  return db.select().from(domesticProducts).orderBy(domesticProducts.sortOrder, domesticProducts.createdAt);
}
/** 国内卸商品マスタを作成 */
export async function createDomesticProduct(data: { title: string; unitPrice?: number | null; supplierName?: string | null; note?: string | null; sortOrder?: number }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(domesticProducts).values({
    title: data.title,
    unitPrice: data.unitPrice != null ? String(data.unitPrice) : null,
    supplierName: data.supplierName ?? null,
    note: data.note ?? null,
    sortOrder: data.sortOrder ?? 0,
  });
  return result;
}
/** 国内卸商品マスタを更新 */
export async function updateDomesticProduct(id: number, data: { title?: string; unitPrice?: number | null; supplierName?: string | null; note?: string | null; sortOrder?: number }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(domesticProducts).set({
    title: data.title,
    unitPrice: data.unitPrice != null ? String(data.unitPrice) : null,
    supplierName: data.supplierName,
    note: data.note,
    sortOrder: data.sortOrder,
  }).where(eq(domesticProducts.id, id));
}
/** 国内卸商品マスタを削除 */
export async function deleteDomesticProduct(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(domesticProducts).where(eq(domesticProducts.id, id));
}

// ============================================================
// 月次棚卸し 国内卸発注行 (monthly_domestic_items)
// ============================================================
/** 指定年月の国内卸発注行を取得 */
export async function getMonthlyDomesticItems(yearMonth: string): Promise<MonthlyDomesticItem[]> {
  const db = await getDb();
  if (!db) {
    return byFieldsAsc((await getDumpRows<MonthlyDomesticItem>("monthly_domestic_items")).filter((row) => row.yearMonth === yearMonth), ["sortOrder", "createdAt"]);
  }
  return db.select().from(monthlyDomesticItems)
    .where(eq(monthlyDomesticItems.yearMonth, yearMonth))
    .orderBy(monthlyDomesticItems.sortOrder, monthlyDomesticItems.createdAt);
}
/** 国内卸発注行を作成 */
export async function createMonthlyDomesticItem(data: { yearMonth: string; domesticProductId?: number | null; title: string; quantity?: number; unitPrice?: number | null; supplierName?: string | null; note?: string | null; sortOrder?: number }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(monthlyDomesticItems).values({
    yearMonth: data.yearMonth,
    domesticProductId: data.domesticProductId ?? null,
    title: data.title ?? "",
    quantity: data.quantity ?? 1,
    unitPrice: data.unitPrice != null ? String(data.unitPrice) : null,
    supplierName: data.supplierName ?? null,
    note: data.note ?? null,
    sortOrder: data.sortOrder ?? 0,
  });
  return result;
}
/** 国内卸発注行を更新 */
export async function updateMonthlyDomesticItem(id: number, data: { title?: string; quantity?: number; unitPrice?: number | null; supplierName?: string | null; note?: string | null; isPaid?: number }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // undefinedのフィールドはset()に含めない（NULLで上書きされるのを防ぐ）
  const patch: Record<string, unknown> = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.quantity !== undefined) patch.quantity = data.quantity;
  if (data.unitPrice !== undefined) patch.unitPrice = data.unitPrice != null ? String(data.unitPrice) : null;
  if (data.supplierName !== undefined) patch.supplierName = data.supplierName;
  if (data.note !== undefined) patch.note = data.note;
  if (data.isPaid !== undefined) patch.isPaid = data.isPaid;
  if (Object.keys(patch).length === 0) return;
  await db.update(monthlyDomesticItems).set(patch).where(eq(monthlyDomesticItems.id, id));
}
/** 国内卸発注行を削除 */
export async function deleteMonthlyDomesticItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(monthlyDomesticItems).where(eq(monthlyDomesticItems.id, id));
}

// ============================================================
// 取引先マスタ（customers）
// ============================================================

export async function getCustomers(): Promise<Customer[]> {
  const db = await getDb();
  if (!db) return byFieldsAsc(await getDumpRows<Customer>("customers"), ["sortOrder", "displayName"]);
  return db.select().from(customers).orderBy(customers.sortOrder, customers.displayName);
}

export async function createCustomer(data: InsertCustomer) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(customers).values(data);
}

export async function updateCustomer(id: number, data: Partial<InsertCustomer>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(customers).set({ ...data, updatedAt: new Date() }).where(eq(customers.id, id));
}

export async function deleteCustomer(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(customers).where(eq(customers.id, id));
}

// ─── AuthorizedUsers ────────────────────────────────────────────────────────

/** openIdまたは同じメールアドレスが認証済みユーザーテーブルに存在するか確認する */
export async function isAuthorizedUser(openId: string, email?: string | null): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail && ADMIN_EMAILS.some((adminEmail) => adminEmail.toLowerCase() === normalizedEmail)) return true;
    const rows = await getDumpRows("authorized_users");
    return rows.some((row) =>
      row.openId === openId ||
      (normalizedEmail && normalizeEmail(row.email) === normalizedEmail)
    );
  }
  const condition = email
    ? or(eq(authorizedUsers.openId, openId), eq(authorizedUsers.email, email))
    : eq(authorizedUsers.openId, openId);
  const rows = await db.select().from(authorizedUsers).where(condition);
  return rows.length > 0;
}

/** 認証済みユーザーとして登録する（既に存在する場合は何もしない） */
export async function authorizeUser(data: InsertAuthorizedUser): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot persist authorized user: database not available");
    return;
  }
  await db.insert(authorizedUsers).ignore().values(data);
}

// ─── FedexShipments ──────────────────────────────────────────────────────────

/** FedEx発送記録を作成する */
export async function createFedexShipment(data: InsertFedexShipment): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(fedexShipments).values(data);
  return (result[0] as { insertId: number }).insertId;
}

/** 出庫Noに紐づくFedEx発送記録を取得する */
export async function getFedexShipmentsByDeliveryNo(deliveryNo: string): Promise<FedexShipment[]> {
  const db = await getDb();
  if (!db) return byCreatedDesc((await getDumpRows<FedexShipment>("fedex_shipments")).filter((row) => row.deliveryNo === deliveryNo)) as FedexShipment[];
  return db
    .select()
    .from(fedexShipments)
    .where(eq(fedexShipments.deliveryNo, deliveryNo))
    .orderBy(desc(fedexShipments.createdAt));
}

/** 全FedEx発送記録を取得する */
export async function getAllFedexShipments(): Promise<FedexShipment[]> {
  const db = await getDb();
  if (!db) return byCreatedDesc(await getDumpRows<FedexShipment>("fedex_shipments")) as FedexShipment[];
  return db.select().from(fedexShipments).orderBy(desc(fedexShipments.createdAt));
}

/** FedEx発送記録のスプシ書き込みステータスを更新する */
export async function updateFedexShipmentStatus(
  id: number,
  status: "pending" | "success" | "error",
  errorMsg?: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(fedexShipments)
    .set({ spreadsheetStatus: status, spreadsheetError: errorMsg ?? null, updatedAt: new Date() })
    .where(eq(fedexShipments.id, id));
}

/** FedEx発送記録の内容を更新する */
export async function updateFedexShipment(
  id: number,
  data: {
    trackingNumber?: string;
    shippingDate?: string;
    sheetName?: string;
    itemsJson?: string;
    spreadsheetStatus?: "pending" | "success" | "error";
    spreadsheetError?: string | null;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(fedexShipments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(fedexShipments.id, id));
}

/** historyIdに紐づくFedEx発送記録を取得する */
export async function getFedexShipmentsByHistoryId(historyId: number): Promise<FedexShipment[]> {
  const db = await getDb();
  if (!db) return byCreatedDesc((await getDumpRows<FedexShipment>("fedex_shipments")).filter((row) => row.historyId === historyId)) as FedexShipment[];
  return db
    .select()
    .from(fedexShipments)
    .where(eq(fedexShipments.historyId, historyId))
    .orderBy(desc(fedexShipments.createdAt));
}
/** FedEx発送記録のhistoryIdとdeliveryNoを更新する（商品単位移動時の追跡番号引き継ぎ） */
export async function updateFedexShipmentHistoryAndDeliveryNo(
  id: number,
  historyId: number | null,
  deliveryNo: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(fedexShipments)
    .set({ historyId, deliveryNo, updatedAt: new Date() })
    .where(eq(fedexShipments.id, id));
}

/** FedEx発送記録を削除する */
export async function deleteFedexShipment(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(fedexShipments).where(eq(fedexShipments.id, id));
}

// ===== Partner Portal =====

/** 全取引先ポータル一覧を取得 */
export async function getAllPartnerPortals(): Promise<PartnerPortal[]> {
  const db = await getDb();
  if (!db) return byFieldsAsc(await getDumpRows<PartnerPortal>("partner_portals"), ["id"]) as PartnerPortal[];
  return db.select().from(partnerPortals).orderBy(partnerPortals.id);
}

/** 取引先コードでポータルを取得 */
export async function getPartnerPortalByCode(partnerCode: string): Promise<PartnerPortal | null> {
  const db = await getDb();
  if (!db) {
    const rows = await getDumpRows<PartnerPortal>("partner_portals");
    return (rows.find((row) => row.partnerCode === partnerCode) as PartnerPortal | undefined) ?? null;
  }
  const rows = await db.select().from(partnerPortals).where(eq(partnerPortals.partnerCode, partnerCode)).limit(1);
  return rows[0] ?? null;
}

/** 取引先ポータルを作成 */
export async function createPartnerPortal(data: InsertPartnerPortal): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(partnerPortals).values(data);
  return (result[0] as { insertId: number }).insertId;
}

/** 取引先ポータルを更新 */
export async function updatePartnerPortal(id: number, data: Partial<InsertPartnerPortal>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(partnerPortals).set({ ...data, updatedAt: new Date() }).where(eq(partnerPortals.id, id));
}

/** 取引先ポータルのセッショントークンを更新 */
export async function setPartnerSessionToken(partnerCode: string, token: string | null, expiresAt: Date | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(partnerPortals).set({ sessionToken: token, sessionExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(partnerPortals.partnerCode, partnerCode));
}

/** 取引先ポータルを削除 */
export async function deletePartnerPortal(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(partnerPortals).where(eq(partnerPortals.id, id));
}

// ===== Shipment Checks =====

/** 取引先の受取確認チェック一覧を取得 */
export async function getShipmentChecksByPartner(partnerCode: string): Promise<ShipmentCheck[]> {
  const db = await getDb();
  if (!db) return (await getDumpRows<ShipmentCheck>("shipment_checks")).filter((row) => row.partnerCode === partnerCode) as ShipmentCheck[];
  return db.select().from(shipmentChecks).where(eq(shipmentChecks.partnerCode, partnerCode));
}

/** 受取確認チェックをupsert */
export async function upsertShipmentCheck(partnerCode: string, fedexShipmentId: number, itemIndex: number, isChecked: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // 既存レコードを確認
  const existing = await db.select().from(shipmentChecks)
    .where(and(
      eq(shipmentChecks.partnerCode, partnerCode),
      eq(shipmentChecks.fedexShipmentId, fedexShipmentId),
      eq(shipmentChecks.itemIndex, itemIndex)
    ))
    .limit(1);
  if (existing.length > 0) {
    await db.update(shipmentChecks)
      .set({ isChecked: isChecked ? 1 : 0, updatedAt: new Date() })
      .where(eq(shipmentChecks.id, existing[0].id));
  } else {
    await db.insert(shipmentChecks).values({ partnerCode, fedexShipmentId, itemIndex, isChecked: isChecked ? 1 : 0 });
  }
}

// ===== Partner Messages =====

/** 取引先からのメッセージを作成 */
export async function createPartnerMessage(data: InsertPartnerMessage): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(partnerMessages).values(data);
  return (result[0] as { insertId: number }).insertId;
}

/** 全メッセージを取得（管理者向け） */
export async function getAllPartnerMessages(): Promise<PartnerMessage[]> {
  const db = await getDb();
  if (!db) return byCreatedDesc(await getDumpRows<PartnerMessage>("partner_messages")) as PartnerMessage[];
  return db.select().from(partnerMessages).orderBy(desc(partnerMessages.createdAt));
}

/** メッセージを既読にする */
export async function markPartnerMessageRead(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(partnerMessages).set({ isRead: 1 }).where(eq(partnerMessages.id, id));
}

/** メッセージに返信する（管理者向け） */
export async function replyToPartnerMessage(id: number, replyText: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(partnerMessages)
    .set({ replyText, repliedAt: new Date(), isRead: 1 })
    .where(eq(partnerMessages.id, id));
}

/** メッセージを削除する（管理者向け） */
export async function deletePartnerMessage(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(partnerMessages).set({ isDeleted: 1 }).where(eq(partnerMessages.id, id));
}

/** メッセージを削除する（取引先向け） */
export async function deletePartnerMessageByPartner(id: number, partnerCode: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(partnerMessages)
    .set({ isDeletedByPartner: 1 })
    .where(and(eq(partnerMessages.id, id), eq(partnerMessages.partnerCode, partnerCode)));
}

/** 取引先の自分のメッセージ履歴を取得する */
export async function getPartnerMessagesByCode(partnerCode: string): Promise<PartnerMessage[]> {
  const db = await getDb();
  if (!db) {
    return byCreatedDesc((await getDumpRows<PartnerMessage>("partner_messages")).filter((row) => row.partnerCode === partnerCode && row.isDeletedByPartner === 0)) as PartnerMessage[];
  }
  return db.select().from(partnerMessages)
    .where(and(eq(partnerMessages.partnerCode, partnerCode), eq(partnerMessages.isDeletedByPartner, 0)))
    .orderBy(desc(partnerMessages.createdAt));
}

// ===== 手動発送記録 =====

/** 手動発送記録を作成する */
export async function createManualShipment(data: InsertManualShipment): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(manualShipments).values(data);
  return (result[0] as { insertId: number }).insertId;
}

/** 全手動発送記録を取得する */
export async function getAllManualShipments(): Promise<ManualShipment[]> {
  const db = await getDb();
  if (!db) return byCreatedDesc(await getDumpRows<ManualShipment>("manual_shipments")) as ManualShipment[];
  return db.select().from(manualShipments).orderBy(desc(manualShipments.createdAt));
}

/** 手動発送記録を削除する */
export async function deleteManualShipment(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(manualShipments).where(eq(manualShipments.id, id));
}

/**
 * inventoryId のリストから最新の追跡番号マップを返す
 * purchase_histories → purchase_extras を JOIN して取得
 * キー: inventoryId, 値: trackingNumber (文字列)
 */
export async function getTrackingNumbersByInventoryIds(inventoryIds: number[]): Promise<Map<number, string>> {
  const db = await getDb();
  const map = new Map<number, string>();
  if (inventoryIds.length === 0) return map;
  if (!db) {
    const idSet = new Set(inventoryIds);
    const extras = new Map((await getDumpRows<PurchaseExtra>("purchase_extras")).map((row) => [row.zaicoId, row]));
    const rows = byCreatedDesc(await getDumpRows<PurchaseHistory>("purchase_histories"));
    for (const row of rows) {
      const inventoryId = row.inventoryId;
      if (inventoryId == null || !idSet.has(inventoryId) || map.has(inventoryId)) continue;
      const trackingNumber = extras.get(row.zaicoId)?.trackingNumber;
      if (trackingNumber) map.set(inventoryId, String(trackingNumber));
    }
    return map;
  }
  const rows = await db
    .select({
      inventoryId: purchaseHistories.inventoryId,
      trackingNumber: purchaseExtras.trackingNumber,
      createdAt: purchaseHistories.createdAt,
    })
    .from(purchaseHistories)
    .leftJoin(purchaseExtras, eq(purchaseHistories.zaicoId, purchaseExtras.zaicoId))
    .where(inArray(purchaseHistories.inventoryId, inventoryIds))
    .orderBy(desc(purchaseHistories.createdAt));
  for (const row of rows) {
    if (row.inventoryId == null) continue;
    if (!map.has(row.inventoryId) && row.trackingNumber) {
      map.set(row.inventoryId, row.trackingNumber);
    }
  }
  return map;
}

/** 取引先が自分のメッセージ（返信付き）を既読にする */
export async function markPartnerMessagesReadByPartner(partnerCode: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(partnerMessages)
    .set({ isReadByPartner: 1 })
    .where(and(
      eq(partnerMessages.partnerCode, partnerCode),
      eq(partnerMessages.isReadByPartner, 0),
    ));
}

// ============================================================
// メッセージスレッド（partner_message_threads）
// ============================================================

/** スレッド返信を追加する */
export async function addMessageThread(data: InsertPartnerMessageThread): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(partnerMessageThreads).values(data);
  return (result as any)[0]?.insertId ?? 0;
}

/** 特定の親メッセージIDに紐づくスレッド一覧を取得する */
export async function getThreadsByParentId(parentMessageId: number): Promise<PartnerMessageThread[]> {
  const db = await getDb();
  if (!db) {
    return byFieldsAsc((await getDumpRows<PartnerMessageThread>("partner_message_threads")).filter((row) => row.parentMessageId === parentMessageId), ["createdAt"]) as PartnerMessageThread[];
  }
  return db
    .select()
    .from(partnerMessageThreads)
    .where(eq(partnerMessageThreads.parentMessageId, parentMessageId))
    .orderBy(partnerMessageThreads.createdAt);
}

/** 複数の親メッセージIDに紐づくスレッドを一括取得する */
export async function getThreadsByParentIds(parentMessageIds: number[]): Promise<PartnerMessageThread[]> {
  const db = await getDb();
  if (parentMessageIds.length === 0) return [];
  if (!db) {
    const parentSet = new Set(parentMessageIds);
    return byFieldsAsc((await getDumpRows<PartnerMessageThread>("partner_message_threads")).filter((row) => parentSet.has(row.parentMessageId)), ["createdAt"]) as PartnerMessageThread[];
  }
  return db
    .select()
    .from(partnerMessageThreads)
    .where(inArray(partnerMessageThreads.parentMessageId, parentMessageIds))
    .orderBy(partnerMessageThreads.createdAt);
}

/** 取引先のスレッド返信を既読にする（admin送信のスレッドを既読） */
export async function markThreadsReadByPartner(parentMessageIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  if (parentMessageIds.length === 0) return;
  await db
    .update(partnerMessageThreads)
    .set({ isReadByPartner: 1 })
    .where(and(
      inArray(partnerMessageThreads.parentMessageId, parentMessageIds),
      eq(partnerMessageThreads.senderType, "admin"),
      eq(partnerMessageThreads.isReadByPartner, 0),
    ));
}

/** 管理者のスレッド返信を既読にする（partner送信のスレッドを既読） */
export async function markThreadsReadByAdmin(parentMessageId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(partnerMessageThreads)
    .set({ isReadByAdmin: 1 })
    .where(and(
      eq(partnerMessageThreads.parentMessageId, parentMessageId),
      eq(partnerMessageThreads.senderType, "partner"),
      eq(partnerMessageThreads.isReadByAdmin, 0),
    ));
}
