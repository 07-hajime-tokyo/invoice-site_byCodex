import { describe, expect, it } from "vitest";
import { isReceivedLabelStatus } from "../labelViews";
import {
  getLocalPurchaseDisplayStatus,
  isLocalPurchaseReceivedFromLabels,
  type PurchaseStatusSource,
} from "./displayStatus";

const purchase = (
  overrides: Partial<PurchaseStatusSource> = {}
): PurchaseStatusSource => ({
  id: 1,
  zaicoId: null,
  status: "ordered",
  trackingNumber: null,
  itemsJson: "[]",
  managementNo: "ORDER-A",
  localInventoryId: 10,
  quantity: 2,
  ...overrides,
});
describe("入庫一覧の表示状態", () => {
  it.each([
    ["received", true],
    [" STOCKED ", true],
    ["Shipped", true],
    ["returned", false],
    ["cancelled", false],
    [null, false],
  ])("ラベル状態の受領判定 (%#)", (status, expected) => {
    expect(isReceivedLabelStatus(status)).toBe(expected);
  });
  it("ラベルなしは未入庫、既存ラベルが全て受領済みなら数量不足でも入庫済み", () => {
    expect(isLocalPurchaseReceivedFromLabels(purchase())).toBe(false);
    expect(
      isLocalPurchaseReceivedFromLabels(
        purchase({
          quantity: 3,
          itemLabels: [{ labelId: "A", status: "received" }],
        })
      )
    ).toBe(true);
    expect(
      isLocalPurchaseReceivedFromLabels(
        purchase({
          itemLabels: [
            { labelId: "A", status: "received" },
            { labelId: "B", status: "ordered" },
          ],
        })
      )
    ).toBe(false);
  });
  it("発注数量が1なら2ラベル中1つの受領で入庫済みにする", () => {
    expect(
      isLocalPurchaseReceivedFromLabels(
        purchase({
          quantity: 1,
          itemLabels: [
            { labelId: "A", status: "received" },
            { labelId: "B", status: "ordered" },
          ],
        })
      )
    ).toBe(true);
  });
  it("追跡番号・発送状態は履歴とラベルより優先し、保存済みpurchasedは維持する", () => {
    const row = purchase({
      trackingNumber: " TRACK ",
      itemLabels: [{ labelId: "A", status: "received" }],
    });
    expect(getLocalPurchaseDisplayStatus(row, undefined, new Set([1]))).toBe(
      "shipped"
    );
    expect(getLocalPurchaseDisplayStatus({ ...row, status: "purchased" })).toBe(
      "purchased"
    );
    expect(getLocalPurchaseDisplayStatus(purchase({ status: "shipped" }))).toBe(
      "shipped"
    );
  });
  it("履歴は外部IDを優先し、ゼロも有効IDとして維持する", () => {
    expect(
      getLocalPurchaseDisplayStatus(
        purchase({ zaicoId: 20 }),
        undefined,
        new Set([1])
      )
    ).toBe("ordered");
    expect(
      getLocalPurchaseDisplayStatus(
        purchase({ zaicoId: 20 }),
        undefined,
        new Set([20])
      )
    ).toBe("purchased");
    expect(
      getLocalPurchaseDisplayStatus(
        purchase({ zaicoId: 0 }),
        undefined,
        new Set([0])
      )
    ).toBe("purchased");
  });
  it("復旧対象の例外は保存済み入庫・履歴より優先し、追跡番号より後に適用する", () => {
    const row = purchase({
      managementNo: "402_マキシム_2/2",
      status: "purchased",
    });
    expect(getLocalPurchaseDisplayStatus(row, undefined, new Set([1]))).toBe(
      "ordered"
    );
    expect(
      getLocalPurchaseDisplayStatus({
        ...row,
        status: "ordered",
        trackingNumber: "TRACK",
      })
    ).toBe("shipped");
    expect(
      getLocalPurchaseDisplayStatus(
        purchase({ itemsJson: '[{"managementNo":"402_マキシム_2/2"}]' }),
        undefined,
        new Set([1])
      )
    ).toBe("ordered");
  });
  it("空状態はorderedへ、未知の既存状態はそのまま返す", () => {
    expect(getLocalPurchaseDisplayStatus(purchase({ status: "" }))).toBe(
      "ordered"
    );
    expect(getLocalPurchaseDisplayStatus(purchase({ status: "legacy" }))).toBe(
      "legacy"
    );
  });
});
