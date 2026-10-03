import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

/**
 * 認証・設定・共通基盤領域の整理前基準。
 * server/routers.ts（authGate / auth / quoteProxy）と server/inventory/routers.ts の
 * インラインブロック（auth / purchaseExtra / invoiceManualItem / domesticProduct /
 * monthlyDomesticItem / customer / accessCode / admin）を専用ファイルへ移す前後で、
 * 同じ入力に対する応答・DB保存値が変わらないことを固定する。
 * テスト環境は LOCAL_AUTH_BYPASS=true（ctx.user は Local Developer / 管理者メール）。
 * quoteProxy のローカルバイパスは NODE_ENV=development 条件のため、テスト内で
 * 一時的に NODE_ENV を切り替えて両経路（拒否・バイパス）を固定する。
 */

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

async function rows(sql: string, params: unknown[] = []) {
  const [result] = await db.query<RowDataPacket[]>(sql, params);
  return result;
}

const localDevUser = {
  id: 0,
  openId: "local-dev",
  name: "Local Developer",
  email: "07.hajime.tokyo@gmail.com",
  loginMethod: "local",
  role: "admin",
};

describe("authGate: ローカルバイパス経路の契約", () => {
  it("checkVerifiedはバイパス時に verified/loggedIn=true と Local Developer を返す", async () => {
    const res = await api.client.authGate.checkVerified.query();
    expect(res.verified).toBe(true);
    expect(res.loggedIn).toBe(true);
    expect(res.user).toMatchObject(localDevUser);
  });

  it("loginWithEmailはバイパス時に即successを返し、usersテーブルには書き込まない", async () => {
    const res = await api.client.authGate.loginWithEmail.mutate({
      email: "someone@example.com",
    });
    expect(res).toEqual({ success: true, message: "ログインしました" });
    expect(await rows("SELECT * FROM users")).toHaveLength(0);
  });
});

describe("auth.me / auth.logout（appRouter直下）", () => {
  it("meはコンテキストのユーザーを返し、logoutはsuccessを返す", async () => {
    const me = await api.client.auth.me.query();
    expect(me).toMatchObject(localDevUser);
    expect(await api.client.auth.logout.mutate()).toEqual({ success: true });
  });
});

describe("inventory.auth: me / logout / checkAuthorized / authorize", () => {
  it("me・logoutはappRouter直下authと同じ契約を持つ", async () => {
    const me = await api.client.inventory.auth.me.query();
    expect(me).toMatchObject(localDevUser);
    expect(await api.client.inventory.auth.logout.mutate()).toEqual({ success: true });
  });

  it("access_code未設定時のauthorizeはどんなコードでも valid:true で認証登録する", async () => {
    expect(await api.client.inventory.auth.checkAuthorized.query()).toEqual({
      authorized: false,
    });
    expect(
      await api.client.inventory.auth.authorize.mutate({ code: "でたらめ" }),
    ).toEqual({ valid: true });
    const saved = await rows("SELECT openId, name, email FROM authorized_users");
    expect(saved).toHaveLength(1);
    expect(saved[0].openId).toBe("local-dev");
    expect(saved[0].name).toBe("Local Developer");
    expect(saved[0].email).toBe("07.hajime.tokyo@gmail.com");
    expect(await api.client.inventory.auth.checkAuthorized.query()).toEqual({
      authorized: true,
    });
  });

  it("access_code設定時のauthorizeは不一致をvalid:falseで拒否し、一致時のみ登録する", async () => {
    await api.client.inventory.accessCode.set.mutate({ code: "gate-1" });
    expect(
      await api.client.inventory.auth.authorize.mutate({ code: "wrong" }),
    ).toEqual({ valid: false });
    expect(await rows("SELECT * FROM authorized_users")).toHaveLength(0);
    expect(
      await api.client.inventory.auth.authorize.mutate({ code: "gate-1" }),
    ).toEqual({ valid: true });
    expect(await rows("SELECT * FROM authorized_users")).toHaveLength(1);
  });
});

