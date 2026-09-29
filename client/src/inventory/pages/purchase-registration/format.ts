
export function toNumber(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function formatCurrency(value: unknown): string {
  const numberValue = toNumber(value);
  return `¥${numberValue.toLocaleString()}`;
}

export function formatEuro(value: unknown): string {
  const numberValue = toNumber(value);
  if (numberValue <= 0) return "-";
  return `€${numberValue.toLocaleString()}`;
}

export function formatTradePrice(value: unknown, currency?: string | null): string {
  const numberValue = toNumber(value);
  if (numberValue <= 0) return "-";
  const normalizedCurrency = (currency ?? "").toLowerCase();
  if (normalizedCurrency.includes("eur") || normalizedCurrency.includes("ユーロ")) {
    return `€${numberValue.toLocaleString()}`;
  }
  if (normalizedCurrency.includes("usd") || normalizedCurrency.includes("ドル")) {
    return `$${numberValue.toLocaleString()}`;
  }
  return numberValue.toLocaleString();
}

export function normalizeCurrencyLabel(currency?: string | null): string {
  const normalizedCurrency = (currency ?? "").toLowerCase();
  if (normalizedCurrency.includes("eur") || normalizedCurrency.includes("ユーロ")) return "EUR";
  if (normalizedCurrency.includes("usd") || normalizedCurrency.includes("ドル")) return "USD";
  return currency?.trim() || "";
}

export function formatDate(value?: string | null): string {
  if (!value) return "-";
  return value.slice(0, 10);
}
