import { describe, expect, it } from "vitest";
import { calculateSafePurchaseLimit } from "./tradeSafePurchaseLimit";

describe("calculateSafePurchaseLimit", () => {
  it("matches the spreadsheet formula for a small item row", () => {
    const result = calculateSafePurchaseLimit({
      totalSalesJpy: 18472,
      totalForeignAmount: 114.91,
      fxRate: 160.75,
      shippingCostJpy: 6000,
    });

    expect(result?.ebayFeeJpy).toBe(3351);
    expect(result?.adFeeJpy).toBe(439);
    expect(result?.payoneerFeeJpy).toBe(277);
    expect(result?.customsDutyJpy).toBe(2771);
    expect(result?.safePurchaseLimitJpy).toBe(2897);
  });

  it("matches the spreadsheet formula when rate profit threshold is larger", () => {
    const result = calculateSafePurchaseLimit({
      totalSalesJpy: 63979,
      totalForeignAmount: 398,
      fxRate: 160.75,
      shippingCostJpy: 14000,
    });

    expect(result?.requiredProfitJpy).toBe(9597);
    expect(result?.safePurchaseLimitJpy).toBe(18558);
  });
});
