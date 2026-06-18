export type EbayStockType = "stocked" | "dropship";

export function extractManagementNo(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const firstPart = raw.split(",")[0]?.trim() ?? "";
  return firstPart.split(/\s+/)[0]?.trim() ?? "";
}

export function isEbayManagementNo(value: string | null | undefined): boolean {
  return /^E/i.test(extractManagementNo(value));
}

export function getEbayStockType(value: string | null | undefined): EbayStockType | null {
  const managementNo = extractManagementNo(value);
  if (!/^E/i.test(managementNo)) return null;

  const dateMatch = managementNo.match(/^E(\d{4})(?:[_-]|$)/i);
  if (!dateMatch) return "dropship";

  const month = Number(dateMatch[1].slice(0, 2));
  const day = Number(dateMatch[1].slice(2, 4));
  if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
    return "stocked";
  }
  return "dropship";
}

export function getEbayStockTypeLabel(type: EbayStockType | null): string {
  if (type === "stocked") return "有在庫";
  if (type === "dropship") return "無在庫";
  return "";
}

