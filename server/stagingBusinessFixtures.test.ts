import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUSINESS_FIXTURE_ID_BASE,
  BUSINESS_FIXTURE_INVOICE_NO,
  calculateDeclarationSummary,
  createBusinessFixtureBundle,
  writeBusinessFixtureJson,
} from "../scripts/staging/business-fixtures";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true }))
  );
});

function labelsForPurchase(
  bundle: ReturnType<typeof createBusinessFixtureBundle>,
  purchaseId: number
) {
  return bundle.tables.inventory_item_labels.filter(
    label => label.purchaseId === purchaseId
  );
}

describe("offline staging business fixtures", () => {
  it("keeps order, receipt, stock, and shipment quantities consistent", () => {
    const bundle = createBusinessFixtureBundle();
    const histories = bundle.tables.purchase_histories;

    for (const expected of [
      bundle.scenarioExpectations.orderedNotReceived,
      bundle.scenarioExpectations.partiallyReceived,
      bundle.scenarioExpectations.fullyReceived,
      bundle.scenarioExpectations.partiallyShipped,
    ]) {
      const purchase = bundle.tables.local_purchases.find(
        row => row.id === expected.purchaseId
      );
      expect(purchase).toBeDefined();
      const labels = labelsForPurchase(bundle, expected.purchaseId);
      const received = labels.filter(label => label.receivedAt != null).length;
      const shipped = labels.filter(label => label.shippedAt != null).length;
      const stock = labels.filter(label => label.status === "stocked").length;
      const historyQuantity = histories
        .filter(
          history =>
            history.inventoryId === purchase?.localInventoryId &&
            history.cancelled === 0
        )
        .reduce((sum, history) => sum + Number(history.quantity), 0);
      const inventory = bundle.tables.local_inventories.find(
        row => row.id === purchase?.localInventoryId
      );

      expect(labels).toHaveLength(expected.ordered);
      expect(Number(purchase?.quantity)).toBe(expected.ordered);
      expect(received).toBe(
        "received" in expected ? expected.received : expected.ordered
      );
      expect(historyQuantity).toBe(received);
      expect(Number(inventory?.quantity)).toBe(stock);
      expect(received).toBe(stock + shipped);
    }

    const partial = bundle.scenarioExpectations.partiallyShipped;
    const partialLabels = labelsForPurchase(bundle, partial.purchaseId);
    expect(
      partialLabels.filter(label => label.status === "shipped")
    ).toHaveLength(partial.shipped);
    expect(
      partialLabels.filter(label => label.status === "stocked")
    ).toHaveLength(partial.remaining);
    expect(bundle.tables.shipment_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          invoiceNo: BUSINESS_FIXTURE_INVOICE_NO,
          quantity: partial.shipped,
        }),
      ])
    );
  });

  it("recalculates the box declaration after a human assigns the unmatched label", () => {
    const bundle = createBusinessFixtureBundle();
    const scenario = bundle.scenarioExpectations.lateInvoiceAssignment;
    expect(scenario.before.unmatchedLabelIds).toEqual([scenario.labelId]);
    expect(scenario.before.matchedQuantity).toBe(4);
    expect(scenario.before.totals).toEqual([
      { currency: "EUR", quantity: 4, amount: 800 },
    ]);
    expect(scenario.after.unmatchedLabelIds).toEqual([]);
    expect(scenario.after.matchedQuantity).toBe(5);
    expect(scenario.after.totals).toEqual([
      { currency: "EUR", quantity: 5, amount: 1000 },
    ]);

    const afterBoxLabels =
      bundle.afterLateInvoiceAssignment.inventory_item_labels.filter(
        label => label.outboundBoxId === scenario.boxId
      );
    expect(
      calculateDeclarationSummary(afterBoxLabels, bundle.tables.trade_records)
    ).toEqual(scenario.after);
  });

  it("uses a dedicated ID band, valid fictional identifiers, and no external URLs", () => {
    const bundle = createBusinessFixtureBundle();
    const rows = Object.values(bundle.tables).flat();
    const ids = rows.flatMap(row =>
      typeof row.id === "number" ? [row.id] : []
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every(id => id >= BUSINESS_FIXTURE_ID_BASE)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      bundle.tables.inventory_item_labels.every(label =>
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{7}$/.test(String(label.labelId))
      )
    ).toBe(true);
    expect(
      new Set(bundle.tables.inventory_item_labels.map(label => label.labelId))
        .size
    ).toBe(bundle.tables.inventory_item_labels.length);
    expect(JSON.stringify(bundle)).not.toMatch(/https?:\/\//i);
    expect(JSON.stringify(bundle)).not.toMatch(/@(?!example\.invalid)/i);
    expect(bundle.coverage.coveredTables).toHaveLength(16);
    expect(bundle.coverage.uncoveredTableCount).toBe(38);
  });

  it("writes deterministic, parseable JSON without a database connection", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "staging-business-fixtures-")
    );
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "nested", "fixtures.json");
    await expect(writeBusinessFixtureJson(outputPath)).resolves.toBe(
      outputPath
    );
    const parsed = JSON.parse(await readFile(outputPath, "utf8"));
    expect(parsed.format).toBe("staging-business-fixtures");
    expect(parsed.generatedAt).toBe("2026-09-10T00:00:00.000Z");
    expect(parsed.tables.local_purchases).toHaveLength(4);
    expect(
      parsed.afterLateInvoiceAssignment.inventory_item_labels
    ).toHaveLength(25);
  });
});
