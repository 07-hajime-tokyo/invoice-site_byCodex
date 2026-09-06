import { count } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  inventoryItemLabels,
  localInventories,
  localPurchases,
} from "../../drizzle/schema";
import { assertDatabaseTarget } from "../../server/_core/connections";
import type { AppDatabase } from "../../server/_core/database";

type Env = Record<string, string | undefined>;

export const STAGING_SCHEMA_NAME = "invoice_staging";
export const STAGING_PRODUCT_TITLE = "STAGING架空商品";
export const STAGING_MANAGEMENT_NO = "STG-BOOTSTRAP-001";
export const STAGING_LABEL_IDS = [
  "STGAAAA",
  "STGAAAB",
  "STGAAAC",
  "STGAAAD",
  "STGAAAE",
] as const;

type InventorySeed = typeof localInventories.$inferInsert;
type PurchaseSeed = typeof localPurchases.$inferInsert;
type LabelSeed = typeof inventoryItemLabels.$inferInsert;

export type StagingSeedSnapshot = {
  inventory: InventorySeed;
  purchase: PurchaseSeed;
  labels: LabelSeed[];
};

export type StagingSeedResult = {
  inventoryId: number;
  purchaseId: number;
  inventoryCount: 1;
  orderedCount: 5;
  labelCount: 5;
};

export type SeedTransaction = {
  countBusinessTable(table: "local_inventories" | "local_purchases" | "inventory_item_labels"): Promise<number>;
  insertInventory(values: InventorySeed): Promise<number>;
  insertPurchase(values: PurchaseSeed): Promise<number>;
  insertLabels(values: LabelSeed[]): Promise<void>;
};

export type SeedDatabase = {
  transaction<T>(callback: (transaction: SeedTransaction) => Promise<T>): Promise<T>;
};

export type StagingSeedConnection = {
  database: SeedDatabase;
  close(): Promise<void>;
};

export type StagingSeedConnector = (databaseUrl: string) => Promise<StagingSeedConnection>;

export class StagingSeedRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StagingSeedRefusalError";
  }
}

function normalizedBoolean(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

export function assertStagingSeedEnvironment(env: Env): string {
  if (env.APP_ENV?.trim() !== "staging") {
    throw new StagingSeedRefusalError("Staging seed requires APP_ENV=staging");
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new StagingSeedRefusalError("Staging seed requires DATABASE_URL");
  }

  assertDatabaseTarget(databaseUrl, env);

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new StagingSeedRefusalError("Staging seed database URL is invalid");
  }

  if (parsed.pathname !== `/${STAGING_SCHEMA_NAME}`) {
    throw new StagingSeedRefusalError(`Staging seed requires schema ${STAGING_SCHEMA_NAME}`);
  }

  const sslEnabled = normalizedBoolean(env.DATABASE_SSL);
  if (!isLoopbackHost(parsed.hostname) && !parsed.hostname.toLowerCase().includes("tidbcloud") && sslEnabled !== true) {
    throw new StagingSeedRefusalError("Remote staging seed requires DATABASE_SSL=1");
  }
  if (!isLoopbackHost(parsed.hostname) && sslEnabled === false) {
    throw new StagingSeedRefusalError("Remote staging seed cannot disable TLS");
  }
  if (normalizedBoolean(env.DATABASE_SSL_REJECT_UNAUTHORIZED) === false) {
    throw new StagingSeedRefusalError("Staging seed cannot disable TLS certificate verification");
  }

  return databaseUrl;
}

export function createStagingSeedSnapshot(ids: { inventoryId: number; purchaseId: number }): StagingSeedSnapshot {
  const inventory: InventorySeed = {
    zaicoId: null,
    title: STAGING_PRODUCT_TITLE,
    category: "検証用",
    place: "STAGING",
    quantity: 0,
    unit: "個",
    unitPrice: "1000.00",
    etc: STAGING_MANAGEMENT_NO,
    supplierUrl: null,
    supplierName: "架空仕入先",
    ebayListingUrl: null,
    ebayOrderUrl: null,
    ebayOrderStatus: "normal",
    isDeleted: 0,
  };

  const purchaseItem = {
    id: 0,
    title: STAGING_PRODUCT_TITLE,
    quantity: "5",
    unit_price: 1000,
    etc: STAGING_MANAGEMENT_NO,
    status: "ordered",
    inventory_id: ids.inventoryId,
    inventoryId: ids.inventoryId,
  };
  const purchase: PurchaseSeed = {
    zaicoId: null,
    purchaseNum: "STAGING-BOOTSTRAP-001",
    status: "ordered",
    itemsJson: JSON.stringify([purchaseItem]),
    localInventoryId: ids.inventoryId,
    title: STAGING_PRODUCT_TITLE,
    category: "検証用",
    quantity: 5,
    unitPrice: "1000.00",
    managementNo: STAGING_MANAGEMENT_NO,
    purchaseDate: "2026-09-07",
    receivedDate: null,
    shipDate: null,
    trackingNumber: null,
    carrier: null,
    note: "独立検証DB用の架空データ",
    supplierUrl: null,
    supplierName: "架空仕入先",
    receiptAckStatus: null,
    receiptAckSource: null,
    receiptAckAt: null,
    receiptAckNote: null,
    inboundClass: null,
    classSource: "auto",
    stage: "ordered",
    stageUpdatedBy: "staging-bootstrap",
    stageUpdatedAt: null,
    shaftParentPurchaseId: null,
  };

  const labels: LabelSeed[] = STAGING_LABEL_IDS.map((labelId) => ({
    labelId,
    purchaseId: ids.purchaseId,
    localInventoryId: ids.inventoryId,
    legacyManagementNo: STAGING_MANAGEMENT_NO,
    assignedInvoiceNo: null,
    title: STAGING_PRODUCT_TITLE,
    status: "ordered",
    sourceKey: `staging-bootstrap:${STAGING_MANAGEMENT_NO}`,
    outboundBoxId: null,
    receivedAt: null,
    shippedAt: null,
  }));

  return { inventory, purchase, labels };
}

