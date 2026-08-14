export const OUTBOUND_BOX_CODE_PATTERN = /^B\d{6}$/;
export const PRODUCT_LABEL_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{7}$/;

export type OutboundScanKind = "box" | "label" | "tracking" | "unknown";

export function normalizeOutboundScan(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, "").toUpperCase();
}

export function classifyOutboundScan(value: string): OutboundScanKind {
  const normalized = normalizeOutboundScan(value);
  if (OUTBOUND_BOX_CODE_PATTERN.test(normalized)) return "box";
  if (PRODUCT_LABEL_PATTERN.test(normalized)) return "label";
  if (/^[A-Z0-9-]{8,100}$/.test(normalized)) return "tracking";
  return "unknown";
}

export function formatOutboundBoxCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 999_999) {
    throw new Error("箱IDの発番上限（B999999）を超えています");
  }
  return `B${String(sequence).padStart(6, "0")}`;
}

export function invoiceNoFromManagementNo(value: string | null | undefined): string | null {
  return String(value ?? "").normalize("NFKC").trim().match(/^(\d{3,4})(?:_|$)/)?.[1] ?? null;
}

export type OutboundFedexItem = {
  labelId: string;
  invoiceNo: string | null;
  productNameJa: string;
  productNameEn: string;
  quantity: number;
  managementNo: string | null;
};

export function buildOutboundFedexItems(labels: Array<{
  labelId: string;
  title: string;
  legacyManagementNo?: string | null;
}>): OutboundFedexItem[] {
  return labels.map((label) => ({
    labelId: normalizeOutboundScan(label.labelId),
    invoiceNo: invoiceNoFromManagementNo(label.legacyManagementNo),
    productNameJa: label.title,
    productNameEn: label.title,
    quantity: 1,
    managementNo: label.legacyManagementNo?.trim() || null,
  }));
}

export function groupOutboundFedexItemsByInvoice(items: OutboundFedexItem[]): Map<string, OutboundFedexItem[]> {
  const groups = new Map<string, OutboundFedexItem[]>();
  for (const item of items) {
    const key = item.invoiceNo ?? "stock";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}
