// AddTradeDialog / EditTradeDialog で逐語一致していた共通ロジック（SSOT）

// frankfurter.dev/v1 から指定日（または最新）の EUR/USD → JPY レートを取得
export async function fetchFrankfurterRate(date?: string): Promise<{ eur: number; usd: number } | null> {
  try {
    const baseUrl = "https://api.frankfurter.dev/v1";
    const dateParam = date ?? "latest";
    const [eurRes, usdRes] = await Promise.all([
      fetch(`${baseUrl}/${dateParam}?base=EUR&symbols=JPY`),
      fetch(`${baseUrl}/${dateParam}?base=USD&symbols=JPY`),
    ]);
    if (!eurRes.ok || !usdRes.ok) return null;
    const [eurData, usdData] = await Promise.all([eurRes.json(), usdRes.json()]);
    const eurToJpy = eurData.rates?.JPY ? Math.round(eurData.rates.JPY * 100) / 100 : null;
    const usdToJpy = usdData.rates?.JPY ? Math.round(usdData.rates.JPY * 100) / 100 : null;
    if (!eurToJpy || !usdToJpy) return null;
    return { eur: eurToJpy, usd: usdToJpy };
  } catch {
    return null;
  }
}

// 日付文字列を YYYY-MM-DD 形式に正規化（例: 2025/3/15 → 2025-03-15）
export function normalizeDate(input: string): string | null {
  const cleaned = input.trim().replace(/\//g, "-");
  const match = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export const STATUS_PRESETS = ["complete", "途中", "残1台", "残2台", "残3台", "残5台", "残10台"];
