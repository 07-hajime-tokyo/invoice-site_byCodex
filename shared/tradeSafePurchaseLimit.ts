export const TRADE_SAFE_PURCHASE_SETTINGS = {
  buyerTaxRate: 0.08,
  baseFinalValueFeeRate: 0.136,
  internationalFeeRate: 0.0135,
  fixedOrderFeeForeign: 0.4,
  feeTaxRate: 0.1,
  adRate: 0.02,
  payoneerRate: 0.015,
  customsFloorRate: 0.10,
  customsActualRate: 0.15,
  refundDivisor: 11,
  minProfitJpy: 3000,
  minProfitRate: 0.15,
} as const;

export type SafePurchaseLimitInput = {
  totalSalesJpy: number | null | undefined;
  totalForeignAmount?: number | null | undefined;
  fxRate?: number | null | undefined;
  shippingCostJpy?: number | null | undefined;
  customsDutyJpy?: number | null | undefined;
};

export type SafePurchaseLimitResult = {
  safePurchaseLimitJpy: number;
  requiredProfitJpy: number;
  ebayFeeJpy: number;
  adFeeJpy: number;
  payoneerFeeJpy: number;
  customsDutyJpy: number;
  refundDivisor: number;
};

const toNumber = (value: number | null | undefined) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

const roundJpy = (value: number) => Math.round(value);

export function calculateSafePurchaseLimit(
  input: SafePurchaseLimitInput,
): SafePurchaseLimitResult | null {
  const totalSalesJpy = toNumber(input.totalSalesJpy);
  if (totalSalesJpy <= 0) return null;

  const settings = TRADE_SAFE_PURCHASE_SETTINGS;
  const shippingCostJpy = Math.max(0, toNumber(input.shippingCostJpy));
  const fxRate = toNumber(input.fxRate);
  const totalForeignAmount =
    toNumber(input.totalForeignAmount) > 0
      ? toNumber(input.totalForeignAmount)
      : fxRate > 0
        ? totalSalesJpy / fxRate
        : 0;

  const ebayFeeJpy =
    totalForeignAmount > 0 && fxRate > 0
      ? roundJpy(
          (((totalForeignAmount * (1 + settings.buyerTaxRate)) *
            (settings.baseFinalValueFeeRate + settings.internationalFeeRate) +
            settings.fixedOrderFeeForeign) *
            (1 + settings.feeTaxRate)) *
            fxRate,
        )
      : 0;

  const adFeeJpy =
    totalForeignAmount > 0 && fxRate > 0
      ? roundJpy(
          totalForeignAmount *
            (1 + settings.buyerTaxRate) *
            settings.adRate *
            (1 + settings.feeTaxRate) *
            fxRate,
        )
      : 0;

  const payoneerFeeJpy =
    totalForeignAmount > 0 && fxRate > 0
      ? roundJpy(totalForeignAmount * fxRate * settings.payoneerRate)
      : 0;

  const customsDutyJpy =
    toNumber(input.customsDutyJpy) > 0
      ? roundJpy(toNumber(input.customsDutyJpy))
      : roundJpy(
          totalSalesJpy *
            Math.max(settings.customsFloorRate, settings.customsActualRate),
        );

  const requiredProfitJpy = Math.max(
    settings.minProfitJpy,
    totalSalesJpy * settings.minProfitRate,
  );

  const availableBeforePurchase =
    totalSalesJpy -
    shippingCostJpy -
    ebayFeeJpy -
    adFeeJpy -
    payoneerFeeJpy -
    customsDutyJpy -
    requiredProfitJpy;

  const refundRate = 1 / settings.refundDivisor;
  const safePurchaseLimitJpy =
    availableBeforePurchase <= 0
      ? 0
      : Math.floor(availableBeforePurchase / (1 - refundRate));

  return {
    safePurchaseLimitJpy,
    requiredProfitJpy: roundJpy(requiredProfitJpy),
    ebayFeeJpy,
    adFeeJpy,
    payoneerFeeJpy,
    customsDutyJpy,
    refundDivisor: settings.refundDivisor,
  };
}
