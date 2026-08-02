import { describe, it, expect } from "vitest";
import { diffInventoryFields } from "./changeLog";

describe("在庫変動履歴の差分抽出", () => {
  it("変わった項目だけを返す", () => {
    const diffs = diffInventoryFields(
      { title: "Switch lite グレー", quantity: 1, category: "toy net 保管分", place: "toy net" },
      { title: "Switch lite グレー", quantity: 2, category: "スイッチライト", place: "toy net" }
    );
    expect(diffs.map((d) => d.field).sort()).toEqual(["category", "quantity"]);
    const quantity = diffs.find((d) => d.field === "quantity");
    expect(quantity).toMatchObject({ label: "在庫数", before: "1", after: "2" });
  });

  it("after に無い項目は比較対象にしない", () => {
    // 更新フォームが送っていない項目を「消された」と誤検知しないこと
    const diffs = diffInventoryFields({ title: "商品A", etc: "397_ルカ_1/20" }, { title: "商品B" });
    expect(diffs.map((d) => d.field)).toEqual(["title"]);
  });

  it("null・空文字・空白のみは同じ値として扱う", () => {
    const diffs = diffInventoryFields(
      { place: null, supplierName: "  ", etc: "x" },
      { place: "", supplierName: null, etc: "x" }
    );
    expect(diffs).toEqual([]);
  });

  it("数値と文字列の表記ゆれで差分にしない", () => {
    const diffs = diffInventoryFields({ quantity: 2, unitPrice: "13000" }, { quantity: "2", unitPrice: 13000 });
    expect(diffs).toEqual([]);
  });

  it("空だった項目に値が入ると差分として出る", () => {
    const diffs = diffInventoryFields({ supplierName: null }, { supplierName: "駿河屋" });
    expect(diffs).toEqual([
      { field: "supplierName", label: "仕入先", before: null, after: "駿河屋" },
    ]);
  });
});
