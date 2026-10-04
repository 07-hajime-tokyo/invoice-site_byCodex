import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import {
  getAllPurchaseExtras,
  getLocalInventories,
  getLocalPurchases,
  getPurchaseHistories,
} from "../db";
import {
  loadLocalPurchaseListData,
  refreshPurchaseInventoryMap,
} from "./localData";
import { createPurchaseInventoryMap } from "./localRows";

vi.mock("../../db", () => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({
  getAllPurchaseExtras: vi.fn(),
  getLocalInventories: vi.fn(),
  getLocalPurchases: vi.fn(),
  getPurchaseHistories: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(getLocalPurchases).mockResolvedValue([]);
  vi.mocked(getLocalInventories).mockResolvedValue([]);
  vi.mocked(getAllPurchaseExtras).mockResolvedValue([]);
  vi.mocked(getPurchaseHistories).mockResolvedValue([]);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("一覧の初期取得", () => {
  it("通常一覧は履歴を読まず、3つの読取を待ち合わせ前に開始する", async () => {
    const purchases = deferred<Awaited<ReturnType<typeof getLocalPurchases>>>();
    const inventories =
      deferred<Awaited<ReturnType<typeof getLocalInventories>>>();
    const extras = deferred<Awaited<ReturnType<typeof getAllPurchaseExtras>>>();
    vi.mocked(getLocalPurchases).mockReturnValue(purchases.promise);
    vi.mocked(getLocalInventories).mockReturnValue(inventories.promise);
    vi.mocked(getAllPurchaseExtras).mockReturnValue(extras.promise);
    const pending = loadLocalPurchaseListData("page");
    expect(vi.mocked(getLocalPurchases).mock.calls).toEqual([[]]);
    expect(vi.mocked(getLocalInventories).mock.calls).toEqual([[]]);
    expect(vi.mocked(getAllPurchaseExtras).mock.calls).toEqual([[]]);
    expect(getPurchaseHistories).not.toHaveBeenCalled();
    const purchaseRows: Awaited<ReturnType<typeof getLocalPurchases>> = [];
    const inventoryRows: Awaited<ReturnType<typeof getLocalInventories>> = [];
    const extraRows: Awaited<ReturnType<typeof getAllPurchaseExtras>> = [];
    extras.resolve(extraRows);
    inventories.resolve(inventoryRows);
    purchases.resolve(purchaseRows);
    const result = await pending;
    expect(result.localPurchaseRows).toBe(purchaseRows);
    expect(result.localInventoryRows).toBe(inventoryRows);
    expect(result.purchaseExtras).toBe(extraRows);
    expect(result.purchaseHistRows).toEqual([]);
    expect(result.purchaseHistoriesMs).toBe(0);
  });

  it("全件取得は履歴2,000件を先に開始し、その読取時間だけを計測する", async () => {
    const history =
      deferred<Awaited<ReturnType<typeof getPurchaseHistories>>>();
    const purchases = deferred<Awaited<ReturnType<typeof getLocalPurchases>>>();
    const starts: string[] = [];
    let clock = 100;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.mocked(getPurchaseHistories).mockImplementation(() => {
      starts.push("history");
      return history.promise;
    });
    vi.mocked(getLocalPurchases).mockImplementation(() => {
      starts.push("purchases");
      return purchases.promise;
    });
    vi.mocked(getLocalInventories).mockImplementation(async () => {
      starts.push("inventories");
      return [];
    });
    vi.mocked(getAllPurchaseExtras).mockImplementation(async () => {
      starts.push("extras");
      return [];
    });
    const pending = loadLocalPurchaseListData("all");
    expect(starts).toEqual(["history", "purchases", "inventories", "extras"]);
    expect(vi.mocked(getPurchaseHistories).mock.calls).toEqual([[2000]]);
    const historyRows: Awaited<ReturnType<typeof getPurchaseHistories>> = [];
    clock = 125;
    history.resolve(historyRows);
    await history.promise;
    clock = 250;
    purchases.resolve([]);
    const result = await pending;
    expect(result.purchaseHistRows).toBe(historyRows);
    expect(result.purchaseHistoriesMs).toBe(25);
  });

  it.each([
    ["page", getLocalPurchases],
    ["page", getLocalInventories],
    ["page", getAllPurchaseExtras],
    ["all", getLocalPurchases],
    ["all", getLocalInventories],
    ["all", getAllPurchaseExtras],
    ["all", getPurchaseHistories],
  ] as const)(
    "%s の読取失敗を空一覧に変えず呼出元へ返す (%#)",
    async (mode, read) => {
      const failure = new Error("synthetic read failure");
      vi.mocked(read).mockRejectedValueOnce(failure);
      await expect(loadLocalPurchaseListData(mode)).rejects.toBe(failure);
    }
  );
});

describe("仕入先・在庫情報の再取得", () => {
  const row = (id: number, supplierName = "初回取得") => ({
    id,
    supplierName,
    supplierUrl: "https://supplier.invalid/old",
    ebayListingUrl: "https://listing.invalid/old",
    quantity: 2,
  });
  function queryResult(
    rows: Array<
      | ReturnType<typeof row>
      | {
          id: number;
          supplierName: null;
          supplierUrl: null;
          ebayListingUrl: null;
          quantity: null;
        }
    >
  ) {
    const where = vi.fn().mockResolvedValue(rows);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    vi.mocked(getDb).mockResolvedValue({ select } as unknown as NonNullable<
      Awaited<ReturnType<typeof getDb>>
    >);
    return { select, from, where };
  }

  it("在庫IDがなければDBへ接続せず初回情報を保持する", async () => {
    const map = createPurchaseInventoryMap([row(1)]);
    const original = [...map];
    await refreshPurchaseInventoryMap([], map);
    expect(getDb).not.toHaveBeenCalled();
    expect([...map]).toEqual(original);
  });

  it("DBを利用できないときは初回取得の情報を保持する", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    const map = createPurchaseInventoryMap([row(1)]);
    const original = [...map];
    await refreshPurchaseInventoryMap([1], map);
    expect([...map]).toEqual(original);
  });

  it("再取得した行だけを更新し、null・0も反映する", async () => {
    const map = createPurchaseInventoryMap([row(1), row(2), row(3)]);
    const missing = map.get(3);
    queryResult([
      {
        id: 1,
        supplierName: null,
        supplierUrl: null,
        ebayListingUrl: null,
        quantity: null,
      },
      { ...row(2, "再取得"), quantity: 0 },
      row(4, "初回取得になかった在庫"),
    ]);
    await refreshPurchaseInventoryMap([1, 2, 3, 4], map);
    expect(map.get(1)).toEqual({
      supplierName: null,
      supplierUrl: null,
      ebayListingUrl: null,
      quantity: null,
    });
    expect(map.get(2)).toMatchObject({ supplierName: "再取得", quantity: 0 });
    expect(map.get(3)).toBe(missing);
    expect(map.get(4)?.supplierName).toBe("初回取得になかった在庫");
  });

  it("再呼出しで再照会し、空の取得結果では既存情報を消さない", async () => {
    const map = createPurchaseInventoryMap([row(1)]);
    const { where } = queryResult([row(1, "新しい値")]);
    await refreshPurchaseInventoryMap([1], map);
    expect(map.get(1)?.supplierName).toBe("新しい値");
    where.mockResolvedValueOnce([]);
    await refreshPurchaseInventoryMap([1], map);
    expect(where).toHaveBeenCalledTimes(2);
    expect(map.get(1)?.supplierName).toBe("新しい値");
  });

  it("DB照会エラーを握りつぶさず初回情報も書き換えない", async () => {
    const map = createPurchaseInventoryMap([row(1)]);
    const original = [...map];
    const failure = new Error("synthetic query failure");
    queryResult([]).where.mockRejectedValue(failure);
    await expect(refreshPurchaseInventoryMap([1], map)).rejects.toBe(failure);
    expect([...map]).toEqual(original);
  });
});
