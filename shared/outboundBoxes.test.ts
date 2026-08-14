import { describe, expect, it } from "vitest";
import {
  buildOutboundFedexItems,
  classifyOutboundScan,
  formatOutboundBoxCode,
  groupOutboundFedexItemsByInvoice,
} from "./outboundBoxes";

describe("outbound box identifiers", () => {
  it("distinguishes boxes, product labels, and tracking numbers", () => {
    expect(classifyOutboundScan("B000137")).toBe("box");
    expect(classifyOutboundScan("ACDEFGH")).toBe("label");
    expect(classifyOutboundScan("  7712-3456-7890 ")).toBe("tracking");
    expect(classifyOutboundScan("ABCIDEF")).toBe("unknown");
  });

  it("formats the full six digit box code range", () => {
    expect(formatOutboundBoxCode(1)).toBe("B000001");
    expect(formatOutboundBoxCode(999_999)).toBe("B999999");
    expect(() => formatOutboundBoxCode(1_000_000)).toThrow(/発番上限/);
  });
});

describe("FedEx item identity", () => {
  it("keeps label identity and supports multiple invoices in one box", () => {
    const items = buildOutboundFedexItems([
      { labelId: "ACDEFGH", title: "Iron", legacyManagementNo: "401_luca" },
      { labelId: "JKLMNPQ", title: "Wood", legacyManagementNo: "402_samee" },
      { labelId: "RSTUVWX", title: "Putter", legacyManagementNo: "401_luca" },
    ]);
    expect(items.map((item) => item.labelId)).toEqual(["ACDEFGH", "JKLMNPQ", "RSTUVWX"]);
    const groups = groupOutboundFedexItemsByInvoice(items);
    expect(groups.get("401")).toHaveLength(2);
    expect(groups.get("402")).toHaveLength(1);
  });
});