describe("inventory.accessCode: 設定→検証→解除の往復", () => {
  it("未設定時のverifyは常にvalid:true、設定後は一致判定、空保存で解除される", async () => {
    expect(
      await api.client.inventory.accessCode.verify.mutate({ code: "anything" }),
    ).toEqual({ valid: true });
    expect(await api.client.inventory.accessCode.isSet.query()).toEqual({ isSet: false });

    // 前後空白はトリムして保存される
    expect(
      await api.client.inventory.accessCode.set.mutate({ code: "  secret-1  " }),
    ).toEqual({ success: true });
    const saved = await rows(
      "SELECT `value` FROM system_settings WHERE `key` = 'access_code'",
    );
    expect(saved[0].value).toBe("secret-1");
    expect(await api.client.inventory.accessCode.isSet.query()).toEqual({ isSet: true });
    expect(
      await api.client.inventory.accessCode.verify.mutate({ code: "secret-1" }),
    ).toEqual({ valid: true });
    expect(
      await api.client.inventory.accessCode.verify.mutate({ code: "typo" }),
    ).toEqual({ valid: false });

    // 空文字で保存すると空値の行が残り、未設定扱い（常に通過）に戻る
    expect(await api.client.inventory.accessCode.set.mutate({ code: "   " })).toEqual({
      success: true,
    });
    const cleared = await rows(
      "SELECT `value` FROM system_settings WHERE `key` = 'access_code'",
    );
    expect(cleared).toHaveLength(1);
    expect(cleared[0].value).toBe("");
    expect(await api.client.inventory.accessCode.isSet.query()).toEqual({ isSet: false });
    expect(
      await api.client.inventory.accessCode.verify.mutate({ code: "anything" }),
    ).toEqual({ valid: true });
  });
});

describe("inventory.admin.isAdmin", () => {
  it("ローカル開発ユーザー（管理者メール）はisAdmin:trueを返す", async () => {
    expect(await api.client.inventory.admin.isAdmin.query()).toEqual({ isAdmin: true });
  });
});

describe("inventory.customer: 取引先マスタCRUD", () => {
  it("create→list→update→deleteの契約と並び順（sortOrder, displayName）を維持する", async () => {
    expect(
      await api.client.inventory.customer.create.mutate({
        displayName: "ルカ",
        code: "luca",
        keywords: "ルカ,luca",
        sortOrder: 2,
      }),
    ).toEqual({ success: true });
    await api.client.inventory.customer.create.mutate({
      displayName: "サミー",
      code: "sammy",
      keywords: "サミー",
      sortOrder: 1,
    });
    const listed = await api.client.inventory.customer.list.query();
    expect(listed.map((c: { displayName: string }) => c.displayName)).toEqual([
      "サミー",
      "ルカ",
    ]);
    const luca = listed.find((c: { code: string }) => c.code === "luca")!;
    expect(luca.keywords).toBe("ルカ,luca");
    expect(luca.sortOrder).toBe(2);

    expect(
      await api.client.inventory.customer.update.mutate({
        id: luca.id,
        keywords: "ルカ,luca,Luca",
      }),
    ).toEqual({ success: true });
    const updated = await rows("SELECT displayName, code, keywords FROM customers WHERE id = ?", [luca.id]);
    expect(updated[0].keywords).toBe("ルカ,luca,Luca");
    expect(updated[0].displayName).toBe("ルカ");

    expect(await api.client.inventory.customer.delete.mutate({ id: luca.id })).toEqual({
      success: true,
    });
    expect(await rows("SELECT id FROM customers")).toHaveLength(1);
  });
});

describe("inventory.domesticProduct: 国内卸商品マスタCRUD", () => {
  it("createはnull許容項目を保存し、updateのunitPrice未指定はnull上書き（既存挙動）", async () => {
    const created = await api.client.inventory.domesticProduct.create.mutate({
      title: "New3DSLL 本体",
      unitPrice: 3500,
      supplierName: "toynet",
      note: "メモ",
    });
    expect(created.success).toBe(true);
    expect(created.insertId).toBeGreaterThan(0);
    const listed = await api.client.inventory.domesticProduct.list.query();
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe("New3DSLL 本体");
    expect(Number(listed[0].unitPrice)).toBe(3500);
    expect(listed[0].supplierName).toBe("toynet");

    // unitPriceを渡さない更新は unitPrice が null に戻る（既存挙動として固定）
    expect(
      await api.client.inventory.domesticProduct.update.mutate({
        id: created.insertId!,
        title: "New3DSLL 本体（改）",
      }),
    ).toEqual({ success: true });
    const updated = await rows("SELECT title, unit_price AS unitPrice, supplier_name AS supplierName FROM domestic_products");
    expect(updated[0].title).toBe("New3DSLL 本体（改）");
    expect(updated[0].unitPrice).toBeNull();
    expect(updated[0].supplierName).toBe("toynet");

    expect(
      await api.client.inventory.domesticProduct.delete.mutate({ id: created.insertId! }),
    ).toEqual({ success: true });
    expect(await rows("SELECT id FROM domestic_products")).toHaveLength(0);
  });
});

