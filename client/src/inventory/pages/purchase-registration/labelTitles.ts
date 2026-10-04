import { compactProductText } from "./productText";
import { parseInvoiceFromManagementNo } from "./invoiceIdentity";

export function labelAllocationLabel(managementNo: string): string {
  const parsed = parseInvoiceFromManagementNo(managementNo);
  if (!parsed) return "一般在庫";
  const orderTitle = labelOrderTitleFromManagementNo(managementNo);
  return orderTitle ? `No.${parsed.invoiceNo}-${orderTitle}` : `No.${parsed.invoiceNo}`;
}

export function labelOrderTitleFromManagementNo(managementNo: string): string {
  const normalized = managementNo.normalize("NFKC");
  const parts = normalized.split(/[_\s*]+/).filter(Boolean);
  const hint = parts.find((part, index) => index >= 2 && !/^\d+\s*\/\s*\d+$/.test(part));
  return hint ? formatLabelOrderTitle(hint) : "";
}

export function formatLabelOrderTitle(value: string): string {
  const compact = compactProductText(value);
  if (compact.includes("ホワイトベース") || compact.includes("whitebase")) return "3DSLL White base";
  if (compact.includes("モンスターボール") || compact.includes("monsterball")) return "New2DSLL Monster Ball";
  if (compact.includes("new3dsll") || compact.includes("new3dsxl")) return "New3DSLL Random color";
  if (compact.includes("new3ds")) return "New3DS Random color";
  if (compact.includes("new2dsll") || compact.includes("new2dsxl")) return "New2DSLL Random color";
  if (compact.includes("3dsll") || compact.includes("3dsxl")) return "3DSLL Random color";
  if (compact.includes("2ds")) return "2DS Random color";
  if (compact.includes("3ds")) return "3DS Random color";
  if (
    compact.includes("psvita1000") ||
    compact.includes("psvita1100") ||
    compact.includes("vita1000") ||
    compact.includes("vita1100")
  ) {
    return "Vita1000 Random color";
  }
  if (compact.includes("psvita2000") || compact.includes("vita2000")) return "Vita2000 Random color";
  if (compact.includes("psp3000")) return "PSP3000 Random color";
  if (compact.includes("psp2000")) return "PSP2000 Random color";
  if (compact.includes("pspgo")) return "PSP Go";
  return value
    .replace(/ランダムカラー/g, "Random color")
    .replace(/ホワイトベース/g, "White base")
    .replace(/[＿_]+/g, " ")
    .trim();
}

