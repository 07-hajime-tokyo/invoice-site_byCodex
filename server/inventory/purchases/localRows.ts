import type { InboundClass } from "@shared/inboundPipeline";
import type { LocalInventory, LocalPurchase } from "../../../drizzle/schema";
import { withStoredPurchaseExtra, type PurchaseExtraView } from "./storedExtra";

export type InboundInfo = {
  inboundClass: InboundClass | null;
  classSource: "auto" | "manual";
  stage: string;
  stageUpdatedBy: string | null;
  shaftParentPurchaseId: number | null;
};

type PurchaseSource = Pick<
  LocalPurchase,
  | "id"
  | "zaicoId"
  | "localInventoryId"
  | "purchaseNum"
  | "purchaseDate"
  | "shipDate"
  | "trackingNumber"
  | "carrier"
  | "note"
  | "supplierName"
  | "supplierUrl"
  | "itemsJson"
  | "managementNo"
  | "category"
  | "title"
  | "quantity"
  | "unitPrice"
>;

export type PurchaseInventoryInfo = Pick<
  LocalInventory,
  "supplierName" | "supplierUrl" | "ebayListingUrl" | "quantity"
>;

/** 取得済み在庫の表示用情報。重複IDは従来どおり後の値を優先する。 */
export function createPurchaseInventoryMap(
  inventories: ReadonlyArray<PurchaseInventoryInfo & { id: number }>
) {
  const map = new Map<number, PurchaseInventoryInfo>();
  for (const inv of inventories) {
    map.set(inv.id, {
      supplierName: inv.supplierName ?? null,
      supplierUrl: inv.supplierUrl ?? null,
      ebayListingUrl: inv.ebayListingUrl ?? null,
      quantity: inv.quantity ?? null,
    });
  }
  return map;
}

type LocalPurchaseRowContext<T, Label> = {
  extrasById: ReadonlyMap<number, PurchaseExtraView>;
  inventoryById: ReadonlyMap<number, PurchaseInventoryInfo>;
  inbound?: InboundInfo;
  getDisplayStatus: (purchase: T) => string;
  getItemLabels: (purchase: T, item: Record<string, unknown>) => Label[];
};

/**
 * 取得・補完済みの発注を表示行に変換する。ここではDBや外部APIに接続しない。
 * ラベル照合と履歴を含む状態判定は、既存の業務処理を呼出元から渡す。
 */
export function buildLocalPurchaseRow<T extends PurchaseSource, Label>(
  p: T,
  context: LocalPurchaseRowContext<T, Label>
) {
  const invSupplierMap = context.inventoryById;
  const purchaseWithExtra = withStoredPurchaseExtra(p, context.extrasById);
  const inv = purchaseWithExtra.localInventoryId
    ? invSupplierMap.get(purchaseWithExtra.localInventoryId)
    : null;
  const inbound = context.inbound;
  const displayStatus = context.getDisplayStatus(purchaseWithExtra);
  return {
    id: purchaseWithExtra.zaicoId ?? purchaseWithExtra.id,
    num: purchaseWithExtra.purchaseNum ?? "",
    purchase_date: purchaseWithExtra.purchaseDate ?? null,
    status: displayStatus,
    csvSupplierName:
      purchaseWithExtra.supplierName ?? inv?.supplierName ?? null,
    csvSupplierUrl: purchaseWithExtra.supplierUrl ?? inv?.supplierUrl ?? null,
    inboundClass: inbound?.inboundClass ?? null,
    classSource: inbound?.classSource ?? "auto",
    stage: inbound?.stage ?? "received",
    stageUpdatedBy: inbound?.stageUpdatedBy ?? null,
    shaftParentPurchaseId: inbound?.shaftParentPurchaseId ?? null,
    extra: {
      shipDate: purchaseWithExtra.shipDate ?? null,
      trackingNumber: purchaseWithExtra.trackingNumber ?? null,
      carrier: purchaseWithExtra.carrier ?? null,
      note: purchaseWithExtra.note ?? null,
    },
    purchase_items: (() => {
      try {
        const items = JSON.parse(purchaseWithExtra.itemsJson ?? "[]");
        return Array.isArray(items)
          ? items.map((item: Record<string, unknown>) => {
              const parsedInventoryId = Number(
                item.inventory_id ??
                  item.inventoryId ??
                  purchaseWithExtra.localInventoryId
              );
              const inventoryId = Number.isFinite(parsedInventoryId)
                ? parsedInventoryId
                : null;
              const invInfo =
                inventoryId != null ? invSupplierMap.get(inventoryId) : null;
              const itemEtc =
                typeof item.etc === "string" && item.etc.trim()
                  ? item.etc
                  : (purchaseWithExtra.managementNo ?? undefined);
              return {
                ...item,
                status:
                  displayStatus === "purchased" || displayStatus === "shipped"
                    ? displayStatus
                    : item.status,
                inventory_id: inventoryId,
                etc: itemEtc,
                category: purchaseWithExtra.category ?? "未分類",
                currentInventoryQuantity: invInfo?.quantity ?? null,
                itemLabels: context.getItemLabels(purchaseWithExtra, item),
              };
            })
          : [];
      } catch {
        const invInfo = purchaseWithExtra.localInventoryId
          ? invSupplierMap.get(purchaseWithExtra.localInventoryId)
          : null;
        return [
          {
            id: purchaseWithExtra.id,
            title: purchaseWithExtra.title,
            quantity: String(purchaseWithExtra.quantity ?? 1),
            unit_price: purchaseWithExtra.unitPrice ?? null,
            etc: purchaseWithExtra.managementNo ?? null,
            status: displayStatus,
            inventory_id: purchaseWithExtra.localInventoryId ?? null,
            category: purchaseWithExtra.category ?? "未分類",
            currentInventoryQuantity: invInfo?.quantity ?? null,
            itemLabels: context.getItemLabels(purchaseWithExtra, {
              inventory_id: purchaseWithExtra.localInventoryId,
            }),
          },
        ];
      }
    })(),
  };
}

/** 新しく作った表示明細だけに在庫数量・出品URLを付ける。入力のDB行は変更しない。 */
export function attachPurchaseInventoryInfo(
  rows: ReadonlyArray<{ purchase_items: unknown[] }>,
  invSupplierMap: ReadonlyMap<number, PurchaseInventoryInfo>
) {
  for (const row of rows) {
    for (const item of row.purchase_items as Array<Record<string, unknown>>) {
      const itemInventoryId = Number(item.inventory_id ?? item.inventoryId);
      const invInfo = Number.isFinite(itemInventoryId)
        ? invSupplierMap.get(itemInventoryId)
        : null;
      item.ebayListingUrl = invInfo?.ebayListingUrl ?? null;
      item.currentInventoryQuantity =
        item.currentInventoryQuantity ?? invInfo?.quantity ?? null;
    }
  }
}
