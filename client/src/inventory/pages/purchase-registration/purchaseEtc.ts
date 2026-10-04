import { cleanLegacyManagementNo } from "@shared/purchaseMetadata";

// This keeps the legacy three-field representation, including undefined versus empty supplier.

export function buildEtcWithManagementNo(
  managementNo: string,
  currentEtc?: string | null,
  supplierName?: string | null,
): string {
  const parts = (currentEtc ?? "").split(",").map((part) => part.trim());
  const nextManagementNo = cleanLegacyManagementNo(managementNo);
  const datePart = parts[1] ?? "";
  const supplierPart = supplierName === undefined ? parts[2] ?? "" : (supplierName ?? "").trim();
  if (!nextManagementNo && !datePart && !supplierPart) return "";
  if (datePart || supplierPart) return [nextManagementNo, datePart, supplierPart].join(", ");
  return nextManagementNo;
}
