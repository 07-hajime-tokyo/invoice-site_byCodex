import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

let db: Awaited<ReturnType<typeof connectTestDatabase>>;
let api: Awaited<ReturnType<typeof startTestApi>>;
beforeAll(async () => { db = await connectTestDatabase(); api = await startTestApi(); });
beforeEach(async () => { await resetFixtures(db); });
afterAll(async () => { try { if (api) await api.stop(); } finally { if (db) await db.end(); } });

const form = {
  invoiceNumber: "0901", currency: "JPY", showAmounts: true,
  clientSnapshot: { name: "Synthetic Buyer" }, invoiceDate: "2026-09-30",
  notes: "Local persistence check", status: "sent" as const,
  items: [{ description: "Synthetic item", variant: "Blue", quantity: 2.5, unitPrice: 123.4, tax: 10 }],
};
async function rows(sql: string, values: unknown[] = []) {
  const [result] = await db.query<RowDataPacket[]>(sql, values);
  return result;
}

describe("請求書の保存・削除・分割の既存契約", () => {
  it("作成・明細置換・状態更新を再取得でき、重複と不正入力は保存しない", async () => {
    const created = await api.client.invoices.create.mutate(form);
    const saved = await api.client.invoices.get.query(created);
    expect(saved).toMatchObject({ ...created, invoiceNumber: "0901", currency: "JPY", notes: form.notes, clientSnapshot: form.clientSnapshot, status: "sent" });
    expect(saved!.items).toHaveLength(1);
    expect(saved!.items[0]).toMatchObject({ description: "Synthetic item", variant: "Blue", quantity: "2.50", unitPrice: "123.40", tax: "10.00", sortOrder: 0 });
    expect((await api.client.invoices.list.query())[0]).toMatchObject({ ...created, itemCount: 1, totalAmount: 308.5 });
    await expect(api.client.invoices.create.mutate(form)).rejects.toThrow(/既に存在/);
    await expect(api.client.invoices.create.mutate({ ...form, invoiceNumber: "0902", items: [{ ...form.items[0], quantity: -1 }] })).rejects.toThrow();
    expect(await api.client.invoices.list.query()).toHaveLength(1);
    await api.client.invoices.update.mutate({ ...created, invoiceNumber: "0901", items: [{ description: "Replacement", quantity: 3, unitPrice: 20 }] });
    const edited = await api.client.invoices.get.query(created);
    expect(edited).toMatchObject({ currency: "EUR", showAmounts: false, notes: null, clientSnapshot: null, status: "draft" });
    expect(edited!.items).toHaveLength(1);
    expect(edited!.items[0]).toMatchObject({ description: "Replacement", quantity: "3.00", unitPrice: "20.00", tax: "0.00" });
    expect(edited!.items[0].id).not.toBe(saved!.items[0].id);
    await api.client.invoices.updateStatus.mutate({ ...created, status: "paid" });
    expect(await api.client.invoices.get.query(created)).toMatchObject({ status: "paid" });
  });

  it("複製・ソフト削除・復元・完全削除は対象だけに作用する", async () => {
    const purchases = await rows("SELECT * FROM local_purchases ORDER BY id");
    const original = await api.client.invoices.create.mutate(form);
    const copy = await api.client.invoices.clone.mutate(original);
    expect(copy.invoiceNumber).toBe("0902");
    const cloned = await api.client.invoices.get.query(copy);
    expect(cloned).toMatchObject({ status: "draft", notes: form.notes, clientSnapshot: form.clientSnapshot });
    expect(cloned!.items[0]).toMatchObject({ description: form.items[0].description, quantity: "2.50", tax: "10.00" });
    await expect(api.client.invoices.permanentDelete.mutate(original)).rejects.toThrow(/ソフトデリート/);
    await api.client.invoices.delete.mutate(original);
    expect((await api.client.invoices.list.query()).map(row => row.id)).toEqual([copy.id]);
    expect((await api.client.invoices.listDeleted.query())[0]).toMatchObject({ id: original.id, itemCount: 1, totalAmount: 308.5 });
    await api.client.invoices.restore.mutate(original);
    expect(await api.client.invoices.listDeleted.query()).toEqual([]);
    expect(await api.client.invoices.list.query()).toHaveLength(2);
    await api.client.invoices.delete.mutate(original);
    await api.client.invoices.permanentDelete.mutate(original);
    expect(await api.client.invoices.get.query(original)).toBeNull();
    expect(await rows("SELECT * FROM invoice_items WHERE invoiceId=?", [original.id])).toEqual([]);
    expect(await api.client.invoices.get.query(copy)).toEqual(cloned);
    expect(await rows("SELECT * FROM local_purchases ORDER BY id")).toEqual(purchases);
  });

  it("分割保存は番号正規化・順序・値を保持し、採番は削除済みも含む既存規則を維持する", async () => {
    const result = await api.client.invoices.createSplit.mutate({ ...form, baseInvoiceNumber: "901", exchangeRate: 1, splits: [
      { invoiceNumber: " 901 ", items: form.items },
      { invoiceNumber: "X-902", items: [{ description: "Second", quantity: 1, unitPrice: 600000 }] },
    ] });
    expect(result.count).toBe(2);
    const first = await api.client.invoices.get.query({ id: result.ids[0] });
    const second = await api.client.invoices.get.query({ id: result.ids[1] });
    expect(first).toMatchObject({ invoiceNumber: "0901", notes: form.notes });
    expect(second).toMatchObject({ invoiceNumber: "X-902", notes: form.notes });
    expect(first!.items[0]).toMatchObject({ quantity: "2.50", unitPrice: "123.40", tax: "10.00" });
    expect(second!.items[0]).toMatchObject({ quantity: "1.00", unitPrice: "600000.00", tax: "0.00" });
    await api.client.invoices.delete.mutate({ id: result.ids[1] });
    expect(await api.client.invoices.getNextNumber.query()).toMatch(/^INV-\d{8}-903$/);
    expect(await api.client.invoices.getLatest.query()).toMatchObject({ id: result.ids[1], invoiceNumber: "X-902" });
  });
});
