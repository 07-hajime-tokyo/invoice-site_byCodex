import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { describe, expect, it, vi } from "vitest";
import { tradeRecords } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

const mock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", async (importOriginal) => ({
  ...await importOriginal<typeof import("./db")>(),
  getDb: mock.getDb,
}));
vi.mock("./inventory/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("./inventory/db")>(),
  getAllInvoiceMemos: async () => [],
}));

describe("trade list shipment registration", () => {
  it("counts saved dispatches per selected line and keeps missing procurement visible", async () => {
    const trades = [
      { id: 1, no: 423, productName: "2DS", quantity: "3", status: "remaining 1", procurementTotal: "100" },
      { id: 2, no: 423, productName: "2DS", quantity: "3", status: "complete", procurementTotal: "100" },
      { id: 3, no: 423, productName: "2DS", quantity: "2", status: "complete", procurementTotal: "100" },
      { id: 4, no: 423, productName: "PSP", quantity: "1", status: "", procurementTotal: "0" },
      { id: 5, no: 399, productName: "PSP", quantity: "1", status: "remaining 1", procurementTotal: "100" },
    ];
    const columns = Object.keys(getTableColumns(tradeRecords));
    const shipmentQueries: string[] = [];
    mock.getDb.mockResolvedValue(drizzle(async (sql, params) => {
      const statement = sql.replaceAll("`", "");
      if (statement.includes("from shipment_items")) {
        shipmentQueries.push(statement);
        expect(statement).toContain("SUM(shipment_items.quantity)");
        expect(statement).toContain("inner join shipments on shipments.id = shipment_items.shipmentId");
        expect(statement).toContain("trade_records.id = shipment_items.tradeRecordId");
        expect(statement).toContain("trade_records.no = shipment_items.invoiceNo");
        expect(statement).toContain("group by trade_records.id");
        expect(params).toEqual([1, 2, 3, 4]);
        return { rows: [[1, "3"], [2, "2"], [4, "1"]] };
      }
      if (statement.includes("from trade_records")) {
        if (!statement.includes("order by")) return { rows: [] };
        return { rows: trades.map(trade => columns.map(key => Reflect.get(trade, key) ?? null)) };
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    }));
    const caller = appRouter.createCaller({
      user: { id: 1, name: "Test", email: "test@example.com" }, req: {}, res: {},
    } as TrpcContext);
    const statuses = (await caller.trade.listFromDb({})).rows.map(({ id, status }) => [id, status]);
    expect(statuses).toEqual([
      [1, "complete"],
      [2, "\u6b8b1"],
      [3, "\u767a\u9001\u767b\u9332\u672a\u5b8c\u4e86\uff08\u6b8b2\u53f0\uff09"],
      [4, "complete"],
      [5, "complete"],
    ]);
    const incomplete = await caller.trade.listFromDb({ incompleteOnly: true });
    expect(incomplete.rows.map(({ id }) => id)).toEqual([2, 3, 4]);
    expect(incomplete.totalCount).toBe(3);
    expect(shipmentQueries).toHaveLength(2);
  });
});
