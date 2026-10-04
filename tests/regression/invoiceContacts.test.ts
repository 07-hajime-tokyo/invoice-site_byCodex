import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

let db: Awaited<ReturnType<typeof connectTestDatabase>>;
let api: Awaited<ReturnType<typeof startTestApi>>;
beforeAll(async () => {
  db = await connectTestDatabase();
  api = await startTestApi();
});
beforeEach(async () => { await resetFixtures(db); });
afterAll(async () => {
  try { if (api) await api.stop(); }
  finally { if (db) await db.end(); }
});

const clientForm = {
  name: "Local Test Client", company: "Synthetic Company", email: "test@example.invalid",
  phone: "+00 123", address: "Test Street 1", city: "Test City", country: "Test Country",
  notes: "Synthetic memo", extraInfo: "TEST-REG-001\nSecond line",
};
const senderForm = {
  senderName: "Local Test Sender", senderCompany: "Synthetic Sender", senderEmail: "sender@example.invalid",
  senderPhone: "+00 456", senderAddress: "Test Street 2", senderCity: "Test City",
  senderCountry: "Test Country", senderExtraInfo: "TEST-SENDER-001\nSecond line",
};
async function rows(sql: string, values: unknown[] = []) {
  const [result] = await db.query<RowDataPacket[]>(sql, values);
  return result;
}

describe("宛先・差出人ダイアログの保存先契約", () => {
  it("宛先の作成・全項目更新・削除を再取得でき、別宛先と発注を保持する", async () => {
    const purchases = await rows("SELECT * FROM local_purchases ORDER BY id");
    const other = await api.client.invoiceClients.create.mutate({ ...clientForm, name: "Other Synthetic Client" });
    const untouched = await api.client.invoiceClients.get.query(other);
    const created = await api.client.invoiceClients.create.mutate(clientForm);
    expect(await api.client.invoiceClients.get.query(created)).toMatchObject({ ...created, ...clientForm });
    expect((await rows("SELECT * FROM invoice_clients WHERE id=?", [created.id]))[0]).toMatchObject(clientForm);
    const edited = { ...clientForm, name: "Edited Local Client", email: "", phone: "", notes: "Kept memo", extraInfo: "更新後の架空登録番号" };
    await api.client.invoiceClients.update.mutate({ ...created, ...edited });
    // Client strings pass through sanitizeText; empty optional values are stored as null.
    expect(await api.client.invoiceClients.get.query(created)).toMatchObject({ ...edited, email: null, phone: null });
    expect((await api.client.invoiceClients.list.query()).map(row => row.id)).toEqual([created.id, other.id]);
    await api.client.invoiceClients.delete.mutate(created);
    expect(await api.client.invoiceClients.get.query(created)).toBeNull();
    expect(await api.client.invoiceClients.list.query()).toEqual([untouched]);
    expect(await rows("SELECT * FROM local_purchases ORDER BY id")).toEqual(purchases);
  });

  it("空の宛先名は作成・更新とも拒否され、登録済みデータが変わらない", async () => {
    const created = await api.client.invoiceClients.create.mutate(clientForm);
    const before = await api.client.invoiceClients.list.query();
    await expect(api.client.invoiceClients.create.mutate({ ...clientForm, name: "" })).rejects.toThrow();
    await expect(api.client.invoiceClients.update.mutate({ ...created, ...clientForm, name: "" })).rejects.toThrow();
    expect(await api.client.invoiceClients.list.query()).toEqual(before);
  });

  it("差出人の初回保存・上書き・空欄を保持し、未送信のロゴと税率を変更しない", async () => {
    expect(await api.client.invoiceSettings.get.query()).toBeNull();
    await api.client.invoiceSettings.save.mutate({ ...senderForm, logoUrl: "/synthetic-logo.png", logoKey: "test-only", taxRate: 7.5 });
    const first = await api.client.invoiceSettings.get.query();
    expect(first).toMatchObject({ ...senderForm, logoUrl: "/synthetic-logo.png", logoKey: "test-only" });
    const edited = { ...senderForm, senderName: "Edited Local Sender", senderEmail: "", senderExtraInfo: "更新後の架空番号" };
    await api.client.invoiceSettings.save.mutate(edited);
    const next = await api.client.invoiceSettings.get.query();
    expect(next).toMatchObject({ ...edited, id: first!.id, logoUrl: first!.logoUrl, logoKey: first!.logoKey, taxRate: first!.taxRate });
    const saved = await rows("SELECT * FROM invoice_settings");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject(edited);
  });
});
