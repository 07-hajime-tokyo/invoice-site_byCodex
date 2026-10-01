import {
  getInventoryDisplayCategory,
  getInventoryLabelIds,
  getManagementNo,
  normalizeInventoryCategoryName,
} from "./display";
import type { InventoryItem } from "./types";

/** カテゴリプルダウン候補の集計（管理カテゴリ + 在庫カテゴリを正規化・ja順） */
export function buildCategoryOptions(
  inventories: InventoryItem[] | undefined,
  managedCategories: string[] | undefined,
): string[] {
    const cats = new Set<string>();
    for (const cat of managedCategories ?? []) {
      if (cat && cat !== "すべて" && cat !== "未分類") cats.add(normalizeInventoryCategoryName(cat));
    }
    for (const inv of (inventories ?? []) as InventoryItem[]) {
      if (inv.quantity === null || inv.quantity === undefined) continue;
      const cat = getInventoryDisplayCategory(inv);
      if (cat && cat !== "未分類") cats.add(cat);
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b, "ja"));
}

/** カテゴリ + 検索フィルターと更新日（なければ登録日）降順ソート */
export function filterAndSortInventories(
  inventories: InventoryItem[] | undefined,
  searchQuery: string,
  selectedCategory: string,
  hideZeroStock: boolean,
): InventoryItem[] {
    if (!inventories) return [];
    // 検索クエリのスペースを除去（「PSP2000」→「PSP 2000」もマッチ）
    const q = searchQuery.toLowerCase().replace(/\s+/g, "");
    return (inventories as InventoryItem[])
      .filter((inv) => {
        if (inv.quantity === null || inv.quantity === undefined) return false;
        if (hideZeroStock && parseFloat(inv.quantity ?? "0") <= 0) return false;
        const cat = getInventoryDisplayCategory(inv);
        if (selectedCategory !== "すべて" && cat !== selectedCategory) return false;
        if (q) {
          const managementNo = getManagementNo(inv.etc).toLowerCase().replace(/\s+/g, "");
          const labelText = getInventoryLabelIds(inv).join(" ").toLowerCase().replace(/\s+/g, "");
          return (
            inv.title.toLowerCase().replace(/\s+/g, "").includes(q) ||
            (inv.category ?? "").toLowerCase().replace(/\s+/g, "").includes(q) ||
            (inv.place ?? "").toLowerCase().replace(/\s+/g, "").includes(q) ||
            managementNo.includes(q) ||
            labelText.includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const da = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
        const db = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
        return db - da;
      });
}
