import { describe, expect, it, vi } from "vitest";
import {
  STAGING_LABEL_IDS,
  StagingSeedRefusalError,
  assertStagingSeedEnvironment,
  createStagingSeedSnapshot,
  executeStagingSeed,
  runStagingSeed,
  type SeedDatabase,
  type SeedTransaction,
} from "../scripts/staging/seed";

const validEnv = {
  APP_ENV: "staging",
  DATABASE_URL: "mysql://seed-user:secret@localhost:3306/invoice_staging",
  NON_PRODUCTION_DATABASE_TARGET: "mysql://localhost:3306/invoice_staging",
};

function memoryDatabase(initial = { inventories: 0, purchases: 0, labels: 0 }) {
  const state = { ...initial };
  const inserted: { inventory?: unknown; purchase?: unknown; labels?: unknown[] } = {};
  const database: SeedDatabase = {
    transaction: async (callback) => {
      const before = { ...state };
      const transaction: SeedTransaction = {
        countBusinessTable: async (table) => ({
          local_inventories: state.inventories,
          local_purchases: state.purchases,
          inventory_item_labels: state.labels,
        })[table],
        insertInventory: async (values) => {
          inserted.inventory = values;
          state.inventories += 1;
          return 41;
        },
        insertPurchase: async (values) => {
          inserted.purchase = values;
          state.purchases += 1;
          return 73;
        },
        insertLabels: async (values) => {
          inserted.labels = values;
          state.labels += values.length;
        },
      };
      try {
        return await callback(transaction);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
  };
  return { database, state, inserted };
}

describe("staging bootstrap guards", () => {
  it("requires explicit staging before attempting a connection", async () => {
    const connect = vi.fn();
    await expect(executeStagingSeed({ ...validEnv, APP_ENV: "test" }, connect)).rejects.toThrow(
      "APP_ENV=staging",
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it("reuses the approved target check and requires invoice_staging", () => {
    expect(() => assertStagingSeedEnvironment({
      ...validEnv,
      NON_PRODUCTION_DATABASE_TARGET: "mysql://localhost:3306/another_schema",
    })).toThrow("approved non-production target");

    expect(() => assertStagingSeedEnvironment({
      ...validEnv,
      DATABASE_URL: "mysql://seed-user:secret@localhost:3306/another_schema",
      NON_PRODUCTION_DATABASE_TARGET: "mysql://localhost:3306/another_schema",
    })).toThrow("schema invoice_staging");
  });

  it("requires verified TLS for remote non-TiDB targets", () => {
    const remote = {
      ...validEnv,
      DATABASE_URL: "mysql://seed-user:secret@db.example.test:3306/invoice_staging",
      NON_PRODUCTION_DATABASE_TARGET: "mysql://db.example.test:3306/invoice_staging",
    };
    expect(() => assertStagingSeedEnvironment(remote)).toThrow("DATABASE_SSL=1");
    expect(() => assertStagingSeedEnvironment({ ...remote, DATABASE_SSL: "1" })).not.toThrow();
    expect(() => assertStagingSeedEnvironment({
      ...remote,
      DATABASE_SSL: "1",
      DATABASE_SSL_REJECT_UNAUTHORIZED: "0",
    })).toThrow("certificate verification");
  });
});

describe("staging bootstrap seed", () => {
  it("matches the purchase-registration JSON and ordered label snapshot", () => {
    const snapshot = createStagingSeedSnapshot({ inventoryId: 41, purchaseId: 73 });
    expect({
      inventory: snapshot.inventory,
      purchase: { ...snapshot.purchase, itemsJson: JSON.parse(String(snapshot.purchase.itemsJson)) },
      labels: snapshot.labels,
    }).toMatchInlineSnapshot(`
      {
        "inventory": {
          "category": "検証用",
          "ebayListingUrl": null,
          "ebayOrderStatus": "normal",
          "ebayOrderUrl": null,
          "etc": "STG-BOOTSTRAP-001",
          "isDeleted": 0,
          "place": "STAGING",
          "quantity": 0,
          "supplierName": "架空仕入先",
          "supplierUrl": null,
          "title": "STAGING架空商品",
          "unit": "個",
          "unitPrice": "1000.00",
          "zaicoId": null,
        },
        "labels": [
          {
            "assignedInvoiceNo": null,
            "labelId": "STGAAAA",
            "legacyManagementNo": "STG-BOOTSTRAP-001",
            "localInventoryId": 41,
            "outboundBoxId": null,
            "purchaseId": 73,
            "receivedAt": null,
            "shippedAt": null,
            "sourceKey": "staging-bootstrap:STG-BOOTSTRAP-001",
            "status": "ordered",
            "title": "STAGING架空商品",
          },
          {
            "assignedInvoiceNo": null,
            "labelId": "STGAAAB",
            "legacyManagementNo": "STG-BOOTSTRAP-001",
            "localInventoryId": 41,
            "outboundBoxId": null,
            "purchaseId": 73,
            "receivedAt": null,
            "shippedAt": null,
            "sourceKey": "staging-bootstrap:STG-BOOTSTRAP-001",
            "status": "ordered",
            "title": "STAGING架空商品",
          },
          {
            "assignedInvoiceNo": null,
            "labelId": "STGAAAC",
            "legacyManagementNo": "STG-BOOTSTRAP-001",
            "localInventoryId": 41,
            "outboundBoxId": null,
            "purchaseId": 73,
            "receivedAt": null,
            "shippedAt": null,
            "sourceKey": "staging-bootstrap:STG-BOOTSTRAP-001",
            "status": "ordered",
            "title": "STAGING架空商品",
          },
          {
            "assignedInvoiceNo": null,
            "labelId": "STGAAAD",
            "legacyManagementNo": "STG-BOOTSTRAP-001",
            "localInventoryId": 41,
            "outboundBoxId": null,
            "purchaseId": 73,
            "receivedAt": null,
            "shippedAt": null,
            "sourceKey": "staging-bootstrap:STG-BOOTSTRAP-001",
            "status": "ordered",
            "title": "STAGING架空商品",
          },
          {
            "assignedInvoiceNo": null,
            "labelId": "STGAAAE",
            "legacyManagementNo": "STG-BOOTSTRAP-001",
            "localInventoryId": 41,
            "outboundBoxId": null,
            "purchaseId": 73,
            "receivedAt": null,
            "shippedAt": null,
            "sourceKey": "staging-bootstrap:STG-BOOTSTRAP-001",
            "status": "ordered",
            "title": "STAGING架空商品",
          },
        ],
        "purchase": {
          "carrier": null,
          "category": "検証用",
          "classSource": "auto",
          "inboundClass": null,
          "itemsJson": [
            {
              "etc": "STG-BOOTSTRAP-001",
              "id": 0,
              "inventoryId": 41,
              "inventory_id": 41,
              "quantity": "5",
              "status": "ordered",
              "title": "STAGING架空商品",
              "unit_price": 1000,
            },
          ],
          "localInventoryId": 41,
          "managementNo": "STG-BOOTSTRAP-001",
          "note": "独立検証DB用の架空データ",
          "purchaseDate": "2026-09-07",
          "purchaseNum": "STAGING-BOOTSTRAP-001",
          "quantity": 5,
          "receiptAckAt": null,
          "receiptAckNote": null,
          "receiptAckSource": null,
          "receiptAckStatus": null,
          "receivedDate": null,
          "shaftParentPurchaseId": null,
          "shipDate": null,
          "stage": "ordered",
          "stageUpdatedAt": null,
          "stageUpdatedBy": "staging-bootstrap",
          "status": "ordered",
          "supplierName": "架空仕入先",
          "supplierUrl": null,
          "title": "STAGING架空商品",
          "trackingNumber": null,
          "unitPrice": "1000.00",
          "zaicoId": null,
        },
      }
    `);
    expect(STAGING_LABEL_IDS).toHaveLength(5);
    expect(STAGING_LABEL_IDS.every((labelId) => /^[A-HJ-NP-Z]{7}$/.test(labelId))).toBe(true);
  });

  it("inserts once into an empty target and refuses a rerun without changing counts", async () => {
    const memory = memoryDatabase();
    await expect(runStagingSeed(memory.database)).resolves.toEqual({
      inventoryId: 41,
      purchaseId: 73,
      inventoryCount: 1,
      orderedCount: 5,
      labelCount: 5,
    });
    expect(memory.state).toEqual({ inventories: 1, purchases: 1, labels: 5 });
    expect(memory.inserted.labels).toHaveLength(5);

    await expect(runStagingSeed(memory.database)).rejects.toBeInstanceOf(StagingSeedRefusalError);
    expect(memory.state).toEqual({ inventories: 1, purchases: 1, labels: 5 });
  });

  it("rolls back all writes when a later insert fails and hides driver details", async () => {
    const memory = memoryDatabase();
    const originalTransaction = memory.database.transaction;
    const failingDatabase: SeedDatabase = {
      transaction: (callback) => originalTransaction(async (transaction) => callback({
        ...transaction,
        insertPurchase: async () => {
          throw new Error("mysql://seed-user:secret@db.example.test/invoice_staging");
        },
      })),
    };
    const close = vi.fn(async () => undefined);
    const connect = vi.fn(async () => ({ database: failingDatabase, close }));

    await expect(executeStagingSeed(validEnv, connect)).rejects.toThrow(
      /^Staging seed transaction failed; database commit status is unknown$/,
    );
    expect(memory.state).toEqual({ inventories: 0, purchases: 0, labels: 0 });
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports cleanup failure after commit without hiding the committed rows or exposing secrets", async () => {
    const memory = memoryDatabase();
    const close = vi.fn(async () => {
      throw new Error("mysql://seed-user:secret@db.example.test/invoice_staging");
    });
    const connect = vi.fn(async () => ({ database: memory.database, close }));

    await expect(executeStagingSeed(validEnv, connect)).rejects.toThrow(
      /^Staging seed committed, but database connection cleanup failed$/,
    );
    expect(memory.state).toEqual({ inventories: 1, purchases: 1, labels: 5 });
    expect(close).toHaveBeenCalledOnce();
  });
});
