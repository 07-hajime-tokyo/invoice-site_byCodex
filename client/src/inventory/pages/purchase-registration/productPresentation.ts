import { compactProductText } from "./productText";
import type { InventoryItem } from "./dataTypes";

export function getInventoryCategory(inventory: InventoryItem): string {
  return (inventory.categories?.[0] ?? inventory.category ?? "").trim();
}

export function stockModelName(title: string): string {
  const compact = compactProductText(title);
  const normalized = title.normalize("NFKC").toLowerCase();
  if (compact.includes("new3dsll") || compact.includes("new3dsxl")) return "New 3DS LL";
  if (compact.includes("new3ds")) return "New 3DS";
  if (compact.includes("new2dsll") || compact.includes("new2dsxl")) return "New 2DS LL";
  if (compact.includes("3dsll") || compact.includes("3dsxl")) return "3DS LL";
  if (compact.includes("2ds")) return "2DS";
  if (compact.includes("3ds")) return "3DS";
  if (compact.includes("dslite") || compact.includes("dsl")) return "DSLite";
  if (
    compact.includes("ゲームボーイプレーヤー") ||
    compact.includes("ゲームボーイプレイヤー") ||
    compact.includes("gameboyplayer")
  ) return "GC";
  if (compact.includes("gba") || compact.includes("gameboyadvance") || compact.includes("ゲームボーイアドバンス")) return "GBA";
  if (compact.includes("vita2000") || compact.includes("psvita2000")) return "PS Vita 2000";
  if (
    compact.includes("vita1000") ||
    compact.includes("psvita1000") ||
    compact.includes("vita1100") ||
    compact.includes("psvita1100")
  ) return "PS Vita 1000";
  if (compact.includes("psp3000")) return "PSP 3000";
  if (compact.includes("psp2000")) return "PSP 2000";
  if (compact.includes("psp1000")) return "PSP 1000";
  if (
    compact.includes("callaway") ||
    compact.includes("taylormade") ||
    compact.includes("キャロウェイ") ||
    compact.includes("テーラーメイド") ||
    /(^|[\s　])ping(?=($|[\s　a-z0-9]))/u.test(normalized) ||
    /(^|[\s　])ピン(?=($|[\s　a-z0-9]))/u.test(normalized)
  ) {
    return "ゴルフ";
  }
  if (compact.includes("switch") || compact.includes("スイッチ")) return "Switch";
  if (compact.includes("shaft") || compact.includes("シャフト")) return "シャフト";
  return "その他";
}

export const STOCK_MODEL_ORDER = [
  "New 3DS LL",
  "New 3DS",
  "New 2DS LL",
  "3DS LL",
  "3DS",
  "2DS",
  "DSLite",
  "GBA",
  "GC",
  "PS Vita 2000",
  "PS Vita 1000",
  "PSP 3000",
  "PSP 2000",
  "PSP 1000",
  "Switch",
  "ゴルフ",
  "シャフト",
  "その他",
];
