import { TradeRecord } from "@/lib/csvUtils";

export type FilterableKey = "year" | "monthFrom" | "monthTo" | "partner" | "currency" | "status";
export type ActiveTab = "trade" | "inventory" | "invoice";

export function runWhenIdle(callback: () => void, timeout = 12_000) {
  const win = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (win.requestIdleCallback) {
    const id = win.requestIdleCallback(callback, { timeout });
    return () => win.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, timeout);
  return () => window.clearTimeout(id);
}

export function normalizeTradeDataPartner(partner: string | null | undefined) {
  const trimmed = String(partner ?? "").trim();
  return trimmed.normalize("NFKC").toLowerCase() === "hennes kamusien" ? "サイモン" : trimmed;
}

// DBレコードをフロントエンドのTradeRecord型に変換する
export function dbRecordToTradeRecord(r: {
  id: number;
  month: string | null;
  partner: string | null;
  no: number | null;
  paymentDate: string | null;
  productName: string | null;
  quantity: string | null;
  unitPrice: string | null;
  currency: string | null;
  unitPriceJPY: string | null;
  status: string | null;
  procurement: string | null;
  shippingFromTokyo: string | null;
  totalSales: string | null;
  procurementTotal: string | null;
  refund: string | null;
  shippingCost: string | null;
  customsDuty?: string | null;
  profitWithRefund: string | null;
  cumulativeProfit: string | null;
}): TradeRecord & { customsDuty: number } {
  const paymentDate = r.paymentDate ?? "";
  // 年を抽出
  let year = "";
  if (paymentDate) {
    const m = paymentDate.match(/\b(20\d{2})\b/);
    if (m) year = m[1];
    else {
      try {
        const d = new Date(paymentDate);
        if (!isNaN(d.getTime())) year = String(d.getFullYear());
      } catch { /* ignore */ }
    }
  }
  const yearMonth = year && r.month ? `${year}-${String(r.month).padStart(2, "0")}` : "";
  const pf = (v: string | null, decimals = 0) => {
    const n = parseFloat(v ?? "0") || 0;
    return decimals === 0 ? Math.round(n) : Math.round(n * 10 ** decimals) / 10 ** decimals;
  };
  return {
    id: r.id,
    month: r.month ?? "",
    year,
    yearMonth,
    partner: normalizeTradeDataPartner(r.partner),
    no: r.no ?? 0,
    paymentDate,
    productName: r.productName ?? "",
    quantity: pf(r.quantity, 2),
    unitPrice: pf(r.unitPrice, 2),
    currency: r.currency ?? "",
    unitPriceJPY: pf(r.unitPriceJPY),
    status: r.status ?? "",
    procurement: r.procurement ?? "",
    shippingFromTokyo: r.shippingFromTokyo ?? "",
    totalSales: pf(r.totalSales),
    procurementTotal: pf(r.procurementTotal),
    refund: pf(r.refund),
    shippingCost: pf(r.shippingCost),
    profitWithRefund: pf(r.profitWithRefund),
    cumulativeProfit: pf(r.cumulativeProfit),
    customsDuty: pf(r.customsDuty ?? null),
  };
}
