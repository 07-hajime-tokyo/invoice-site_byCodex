import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DIRECT_PARTNER_NAMES,
  DIRECT_PARTNER_NAMES_SETTING_KEY,
} from "@shared/inboundPipeline";
import {
  getSystemSetting,
  getPublishedInvoiceNumberSet,
  setLocalPurchaseInboundClass,
  type LocalPurchaseWithLabels,
  type LocalInventoryWithLabels,
} from "../db";
import {
  getDirectPartnerNames,
  resolveInboundInfoMap,
} from "./inboundClassification";

vi.mock("../db", () => ({
  getSystemSetting: vi.fn(),
  getPublishedInvoiceNumberSet: vi.fn(),
  setLocalPurchaseInboundClass: vi.fn(),
}));

// These fixtures deliberately omit unrelated database columns.
const purchase = (patch: Partial<LocalPurchaseWithLabels> = {}) =>
  ({
    id: 1,
    localInventoryId: 10,
    managementNo: "TEST",
    inboundClass: null,
    classSource: "auto",
    stage: "received",
    stageUpdatedBy: null,
    shaftParentPurchaseId: null,
    ...patch,
  }) as LocalPurchaseWithLabels;
const inventory = (patch: Partial<LocalInventoryWithLabels> = {}) =>
  ({
    id: 10,
    etc: null,
    place: null,
    ebayOrderUrl: null,
    ...patch,
  }) as LocalInventoryWithLabels;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSystemSetting).mockResolvedValue(null);
  vi.mocked(getPublishedInvoiceNumberSet).mockResolvedValue(new Set());
  vi.mocked(setLocalPurchaseInboundClass).mockResolvedValue(undefined);
});

describe("分類の設定と保存", () => {
  it("相手名の設定を区切り文字で分解し、初期値と重複なく併用する", async () => {
    vi.mocked(getSystemSetting).mockResolvedValue(
      " 架空A,架空B、架空A\nサミー "
    );
    expect(await getDirectPartnerNames()).toEqual([
      ...DEFAULT_DIRECT_PARTNER_NAMES,
      "架空A",
      "架空B",
    ]);
    expect(getSystemSetting).toHaveBeenCalledWith(
      DIRECT_PARTNER_NAMES_SETTING_KEY
    );
  });
  it.each([null, "", " ,、\n "])("空設定%jでは初期値を使う", async raw => {
    vi.mocked(getSystemSetting).mockResolvedValue(raw);
    const result = await getDirectPartnerNames();
    expect(result).toEqual(DEFAULT_DIRECT_PARTNER_NAMES);
    expect(result).not.toBe(DEFAULT_DIRECT_PARTNER_NAMES);
  });
  it("設定を読めなくても初期値で分類を続ける", async () => {
    vi.mocked(getSystemSetting).mockRejectedValue(new Error("synthetic"));
    const result = await resolveInboundInfoMap(
      [purchase({ managementNo: "999_サミー_商品" })],
      []
    );
    expect(result.get(1)?.inboundClass).toBe("direct");
  });
  it("空の発注一覧では照会も保存もしない", async () => {
    expect(await resolveInboundInfoMap([], [])).toEqual(new Map());
    expect(getSystemSetting).not.toHaveBeenCalled();
    expect(getPublishedInvoiceNumberSet).not.toHaveBeenCalled();
    expect(setLocalPurchaseInboundClass).not.toHaveBeenCalled();
  });
  it("手動分類は自動判定の材料があっても工程・分離元とともに保持する", async () => {
    const row = purchase({
      classSource: "manual",
      inboundClass: "domestic",
      stage: "listed",
      stageUpdatedBy: "TEST",
      shaftParentPurchaseId: 42,
    });
    expect(
      (
        await resolveInboundInfoMap([row], [inventory({ place: "Oregon" })])
      ).get(1)
    ).toEqual({
      inboundClass: "domestic",
      classSource: "manual",
      stage: "listed",
      stageUpdatedBy: "TEST",
      shaftParentPurchaseId: 42,
    });
    expect(setLocalPurchaseInboundClass).not.toHaveBeenCalled();
  });
  it("自動分類に差がある行だけを保存し、入力行は変更しない", async () => {
    const rows = [purchase(), purchase({ id: 2, inboundClass: "oregon" })];
    const inventories = [inventory({ place: "Oregon" })];
    const original = structuredClone({ rows, inventories });
    const result = await resolveInboundInfoMap(rows, inventories);
    expect([...result.values()].map(row => row.inboundClass)).toEqual([
      "oregon",
      "oregon",
    ]);
    expect(vi.mocked(setLocalPurchaseInboundClass).mock.calls).toEqual([
      [1, "oregon", "auto"],
    ]);
    expect({ rows, inventories }).toEqual(original);
  });
  it("発行済みインボイスに紐づく番号を直取にし、eBayと矛盾すれば未仕訳にする", async () => {
    vi.mocked(getPublishedInvoiceNumberSet).mockResolvedValue(new Set([987]));
    const rows = [
      purchase({ managementNo: "987_架空", localInventoryId: null }),
      purchase({ id: 2, managementNo: "987_架空" }),
    ];
    const result = await resolveInboundInfoMap(rows, [
      inventory({ ebayOrderUrl: "https://ebay.invalid/order" }),
    ]);
    expect(result.get(1)?.inboundClass).toBe("direct");
    expect(result.get(2)?.inboundClass).toBeNull();
  });
  it("インボイス照会失敗は空集合として扱い、保存失敗でも計算結果を返す", async () => {
    vi.mocked(getPublishedInvoiceNumberSet).mockRejectedValue(
      new Error("synthetic read")
    );
    vi.mocked(setLocalPurchaseInboundClass).mockRejectedValue(
      new Error("synthetic write")
    );
    const result = await resolveInboundInfoMap(
      [purchase({ managementNo: "987_架空" })],
      [inventory({ place: "Oregon" })]
    );
    expect(result.get(1)?.inboundClass).toBe("oregon");
    expect(setLocalPurchaseInboundClass).toHaveBeenCalledWith(
      1,
      "oregon",
      "auto"
    );
  });
  it("nullの管理番号は在庫備考で補い、空文字は補わず、重複在庫は最後を使う", async () => {
    const rows = [
      purchase({ managementNo: null }),
      purchase({ id: 2, managementNo: "" }),
    ];
    const result = await resolveInboundInfoMap(rows, [
      inventory({ etc: "TEST" }),
      inventory({ etc: " E123_架空 ,日付" }),
    ]);
    expect(result.get(1)?.inboundClass).toBe("ebay");
    expect(result.get(2)?.inboundClass).toBeNull();
  });
  it("旧データの未設定工程などに既存の初期値を補う", async () => {
    const row = {
      ...purchase(),
      stage: null,
      classSource: null,
    } as unknown as LocalPurchaseWithLabels;
    expect((await resolveInboundInfoMap([row], [])).get(1)).toEqual({
      inboundClass: null,
      classSource: "auto",
      stage: "received",
      stageUpdatedBy: null,
      shaftParentPurchaseId: null,
    });
  });
});
