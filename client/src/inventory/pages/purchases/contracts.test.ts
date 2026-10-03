import { afterEach, describe, expect, it, vi } from "vitest";
import type { Purchase } from "./types";
import { buildPurchasesCsv, exportPurchasesCSV } from "./csv";
import { buildPurchaseCompletionInput } from "./completionInput";
import { createEmptyEditState } from "./editState";
import { getPurchaseTrackingInfo } from "./carrier";
const purchase: Purchase = {
  id: 1,
  num: "TEST",
  customer_name: "架空",
  status: "ordered",
  purchase_date: "2026-09-01",
  estimated_purchase_date: null,
  purchase_items: [
    {
      id: 1,
      inventory_id: 10,
      title: '商品,"A"',
      quantity: "2",
      unit: "個",
      unit_price: "0",
      status: "ordered",
      purchase_date: null,
      estimated_purchase_date: null,
      etc: "TEST,日付,架空サイト",
      category: "部品",
    },
  ],
  extra: {
    id: 1,
    zaicoId: 1,
    shipDate: "2026-09-02",
    trackingNumber: "1234-5678-9012",
    carrier: "yamato",
    note: null,
  },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("画面が使う共通の出力規則", () => {
  it("CSVはBOM・ヘッダー・引用符・日付・手動配送業者を維持する", () => {
    const result = buildPurchasesCsv([purchase]);
    expect(result).toBe(
      '\uFEFF"発注No","商品名","管理番号","カテゴリ","仕入先","発注日","入庫予定日","入庫日","発送日","追跡番号","配送業者","ステータス"\n"TEST","商品,""A""","TEST","部品","架空サイト","2026-09-01","","","2026-09-02","1234-5678-9012","ヤマト運輸","ordered"'
    );
    expect(buildPurchasesCsv([]).split("\n")).toHaveLength(1);
  });
  it("CSVのブラウザー保存で日付付きファイル名を使い一時URLを解放する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const link = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => link),
    });
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:synthetic");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    exportPurchasesCSV([purchase]);
    expect(link.download).toBe("入庫管理_2026-09-30.csv");
    expect(link.click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:synthetic");
    const blob = create.mock.calls[0][0] as Blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // Blob.text() consumes the UTF-8 BOM; verify the download bytes separately.
    expect(await blob.text()).toBe(buildPurchasesCsv([purchase]).slice(1));
  });
  it("単件・一括の入庫入力は同じ明細と履歴を作り、ゼロ円も維持する", () => {
    const original = structuredClone(purchase);
    expect(
      buildPurchaseCompletionInput(purchase, "2026-09-30", "A", "テスト担当")
    ).toEqual({
      purchaseId: 1,
      purchaseDate: "2026-09-30",
      purchaseItems: [{ inventory_id: 10, quantity: "2", unit_price: "0" }],
      historyData: {
        kanriNo: "TEST",
        title: '商品,"A"',
        category: "部品",
        supplier: "架空サイト",
        unitPrice: "0",
        inventoryId: 10,
      },
      operatorKey: "A",
      operatorName: "テスト担当",
    });
    expect(purchase).toEqual(original);
  });
  it("編集開始前とキャンセル後の初期値は毎回独立する", () => {
    const first = createEmptyEditState();
    const second = createEmptyEditState();
    first.itemEdits[10] = {
      title: "test",
      unitPrice: "",
      quantity: "1",
      managementNo: "",
      estimatedDate: "",
      category: "",
    };
    expect(second).toEqual({
      shipDate: "",
      trackingNumber: "",
      carrier: "auto",
      note: "",
      supplierName: "",
      supplierUrl: "",
      itemEdits: {},
    });
  });
  it.each([
    ["yamato", "kuronekoyamato.co.jp"],
    ["japanpost", "post.japanpost.jp"],
    ["sagawa", "sagawa-exp.co.jp"],
    ["amazon", "amazon.co.jp"],
    ["seino", "seino.co.jp"],
    ["fukuyama", "fukutsu.co.jp"],
  ])("%sの手動指定リンクをスマホとPCで共有する", (carrier, domain) => {
    const info = getPurchaseTrackingInfo({
      ...purchase,
      extra: { ...purchase.extra!, carrier },
    })!;
    expect(info.carrierKey).toBe(carrier);
    expect(info.url).toContain(domain);
    expect(info.num).toBe("123456789012");
  });
  it("エコ配・番号なし・未知の保存済み配送業者の扱いを変えない", () => {
    expect(
      getPurchaseTrackingInfo({
        ...purchase,
        extra: { ...purchase.extra!, carrier: "ecohai" },
      })
    ).toMatchObject({ url: null, isEcohai: true });
    expect(getPurchaseTrackingInfo({ ...purchase, extra: null })).toBeNull();
    expect(
      getPurchaseTrackingInfo({
        ...purchase,
        extra: { ...purchase.extra!, carrier: "legacy" },
      })?.carrierKey
    ).toBe("legacy");
  });
});
