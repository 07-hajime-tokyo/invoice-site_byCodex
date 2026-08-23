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
  /** 仕入れ行として入庫済みか。ラベルの status だけでは未着かどうか分からない。 */
  purchaseReceived?: boolean;
  /** 発注として存在するか。既存在庫へ後から貼ったラベルは仕入れ行を持たない。 */
  purchaseLinked?: boolean;
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

/**
 * 表示から外してよい「終わった取引」の判定。
 *
 * 1) No.399以下は完了扱い（shared/tradeStatus.ts と同じ基準）
 * 2) 400以降でも、受注数まで出庫し終えたものは完了扱い（2026-08-16 村上さん指示）
 *
 * 出庫登録の仕組みができる前の取引は出庫済が0のまま残るため、
 * 「不足数 > 0」だけを条件にすると古い取引が永久に消えない。
 * 紙（InvoicePrintPack）と画面で同じ判定を使う。
 */
export function isCompletedInvoiceRollup(rollup: InboundInvoiceRollup): boolean {
  const invoiceNo = Number(rollup.key);
  if (!Number.isFinite(invoiceNo) || invoiceNo <= 399) return true;
  const ordered = Number(rollup.csvOrderQty) || 0;
  const delivered = Number(rollup.deliveredCount) || 0;
  return ordered > 0 && delivered >= ordered;
}

/** 進行中の取引だけを残す。 */
export function filterActiveInvoiceRollups(
  rollups: InboundInvoiceRollup[]
): InboundInvoiceRollup[] {
  return rollups.filter(rollup => !isCompletedInvoiceRollup(rollup));
}

/** 追跡番号ごとに束ねる。荷受け前後どちらの一覧にも使う。 */
export function groupLabelsByTracking(labels: InboundLabel[]): InboundBox[] {
  const boxes = new Map<string, InboundBox>();
  for (const label of labels) {
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
  return Array.from(boxes.values());
}

export type IncomingSummary = {
  /** 追跡番号が登録済みで、まだ荷受けしていない箱 */
  boxes: InboundBox[];
  /** 上記の台数 */
  labelCount: number;
  /** 発注済みだが追跡番号が未登録で、スキャンしても永久に当たらない個体 */
  untrackedLabels: InboundLabel[];
};

/**
 * 「到着予定」を出す。
 *
 * これまでの①受け取り／②動作確認はどちらも status="received" を数えていたため、
 * 荷受けボタンを押す前の荷物が画面のどこにも出ていなかった。
 */
export function summarizeIncoming(labels: InboundLabel[]): IncomingSummary {
  // status="ordered" は「まだ荷受けスキャンを通っていない」だけで、未着を意味しない。
  // 仕入れ行として入庫済みのものは、荷受け画面を通さない運用（ゴルフ系など）で
  // 永久に ordered のまま残るので、ここで落とす。
  const ordered = labels.filter(
    label =>
      label.status === "ordered" &&
      !label.purchaseReceived &&
      // 発注が無いものは届かない。既存在庫へ後から貼ったラベルがこれに当たる。
      label.purchaseLinked !== false
  );
  const tracked = ordered.filter(
    label => normalizeTrackingNumber(label.trackingNumber).length >= 4
  );
  const untrackedLabels = ordered.filter(
    label => normalizeTrackingNumber(label.trackingNumber).length < 4
  );
  const boxes = groupLabelsByTracking(tracked).sort((a, b) =>
    a.supplierName.localeCompare(b.supplierName, "ja")
  );
  return { boxes, labelCount: tracked.length, untrackedLabels };
}
