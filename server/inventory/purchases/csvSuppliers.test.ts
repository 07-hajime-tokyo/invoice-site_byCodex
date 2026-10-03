import { describe, expect, it } from "vitest";
import { fillCsvPurchaseSuppliers } from "./csvSuppliers";

const line = (id: string, supplier: string) =>
  ["", "", id, ...Array(10).fill(""), supplier].join(",");

describe("取引CSVによる仕入先補完", () => {
  it("途中のパース失敗を返しつつ、それまでに読み取れた補完値を保持する", () => {
    const suppliers = new Map([["1", "既存値"]]);
    const failure = new Error("synthetic parse failure");
    const text = [
      "header1",
      "header2",
      "header3",
      line("1", "上書き禁止"),
      line("2", "追加値"),
      "broken",
    ].join("\n");
    expect(() =>
      fillCsvPurchaseSuppliers(text, suppliers, value => {
        if (value === "broken") throw failure;
        return value.split(",");
      })
    ).toThrow(failure);
    expect([...suppliers]).toEqual([
      ["1", "既存値"],
      ["2", "追加値"],
    ]);
  });

  it("空名では番号を確定せず、最初の非空名と文字列の番号を保持する", () => {
    const suppliers = new Map<string, string>();
    const text = [
      "h1",
      "h2",
      "h3",
      line(" 001 ", " "),
      line("001", " 最初の名前 "),
      line("001", "別名"),
      line("1a", "対象外"),
      "",
      "short",
    ].join("\r\n");
    fillCsvPurchaseSuppliers(text, suppliers, value => value.split(","));
    expect([...suppliers]).toEqual([["001", "最初の名前"]]);
  });
});
