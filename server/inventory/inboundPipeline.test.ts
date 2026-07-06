import { describe, it, expect } from "vitest";
import {
  classifyInbound,
  nextStage,
  getStagesForClass,
  isInboundComplete,
  isFinalStage,
  isRegisterStage,
  isOregonPlace,
  extractInvoicePrefix,
  extractPartnerToken,
  matchesDirectPartner,
  getStageIndex,
  DEFAULT_DIRECT_PARTNER_NAMES,
} from "@shared/inboundPipeline";

describe("classifyInbound", () => {
  const partners = DEFAULT_DIRECT_PARTNER_NAMES; // サミー, ルカ

  it("classifies E-prefixed management numbers as ebay", () => {
    expect(classifyInbound({ managementNo: "E0403-12" })).toBe("ebay");
    expect(classifyInbound({ managementNo: "e0402-3, 2026-04-02, Amazon" })).toBe("ebay");
  });

  it("classifies rows with an ebay order url as ebay", () => {
    expect(classifyInbound({ managementNo: "何か", ebayOrderUrl: "https://ebay.com/o/123" })).toBe("ebay");
  });

  it("classifies partner-name prefixed management numbers as direct", () => {
    expect(classifyInbound({ managementNo: "サミー_001", directPartnerNames: partners })).toBe("direct");
    expect(classifyInbound({ managementNo: "371_ルカ_商品名", directPartnerNames: partners })).toBe("direct");
    expect(classifyInbound({ managementNo: "ルカ", directPartnerNames: partners })).toBe("direct");
  });

  it("classifies rows linked to a published invoice as direct", () => {
    expect(classifyInbound({ managementNo: "371_誰か_x", hasLinkedInvoice: true })).toBe("direct");
  });

  it("classifies oregon place as oregon when not ebay/direct", () => {
    expect(classifyInbound({ managementNo: "999_不明", place: "オレゴン倉庫" })).toBe("oregon");
    expect(classifyInbound({ managementNo: "", place: "Oregon" })).toBe("oregon");
  });

  it("prefers ebay/direct over oregon place", () => {
    // E-prefixed even if place says oregon → ebay
    expect(classifyInbound({ managementNo: "E0403-1", place: "オレゴン" })).toBe("ebay");
    // partner match even if place says oregon → direct
    expect(classifyInbound({ managementNo: "サミー_1", place: "オレゴン", directPartnerNames: partners })).toBe("direct");
  });

  it("falls to unclassified (null) when ebay and direct conflict (safe side)", () => {
    // E-prefixed AND linked invoice → conflict → null
    expect(classifyInbound({ managementNo: "E0403-1", hasLinkedInvoice: true })).toBeNull();
    // E-prefixed AND partner match → conflict → null
    expect(
      classifyInbound({ managementNo: "Eルカ", directPartnerNames: ["Eルカ"] }),
    ).toBeNull();
  });

  it("returns null (unclassified) when nothing matches", () => {
    expect(classifyInbound({ managementNo: "", place: "" })).toBeNull();
    expect(classifyInbound({ managementNo: "999_不明の相手", place: "東京", directPartnerNames: partners })).toBeNull();
  });

  it("never auto-classifies as domestic (domestic is manual via shaft separation)", () => {
    for (const input of [
      { managementNo: "E0403-1" },
      { managementNo: "サミー_1", directPartnerNames: partners },
      { managementNo: "1_x", place: "オレゴン" },
      { managementNo: "" },
    ]) {
      expect(classifyInbound(input)).not.toBe("domestic");
    }
  });
});

describe("extractInvoicePrefix / extractPartnerToken", () => {
  it("extracts numeric invoice prefix", () => {
    expect(extractInvoicePrefix("371_ルカ_商品名")).toBe("371");
    expect(extractInvoicePrefix("0372_x")).toBe("0372");
    expect(extractInvoicePrefix("E0403-12")).toBeNull();
    expect(extractInvoicePrefix("サミー_1")).toBeNull();
  });

  it("extracts partner token", () => {
    expect(extractPartnerToken("371_ルカ_商品名")).toBe("ルカ");
    expect(extractPartnerToken("サミー_001")).toBe("サミー");
    expect(extractPartnerToken("ルカ")).toBe("ルカ");
    expect(extractPartnerToken("E0403-12")).toBe("E0403"); // token exists but classify handles E first
  });
});

describe("matchesDirectPartner", () => {
  it("prefix-matches partner names", () => {
    expect(matchesDirectPartner("サミー_1", ["サミー", "ルカ"])).toBe(true);
    expect(matchesDirectPartner("371_ルカ_x", ["サミー", "ルカ"])).toBe(true);
    expect(matchesDirectPartner("999_田中", ["サミー", "ルカ"])).toBe(false);
    expect(matchesDirectPartner("", ["サミー"])).toBe(false);
  });
});

describe("isOregonPlace", () => {
  it("matches オレゴン / Oregon case-insensitively", () => {
    expect(isOregonPlace("オレゴン")).toBe(true);
    expect(isOregonPlace("oregon warehouse")).toBe(true);
    expect(isOregonPlace("OREGON")).toBe(true);
    expect(isOregonPlace("東京")).toBe(false);
    expect(isOregonPlace("")).toBe(false);
    expect(isOregonPlace(null)).toBe(false);
  });
});

describe("stages", () => {
  it("returns correct stage lists per class", () => {
    expect(getStagesForClass("ebay")).toEqual(["received", "registered", "labeled", "packed"]);
    expect(getStagesForClass("oregon")).toEqual(["received", "registered", "warehouse_shipped"]);
    expect(getStagesForClass("direct")).toEqual(["received", "registered", "handed_over"]);
    expect(getStagesForClass("domestic")).toEqual(["registered", "listed", "shipped"]);
    // unclassified shows the shared prefix only
    expect(getStagesForClass(null)).toEqual(["received", "registered"]);
  });

  it("advances stage one at a time and stops at the end", () => {
    expect(nextStage("ebay", "received")).toBe("registered");
    expect(nextStage("ebay", "registered")).toBe("labeled");
    expect(nextStage("ebay", "labeled")).toBe("packed");
    expect(nextStage("ebay", "packed")).toBeNull();
    expect(nextStage("oregon", "registered")).toBe("warehouse_shipped");
    expect(nextStage("oregon", "warehouse_shipped")).toBeNull();
    expect(nextStage("domestic", "registered")).toBe("listed");
  });

  it("starts from first stage when current stage is not in the list", () => {
    // e.g. after a class change from ebay(packed) to domestic
    expect(nextStage("domestic", "packed")).toBe("registered");
  });

  it("identifies final stage and completion", () => {
    expect(isFinalStage("ebay", "packed")).toBe(true);
    expect(isFinalStage("ebay", "labeled")).toBe(false);
    expect(isInboundComplete("ebay", "packed")).toBe(true);
    expect(isInboundComplete("oregon", "warehouse_shipped")).toBe(true);
    expect(isInboundComplete("direct", "handed_over")).toBe(true);
    // unclassified is never "complete"
    expect(isInboundComplete(null, "registered")).toBe(false);
  });

  it("identifies the register stage (status=purchased trigger)", () => {
    expect(isRegisterStage("registered")).toBe(true);
    expect(isRegisterStage("received")).toBe(false);
  });

  it("computes stage index for progress bars", () => {
    expect(getStageIndex("ebay", "received")).toBe(0);
    expect(getStageIndex("ebay", "labeled")).toBe(2);
    expect(getStageIndex("ebay", "unknown")).toBe(0);
  });
});