describe("inventory.monthlyDomesticItem: 月次国内卸発注行CRUD", () => {
  it("createは文字列unitPriceを数値化し、listは年月で絞り込む", async () => {
    const created = await api.client.inventory.monthlyDomesticItem.create.mutate({
      yearMonth: "2026-09",
      title: "国内卸A",
      quantity: 3,
      unitPrice: "1200.5",
      supplierName: "toynet",
    });
    expect(created.success).toBe(true);
    await api.client.inventory.monthlyDomesticItem.create.mutate({
      yearMonth: "2026-09",
      title: "国内卸B",
      unitPrice: "",
    });
    await api.client.inventory.monthlyDomesticItem.create.mutate({
      yearMonth: "2026-10",
      title: "来月分",
    });
    const sept = await api.client.inventory.monthlyDomesticItem.list.query({
      yearMonth: "2026-09",
    });
    expect(sept.map((m: { title: string }) => m.title)).toEqual(["国内卸A", "国内卸B"]);
    expect(Number(sept[0].unitPrice)).toBe(1200.5);
    expect(sept[0].quantity).toBe(3);
    expect(sept[1].unitPrice).toBeNull();
    expect(sept[1].quantity).toBe(1);
    expect(
      await api.client.inventory.monthlyDomesticItem.list.query({ yearMonth: "2026-10" }),
    ).toHaveLength(1);
  });

  it("updateは指定項目のみ更新し、isPaid/togglePaidは1/0で保存する", async () => {
    const created = await api.client.inventory.monthlyDomesticItem.create.mutate({
      yearMonth: "2026-09",
      title: "国内卸A",
      unitPrice: 999,
    });
    const id = created.insertId!;
    expect(
      await api.client.inventory.monthlyDomesticItem.update.mutate({
        id,
        title: "国内卸A改",
        isPaid: true,
      }),
    ).toEqual({ success: true });
    let saved = await rows("SELECT title, unit_price AS unitPrice, is_paid AS isPaid FROM monthly_domestic_items WHERE id = ?", [id]);
    expect(saved[0].title).toBe("国内卸A改");
    // updateで未指定のunitPriceは保持される（monthlyDomesticItemはpatch方式）
    expect(Number(saved[0].unitPrice)).toBe(999);
    expect(saved[0].isPaid).toBe(1);

    expect(
      await api.client.inventory.monthlyDomesticItem.togglePaid.mutate({ id, isPaid: false }),
    ).toEqual({ success: true });
    saved = await rows("SELECT is_paid AS isPaid FROM monthly_domestic_items WHERE id = ?", [id]);
    expect(saved[0].isPaid).toBe(0);

    expect(
      await api.client.inventory.monthlyDomesticItem.delete.mutate({ id }),
    ).toEqual({ success: true });
    expect(await rows("SELECT id FROM monthly_domestic_items")).toHaveLength(0);
  });
});

describe("inventory.invoiceManualItem: 手動入力行CRUD", () => {
  it("createのデフォルト値とlist/listByInvoiceNosの絞り込み・並び順を維持する", async () => {
    const first = await api.client.inventory.invoiceManualItem.create.mutate({
      invoiceNo: "500",
      title: "手動行A",
      quantity: 2,
      unitPrice: 120,
      sortOrder: 5,
    });
    expect(first.success).toBe(true);
    await api.client.inventory.invoiceManualItem.create.mutate({
      invoiceNo: "500",
      sortOrder: 1,
    });
    await api.client.inventory.invoiceManualItem.create.mutate({
      invoiceNo: "501",
      title: "別インボイス",
    });
    const listed = await api.client.inventory.invoiceManualItem.list.query({
      invoiceNo: "500",
    });
    // sortOrder昇順
    expect(listed.map((i: { title: string }) => i.title)).toEqual(["", "手動行A"]);
    expect(listed[1].quantity).toBe(2);
    expect(Number(listed[1].unitPrice)).toBe(120);
    expect(listed[0].quantity).toBe(1);
    expect(listed[0].unitPrice).toBeNull();

    const both = await api.client.inventory.invoiceManualItem.listByInvoiceNos.query({
      invoiceNos: ["500", "501"],
    });
    expect(both).toHaveLength(3);
    expect(
      await api.client.inventory.invoiceManualItem.listByInvoiceNos.query({ invoiceNos: [] }),
    ).toEqual([]);
  });

  it("updateのunitPrice未指定はnull上書き（既存挙動）、deleteで行が消える", async () => {
    const created = await api.client.inventory.invoiceManualItem.create.mutate({
      invoiceNo: "500",
      title: "手動行A",
      unitPrice: 120,
    });
    const id = created.insertId!;
    expect(
      await api.client.inventory.invoiceManualItem.update.mutate({ id, title: "改" }),
    ).toEqual({ success: true });
    const saved = await rows("SELECT title, unit_price AS unitPrice FROM invoice_manual_items WHERE id = ?", [id]);
    expect(saved[0].title).toBe("改");
    expect(saved[0].unitPrice).toBeNull();
    expect(
      await api.client.inventory.invoiceManualItem.delete.mutate({ id }),
    ).toEqual({ success: true });
    expect(await rows("SELECT id FROM invoice_manual_items")).toHaveLength(0);
  });
});

