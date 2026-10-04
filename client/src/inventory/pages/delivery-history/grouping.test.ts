import { describe, expect, it } from "vitest";
import {
  extractDeliveryGroup,
  extractInvoiceNoFromManagementText,
  formatDisplayDeliveryNo,
  resolveHistoryGroup,
} from "./grouping";

/** 出庫履歴画面のグループ解決の整理前基準（現行出力の固定） */

describe("extractDeliveryGroup", () => {
  it("deliveryNoの先頭数字を抽出、数字がなければそのまま", () => {
    expect(extractDeliveryGroup("378_luca20260403")).toBe("378");
    expect(extractDeliveryGroup("379_1")).toBe("379");
    expect(extractDeliveryGroup("luca20260403")).toBe("luca20260403");
  });
});

describe("extractInvoiceNoFromManagementText", () => {
  it("No.表記・括弧・埋め込みからインボイスNoを抽出する", () => {
    expect(extractInvoiceNoFromManagementText("No.379_サミー")).toBe("379");
    expect(extractInvoiceNoFromManagementText("379 メモ")).toBe("379");
    expect(extractInvoiceNoFromManagementText("（No.379_サミー）")).toBe("379");
    expect(extractInvoiceNoFromManagementText("商品 379_1")).toBe("379");
  });
  it("抽出できない場合はnull", () => {
    expect(extractInvoiceNoFromManagementText("379-1")).toBeNull();
    expect(extractInvoiceNoFromManagementText("メモのみ")).toBeNull();
    expect(extractInvoiceNoFromManagementText("")).toBeNull();
    expect(extractInvoiceNoFromManagementText(null)).toBeNull();
    expect(extractInvoiceNoFromManagementText(undefined)).toBeNull();
  });
});

describe("resolveHistoryGroup", () => {
  const emptyMap = new Map<number, string>();
  it("deliveryNo先頭数字があればそれを返す", () => {
    expect(
      resolveHistoryGroup({ deliveryNo: "378_luca", items: [] }, emptyMap),
    ).toBe("378");
  });
  it("数字がない場合はitemsの管理番号から一意のインボイスNoを解決する", () => {
    const items = [
      { inventoryId: 1, title: "A", quantity: 1, managementNo: "379_1" },
      { inventoryId: 2, title: "B", quantity: 1, managementNo: "379_2" },
    ];
    expect(resolveHistoryGroup({ deliveryNo: "サミー出庫", items }, emptyMap)).toBe("379");
  });
  it("プレフィックスが複数ならdeliveryNoのまま", () => {
    const items = [
      { inventoryId: 1, title: "A", quantity: 1, managementNo: "379_1" },
      { inventoryId: 2, title: "B", quantity: 1, managementNo: "380_1" },
    ];
    expect(resolveHistoryGroup({ deliveryNo: "サミー出庫", items }, emptyMap)).toBe("サミー出庫");
  });
  it("managementNoがなければマップとタイトルからフォールバックする", () => {
    const map = new Map<number, string>([[1, "381_1"]]);
    const items = [{ inventoryId: 1, title: "A", quantity: 1 }];
    expect(resolveHistoryGroup({ deliveryNo: "ルカ出庫", items }, map)).toBe("381");
  });
});

describe("formatDisplayDeliveryNo", () => {
  it("インボイスNoを含まないdeliveryNoには数字グループキーを付与する", () => {
    expect(formatDisplayDeliveryNo("luca0403", "378")).toBe("378_luca0403");
    expect(formatDisplayDeliveryNo("379_1", "379")).toBe("379_1");
    expect(formatDisplayDeliveryNo("luca0403", "サミー")).toBe("luca0403");
  });
});