export function formatLabelPrintTitleLegacy(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/ランダムカラー/g, "Random color"],
    [/ホワイトベース/g, "White base"],
    [/限定版/g, "Limited edition"],
    [/ミント\s*[×xXＸｘ]\s*ホワイト/g, "Mint x White"],
    [/ホワイト\s*[×xXＸｘ]\s*ミント/g, "White x Mint"],
    [/パール\s*ホワイト/g, "Pearl White"],
    [/クリア\s*ブラック/g, "Clear Black"],
    [/クリア\s*ブルー/g, "Clear Blue"],
    [/クリア\s*レッド/g, "Clear Red"],
    [/コスモ\s*ブラック/g, "Cosmo Black"],
    [/メタリック\s*ブラック/g, "Metallic Black"],
    [/メタリック\s*ブルー/g, "Metallic Blue"],
    [/メタリック\s*レッド/g, "Metallic Red"],
    [/アクア\s*[・･]?\s*ブルー/g, "Aqua Blue"],
    [/サファイア\s*[・･]?\s*ブルー/g, "Sapphire Blue"],
    [/クリスタル\s*[・･]?\s*ブラック/g, "Crystal Black"],
    [/クリスタル\s*[・･]?\s*ホワイト/g, "Crystal White"],
    [/ピアノ\s*[・･]?\s*ブラック/g, "Piano Black"],
    [/セラミック\s*[・･]?\s*ホワイト/g, "Ceramic White"],
    [/ミスティ\s*ピンク/g, "Misty Pink"],
    [/コズミック\s*[・･]?\s*ブラック/g, "Cosmic Black"],
    [/コズミック\s*[・･]?\s*レッド/g, "Cosmic Red"],
    [/ライム\s*[・･]?\s*グリーン/g, "Lime Green"],
    [/グレイシャー\s*[・･]?\s*ホワイト/g, "Glacier White"],
    [/バイブラント\s*[・･]?\s*ブルー/g, "Vibrant Blue"],
    [/ラディアント\s*[・･]?\s*レッド/g, "Radiant Red"],
    [/コバルト\s*[・･]?\s*ブルー/g, "Cobalt Blue"],
    [/ライト\s*[・･]?\s*ブルー/g, "Light Blue"],
    [/レッド\s*[・･]\s*ブルー\s*[・･]\s*ホワイト/g, "Red, Blue, White"],
    [/ブルー\s*[・･]\s*ホワイト/g, "Blue, White"],
    [/レッド\s*[・･]\s*ホワイト/g, "Red, White"],
    [/レッド\s*[・･]\s*ブルー/g, "Red, Blue"],
    [/コズミック/g, "Cosmic"],
    [/クリスタル/g, "Crystal"],
    [/ライム/g, "Lime"],
    [/グレイシャー/g, "Glacier"],
    [/バイブラント/g, "Vibrant"],
    [/ラディアント/g, "Radiant"],
    [/コバルト/g, "Cobalt"],
    [/ライト\s*ブルー/g, "Light Blue"],
    [/ブラック/g, "Black"],
    [/ホワイト/g, "White"],
    [/ブルー/g, "Blue"],
    [/レッド/g, "Red"],
    [/グリーン/g, "Green"],
    [/イエロー/g, "Yellow"],
    [/オレンジ/g, "Orange"],
    [/シルバー/g, "Silver"],
    [/ゴールド/g, "Gold"],
    [/ラベンダー/g, "Lavender"],
    [/ミント/g, "Mint"],
  ];

  return replacements
    .reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value.trim())
    .replace(/\s*×\s*/g, " x ")
    .replace(/[＿_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceAllText(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}

export function formatLabelPrintTitle(value: string): string {
  const legacyFormatted = formatLabelPrintTitleLegacy(value);
  const replacements: Array<[RegExp, string]> = [
    [/\u30e9\u30f3\u30c0\u30e0\u30ab\u30e9\u30fc/g, "Random color"],
    [/\u30db\u30ef\u30a4\u30c8\u30d9\u30fc\u30b9/g, "White base"],
    [/\u9650\u5b9a\u7248/g, "Limited edition"],
    [/\u3069\u3046\u3076\u3064\u306e\u68ee/g, "Animal Crossing"],
    [/\u30df\u30f3\u30c8\s*[\u00d7xX\uFF38\uFF58]\s*\u30db\u30ef\u30a4\u30c8/g, "Mint x White"],
    [/\u30db\u30ef\u30a4\u30c8\s*[\u00d7xX\uFF38\uFF58]\s*\u30df\u30f3\u30c8/g, "White x Mint"],
    [/\u30df\u30f3\u30c8\s*\u30db\u30ef\u30a4\u30c8/g, "Mint x White"],
    [/\u30db\u30ef\u30a4\u30c8\s*\u30df\u30f3\u30c8/g, "White x Mint"],
    [/\u30d1\u30fc\u30eb\s*\u30db\u30ef\u30a4\u30c8/g, "Pearl White"],
    [/\u30af\u30ea\u30a2\s*\u30d6\u30e9\u30c3\u30af/g, "Clear Black"],
    [/\u30af\u30ea\u30a2\s*\u30d6\u30eb\u30fc/g, "Clear Blue"],
    [/\u30af\u30ea\u30a2\s*\u30ec\u30c3\u30c9/g, "Clear Red"],
    [/\u30b3\u30b9\u30e2\s*\u30d6\u30e9\u30c3\u30af/g, "Cosmo Black"],
    [/\u30e1\u30bf\u30ea\u30c3\u30af\s*\u30d6\u30e9\u30c3\u30af/g, "Metallic Black"],
    [/\u30e1\u30bf\u30ea\u30c3\u30af\s*\u30d6\u30eb\u30fc/g, "Metallic Blue"],
    [/\u30e1\u30bf\u30ea\u30c3\u30af\s*\u30ec\u30c3\u30c9/g, "Metallic Red"],
    [/\u30a2\u30af\u30a2\s*[\u30fb\u00b7]?\s*\u30d6\u30eb\u30fc/g, "Aqua Blue"],
    [/\u30b5\u30d5\u30a1\u30a4\u30a2\s*[\u30fb\u00b7]?\s*\u30d6\u30eb\u30fc/g, "Sapphire Blue"],
    [/\u30af\u30ea\u30b9\u30bf\u30eb\s*[\u30fb\u00b7]?\s*\u30d6\u30e9\u30c3\u30af/g, "Crystal Black"],
    [/\u30af\u30ea\u30b9\u30bf\u30eb\s*[\u30fb\u00b7]?\s*\u30db\u30ef\u30a4\u30c8/g, "Crystal White"],
    [/\u30d4\u30a2\u30ce\s*[\u30fb\u00b7]?\s*\u30d6\u30e9\u30c3\u30af/g, "Piano Black"],
    [/\u30bb\u30e9\u30df\u30c3\u30af\s*[\u30fb\u00b7]?\s*\u30db\u30ef\u30a4\u30c8/g, "Ceramic White"],
    [/\u30df\u30b9\u30c6\u30a3\s*\u30d4\u30f3\u30af/g, "Misty Pink"],
    [/\u30b3\u30ba\u30df\u30c3\u30af\s*[\u30fb\u00b7]?\s*\u30d6\u30e9\u30c3\u30af/g, "Cosmic Black"],
    [/\u30b3\u30ba\u30df\u30c3\u30af\s*[\u30fb\u00b7]?\s*\u30ec\u30c3\u30c9/g, "Cosmic Red"],
    [/\u30e9\u30a4\u30e0\s*[\u30fb\u00b7]?\s*\u30b0\u30ea\u30fc\u30f3/g, "Lime Green"],
    [/\u30b0\u30ec\u30a4\u30b7\u30e3\u30fc\s*[\u30fb\u00b7]?\s*\u30db\u30ef\u30a4\u30c8/g, "Glacier White"],
    [/\u30d0\u30a4\u30d6\u30e9\u30f3\u30c8\s*[\u30fb\u00b7]?\s*\u30d6\u30eb\u30fc/g, "Vibrant Blue"],
    [/\u30e9\u30c7\u30a3\u30a2\u30f3\u30c8\s*\u30ec\u30c3\u30c9/g, "Radiant Red"],
    [/\u30b3\u30d0\u30eb\u30c8\s*[\u30fb\u00b7]?\s*\u30d6\u30eb\u30fc/g, "Cobalt Blue"],
    [/\u30e9\u30a4\u30c8\s*[\u30fb\u00b7]?\s*\u30d6\u30eb\u30fc/g, "Light Blue"],
    [/\u30ec\u30c3\u30c9\s*[\u30fb\u00b7]\s*\u30d6\u30eb\u30fc\s*[\u30fb\u00b7]\s*\u30db\u30ef\u30a4\u30c8/g, "Red, Blue, White"],
    [/\u30d6\u30eb\u30fc\s*[\u30fb\u00b7]\s*\u30db\u30ef\u30a4\u30c8/g, "Blue, White"],
    [/\u30ec\u30c3\u30c9\s*[\u30fb\u00b7]\s*\u30db\u30ef\u30a4\u30c8/g, "Red, White"],
    [/\u30ec\u30c3\u30c9\s*[\u30fb\u00b7]\s*\u30d6\u30eb\u30fc/g, "Red, Blue"],
    [/\u30b3\u30ba\u30df\u30c3\u30af/g, "Cosmic"],
    [/\u30af\u30ea\u30b9\u30bf\u30eb/g, "Crystal"],
    [/\u30e9\u30a4\u30e0/g, "Lime"],
    [/\u30b0\u30ec\u30a4\u30b7\u30e3\u30fc/g, "Glacier"],
    [/\u30d0\u30a4\u30d6\u30e9\u30f3\u30c8/g, "Vibrant"],
    [/\u30e9\u30c7\u30a3\u30a2\u30f3\u30c8/g, "Radiant"],
    [/\u30b3\u30d0\u30eb\u30c8/g, "Cobalt"],
    [/\u30e9\u30a4\u30c8\s*\u30d6\u30eb\u30fc/g, "Light Blue"],
    [/\u30d6\u30e9\u30c3\u30af/g, "Black"],
    [/\u30db\u30ef\u30a4\u30c8/g, "White"],
    [/\u30d6\u30eb\u30fc/g, "Blue"],
    [/\u30ec\u30c3\u30c9/g, "Red"],
    [/\u30b0\u30ea\u30fc\u30f3/g, "Green"],
    [/\u30a4\u30a8\u30ed\u30fc/g, "Yellow"],
    [/\u30aa\u30ec\u30f3\u30b8/g, "Orange"],
    [/\u30b7\u30eb\u30d0\u30fc/g, "Silver"],
    [/\u30b4\u30fc\u30eb\u30c9/g, "Gold"],
    [/\u30e9\u30d9\u30f3\u30c0\u30fc/g, "Lavender"],
    [/\u30df\u30f3\u30c8/g, "Mint"],
  ];

  let formatted = replacements.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    legacyFormatted || value.trim(),
  );
  formatted = replaceAllText(formatted, "\u00d7", " x ");
  formatted = replaceAllText(formatted, "\uFF38", " x ");
  formatted = replaceAllText(formatted, "\uFF58", " x ");
  formatted = formatted
    .replace(/[・･_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return formatted || legacyFormatted;
}
