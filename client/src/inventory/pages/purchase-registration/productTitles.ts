import type { PurchaseItem } from "./dataTypes";
import { parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { hasAnyProductText } from "./productText";

export function displayProductTitle(item: PurchaseItem): string {
  const title = item.title?.trim() || "-";
  const managementNo = parseEtc(item.etc).managementNo;
  const text = `${managementNo} ${title}`;

  if (hasAnyProductText(text, ["モンスターボール", "monster ball", "monsterball"])) {
    if (hasAnyProductText(text, ["new 2ds ll", "new2dsll", "new 2ds xl", "new2dsxl"])) {
      return "New 2DS LL モンスターボール";
    }
    return title;
  }

  if (hasAnyProductText(text, ["どうぶつの森", "animal crossing"])) {
    if (hasAnyProductText(text, ["new 3ds ll", "new3dsll", "new 3ds xl", "new3dsxl"])) return "New 3DS LL どうぶつの森";
    return "3DS LL どうぶつの森";
  }
  if (hasAnyProductText(text, ["new 2ds ll", "new2dsll", "new 2ds xl", "new2dsxl"])) return "New 2DS LL ランダムカラー";
  if (hasAnyProductText(text, ["new 3ds ll", "new3dsll", "new 3ds xl", "new3dsxl"])) return "New 3DS LL ランダムカラー";
  if (hasAnyProductText(text, ["new 3ds", "new3ds"])) return "New 3DS ランダムカラー";
  if (hasAnyProductText(text, ["3ds ll", "3dsll", "3ds xl", "3dsxl"])) return "3DS LL ランダムカラー";
  if (hasAnyProductText(text, ["2ds"])) return "2DS ランダムカラー";
  if (hasAnyProductText(text, ["3ds"])) return "3DS ランダムカラー";

  if (
    hasAnyProductText(text, [
      "ps vita 1000",
      "psvita1000",
      "vita 1000",
      "vita1000",
      "ps vita 1100",
      "psvita1100",
      "vita 1100",
      "vita1100",
    ])
  ) {
    return hasAnyProductText(text, ["ブラック", "黒", "black", "ピアノ", "クリスタルブラック", "crystal black"])
      ? "PS Vita 1000 ブラック"
      : "PS Vita 1000 レッド・ブルー・ホワイト";
  }
  if (hasAnyProductText(text, ["ps vita 2000", "psvita2000", "vita 2000", "vita2000"])) {
    return "PS Vita 2000 ランダムカラー";
  }
  if (hasAnyProductText(text, ["psp go", "pspgo"])) return "PSP Go";
  if (hasAnyProductText(text, ["psp 3000", "psp3000"])) {
    return hasAnyProductText(text, ["ブラック", "黒", "black", "ピアノ"])
      ? "PSP 3000 ブラック"
      : "PSP 3000 ランダムカラー";
  }
  if (hasAnyProductText(text, ["psp 2000", "psp2000"])) {
    return hasAnyProductText(text, ["ホワイト", "白", "white", "セラミック"])
      ? "PSP 2000 ホワイト"
      : "PSP 2000 ランダムカラー";
  }

  return title;
}

export function actualProductTitle(item: PurchaseItem): string {
  return item.title?.trim() || displayProductTitle(item);
}
