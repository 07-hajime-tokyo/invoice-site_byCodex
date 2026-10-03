// Registration intentionally keeps its narrower keyword and punctuation rules.
import { inventoryItemCanMatchCsvProduct, isInvoice407AnimalCrossingWhiteBaseMatch } from "@shared/productMatching";
import { compactProductText, hasAnyProductText } from "./productText";

const LIMITED_EDITION_PRODUCT_KEYWORDS: Array<[string, string[]]> = [
  ["monster-ball", ["モンスターボール", "monster ball", "monsterball"]],
  ["minecraft", ["マインクラフト", "minecraft"]],
  ["animal-crossing", ["どうぶつの森", "animal crossing", "animalcrossing"]],
  ["pikachu", ["ピカチュウ", "pikachu"]],
  ["pokemon", ["ポケモン", "pokemon"]],
  ["mario", ["マリオ", "mario"]],
  ["luigi", ["ルイージ", "luigi"]],
  ["zelda", ["ゼルダ", "ハイラル", "zelda", "hyrule"]],
  ["limited", ["限定版", "限定", "limited edition", "limited"]],
];

export function limitedEditionProductKey(value: string): string | null {
  const compact = compactProductText(value);
  for (const [key, keywords] of LIMITED_EDITION_PRODUCT_KEYWORDS) {
    if (keywords.some((keyword) => compact.includes(compactProductText(keyword)))) return key;
  }
  return null;
}

export function isRandomColorProductTitle(value: string): boolean {
  return hasAnyProductText(value, ["ランダムカラー", "random color", "randomcolor"]);
}

export function limitedEditionKeysCompatible(a: string | null, b: string | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a === b || a === "limited" || b === "limited";
}

export function canMatchTargetProduct(candidateText: string, targetTitle?: string): boolean {
  if (!targetTitle) return true;
  if (isInvoice407AnimalCrossingWhiteBaseMatch(candidateText, targetTitle)) return true;
  const targetLimitedKey = limitedEditionProductKey(targetTitle);
  const candidateLimitedKey = limitedEditionProductKey(candidateText);
  if (targetLimitedKey || candidateLimitedKey) return limitedEditionKeysCompatible(targetLimitedKey, candidateLimitedKey);
  if (isRandomColorProductTitle(targetTitle) && candidateLimitedKey) return false;
  return true;
}

export function canMatchStockTargetProduct(candidateText: string, targetTitle?: string): boolean {
  if (!targetTitle) return true;
  return canMatchTargetProduct(candidateText, targetTitle) &&
    inventoryItemCanMatchCsvProduct(candidateText, targetTitle);
}
