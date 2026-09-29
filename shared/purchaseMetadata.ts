/** Legacy purchase metadata uses comma-separated management number, date and supplier fields. */
export function cleanLegacyManagementNo(value?: string | null): string {
  const firstPart = (value ?? "").split(",")[0]?.trim() ?? "";
  return firstPart.split(/\s+\/\s+/)[0]?.trim() ?? firstPart;
}

export function parsePurchaseEtc(etc?: string | null): {
  managementNo: string;
  supplierSite: string;
} {
  if (!etc) return { managementNo: "", supplierSite: "" };
  const parts = etc.split(",").map(part => part.trim());
  return {
    managementNo: cleanLegacyManagementNo(parts[0]),
    supplierSite: parts[2] ?? "",
  };
}
