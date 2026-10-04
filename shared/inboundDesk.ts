/** 荷受・検品で使う結果。既存の defective も保存済みデータとの互換性のため残す。 */
export const INBOUND_INSPECTION_OUTCOMES = [
  "stocked",
  "defective",
  "junk",
  "returned",
] as const;
export type InspectionOutcome = (typeof INBOUND_INSPECTION_OUTCOMES)[number];

/** 不良と判定したときの仕分け先（旧データのdefectiveとは区別）。 */
export type DefectDestination = "junk" | "returned";

/** 荷受の割当は3桁の番号のみ。別領域の3〜5桁の照合とは契約が異なる。 */
export function inboundInvoiceAllocation(
  managementNo: string | null | undefined
) {
  const normalized = String(managementNo ?? "")
    .normalize("NFKC")
    .trim();
  const match = normalized.match(/^(\d{3})(?:_|$)/);
  if (!match) return { invoiceNo: null, partner: null };
  const partner = normalized.split("_")[1]?.trim() || null;
  return { invoiceNo: match[1], partner };
}

export function normalizeInboundTrackingNumber(value: string): string {
  return value.normalize("NFKC").trim().replace(/[\s-]/g, "").toLowerCase();
}
