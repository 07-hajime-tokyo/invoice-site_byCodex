import { describe, expect, it } from "vitest";
import type { PurchaseItemSource } from "./items";
import {
  toInventoryItemLabelView,
  uniqueInventoryItemLabelViews,
} from "../labelViews";
import { getPurchaseItemManagementNo, localPurchaseItems } from "./items";
import {
  filterLabelsByManagementNo,
  labelsForPurchaseItem,
  localPurchaseLabelViews,
  type PurchaseLabelSource,
} from "./labels";

const purchase = (
  overrides: Partial<PurchaseLabelSource> = {}
): PurchaseLabelSource => ({
  itemsJson: "[]",
  managementNo: "ORDER-A",
  localInventoryId: 10,
  quantity: 2,
  ...overrides,
});

describe("ラベル表示・重複排除", () => {
  it("表示用の項目だけを返す", () => {
    const source = {
      labelId: "LABELAA",
      title: "非表示項目",
      inspectionOutcome: "private",
      status: "ordered",
      localInventoryId: 10,
    };
    expect(toInventoryItemLabelView(source)).toEqual({
      id: undefined,
      labelId: "LABELAA",
      status: "ordered",
      localInventoryId: 10,
      legacyManagementNo: undefined,
    });
    expect(source.title).toBe("非表示項目");
  });
  it("大小文字・前後空白で同一視し、在庫付きラベルを在庫なしで上書きしない", () => {
    const result = uniqueInventoryItemLabelViews([
      { labelId: " a ", status: "ordered" },
      { labelId: "B", status: "ordered" },
      { labelId: "A", status: "received", localInventoryId: 10 },
      { labelId: "a", status: "cancelled" },
      { labelId: "  " },
    ]);
    expect(result.map(row => [row.labelId, row.status])).toEqual([
      ["A", "received"],
      ["B", "ordered"],
    ]);
  });
  it("同順位は後勝ち、在庫IDゼロは未紐付けとして扱う", () => {
    const result = uniqueInventoryItemLabelViews([
      { labelId: "A", localInventoryId: 0 },
      { labelId: " a ", status: "stocked" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ labelId: " a ", status: "stocked" });
  });
});

describe("発注明細の解釈とラベル照合", () => {
  it.each([
    [{ managementNo: " DIRECT ", etc: "ETC,date" }, "DIRECT"],
    [{ management_no: " LEGACY " }, "LEGACY"],
    [{ legacyManagementNo: " LEGACY2 " }, "LEGACY2"],
    [{ managementNo: "", management_no: "使わない", etc: " ETC,date" }, "ETC"],
    [{ managementNo: 123, management_no: "使わない" }, "ORDER-A"],
    [{ etc: "" }, ""],
  ])("管理番号の既存の優先順位を保持する (%#)", (item, expected) => {
    expect(getPurchaseItemManagementNo(purchase(), item)).toBe(expected);
  });
  it.each([null, "[]", "{}", "null", "{broken"])(
    "空・不正JSONは状態判定用に発注行を使う (%#)",
    itemsJson => {
      expect(localPurchaseItems({ ...purchase(), itemsJson } as PurchaseItemSource)).toEqual([
        { inventory_id: 10, inventoryId: 10, etc: "ORDER-A", quantity: 2 },
      ]);
    }
  );
  it("空でない配列はそのまま扱い、既存のnull明細エラーも隠さない", () => {
    const row = purchase({ itemsJson: "[null]" });
    expect(localPurchaseItems(row)).toEqual([null]);
    expect(() => localPurchaseLabelViews(row)).toThrow(TypeError);
  });
  it("管理番号は大文字小文字を区別し、空のラベル管理番号を許可する", () => {
    const labels = [
      { legacyManagementNo: " ORDER-A " },
      { legacyManagementNo: "order-a" },
      { legacyManagementNo: null },
    ];
    expect(filterLabelsByManagementNo(labels, " ORDER-A ")).toEqual([
      labels[0],
      labels[2],
    ]);
    expect(filterLabelsByManagementNo(labels, " ")).toBe(labels);
  });
  it("発注ラベルを管理番号と在庫で絞ってから在庫側ラベルを足す", () => {
    const row = purchase({
      itemLabels: [
        { labelId: "A", localInventoryId: 10, legacyManagementNo: "ORDER-A" },
        { labelId: "B", localInventoryId: 20, legacyManagementNo: "ORDER-A" },
        { labelId: "C", localInventoryId: 10, legacyManagementNo: "OTHER" },
      ],
    });
    const map = new Map([
      [
        10,
        [
          { labelId: "D", localInventoryId: 10 },
          { labelId: "E", legacyManagementNo: "OTHER" },
        ],
      ],
    ]);
    const original = structuredClone(row);
    expect(
      labelsForPurchaseItem(row, { inventory_id: 10 }, map).map(
        label => label.labelId
      )
    ).toEqual(["A", "D"]);
    expect(
      labelsForPurchaseItem(row, { inventory_id: 99 }, map).map(
        label => label.labelId
      )
    ).toEqual(["A", "B"]);
    expect(row).toEqual(original);
  });
  it("発注ラベルがなければ在庫側を使い、不正IDでは照会しない", () => {
    const map = new Map([
      [10, [{ labelId: "A" }]],
      [0, [{ labelId: "ZERO" }]],
    ]);
    expect(
      labelsForPurchaseItem(purchase(), {}, map).map(label => label.labelId)
    ).toEqual(["A"]);
    expect(
      labelsForPurchaseItem(purchase(), { inventory_id: "invalid" }, map)
    ).toEqual([]);
    expect(
      labelsForPurchaseItem(purchase({ localInventoryId: null }), {}, map).map(
        label => label.labelId
      )
    ).toEqual(["ZERO"]);
  });
  it("複数明細の同じラベルを入庫判定で重複カウントしない", () => {
    const row = purchase({
      itemsJson: '[{"inventory_id":10},{"inventory_id":10}]',
      itemLabels: [{ labelId: "A", localInventoryId: 10 }],
    });
    expect(localPurchaseLabelViews(row)).toHaveLength(1);
  });
});
