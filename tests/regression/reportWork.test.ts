import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

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
const worker = { workerName: " 架空  担当 ", category: "架空作業" };
const report = {
  yearMonth: "2026-09",
  label: "架空棚卸",
  inventorySummaryJson: JSON.stringify([
    {
      category: "架空",
      title: "架空品",
      quantity: 3,
      unitPrice: 120,
      totalValue: 360,
    },
  ]),
  invoiceListJson: JSON.stringify([
    {
      invoiceNo: "1",
      stockItems: [{ inventoryId: 1, quantity: 1, unitPrice: 120 }],
      purchaseItems: [{ quantity: 2, unitPrice: 50 }],
    },
  ]),
};

describe("棚卸と作業管理の保存契約", () => {
  it("棚卸のJSON・単価の上書き/解除を再取得し、削除は対象だけに効く", async () => {
    const c = api.client.inventory.monthlyReport;
    await c.save.mutate(report);
    const id = (await c.list.query())[0].id;
    await c.save.mutate({ ...report, label: "保持" });
    const other = {
      id: (await c.list.query()).find(r => r.label === "保持")!.id,
    };
    const untouched = await c.get.query(other);
    expect(await c.get.query({ id })).toMatchObject(report);
    const cost = {
      reportId: id,
      invoiceKey: "1",
      itemKey: "ordered__1",
      quantity: 3,
      unitPrice: 12.5,
    };
    await c.upsertCost.mutate(cost);
    expect((await c.get.query({ id }))!.costs).toHaveLength(1);
    expect(Number((await c.get.query({ id }))!.costs[0].subtotal)).toBe(37.5);
    await c.upsertCost.mutate({ ...cost, unitPrice: 0, quantity: 0 });
    expect(Number((await c.get.query({ id }))!.costs[0].subtotal)).toBe(0);
    await c.upsertCost.mutate({ ...cost, unitPrice: null });
    expect((await c.get.query({ id }))!.costs).toMatchObject([
      { unitPrice: null, subtotal: null },
    ]);
    await c.delete.mutate({ id });
    expect(await c.get.query({ id })).toBeNull();
    expect(await c.get.query(other)).toEqual(untouched);
    expect((await c.list.query()).map(r => r.id)).toEqual([other.id]);
  });

  it("日次保存の重複抑止・強制保存・月次一覧からの除外と不正JSONを保持", async () => {
    const c = api.client.inventory.snapshot;
    const input = {
      inventorySummaryJson: report.inventorySummaryJson,
      invoiceListJson: report.invoiceListJson,
      date: "2026-09-30",
    };
    const saved = await c.capture.mutate(input);
    expect(saved).toMatchObject({ saved: true, date: input.date });
    expect(await c.capture.mutate(input)).toEqual({
      saved: false,
      date: input.date,
      reason: "already_exists",
    });
    expect(await c.capture.mutate({ ...input, force: true })).toMatchObject({
      saved: true,
    });
    expect(await api.client.inventory.monthlyReport.list.query()).toEqual([]);
    expect(
      await api.client.inventory.monthlyReport.list.query({
        includeDaily: true,
      })
    ).toHaveLength(2);
    const snapshots = await c.list.query();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].breakdown).toMatchObject({
      totalAmount: 360,
      assignedAmount: 120,
      unassignedAmount: 240,
      onOrderAmount: 100,
    });
    await expect(
      c.capture.mutate({ ...input, date: "2026-10-01", invoiceListJson: "{" })
    ).rejects.toThrow();
    expect(await c.list.query()).toHaveLength(2);
  });

  it("作業の開始・実績の追記・終了・編集を再取得し、他担当に触れない", async () => {
    const c = api.client.inventory.workLogs;
    await c.start.mutate(worker);
    const id = (await c.list.query({ status: "running" }))[0].id;
    await c.start.mutate({ ...worker, workerName: "別担当" });
    const other = (await c.list.query()).find(r => r.workerName === "別担当")!;
    for (const sourceId of ["a", "b", "b"])
      await c.create.mutate({
        ...worker,
        manualMinutes: 10,
        quantity: 2,
        sourceType: "delivery",
        sourceId,
        detailsJson: JSON.stringify({ items: [{ title: sourceId }] }),
      });
    let log = (await c.list.query()).find(r => r.id === id)!;
    expect(log).toMatchObject({
      workerName: "架空 担当",
      status: "running",
      quantity: 6,
      sourceId: "a, b",
    });
    expect(JSON.parse(log.detailsJson!).items).toHaveLength(3);
    await expect(
      c.split.mutate({ id, category: "分割", manualMinutes: 1 })
    ).rejects.toThrow(/終了/);
    await c.finish.mutate({ id, manualMinutes: 60, memo: " 完了 " });
    log = (await c.list.query({ status: "done" }))[0];
    expect(log).toMatchObject({
      id,
      quantity: 6,
      manualMinutes: 60,
      memo: "完了",
    });
    expect(log.endedAt).toBeInstanceOf(Date);
    await c.update.mutate({
      ...worker,
      id,
      manualMinutes: 45,
      quantity: 5,
      memo: "編集",
    });
    expect((await c.list.query()).find(r => r.id === id)).toMatchObject({
      manualMinutes: 45,
      quantity: 5,
      memo: "編集",
      sourceId: null,
    });
    await c.delete.mutate({ id });
    expect(await c.list.query()).toEqual([other]);
  });

  it("作業分割は時間・数量・日時を移し、時間超過や不正入力では保存しない", async () => {
    const c = api.client.inventory.workLogs;
    await expect(c.create.mutate(worker)).rejects.toThrow(/作業時間/);
    await expect(
      c.create.mutate({ ...worker, startedAt: "invalid", manualMinutes: 10 })
    ).rejects.toThrow(/日時/);
    await expect(
      c.create.mutate({
        ...worker,
        startedAt: "2026-09-30T03:00:00Z",
        endedAt: "2026-09-30T02:00:00Z",
      })
    ).rejects.toThrow(/終了/);
    expect(await c.list.query()).toEqual([]);
    await c.create.mutate({
      ...worker,
      startedAt: "2026-09-30T01:00:00Z",
      endedAt: "2026-09-30T02:00:00Z",
      quantity: 10,
      memo: "元",
    });
    const before = (await c.list.query())[0];
    await expect(
      c.split.mutate({ id: before.id, category: "分割", manualMinutes: 61 })
    ).rejects.toThrow(/超え/);
    expect(await c.list.query()).toEqual([before]);
    await c.split.mutate({
      id: before.id,
      category: "分割",
      manualMinutes: 20,
      quantity: 3,
    });
    const rows = await c.list.query();
    const original = rows.find(r => r.id === before.id)!;
    const split = rows.find(r => r.id !== before.id)!;
    expect(original).toMatchObject({ manualMinutes: 40, quantity: 7 });
    expect(split).toMatchObject({
      manualMinutes: 20,
      quantity: 3,
      sourceType: "split",
      sourceId: String(before.id),
    });
    expect(original.endedAt).toEqual(split.startedAt);
    expect(split.endedAt).toEqual(before.endedAt);
    expect(
      (await c.options.query()).categories.some(r => r.name === "分割")
    ).toBe(true);
  });
});
