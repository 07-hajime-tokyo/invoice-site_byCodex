import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

let db: Awaited<ReturnType<typeof connectTestDatabase>>;
let api: Awaited<ReturnType<typeof startTestApi>>;
beforeAll(async () => { db = await connectTestDatabase(); api = await startTestApi(); });
beforeEach(async () => { await resetFixtures(db); });
afterAll(async () => { try { if (api) await api.stop(); } finally { if (db) await db.end(); } });
async function rows(sql: string, values: unknown[] = []) {
  return (await db.query<RowDataPacket[]>(sql, values))[0];
}
const order = {
  inventoryId: 910001, title: "【テスト】追加発注", quantity: 2,
  unitPrice: 321, managementNo: "9999-LOCAL-ONLY", supplierName: "架空仕入先2",
};

describe("発注登録から商品ID受入までの保存契約", () => {
  it("同じ管理番号の再登録は同じ発注を更新し、不正数量と他の発注を変更しない", async () => {
    const unrelated = await rows("SELECT * FROM local_purchases ORDER BY id");
    const created = await api.client.inventory.zaico.createOrderedPurchase.mutate(order);
    expect(created).toMatchObject({ code: 200, status: "ok" });
    expect(await rows("SELECT quantity, unitPrice, status, supplierName FROM local_purchases WHERE id=?", [created.data_id]))
      .toMatchObject([{ quantity: 2, unitPrice: "321.00", status: "ordered", supplierName: "架空仕入先2" }]);
    expect(await rows("SELECT status FROM inventory_item_labels WHERE purchaseId=?", [created.data_id]))
      .toEqual([{ status: "ordered" }, { status: "ordered" }]);
    const updated = await api.client.inventory.zaico.createOrderedPurchase.mutate({ ...order, unitPrice: 456 });
    expect(updated.data_id).toBe(created.data_id);
    await expect(api.client.inventory.zaico.createOrderedPurchase.mutate({ ...order, quantity: 0 })).rejects.toThrow();
    expect(await rows("SELECT quantity, unitPrice FROM local_purchases WHERE id=?", [created.data_id]))
      .toMatchObject([{ quantity: 2, unitPrice: "456.00" }]);
    expect(await rows("SELECT * FROM local_purchases WHERE id<>? ORDER BY id", [created.data_id])).toEqual(unrelated);
  });

  it("個体を一つずつ受け入れ、再読取で在庫・履歴を二重計上せず、全数で発注を完了する", async () => {
    const unrelated = await rows("SELECT * FROM local_inventories WHERE id<>910001 ORDER BY id");
    const created = await api.client.inventory.zaico.createOrderedPurchase.mutate(order);
    const labels = await rows("SELECT labelId FROM inventory_item_labels WHERE purchaseId=? ORDER BY id", [created.data_id]);
    const receive = (labelId: string) => api.client.inventory.orderManagement.receivePurchaseLabel.mutate({ labelId, operatorName: "架空担当" });
    expect(await receive(` ${labels[0].labelId.toLowerCase()} `)).toMatchObject({ alreadyReceived: false, inventoryQuantity: 1, status: "received" });
    expect(await rows("SELECT status FROM local_purchases WHERE id=?", [created.data_id])).toEqual([{ status: "ordered" }]);
    expect(await receive(labels[0].labelId)).toMatchObject({ alreadyReceived: true, inventoryQuantity: 1 });
    expect(await receive(labels[1].labelId)).toMatchObject({ alreadyReceived: false, inventoryQuantity: 2 });
    expect(await rows("SELECT status FROM local_purchases WHERE id=?", [created.data_id])).toEqual([{ status: "purchased" }]);
    expect(await rows("SELECT quantity FROM local_inventories WHERE id=910001")).toEqual([{ quantity: 2 }]);
    expect(await rows("SELECT quantity FROM purchase_histories WHERE inventoryId=910001")).toHaveLength(2);
    expect(await rows("SELECT * FROM local_inventories WHERE id<>910001 ORDER BY id")).toEqual(unrelated);
    await expect(receive("NO-SUCH-TEST-LABEL")).rejects.toThrow(/見つかりません/);
  });
});
