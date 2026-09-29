import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";
// 出品先との通信だけを置き換える。荷受・在庫・履歴・取消は実API/専用DB。
vi.mock("../../server/inventory/defectiveSync", () => ({
  syncDefectiveListingByLabelId: vi.fn(async () => ({ success: true })),
}));
let db: Awaited<ReturnType<typeof connectTestDatabase>>;
let api: Awaited<ReturnType<typeof startTestApi>>;
beforeAll(async () => {
  db = await connectTestDatabase();
  api = await startTestApi();
});
beforeEach(async () => {
  await resetFixtures(db);
});
afterAll(async () => {
  try {
    if (api) await api.stop();
  } finally {
    if (db) await db.end();
  }
});
async function rows(sql: string, values: unknown[] = []) {
  return (await db.query<RowDataPacket[]>(sql, values))[0];
}
async function prepare() {
  const created = await api.client.inventory.zaico.createOrderedPurchase.mutate(
    {
      inventoryId: 910001,
      title: "【テスト】荷受検品",
      quantity: 2,
      unitPrice: 321,
      managementNo: "999_架空_検品",
      supplierName: "架空仕入先",
    }
  );
  const labels = await rows(
    "SELECT labelId FROM inventory_item_labels WHERE purchaseId=? ORDER BY id",
    [created.data_id]
  );
  return {
    purchaseId: created.data_id,
    ids: labels.map(r => String(r.labelId)),
  };
}
const quantity = async () =>
  (await rows("SELECT quantity FROM local_inventories WHERE id=910001"))[0]
    .quantity;
const stored = async (id: string) =>
  (await rows("SELECT * FROM inventory_item_labels WHERE labelId=?", [id]))[0];

