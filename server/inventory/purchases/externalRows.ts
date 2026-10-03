import type { InventoryExtra, PurchaseExtra } from "../../../drizzle/schema";
import type { ZaicoInventory, ZaicoPurchase } from "../zaico";

type ExternalInventory = Pick<
  ZaicoInventory,
  "id" | "quantity" | "categories" | "category" | "etc"
>;
type ExternalPurchaseData<Inventory extends ExternalInventory> = {
  inventories: Inventory[];
  extras: PurchaseExtra[];
  inventoryExtras: InventoryExtra[];
};

type ExternalPurchaseMaps<Inventory extends ExternalInventory> = {
  inventoryById: ReadonlyMap<number, Inventory>;
  extrasById: ReadonlyMap<number, PurchaseExtra>;
  inventoryExtrasById: ReadonlyMap<number, InventoryExtra>;
};

/** 全件取得ではCSV通信の前、通常一覧ではラベル取得の後に同じ位置で作る。 */
export function createExternalPurchaseMaps<Inventory extends ExternalInventory>(
  data: ExternalPurchaseData<Inventory>
): ExternalPurchaseMaps<Inventory> {
  return {
    inventoryById: new Map(data.inventories.map(inv => [inv.id, inv])),
    extrasById: new Map(data.extras.map(extra => [extra.zaicoId, extra])),
    inventoryExtrasById: new Map(
      data.inventoryExtras.map(extra => [extra.zaicoInventoryId, extra])
    ),
  };
}

/** 管理番号だけの場合は在庫側の完全形式を補い、両方空ならundefinedを保持する。 */
function resolveItemEtc(itemEtcValue?: string, inventoryEtcValue?: string) {
  const itemEtc = itemEtcValue?.trim() ?? "";
  const invEtc = inventoryEtcValue?.trim() ?? "";
  if (itemEtc.includes(",")) return itemEtc;
  if (invEtc.includes(",")) return invEtc;
  return itemEtc || invEtc || undefined;
}

/** 取得済みデータだけを変換する。通信・ラベル作成・DB更新は呼出元の責務。 */
function buildExternalPurchaseRows<
  Inventory extends ExternalInventory,
  ItemFields extends object,
>(
  purchases: ZaicoPurchase[],
  data: ExternalPurchaseMaps<Inventory>,
  csvSuppliers: ReadonlyMap<string, string>,
  itemFields: (inventory: Inventory | undefined) => ItemFields
) {
  const {
    inventoryById: inventoryMap,
    extrasById: extrasMap,
    inventoryExtrasById: inventoryExtrasMap,
  } = data;
  return purchases.map(p => {
    const invExtra =
      p.purchase_items
        .map(item => inventoryExtrasMap.get(item.inventory_id))
        .find(
          extra => extra?.supplierName?.trim() || extra?.supplierUrl?.trim()
        ) ?? null;
    return {
      ...p,
      // 空文字も保存値。名前・URLは最初に条件に合う同じ追加情報から取る。
      csvSupplierName:
        invExtra?.supplierName ?? csvSuppliers.get(p.num) ?? null,
      csvSupplierUrl: invExtra?.supplierUrl ?? null,
      extra: extrasMap.get(p.id) ?? null,
      purchase_items: p.purchase_items.map(item => {
        const inv = inventoryMap.get(item.inventory_id);
        return {
          ...item,
          category: inv?.categories?.[0] ?? inv?.category ?? "未分類",
          ...itemFields(inv),
          etc: resolveItemEtc(item.etc, inv?.etc),
        };
      }),
    };
  });
}

/** 通常一覧だけに現在庫数と表示用ラベルを付ける。CSV補完はしない。 */
export function buildExternalPurchasePageRows<
  Label,
  View extends { labelId: string },
>(
  purchases: ZaicoPurchase[],
  data: ExternalPurchaseMaps<ExternalInventory & { itemLabels?: Label[] }>,
  toLabelView: (label: Label) => View
) {
  return buildExternalPurchaseRows(purchases, data, new Map(), inv => ({
    currentInventoryQuantity: inv?.quantity ?? null,
    itemLabels: inv?.itemLabels?.map(toLabelView) ?? [],
  }));
}

/** 全件取得だけにCSV補完を適用する。元の明細にある追加項目はそのまま残す。 */
export function buildExternalPurchaseAllRows(
  purchases: ZaicoPurchase[],
  data: ExternalPurchaseMaps<ExternalInventory>,
  csvSuppliers: ReadonlyMap<string, string>
) {
  return buildExternalPurchaseRows(purchases, data, csvSuppliers, () => ({}));
}
