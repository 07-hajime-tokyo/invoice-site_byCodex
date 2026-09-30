import { describe, expect, it } from "vitest";
import {
  detectShipmentSheetName,
  detectShipmentSheetNameInText,
  isDollarPartnerName,
  sheetBadgeClass,
} from "./shipmentSheets";

/** 出庫履歴画面の発送シート判定の整理前基準（現行出力の固定） */

describe("detectShipmentSheetNameInText", () => {
  it("パートナー名キーワードからシート名を判定する", () => {
    expect(detectShipmentSheetNameInText("デボン向け")).toBe("デボン発送管理");
    expect(detectShipmentSheetNameInText("Devon GmbH")).toBe("デボン発送管理");
    expect(detectShipmentSheetNameInText("379_simon20260401")).toBe("サイモン発送管理");
    expect(detectShipmentSheetNameInText("Nele宛て")).toBe("ネレ発送管理");
    expect(detectShipmentSheetNameInText("sammy発送")).toBe("サミー発送管理");
    expect(detectShipmentSheetNameInText("luca20260403")).toBe("独発送管理");
    expect(detectShipmentSheetNameInText("マキシム")).toBe("独発送管理");
  });
  it("キーワードなし・空はnull", () => {
    expect(detectShipmentSheetNameInText("379_1")).toBeNull();
    expect(detectShipmentSheetNameInText("")).toBeNull();
    expect(detectShipmentSheetNameInText(null)).toBeNull();
    expect(detectShipmentSheetNameInText(undefined)).toBeNull();
  });
});

describe("detectShipmentSheetName", () => {
  it("primaryが優先され、なければfallbackを結合して判定する", () => {
    expect(detectShipmentSheetName("サイモン向け", "devon")).toBe("サイモン発送管理");
    expect(detectShipmentSheetName(null, "devon co")).toBe("デボン発送管理");
    expect(detectShipmentSheetName(undefined, "379-1", "nele便")).toBe("ネレ発送管理");
  });
  it("fallbackでは「ルカ」「luca」は判定されずデフォルトの独発送管理", () => {
    expect(detectShipmentSheetName(null, "luca20260403")).toBe("独発送管理");
    expect(detectShipmentSheetName("379_1", "何もなし")).toBe("独発送管理");
  });
});

describe("sheetBadgeClass", () => {
  it("シートごとに固定の色クラスを返す", () => {
    expect(sheetBadgeClass("デボン発送管理")).toBe("bg-amber-100 text-amber-700 border-amber-200");
    expect(sheetBadgeClass("サイモン発送管理")).toBe("bg-cyan-100 text-cyan-700 border-cyan-200");
    expect(sheetBadgeClass("ネレ発送管理")).toBe("bg-emerald-100 text-emerald-700 border-emerald-200");
    expect(sheetBadgeClass("サミー発送管理")).toBe("bg-purple-100 text-purple-700 border-purple-200");
    expect(sheetBadgeClass("独発送管理")).toBe("bg-blue-100 text-blue-700 border-blue-200");
  });
});

describe("isDollarPartnerName", () => {
  it("サミー系のみドル建てパートナーと判定する", () => {
    expect(isDollarPartnerName("Samee GmbH")).toBe(true);
    expect(isDollarPartnerName("SAMMY")).toBe(true);
    expect(isDollarPartnerName("サミー")).toBe(true);
    expect(isDollarPartnerName("Simon")).toBe(false);
    expect(isDollarPartnerName("デボン")).toBe(false);
  });
});
