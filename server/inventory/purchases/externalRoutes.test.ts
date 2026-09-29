import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../_core/context";
import type { InventoryExtra, PurchaseExtra } from "../../../drizzle/schema";
import type {
  ZaicoInventory,
  ZaicoPurchase,
  ZaicoPurchaseItem,
} from "../zaico";
import { inventoryRouter } from "../routers";

// 現在は無効の経路をテスト内だけで選ぶ。読取・ラベル保存・CSV通信は全て固定値に置き換える。
const source = vi.hoisted(() => ({
  purchases: vi.fn(),
  inventories: vi.fn(),
  extras: vi.fn(),
  inventoryExtras: vi.fn(),
  labels: vi.fn(),
  ensureLabels: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("../zaico", async importOriginal => ({
  ...(await importOriginal<typeof import("../zaico")>()),
  getPurchases: source.purchases,
  getInventories: source.inventories,
}));
vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../db")>()),
  isZaicoEnabled: vi.fn(async () => true),
  getAllPurchaseExtras: source.extras,
  getAllInventoryExtras: source.inventoryExtras,
  getInventoryItemLabelsByInventoryIds: source.labels,
  ensureInventoryItemLabelsForInventory: source.ensureLabels,
}));
vi.mock("../../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../../db")>()),
  getDb: vi.fn(async () => null),
}));

const date = new Date("2026-09-01T00:00:00.000Z");
const item = (
  inventory_id = 10,
  overrides: Partial<ZaicoPurchaseItem> = {}
): ZaicoPurchaseItem => ({
  id: inventory_id,
  inventory_id,
  title: "架空の商品",
  quantity: "2",
  unit: "個",
  unit_price: "1500.25",
  status: "ordered",
  purchase_date: "2026-09-01",
  estimated_purchase_date: null,
  etc: " ITEM ",
  ...overrides,
});
const purchase = (overrides: Partial<ZaicoPurchase> = {}): ZaicoPurchase => ({
  id: 1,
  num: "100",
  customer_name: "架空の取引先",
  status: "ordered",
  total_amount: 3000.5,
  purchase_date: "2026-09-01",
  estimated_purchase_date: null,
  create_user_name: "Test",
  created_at: date.toISOString(),
  updated_at: date.toISOString(),
  purchase_items: [item()],
  ...overrides,
});
const inventory = (
  overrides: Partial<ZaicoInventory> = {}
): ZaicoInventory => ({
  id: 10,
  title: "架空の商品",
  quantity: "0",
  unit: "個",
  category: "単一カテゴリ",
  categories: ["ゲーム機"],
  etc: " INV, 20260901, テスト店 ",
  created_at: date.toISOString(),
  updated_at: date.toISOString(),
  ...overrides,
});
const inventoryExtra = (
  overrides: Partial<InventoryExtra> = {}
): InventoryExtra => ({
  id: 1,
  zaicoInventoryId: 10,
  supplierName: "追加情報の仕入先",
  supplierUrl: "https://supplier.invalid/item",
  createdAt: date,
  updatedAt: date,
  ...overrides,
});
const extra = (overrides: Partial<PurchaseExtra> = {}): PurchaseExtra => ({
  id: 1,
  zaicoId: 1,
  shipDate: null,
  trackingNumber: "TEST-EXTERNAL",
  carrier: null,
  note: "架空メモ",
  createdAt: date,
  updatedAt: date,
  ...overrides,
});
const csvRow = (invoice: string, name: string) =>
  ["", "", invoice, ...Array(10).fill(""), name].join(",");
const csv = (...rows: string[]) =>
  ["header1", "header2", "header3", ...rows].join("\r\n");

const user: NonNullable<TrpcContext["user"]> = {
  id: 1,
  openId: "fixed-test-user",
  email: "test@example.invalid",
  name: "Test",
  loginMethod: "test",
  role: "user",
  createdAt: date,
  updatedAt: date,
  lastSignedIn: date,
};
const caller = inventoryRouter.createCaller({
  user,
  req: {} as TrpcContext["req"],
  res: {} as TrpcContext["res"],
});

