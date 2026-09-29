import type { LocalPurchase, PurchaseExtra } from "../../../drizzle/schema";

export type PurchaseExtraView = Pick<PurchaseExtra, "zaicoId"> &
  Partial<
    Pick<PurchaseExtra, "shipDate" | "trackingNumber" | "carrier" | "note">
  >;

type PurchaseWithExtraFields = Pick<
  LocalPurchase,
  | "id"
  | "zaicoId"
  | "localInventoryId"
  | "shipDate"
  | "trackingNumber"
  | "carrier"
  | "note"
>;

/** 発注ID → 外部ID → 在庫IDの順で保存済み情報を探し、発注行の空欄だけを補う。 */
export function withStoredPurchaseExtra<T extends PurchaseWithExtraFields>(
  row: T,
  extrasById: ReadonlyMap<number, PurchaseExtraView>
): T {
  const extra =
    extrasById.get(row.id) ??
    (row.zaicoId ? extrasById.get(row.zaicoId) : undefined) ??
    (row.localInventoryId ? extrasById.get(row.localInventoryId) : undefined) ??
    null;
  if (!extra) return row;
  return {
    ...row,
    shipDate: String(row.shipDate ?? "").trim()
      ? row.shipDate
      : (extra.shipDate ?? null),
    trackingNumber: String(row.trackingNumber ?? "").trim()
      ? row.trackingNumber
      : (extra.trackingNumber ?? null),
    carrier: String(row.carrier ?? "").trim()
      ? row.carrier
      : (extra.carrier ?? null),
    note: String(row.note ?? "").trim() ? row.note : (extra.note ?? null),
  };
}
