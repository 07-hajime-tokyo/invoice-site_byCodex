import { describe, expect, it } from "vitest";
import { cleanLegacyManagementNo, parsePurchaseEtc } from "./purchaseMetadata";
import { cleanManagementNo, parseEtc } from "../client/src/inventory/pages/purchases/format";

describe("legacy purchase metadata shared by purchase screens", () => {
  it.each([
    [undefined, "", ""], [null, "", ""], ["", "", ""],
    [" 405_Max / alternate , 2026-09-30, Supplier , ignored", "405_Max", "Supplier"],
    ["405_Max/alternate, date, Supplier", "405_Max/alternate", "Supplier"],
    ["在庫0814_1 extra, date", "在庫0814_1 extra", ""],
    [", , Supplier", "", "Supplier"],
    ["４０５_Ｍａｘ, date, 仕入先", "４０５_Ｍａｘ", "仕入先"],
    ["Number\t/\tAlternative, date, Supplier", "Number", "Supplier"],
  ])("preserves existing comma and slash rules for %j", (input, managementNo, supplierSite) => {
    expect(cleanLegacyManagementNo(input)).toBe(managementNo);
    expect(parsePurchaseEtc(input)).toEqual({managementNo, supplierSite});
  });

  it("retains purchase-screen exports as references to the shared implementation", () => {
    expect(cleanManagementNo).toBe(cleanLegacyManagementNo);
    expect(parseEtc).toBe(parsePurchaseEtc);
  });
});