export async function runStagingSeed(database: SeedDatabase): Promise<StagingSeedResult> {
  return database.transaction(async (transaction) => {
    for (const table of ["local_inventories", "local_purchases", "inventory_item_labels"] as const) {
      if (await transaction.countBusinessTable(table) !== 0) {
        throw new StagingSeedRefusalError("Staging seed refused because target business tables are not empty");
      }
    }

    const inventorySeed = createStagingSeedSnapshot({ inventoryId: 0, purchaseId: 0 }).inventory;
    const inventoryId = await transaction.insertInventory(inventorySeed);
    if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
      throw new Error("Inventory insert did not return an ID");
    }

    const purchaseSeed = createStagingSeedSnapshot({ inventoryId, purchaseId: 0 }).purchase;
    const purchaseId = await transaction.insertPurchase(purchaseSeed);
    if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
      throw new Error("Purchase insert did not return an ID");
    }

    const labels = createStagingSeedSnapshot({ inventoryId, purchaseId }).labels;
    await transaction.insertLabels(labels);

    return {
      inventoryId,
      purchaseId,
      inventoryCount: 1,
      orderedCount: 5,
      labelCount: 5,
    };
  });
}

export function createDrizzleSeedDatabase(database: AppDatabase): SeedDatabase {
  return {
    transaction: async (callback) => database.transaction(async (transaction) => {
      const adapter: SeedTransaction = {
        countBusinessTable: async (table) => {
          const source = table === "local_inventories"
            ? localInventories
            : table === "local_purchases"
              ? localPurchases
              : inventoryItemLabels;
          const [row] = await transaction.select({ value: count() }).from(source);
          return Number(row?.value ?? 0);
        },
        insertInventory: async (values) => {
          const result = await transaction.insert(localInventories).values(values);
          return Number((result[0] as { insertId?: number }).insertId ?? 0);
        },
        insertPurchase: async (values) => {
          const result = await transaction.insert(localPurchases).values(values);
          return Number((result[0] as { insertId?: number }).insertId ?? 0);
        },
        insertLabels: async (values) => {
          await transaction.insert(inventoryItemLabels).values(values);
        },
      };
      return callback(adapter);
    }),
  };
}

async function defaultConnector(databaseUrl: string): Promise<StagingSeedConnection> {
  const { createDrizzleDatabase } = await import("../../server/_core/database");
  const drizzleDatabase = createDrizzleDatabase(databaseUrl);
  return {
    database: createDrizzleSeedDatabase(drizzleDatabase),
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      drizzleDatabase.$client.end((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

export async function executeStagingSeed(
  env: Env,
  connect: StagingSeedConnector = defaultConnector,
): Promise<StagingSeedResult> {
  const databaseUrl = assertStagingSeedEnvironment(env);
  let connection: StagingSeedConnection;
  try {
    connection = await connect(databaseUrl);
  } catch {
    throw new Error("Staging seed could not establish a database connection");
  }

  let result: StagingSeedResult;
  try {
    result = await runStagingSeed(connection.database);
  } catch (error) {
    try {
      await connection.close();
    } catch {
      // The transaction error below takes precedence and intentionally hides cleanup details.
    }
    if (error instanceof StagingSeedRefusalError) throw error;
    throw new Error("Staging seed transaction failed; database commit status is unknown");
  }

  try {
    await connection.close();
  } catch {
    throw new Error("Staging seed committed, but database connection cleanup failed");
  }
  return result;
}

async function main(): Promise<void> {
  const result = await executeStagingSeed(process.env);
  console.info(`Staging seed inserted ${result.inventoryCount} inventory, ${result.orderedCount} ordered units, and ${result.labelCount} labels.`);
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Staging seed failed");
    process.exitCode = 1;
  });
}
