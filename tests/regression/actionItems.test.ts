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
const input = {
  title: "  架空  作業  ",
  assignee: "全員",
  detail: "  確認\nしてください  ",
  createdBy: "架空担当",
  saveTitlePreset: true,
};
const attachment = {
  fileName: "  test  image.png ",
  contentType: "IMAGE/PNG",
  dataBase64: "data:image/png;base64,Y Q==\n",
};
const all = () =>
  api.client.inventory.actionItems.list.query({ status: "all" });
async function rows(sql: string, values: unknown[] = []) {
  return (await db.query<RowDataPacket[]>(sql, values))[0];
}

describe("やることの保存・状態・添付の既存契約", () => {
  it("作成・編集・返信・確認・完了と再開を再取得でき、別の項目を保持する", async () => {
    const client = api.client.inventory.actionItems;
    const created = await client.create.mutate(input);
    const other = await client.create.mutate({
      ...input,
      title: "無関係な項目",
    });
    const untouched = (await all()).find(row => row.id === other.id);
    expect((await all()).find(row => row.id === created.id)).toMatchObject({
      title: "架空 作業",
      detail: "確認\nしてください",
      status: "open",
      createdBy: "架空担当",
    });
    await client.update.mutate({
      id: created.id,
      title: "編集済み",
      assignee: "出荷担当",
      detail: "更新内容",
      createdBy: "",
    });
    await client.createReply.mutate({
      actionItemId: created.id,
      body: "  返信本文  ",
      author: " 架空  返信者 ",
    });
    let saved = (await all()).find(row => row.id === created.id)!;
    expect(saved).toMatchObject({
      title: "編集済み",
      createdBy: null,
      replies: [{ body: "返信本文", author: "架空 返信者" }],
    });
    await client.updateReply.mutate({
      id: saved.replies[0].id,
      body: "  修正返信  ",
      author: "",
    });
    await db.query("UPDATE action_items SET reviewerChecksJson=? WHERE id=?", [
      JSON.stringify({ "": true, 村上さん: true }),
      created.id,
    ]);
    await client.setReviewerCheck.mutate({
      id: created.id,
      reviewer: "鈴木さん",
      checked: true,
    });
    await client.setPinned.mutate({ id: created.id, pinned: true });
    expect((await all())[0].id).toBe(created.id);
    await client.setStatus.mutate({ id: created.id, status: "done" });
    saved = (await client.list.query({ status: "done" }))[0];
    expect(saved.completedAt).toBeInstanceOf(Date);
    expect(JSON.parse(saved.reviewerChecksJson!)).toEqual({
      村上さん: true,
      鈴木さん: true,
    });
    expect(saved.replies[0]).toMatchObject({ body: "修正返信", author: null });
    expect((await client.list.query()).map(row => row.id)).toEqual([other.id]);
    await client.setStatus.mutate({ id: created.id, status: "open" });
    expect((await all()).find(row => row.id === created.id)).toMatchObject({
      completedAt: null,
      status: "open",
    });
    expect((await all()).find(row => row.id === other.id)).toEqual(untouched);
  });

  it("添付検証は保存前に失敗し、有効な添付・返信は対象項目と一緒に削除する", async () => {
    const client = api.client.inventory.actionItems;
    await expect(
      client.create.mutate({
        ...input,
        attachments: [{ ...attachment, contentType: "text/plain" }],
      })
    ).rejects.toThrow(/画像ファイル/);
    await expect(
      client.create.mutate({
        ...input,
        attachments: [{ ...attachment, dataBase64: "??" }],
      })
    ).rejects.toThrow(/形式/);
    await expect(
      client.create.mutate({
        ...input,
        attachments: Array.from({ length: 11 }, () => attachment),
      })
    ).rejects.toThrow();
    expect(await all()).toEqual([]);
    const created = await client.create.mutate({
      ...input,
      attachments: [attachment],
    });
    const other = await client.create.mutate({
      ...input,
      title: "保持する添付",
      attachments: [attachment],
    });
    await client.addAttachments.mutate({
      actionItemId: created.id,
      attachments: [attachment],
      createdBy: "架空担当",
    });
    const saved = (await all()).find(row => row.id === created.id)!;
    expect(saved.attachments).toHaveLength(2);
    expect(saved.attachments[0]).toMatchObject({
      fileName: "test image.png",
      contentType: "image/png",
      url: `/api/action-item-attachments/${saved.attachments[0].id}`,
    });
    expect(saved.attachments[0]).not.toHaveProperty("dataBase64");
    expect(
      await rows(
        "SELECT dataBase64 FROM action_item_attachments WHERE actionItemId=?",
        [created.id]
      )
    ).toEqual([{ dataBase64: "YQ==" }, { dataBase64: "YQ==" }]);
    await client.deleteAttachment.mutate({ id: saved.attachments[0].id });
    await client.createReply.mutate({
      actionItemId: created.id,
      body: "削除対象返信",
      author: "架空担当",
    });
    await client.delete.mutate({ id: created.id });
    expect(
      await rows("SELECT id FROM action_item_replies WHERE actionItemId=?", [
        created.id,
      ])
    ).toEqual([]);
    expect(
      await rows(
        "SELECT id FROM action_item_attachments WHERE actionItemId=?",
        [created.id]
      )
    ).toEqual([]);
    expect((await all()).map(row => row.id)).toEqual([other.id]);
    expect((await all())[0].attachments).toHaveLength(1);
  });

  it("初期担当を削除できず、追加した担当・タイトル・記入者の候補を再取得できる", async () => {
    const client = api.client.inventory.actionItems;
    for (const name of [
      "全員",
      "仕入れ担当",
      "荷受担当",
      "出荷担当",
      "架空追加担当",
      "その他",
    ])
      await client.addAssignee.mutate({ name });
    await client.create.mutate(input);
    await client.addTitlePreset.mutate({ title: " 架空  定型 " });
    await client.addAuthor.mutate({ name: " 架空  追加者 " });
    const options = await client.options.query();
    expect(options.assignees.some(row => row.name === "その他")).toBe(false);
    expect(options.titles.map(row => row.title)).toEqual(
      expect.arrayContaining(["架空 作業", "架空 定型"])
    );
    expect(options.authors.map(row => row.name)).toEqual(
      expect.arrayContaining(["架空担当", "架空 追加者"])
    );
    for (const name of ["全員", "仕入れ担当", "荷受担当", "出荷担当"]) {
      await expect(
        client.deleteAssignee.mutate({
          id: options.assignees.find(row => row.name === name)!.id,
        })
      ).rejects.toThrow(/初期宛先/);
    }
    await client.deleteAssignee.mutate({
      id: options.assignees.find(row => row.name === "架空追加担当")!.id,
    });
    expect(
      (await client.options.query()).assignees.some(
        row => row.name === "架空追加担当"
      )
    ).toBe(false);
  });
});
