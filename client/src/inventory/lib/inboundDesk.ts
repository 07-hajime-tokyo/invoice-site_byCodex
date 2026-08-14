export type InboundLabel = {
  labelId: string;
  status: string;
  title: string;
  legacyManagementNo: string;
  purchaseId: number | null;
  localInventoryId: number | null;
  trackingNumber: string;
  carrier: string;
  supplierName: string;
  category: string;
  receivedAt: string | null;
  updatedAt: string;
  inventoryCounted: boolean;
  defectTags?: string[];
  defectNote?: string;
  defectPhotoCount?: number;
  marketKeyword?: string;
  marketMedian?: number | null;
  marketFetchedAt?: string | null;
  defectiveSheetSyncedAt?: string | null;
};

export type InboundInvoiceSummary = {
  key: string;
  partner: string;
  csvOrderQty: number;
  deliveredCount: number;
  stockCount: number;
  orderedCount: number;
  purchasedCount: number;
  csvProducts: Array<{
    name: string;
    qty: number;
    status: string;
    paymentDate: string;
  }>;
};

export function normalizeTrackingNumber(value: string): string {
  return value.normalize("NFKC").trim().replace(/[\s-]/g, "").toLowerCase();
}

export function invoiceAllocation(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim();
  const match = normalized.match(/^(\d{3})(?:_|$)/);
  if (!match) return { invoiceNo: null, partner: null, label: "在庫用" };
  const partner = normalized.split("_")[1]?.trim() || null;
  return {
    invoiceNo: match[1],
    partner,
    label: `No.${match[1]}${partner ? ` ${partner}` : ""}`,
  };
}

export function matchInboundLabels(
  value: string,
  labels: InboundLabel[]
): InboundLabel[] {
  const normalizedValue = value.normalize("NFKC").trim();
  if (!normalizedValue) return [];
  const normalizedId = normalizedValue.toUpperCase();
  const exactLabelMatches = labels.filter(
    label => label.labelId.trim().toUpperCase() === normalizedId
  );
  if (exactLabelMatches.length > 0) return exactLabelMatches;

  const trackingValue = normalizeTrackingNumber(normalizedValue);
  if (trackingValue.length < 4) return [];
  return labels.filter(label => {
    const trackingNumber = normalizeTrackingNumber(label.trackingNumber);
    return (
      trackingNumber.length > 0 &&
      (trackingNumber.includes(trackingValue) ||
        trackingValue.includes(trackingNumber))
    );
  });
}

export type InboundBox = {
  key: string;
  trackingNumber: string;
  carrier: string;
  supplierName: string;
  receivedAt: string | null;
  labels: InboundLabel[];
};

export function groupInboundBoxes(labels: InboundLabel[]): InboundBox[] {
  const boxes = new Map<string, InboundBox>();
  for (const label of labels.filter(
    candidate => candidate.status === "received"
  )) {
    const normalizedTracking = normalizeTrackingNumber(label.trackingNumber);
    const key =
      normalizedTracking || `no-tracking:${label.purchaseId ?? label.labelId}`;
    const current = boxes.get(key);
    if (current) {
      current.labels.push(label);
      if (
        !current.receivedAt ||
        (label.receivedAt && label.receivedAt < current.receivedAt)
      ) {
        current.receivedAt = label.receivedAt;
      }
      continue;
    }
    boxes.set(key, {
      key,
      trackingNumber: label.trackingNumber,
      carrier: label.carrier,
      supplierName: label.supplierName,
      receivedAt: label.receivedAt,
      labels: [label],
    });
  }
  return Array.from(boxes.values()).sort((a, b) => {
    const aTime = a.receivedAt ? Date.parse(a.receivedAt) : 0;
    const bTime = b.receivedAt ? Date.parse(b.receivedAt) : 0;
    return aTime - bTime;
  });
}

export type InboundInvoiceRollup = InboundInvoiceSummary & {
  inboundCount: number;
  countedPendingCount: number;
  stockCountBeforeInspection: number;
  remainingBeforeInbound: number;
  stillShortAfterInbound: number;
  finalRemaining: number;
};

export function buildInboundInvoiceRollups(
  summaries: InboundInvoiceSummary[],
  pendingLabels: InboundLabel[]
): InboundInvoiceRollup[] {
  const inboundCounts = new Map<string, number>();
  const countedPendingCounts = new Map<string, number>();
  for (const label of pendingLabels.filter(
    candidate => candidate.status === "received"
  )) {
    const invoiceNo = invoiceAllocation(label.legacyManagementNo).invoiceNo;
    if (!invoiceNo) continue;
    inboundCounts.set(invoiceNo, (inboundCounts.get(invoiceNo) ?? 0) + 1);
    if (label.inventoryCounted) {
      countedPendingCounts.set(
        invoiceNo,
        (countedPendingCounts.get(invoiceNo) ?? 0) + 1
      );
    }
  }

  return summaries
    .map(summary => {
      const inboundCount = inboundCounts.get(summary.key) ?? 0;
      const countedPendingCount = countedPendingCounts.get(summary.key) ?? 0;
      const stockCountBeforeInspection = Math.max(
        0,
        summary.stockCount - countedPendingCount
      );
      const remainingBeforeInbound = Math.max(
        0,
        summary.csvOrderQty -
          summary.deliveredCount -
          stockCountBeforeInspection
      );
      return {
        ...summary,
        inboundCount,
        countedPendingCount,
        stockCountBeforeInspection,
        remainingBeforeInbound,
        stillShortAfterInbound: Math.max(
          0,
          remainingBeforeInbound - inboundCount
        ),
        finalRemaining: Math.max(
          0,
          summary.csvOrderQty - summary.deliveredCount - summary.stockCount
        ),
      };
    })
    .filter(summary => summary.inboundCount > 0 || summary.finalRemaining > 0)
    .sort((a, b) => Number(b.key) - Number(a.key));
}
