// 在庫サービス由来の金額表記を読む。入力フォームの数値検証とは別の契約。
export function parseMoneyNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const normalized = String(value)
    .normalize("NFKC")
    .replace(/[,\s￥¥円]/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  if (!normalized || normalized === "-" || normalized === ".") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
