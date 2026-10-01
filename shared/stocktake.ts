import {
  normalizeOutboundScan,
  PRODUCT_LABEL_PATTERN,
  OUTBOUND_BOX_CODE_PATTERN,
} from "./outboundBoxes";

export type StocktakeRow = {
  id: number;
  title: string;
  category: string;
  managementNo: string;
  quantity: number;
  unitPrice: number;
  labelIds: string[];
};
export type StocktakeLabel = {
  code: string;
  title: string;
  inventoryId: number | null;
  status: string;
  invoiceNo: string | null;
  boxCode: string | null;
};
export type StocktakeBox = { code: string; status: string; labels: string[] };
export type StocktakeSnapshot = {
  rows: StocktakeRow[];
  labels: StocktakeLabel[];
  boxes: StocktakeBox[];
  capturedAt: string;
};
export type StocktakeScan = { code: string; at: string; operator: string };
export type StocktakeState = {
  scans: StocktakeScan[];
  manual: Record<string, { quantity: number; at: string; operator: string }>;
  notes: string;
};
export const emptyStocktakeState = (): StocktakeState => ({
  scans: [],
  manual: {},
  notes: "",
});
export function stocktakeCode(raw: string) {
  const code = normalizeOutboundScan(raw);
  if (
    !PRODUCT_LABEL_PATTERN.test(code) &&
    !OUTBOUND_BOX_CODE_PATTERN.test(code)
  )
    throw new Error(
      "商品QR（英字7文字）か箱QR（Bと数字6桁）を読み取ってください"
    );
  return code;
}
export function stocktakeScanResult(snapshot: StocktakeSnapshot, code: string) {
  const box = snapshot.boxes.find(b => b.code === code);
  if (box)
    return {
      kind: box.status === "shipped" ? "unexpected" : "box",
      title: `箱 ${code}（${box.labels.length}点・${box.status}）`,
    };
  const label = snapshot.labels.find(l => l.code === code);
  if (!label) return { kind: "unknown", title: "登録のないQR" };
  if (snapshot.rows.some(r => r.labelIds.includes(code)))
    return { kind: "stock", title: label.title };
  if (
    label.boxCode &&
    snapshot.boxes.some(b => b.code === label.boxCode && b.status === "sealed")
  )
    return { kind: "packed", title: label.title };
  return {
    kind: "unexpected",
    title: `${label.title}（登録状態: ${label.status}）`,
  };
}
export function summarizeStocktake(
  snapshot: StocktakeSnapshot,
  state: StocktakeState
) {
  const scanned = new Set(state.scans.map(s => s.code));
  const rows = snapshot.rows.map(row => {
    const confirmedLabels = row.labelIds.filter(id => scanned.has(id));
    const manualCapacity = Math.max(0, row.quantity - row.labelIds.length);
    const manualCount = state.manual[String(row.id)]?.quantity ?? 0;
    const confirmed = confirmedLabels.length + manualCount;
    return {
      ...row,
      confirmed,
      manualCapacity,
      manualCount,
      missing: Math.max(0, row.quantity - confirmed),
      excess: Math.max(0, confirmed - row.quantity),
      unscanned: row.labelIds.filter(id => !scanned.has(id)),
      labelConflict: row.labelIds.length > row.quantity,
    };
  });
  const exceptions = state.scans
    .map(scan => ({ ...scan, ...stocktakeScanResult(snapshot, scan.code) }))
    .filter(s => s.kind === "unknown" || s.kind === "unexpected");
  const boxes = snapshot.boxes
    .filter(b => b.status !== "shipped" && b.labels.length > 0)
    .map(b => ({
      ...b,
      boxConfirmed: scanned.has(b.code),
      confirmedContents: b.labels.filter(code => scanned.has(code)).length,
    }));
  const money = (n: number) => Math.round(n * 100) / 100;
  return {
    rows,
    exceptions,
    boxes,
    expected: rows.reduce((n, r) => n + r.quantity, 0),
    confirmed: rows.reduce((n, r) => n + r.confirmed, 0),
    missing: rows.reduce((n, r) => n + r.missing, 0),
    expectedAmount: money(
      rows.reduce((n, r) => n + r.quantity * r.unitPrice, 0)
    ),
    confirmedAmount: money(
      rows.reduce((n, r) => n + r.confirmed * r.unitPrice, 0)
    ),
    differences:
      rows.filter(r => r.missing || r.excess || r.labelConflict).length +
      exceptions.length,
    zeroPriceRows: rows.filter(r => r.unitPrice <= 0).length,
  };
}
