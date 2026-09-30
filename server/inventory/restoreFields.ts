import { getDeletedInventories, getInventoryMemos, getLocalInventories } from "./db";
import { getInventoryManagementNo } from "./managementNo";

type LocalInventoryRow = Awaited<ReturnType<typeof getLocalInventories>>[number];
type InventoryMemoRow = Awaited<ReturnType<typeof getInventoryMemos>>[number];

export type InventoryRestoreField =
  | "title"
  | "quantity"
  | "unit"
  | "category"
  | "place"
  | "etc"
  | "unitPrice"
  | "supplierName"
  | "supplierUrl"
  | "ebayListingUrl"
  | "ebayOrderUrl"
  | "ebayOrderStatus";

const INVENTORY_RESTORE_FIELD_LABELS: Record<string, InventoryRestoreField> = {
  商品名: "title",
  在庫数: "quantity",
  単位: "unit",
  カテゴリ: "category",
  保管場所: "place",
  "管理番号・備考": "etc",
  仕入単価: "unitPrice",
  仕入先: "supplierName",
  仕入先URL: "supplierUrl",
  eBay出品URL: "ebayListingUrl",
  eBay注文URL: "ebayOrderUrl",
  eBay状態: "ebayOrderStatus",
};

export function parseInventoryRestoreMemo(memo: string | null | undefined): Partial<Record<InventoryRestoreField, string | null>> {
  const restored: Partial<Record<InventoryRestoreField, string | null>> = {};
  for (const part of String(memo ?? "").split(" / ")) {
    const separatorIndex = part.indexOf(": ");
    if (separatorIndex < 0) continue;
    const field = INVENTORY_RESTORE_FIELD_LABELS[part.slice(0, separatorIndex).trim()];
    if (!field) continue;

    const valuePart = part.slice(separatorIndex + 2);
    const arrowIndex = valuePart.indexOf(" → ");
    if (arrowIndex < 0) continue;
    const before = valuePart.slice(0, arrowIndex).trim();
    restored[field] = before === "（空）" ? null : before;
  }
  return restored;
}

export const INVENTORY_RESTORE_FIELDS = [
  "title",
  "quantity",
  "unit",
  "category",
  "place",
  "etc",
  "unitPrice",
  "supplierName",
  "supplierUrl",
  "ebayListingUrl",
  "ebayOrderUrl",
  "ebayOrderStatus",
] as const satisfies readonly InventoryRestoreField[];

const INVENTORY_RESTORE_FIELD_NAMES: Record<InventoryRestoreField, string> = {
  title: "商品名",
  quantity: "在庫数",
  unit: "単位",
  category: "カテゴリ",
  place: "保管場所",
  etc: "管理番号・備考",
  unitPrice: "仕入単価",
  supplierName: "仕入先",
  supplierUrl: "仕入先URL",
  ebayListingUrl: "eBay出品URL",
  ebayOrderUrl: "eBay注文URL",
  ebayOrderStatus: "eBay状態",
};

export function normalizeRestoreSearchText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function inventoryRestoreValue(inventory: LocalInventoryRow, field: InventoryRestoreField): string | null {
  if (field === "quantity") return String(Math.max(0, Math.round(Number(inventory.quantity) || 0)));
  if (field === "unitPrice") return inventory.unitPrice == null ? null : String(inventory.unitPrice);
  const value = inventory[field as keyof LocalInventoryRow];
  return value == null ? null : String(value);
}

export function restoreSearchInventoryHaystack(inventory: LocalInventoryRow): string {
  const labelText = (inventory.itemLabels ?? [])
    .map((label) => `${label.labelId ?? ""} ${label.legacyManagementNo ?? ""}`)
    .join(" ");
  return normalizeRestoreSearchText([
    inventory.id,
    inventory.zaicoId,
    inventory.title,
    inventory.category,
    inventory.place,
    inventory.etc,
    inventory.supplierName,
    inventory.supplierUrl,
    getInventoryManagementNo(inventory.etc),
    labelText,
  ].filter(Boolean).join(" "));
}

export function restoreSearchDeletedHaystack(item: Awaited<ReturnType<typeof getDeletedInventories>>[number]): string {
  return normalizeRestoreSearchText([
    item.id,
    item.zaicoId,
    item.title,
    item.category,
    item.place,
    item.etc,
    item.unitPrice,
    item.deletedBy,
    getInventoryManagementNo(item.etc),
  ].filter(Boolean).join(" "));
}

export function parsedRestoreFieldsForMemo(memo: InventoryMemoRow, inventory: LocalInventoryRow | null) {
  const restored = parseInventoryRestoreMemo(memo.memo);
  return (Object.keys(restored) as InventoryRestoreField[])
    .filter((field) => INVENTORY_RESTORE_FIELDS.includes(field))
    .map((field) => ({
      field,
      label: INVENTORY_RESTORE_FIELD_NAMES[field],
      restoreValue: restored[field],
      currentValue: inventory ? inventoryRestoreValue(inventory, field) : null,
    }));
}