describe("荷受・検品・取消の保存契約", () => {
  it("受取だけでは在庫を増やさず、重複・未登録・対象外を区別する", async () => {
    const c = api.client.inventory.inboundDesk;
    const { ids, purchaseId } = await prepare();
    const unrelated = await rows(
      "SELECT * FROM local_inventories WHERE id<>910001 ORDER BY id"
    );
    expect(
      await c.receive.mutate({
        labelIds: [` ${ids[0].toLowerCase()} `, ids[0], "MISSING"],
      })
    ).toMatchObject({
      received: [ids[0]],
      notFound: ["MISSING"],
      rejected: [],
    });
    expect(await quantity()).toBe(0);
    expect(await c.receive.mutate({ labelIds: ids })).toMatchObject({
      received: [ids[1]],
      alreadyReceived: [ids[0]],
    });
    expect(
      await rows("SELECT status FROM local_purchases WHERE id=?", [purchaseId])
    ).toEqual([{ status: "purchased" }]);
    await c.inspect.mutate({ labelId: ids[0], outcome: "stocked" });
    expect(await c.receive.mutate({ labelIds: [ids[0]] })).toMatchObject({
      rejected: [ids[0]],
    });
    expect(
      await rows("SELECT * FROM local_inventories WHERE id<>910001 ORDER BY id")
    ).toEqual(unrelated);
  });
  it("検品OKは1個だけ計上し、検品取消→荷受取消で数量・個体を戻し、再取消で減らさない", async () => {
    const c = api.client.inventory.inboundDesk;
    const { ids } = await prepare();
    const untouched = await stored(ids[1]);
    await c.receive.mutate({ labelIds: [ids[0]] });
    await c.inspect.mutate({ labelId: ids[0], outcome: "stocked" });
    expect(await quantity()).toBe(1);
    await expect(
      c.inspect.mutate({ labelId: ids[0], outcome: "stocked" })
    ).rejects.toThrow(/検品待ち/);
    expect(
      (await c.undoPreview.query({ kind: "receive", labelIds: [ids[0]] }))
        .summary.rejected
    ).toBe(1);
    expect(
      await c.undo.mutate({ kind: "inspection", labelIds: [ids[0], ids[0]] })
    ).toMatchObject({ restored: [ids[0]], inventoryRollback: 1 });
    expect(await quantity()).toBe(0);
    expect(await stored(ids[0])).toMatchObject({ status: "received" });
    expect(
      await rows(
        "SELECT cancelled FROM purchase_histories WHERE inventoryId=910001"
      )
    ).toEqual([{ cancelled: 1 }]);
    expect(
      await c.undo.mutate({ kind: "inspection", labelIds: [ids[0]] })
    ).toMatchObject({ restored: [] });
    expect(
      await c.undo.mutate({ kind: "receive", labelIds: [ids[0]] })
    ).toMatchObject({ restored: [ids[0]] });
    expect(await stored(ids[0])).toMatchObject({
      status: "ordered",
      receivedAt: null,
    });
    expect(await quantity()).toBe(0);
    expect(await stored(ids[1])).toEqual(untouched);
  });
  it("発注登録側で計上済みなら検品OK・取消とも二重に数量を変更しない", async () => {
    const c = api.client.inventory.inboundDesk;
    const { ids } = await prepare();
    await api.client.inventory.orderManagement.receivePurchaseLabel.mutate({
      labelId: ids[0],
    });
    expect(await quantity()).toBe(1);
    expect(
      await c.inspect.mutate({ labelId: ids[0], outcome: "stocked" })
    ).toMatchObject({ inventoryCountChanged: false });
    expect(await quantity()).toBe(1);
    expect(
      await c.undo.mutate({ kind: "inspection", labelIds: [ids[0]] })
    ).toMatchObject({ inventoryRollback: 0 });
    expect(await quantity()).toBe(1);
  });
  it("返品と代替依頼を取り消すと、計上済み数量を戻し未完了依頼だけ取消記録にする", async () => {
    const c = api.client.inventory.inboundDesk;
    const { ids } = await prepare();
    await api.client.inventory.orderManagement.receivePurchaseLabel.mutate({
      labelId: ids[0],
    });
    const inspected = await c.inspect.mutate({
      labelId: ids[0],
      outcome: "returned",
      requestReplacement: true,
    });
    expect(await quantity()).toBe(0);
    expect(inspected.actionItemId).toBeGreaterThan(0);
    const undone = await c.undo.mutate({
      kind: "inspection",
      labelIds: [ids[0]],
    });
    expect(undone).toMatchObject({
      restored: [ids[0]],
      inventoryRollback: 1,
      actionItemsCancelled: 1,
    });
    expect(await quantity()).toBe(1);
    expect(
      await rows("SELECT status,detail FROM action_items WHERE id=?", [
        inspected.actionItemId,
      ])
    ).toMatchObject([
      { status: "done", detail: expect.stringContaining("未完了依頼を取消") },
    ]);
  });
  it("数量が不足した取消はトランザクションを戻し、出庫済み・未登録を拒否する", async () => {
    const c = api.client.inventory.inboundDesk;
    const { ids } = await prepare();
    await c.receive.mutate({ labelIds: [ids[0]] });
    await c.inspect.mutate({ labelId: ids[0], outcome: "stocked" });
    await db.query("UPDATE local_inventories SET quantity=0 WHERE id=910001");
    const before = await stored(ids[0]);
    expect(
      await c.undo.mutate({ kind: "inspection", labelIds: [ids[0]] })
    ).toMatchObject({
      restored: [],
      rejected: [{ reason: expect.stringContaining("在庫数") }],
    });
    expect(await stored(ids[0])).toEqual(before);
    await db.query(
      "UPDATE inventory_item_labels SET status='shipped' WHERE labelId=?",
      [ids[0]]
    );
    expect(
      (
        await c.undoPreview.query({
          kind: "inspection",
          labelIds: [ids[0], "MISSING"],
        })
      ).summary
    ).toMatchObject({ undoable: 0, rejected: 2 });
    expect(await quantity()).toBe(0);
  });
  it("ジャンクは別在庫へ移し、取消で元の個体に戻して出品用在庫を無効にする", async () => {
    const c = api.client.inventory.inboundDesk;
    const { ids } = await prepare();
    await c.receive.mutate({ labelIds: [ids[0]] });
    await expect(
      c.inspect.mutate({ labelId: ids[0], outcome: "junk" })
    ).rejects.toThrow(/不良タグ/);
    expect(await quantity()).toBe(0);
    const inspected = await c.inspect.mutate({
      labelId: ids[0],
      outcome: "junk",
      defectTags: ["通電せず"],
      requestReplacement: true,
    });
    expect(inspected.localInventoryId).not.toBe(910001);
    expect(
      await rows(
        "SELECT quantity,isDeleted FROM local_inventories WHERE id=?",
        [inspected.localInventoryId]
      )
    ).toMatchObject([{ quantity: 1, isDeleted: 0 }]);
    await db.query(
      "UPDATE action_items SET status='done',completedAt=NOW() WHERE id=?",
      [inspected.actionItemId]
    );
    expect(
      await c.undo.mutate({ kind: "inspection", labelIds: [ids[0]] })
    ).toMatchObject({ restored: [ids[0]], actionItemsRetained: 1 });
    expect(await stored(ids[0])).toMatchObject({
      status: "received",
      localInventoryId: 910001,
      defectTags: null,
    });
    expect(
      await rows(
        "SELECT quantity,isDeleted FROM local_inventories WHERE id=?",
        [inspected.localInventoryId]
      )
    ).toMatchObject([{ quantity: 0, isDeleted: 1 }]);
    expect(
      await rows("SELECT detail FROM action_items WHERE id=?", [
        inspected.actionItemId,
      ])
    ).toMatchObject([
      { detail: expect.stringContaining("完了済みのため記録を保持") },
    ]);
  });
});
