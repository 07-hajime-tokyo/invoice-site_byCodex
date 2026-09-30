import { afterEach, describe, expect, it, vi } from "vitest";
import {
  amountInputText,
  compactDate,
  compareShaftSalesByDateDesc,
  formatYen,
  numberFromValue,
  orderStatusBadgeClass,
  stockQuantity,
  stockTypeBadgeClass,
  todayJst,
} from "./display";
import { stockTypeOptions, type InventoryItem, type ShaftSale } from "./types";

function inventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 1,
    title: "【テスト】シャフト",
    quantity: "3",
    ...overrides,
  };
}

function shaftSale(overrides: Partial<ShaftSale> = {}): ShaftSale {
  return {
    id: 1,
    managementNo: "S-001",
    title: "【テスト】シャフト売上",
    quantity: 1,
    saleAmount: "1000",
    ...overrides,
  };
}

describe("formatYen", () => {
  it("null・undefined・非有限値は '-' を返す", () => {
    expect(formatYen(null)).toBe("-");
    expect(formatYen(undefined)).toBe("-");
    expect(formatYen(Number.NaN)).toBe("-");
    expect(formatYen(Number.POSITIVE_INFINITY)).toBe("-");
  });

  it("正の値は四捨五入して ¥ 桁区切りで整形する", () => {
    expect(formatYen(0)).toBe("¥0");
    expect(formatYen(1234567.4)).toBe("¥1,234,567");
    expect(formatYen(999.5)).toBe("¥1,000");
  });

  it("負の値は -¥ 表記にする", () => {
    expect(formatYen(-1234.4)).toBe("-¥1,234");
  });
});

describe("numberFromValue", () => {
  it("null・undefined・空文字は null を返す", () => {
    expect(numberFromValue(null)).toBeNull();
    expect(numberFromValue(undefined)).toBeNull();
    expect(numberFromValue("")).toBeNull();
  });

  it("カンマ区切り文字列を数値化する", () => {
    expect(numberFromValue("1,234,567")).toBe(1234567);
    expect(numberFromValue("42.5")).toBe(42.5);
    expect(numberFromValue(100)).toBe(100);
  });

  it("数値化できない文字列は null を返す", () => {
    expect(numberFromValue("abc")).toBeNull();
  });

  it("0 は 0 のまま返す（null にしない）", () => {
    expect(numberFromValue(0)).toBe(0);
    expect(numberFromValue("0")).toBe(0);
  });
});

describe("amountInputText", () => {
  it("null・undefined・0 は空文字を返す", () => {
    expect(amountInputText(null)).toBe("");
    expect(amountInputText(undefined)).toBe("");
    expect(amountInputText(0)).toBe("");
  });

  it("値は四捨五入した文字列を返す", () => {
    expect(amountInputText(1234.5)).toBe("1235");
    expect(amountInputText(-10.4)).toBe("-10");
  });
});

describe("stockQuantity", () => {
  it("数値文字列は小数切り捨てで返す", () => {
    expect(stockQuantity(inventoryItem({ quantity: "3" }))).toBe(3);
    expect(stockQuantity(inventoryItem({ quantity: "2.9" }))).toBe(2);
  });

  it("負数・非数値は 0 に丸める", () => {
    expect(stockQuantity(inventoryItem({ quantity: "-5" }))).toBe(0);
    expect(stockQuantity(inventoryItem({ quantity: "abc" }))).toBe(0);
    expect(stockQuantity(inventoryItem({ quantity: "" }))).toBe(0);
  });
});

describe("compareShaftSalesByDateDesc", () => {
  it("soldAt の日付降順で並べる", () => {
    const older = shaftSale({ id: 1, soldAt: "2026-09-01T00:00:00" });
    const newer = shaftSale({ id: 2, soldAt: "2026-09-15T00:00:00" });
    expect(compareShaftSalesByDateDesc(newer, older)).toBeLessThan(0);
    expect(compareShaftSalesByDateDesc(older, newer)).toBeGreaterThan(0);
  });

  it("同日付は id 降順にする", () => {
    const a = shaftSale({ id: 5, soldAt: "2026-09-01" });
    const b = shaftSale({ id: 9, soldAt: "2026-09-01" });
    expect(compareShaftSalesByDateDesc(a, b)).toBe(4);
    expect(compareShaftSalesByDateDesc(b, a)).toBe(-4);
  });

  it("soldAt 無しは空文字扱いで末尾に来る", () => {
    const dated = shaftSale({ id: 1, soldAt: "2026-09-01" });
    const undated = shaftSale({ id: 2 });
    expect(compareShaftSalesByDateDesc(dated, undated)).toBeLessThan(0);
  });
});

describe("todayJst / compactDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("JST基準の YYYY-MM-DD を返す（UTC日付とずれる時刻でも）", () => {
    vi.useFakeTimers();
    // UTC 2026-09-30 20:00 = JST 2026-10-01 05:00
    vi.setSystemTime(new Date("2026-09-30T20:00:00Z"));
    expect(todayJst()).toBe("2026-10-01");
    expect(compactDate()).toBe("20261001");
  });
});

describe("stockTypeBadgeClass", () => {
  it("在庫区分ごとのクラスを返す", () => {
    expect(stockTypeBadgeClass("shaft")).toBe("bg-zinc-700 text-white");
    expect(stockTypeBadgeClass("stocked")).toBe("bg-emerald-600 text-white");
    expect(stockTypeBadgeClass("dropship")).toBe("bg-sky-600 text-white");
  });
});

describe("orderStatusBadgeClass", () => {
  it("cancelled / returned / その他でクラスを分ける", () => {
    expect(orderStatusBadgeClass("cancelled")).toBe("border-red-200 bg-red-50 text-red-700");
    expect(orderStatusBadgeClass("returned")).toBe("border-amber-200 bg-amber-50 text-amber-700");
    expect(orderStatusBadgeClass("active")).toBe("border-muted bg-muted/40 text-muted-foreground");
    expect(orderStatusBadgeClass(null)).toBe("border-muted bg-muted/40 text-muted-foreground");
    expect(orderStatusBadgeClass(undefined)).toBe("border-muted bg-muted/40 text-muted-foreground");
  });
});

describe("stockTypeOptions", () => {
  it("有在庫・無在庫・シャフトの3区分を固定順で持つ", () => {
    expect(stockTypeOptions).toEqual([
      { value: "stocked", label: "有在庫" },
      { value: "dropship", label: "無在庫" },
      { value: "shaft", label: "シャフト" },
    ]);
  });
});