beforeEach(() => {
  source.purchases.mockResolvedValue([purchase()]);
  source.inventories.mockResolvedValue([inventory()]);
  source.extras.mockResolvedValue([extra()]);
  source.inventoryExtras.mockResolvedValue([inventoryExtra()]);
  source.labels.mockResolvedValue(new Map());
  source.ensureLabels.mockImplementation(
    async ({ localInventoryId, title, legacyManagementNo }) => [
      {
        id: 5,
        labelId: "FIXED-LABEL",
        localInventoryId,
        title,
        legacyManagementNo,
        status: "ordered",
        hiddenField: "omit",
      },
    ]
  );
  source.fetch.mockImplementation(
    async () => new Response(csv(csvRow("100", "CSVの仕入先")))
  );
  vi.stubGlobal("fetch", source.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("外部在庫由来の一覧: 固定データによる整理前のAPI契約", () => {
  it("通常一覧だけがラベル・現在庫数を付け、全件取得だけがCSVを読む", async () => {
    const page = await caller.zaico.getPurchasesWithCategoryPage({});
    expect(page).toMatchObject({ totalCount: 1, grandTotal: 3000.5 });
    expect(page.items[0]).toMatchObject({
      csvSupplierName: "追加情報の仕入先",
      csvSupplierUrl: "https://supplier.invalid/item",
      extra: extra(),
    });
    expect(page.items[0].purchase_items[0]).toMatchObject({
      category: "ゲーム機",
      etc: "INV, 20260901, テスト店",
      currentInventoryQuantity: "0",
      itemLabels: [
        {
          id: 5,
          labelId: "FIXED-LABEL",
          localInventoryId: 10,
          legacyManagementNo: "INV",
          status: "ordered",
        },
      ],
    });
    expect(page.items[0].purchase_items[0].itemLabels[0]).not.toHaveProperty(
      "hiddenField"
    );
    expect(source.ensureLabels).toHaveBeenCalledTimes(1);
    expect(source.fetch).not.toHaveBeenCalled();
    const all = await caller.zaico.getPurchasesWithCategory();
    expect(all[0].purchase_items[0]).not.toHaveProperty(
      "currentInventoryQuantity"
    );
    expect(all[0].purchase_items[0]).not.toHaveProperty("itemLabels");
    expect(source.ensureLabels).toHaveBeenCalledTimes(1);
    expect(source.fetch).toHaveBeenCalledTimes(1);
  });

  it("最初に名前かURLがある追加情報を採用し、空文字の名前をCSVで置換しない", async () => {
    source.purchases.mockResolvedValue([
      purchase({ purchase_items: [item(10), item(20), item(30)] }),
    ]);
    source.inventoryExtras.mockResolvedValue([
      inventoryExtra({ supplierName: "  ", supplierUrl: null }),
      inventoryExtra({
        zaicoInventoryId: 20,
        supplierName: "",
        supplierUrl: "https://supplier.invalid/first",
      }),
      inventoryExtra({ zaicoInventoryId: 30, supplierName: "後の名前" }),
    ]);
    const page = await caller.zaico.getPurchasesWithCategoryPage({});
    const all = await caller.zaico.getPurchasesWithCategory();
    for (const row of [page.items[0], all[0]]) {
      expect(row).toMatchObject({
        csvSupplierName: "",
        csvSupplierUrl: "https://supplier.invalid/first",
      });
    }
  });

  it("CSVは先頭3行を飛ばし数字の番号の最初の非空名を採用する", async () => {
    source.inventoryExtras.mockResolvedValue([]);
    source.purchases.mockResolvedValue(
      ["100", "001", "bad", " 100 ", "200"].map((num, i) =>
        purchase({ id: i + 1, num })
      )
    );
    source.fetch.mockImplementation(
      async () =>
        new Response(
          [
            csvRow("200", "ヘッダーなので除外"),
            "header2",
            "header3",
            csvRow("100", "  "),
            csvRow("100", '"  架空, ""商店""  "'),
            csvRow("100", "上書き禁止"),
            csvRow("001", "先頭ゼロを保持"),
            csvRow("bad", "数字以外を除外"),
            "",
            "短い行",
          ].join("\r\n")
        )
    );
    const page = await caller.zaico.getPurchasesWithCategoryPage({});
    expect(page.items.every(row => row.csvSupplierName === null)).toBe(true);
    const all = await caller.zaico.getPurchasesWithCategory();
    expect(all.map(row => row.csvSupplierName)).toEqual([
      '架空, "商店"',
      "先頭ゼロを保持",
      null,
      null,
      null,
    ]);
  });

  it("追加情報の名前がnullなら全件取得だけCSVで補い、URLはそのまま保持する", async () => {
    source.inventoryExtras.mockResolvedValue([
      inventoryExtra({ supplierName: null }),
    ]);
    const page = await caller.zaico.getPurchasesWithCategoryPage({});
    const all = await caller.zaico.getPurchasesWithCategory();
    expect(page.items[0].csvSupplierName).toBeNull();
    expect(all[0]).toMatchObject({
      csvSupplierName: "CSVの仕入先",
      csvSupplierUrl: "https://supplier.invalid/item",
    });
  });

  it("先頭カテゴリが空文字でも単一カテゴリに置換しない", async () => {
    source.inventories.mockResolvedValue([
      inventory({ categories: [""], category: "置換禁止" }),
    ]);
    const page = await caller.zaico.getPurchasesWithCategoryPage({});
    const all = await caller.zaico.getPurchasesWithCategory();
    expect(page.items[0].purchase_items[0].category).toBe("");
    expect(all[0].purchase_items[0].category).toBe("");
  });

  it.each([
    [" ITEM, DATE, SHOP ", " INV, DATE, SHOP ", "ITEM, DATE, SHOP"],
    [" ITEM ", " INV, DATE, SHOP ", "INV, DATE, SHOP"],
    [" ITEM ", " INV ", "ITEM"],
    ["  ", " INV ", "INV"],
    [undefined, undefined, undefined],
  ])(
    "管理番号・備考の現行の優先順位を保持する (%#)",
    async (itemEtc, inventoryEtc, expected) => {
      source.purchases.mockResolvedValue([
        purchase({ purchase_items: [item(10, { etc: itemEtc })] }),
      ]);
      source.inventories.mockResolvedValue([inventory({ etc: inventoryEtc })]);
      const page = await caller.zaico.getPurchasesWithCategoryPage({});
      const all = await caller.zaico.getPurchasesWithCategory();
      expect(page.items[0].purchase_items[0].etc).toBe(expected);
      expect(all[0].purchase_items[0].etc).toBe(expected);
    }
  );

  it("同じIDが複数あると最後の在庫・追加情報を使い、元のデータを書き換えない", async () => {
    const purchases = [purchase()];
    const inventories = [
      inventory({ category: "旧カテゴリ", categories: [] }),
      inventory({ categories: [], category: "最新カテゴリ" }),
    ];
    const extras = [extra(), extra({ note: "最後のメモ" })];
    const inventoryExtras = [
      inventoryExtra(),
      inventoryExtra({ supplierName: "最後の仕入先" }),
    ];
    const original = structuredClone({
      purchases,
      inventories,
      extras,
      inventoryExtras,
    });
    source.purchases.mockResolvedValue(purchases);
    source.inventories.mockResolvedValue(inventories);
    source.extras.mockResolvedValue(extras);
    source.inventoryExtras.mockResolvedValue(inventoryExtras);
    const page = await caller.zaico.getPurchasesWithCategoryPage({});
    const all = await caller.zaico.getPurchasesWithCategory();
    for (const row of [page.items[0], all[0]]) {
      expect(row).toMatchObject({
        csvSupplierName: "最後の仕入先",
        extra: { note: "最後のメモ" },
      });
      expect(row.purchase_items[0].category).toBe("最新カテゴリ");
    }
    expect({ purchases, inventories, extras, inventoryExtras }).toEqual(
      original
    );
  });

  it("在庫や追加情報がない場合の既定値を保持し、全件取得は元の追加項目を落とさない", async () => {
    source.inventories.mockResolvedValue([]);
    source.extras.mockResolvedValue([]);
    source.inventoryExtras.mockResolvedValue([]);
    const extendedItem = {
      ...item(99, { etc: undefined }),
      currentInventoryQuantity: "source",
      itemLabels: [{ labelId: "SOURCE-LABEL" }],
      custom: "keep",
    };
    source.purchases.mockResolvedValue([
      {
        ...purchase({ num: "999" }),
        purchase_items: [extendedItem],
        custom: "keep",
      },
    ]);
    const page = await caller.zaico.getPurchasesWithCategoryPage({});
    expect(page.items[0]).toMatchObject({
      extra: null,
      csvSupplierName: null,
      csvSupplierUrl: null,
      custom: "keep",
    });
    expect(page.items[0].purchase_items[0]).toMatchObject({
      category: "未分類",
      currentInventoryQuantity: null,
      itemLabels: [],
      custom: "keep",
    });
    const all = await caller.zaico.getPurchasesWithCategory();
    expect(all[0].purchase_items[0]).toMatchObject({
      ...extendedItem,
      category: "未分類",
    });
  });

  it("CSV取得に失敗しても全件取得の一覧と在庫側仕入先を返す", async () => {
    source.fetch.mockRejectedValue(new Error("synthetic CSV failure"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const all = await caller.zaico.getPurchasesWithCategory();
    expect(all).toHaveLength(1);
    expect(all[0].csvSupplierName).toBe("追加情報の仕入先");
    expect(error).toHaveBeenCalledWith(
      "CSV supplier fetch error:",
      expect.any(Error)
    );
  });

  it("最初の取得が失敗した場合は両APIともエラーを返しCSVやラベル処理へ進まない", async () => {
    source.inventories.mockRejectedValue(
      new Error("synthetic inventory failure")
    );
    await expect(caller.zaico.getPurchasesWithCategoryPage({})).rejects.toThrow(
      "synthetic inventory failure"
    );
    await expect(caller.zaico.getPurchasesWithCategory()).rejects.toThrow(
      "synthetic inventory failure"
    );
    expect(source.fetch).not.toHaveBeenCalled();
    expect(source.ensureLabels).not.toHaveBeenCalled();
  });
});