describe("inventory.purchaseExtra: 追跡情報の保存契約", () => {
  it("upsertはローカル発注へ同期し、localUpdatedCountを返す", async () => {
    const res = await api.client.inventory.purchaseExtra.upsert.mutate({
      zaicoId: 910003,
      trackingNumber: " C-TRACK-1 ",
      carrier: " ヤマト ",
    });
    expect(res).toEqual({ success: true, localUpdatedCount: 1 });
    const saved = await rows(
      "SELECT trackingNumber, carrier, status FROM local_purchases WHERE id = 910003",
    );
    expect(saved[0].trackingNumber).toBe("C-TRACK-1");
    expect(saved[0].carrier).toBe("ヤマト");
    expect(saved[0].status).toBe("shipped");
  });

  it("upsertBulkは複数IDへ同じ更新を適用し、countと合計更新数を返す", async () => {
    const res = await api.client.inventory.purchaseExtra.upsertBulk.mutate({
      zaicoIds: [910001, 910003],
      carrier: "佐川",
    });
    expect(res).toEqual({ success: true, count: 2, localUpdatedCount: 2 });
    const saved = await rows(
      "SELECT id, carrier FROM local_purchases WHERE id IN (910001, 910003) ORDER BY id",
    );
    expect(saved.map(r => [r.id, r.carrier])).toEqual([
      [910001, "佐川"],
      [910003, "佐川"],
    ]);
  });
});

describe("quoteProxy: プロキシキー検証とローカルバイパス経路", () => {
  it("NODE_ENV=testではキー未設定でもUNAUTHORIZEDで拒否する", async () => {
    await expect(api.client.quoteProxy.invoiceClientsList.query()).rejects.toThrow(
      /Invoice proxy key is invalid/,
    );
  });

  it("NODE_ENV=development・キー未設定時はバイパスし、採番・作成・重複拒否が機能する", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      expect(await api.client.quoteProxy.invoiceClientsList.query()).toEqual([]);
      const next = await api.client.quoteProxy.invoicesGetNextNumber.query();
      expect(next).toMatch(/^INV-\d{8}-001$/);
      const created = await api.client.quoteProxy.invoicesCreate.mutate({
        invoiceNumber: "INV-TEST-001",
        currency: "EUR",
        showAmounts: false,
        status: "draft",
        items: [
          { description: "Test Console X", quantity: 2, unitPrice: 100, tax: 0 },
        ],
      });
      expect(created.id).toBeGreaterThan(0);
      const invoice = await rows("SELECT invoiceNumber, currency, status, accentColor FROM invoices");
      expect(invoice).toHaveLength(1);
      expect(invoice[0].invoiceNumber).toBe("INV-TEST-001");
      expect(invoice[0].currency).toBe("EUR");
      expect(invoice[0].status).toBe("draft");
      expect(invoice[0].accentColor).toBe("#db8b1a");
      const items = await rows("SELECT invoiceId, description, quantity, unitPrice, sortOrder, tax FROM invoice_items");
      expect(items).toHaveLength(1);
      expect(items[0].invoiceId).toBe(created.id);
      expect(items[0].description).toBe("Test Console X");
      expect(Number(items[0].quantity)).toBe(2);
      expect(Number(items[0].unitPrice)).toBe(100);
      expect(items[0].sortOrder).toBe(0);
      expect(Number(items[0].tax)).toBe(0);

      // 同一番号の未削除インボイスが存在する場合はCONFLICT
      await expect(
        api.client.quoteProxy.invoicesCreate.mutate({
          invoiceNumber: "INV-TEST-001",
          currency: "EUR",
          showAmounts: false,
          status: "draft",
          items: [],
        }),
      ).rejects.toThrow(/既に存在します/);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });
});
