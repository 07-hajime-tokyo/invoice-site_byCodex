// EditTradeDialog から抽出した型・純粋関数（逐語移動）
// 注意: getCurrencyForPartner は AddTradeDialog 版（addTradeModel.ts）と判定集合・
// デフォルトが異なるため統合しない（docs/trade-refactor.md 1.2 参照）。

export interface EditFormState {
  month: string;
  partner: string;
  invoiceNo: string;
  paymentDate: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  currency: "ユーロ" | "ドル";
  status: string;
  eurRate: string;
  usdRate: string;
  procurementTotal: string;
  refund: string;
  shippingCost: string;
  customsDuty: string;
}

export type TradeCurrency = EditFormState["currency"];

export function getCurrencyForPartner(partner: string): TradeCurrency | null {
  const normalized = partner.trim().toLowerCase();
  if (
    normalized.includes("ルカ") ||
    normalized.includes("luca") ||
    normalized.includes("サイモン") ||
    normalized.includes("simon") ||
    normalized.includes("マキシム") ||
    normalized.includes("maxim") ||
    normalized.includes("ネレ") ||
    normalized.includes("nele")
  ) {
    return "ユーロ";
  }
  if (normalized.includes("サミー") || normalized.includes("samee") || normalized.includes("デボン") || normalized.includes("devon")) {
    return "ドル";
  }
  return null;
}

export function normalizeCurrency(c: string, partner?: string): TradeCurrency {
  const partnerCurrency = getCurrencyForPartner(partner ?? "");
  if (partnerCurrency) return partnerCurrency;
  if (c === "ドル") return "ドル";
  return "ユーロ";
}
