export type ShipmentGasItem = {
  productNameJa: string;
  productNameEn: string;
  quantity: number;
  managementNo?: string | null;
  labelId?: string;
};

function compactShipmentName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[　\s・･_\-ー]/g, "")
    .replace(/ニンテンドー|nintendo/g, "")
    .replace(/カラー/g, "color")
    .trim();
}

/** 取引データの通貨表記（ユーロ・ドル）を、送り状に書く3文字コードへ寄せる。 */
export function normalizeDeclarationCurrency(
  value: string | null | undefined
): string {
  const text = String(value ?? "")
    .normalize("NFKC")
    .trim();
  if (!text) return "—";
  const lower = text.toLowerCase();
  if (text.includes("ユーロ") || lower === "eur" || text.includes("€"))
    return "EUR";
  if (text.includes("ドル") || lower === "usd" || text.includes("$"))
    return "USD";
  if (text.includes("円") || lower === "jpy" || text.includes("¥"))
    return "JPY";
  return text;
}

export function isRandomShipmentName(value: string): boolean {
  const target = compactShipmentName(value);
  return (
    target.includes("ランダム") ||
    target.includes("random") ||
    target.includes("ramdom")
  );
}

function shipmentModelKey(value: string): string {
  const target = compactShipmentName(value);
  if (/new3ds(ll|xl)|n3ds(ll|xl)/.test(target)) return "new3dsll";
  if (/new2ds(ll|xl)|n2ds(ll|xl)/.test(target)) return "new2dsll";
  if (/new3ds|n3ds/.test(target)) return "new3ds";
  if (/(^|[^a-z])3ds(ll|xl)/.test(target) || target.includes("3dsll"))
    return "3dsll";
  if (target.includes("3ds")) return "3ds";
  if (
    target.includes("vita2000") ||
    target.includes("psvita2000") ||
    target.includes("pch2000")
  )
    return "vita2000";
  if (
    target.includes("vita1000") ||
    target.includes("psvita1000") ||
    target.includes("pch1000") ||
    target.includes("pch1100")
  )
    return "vita1000";
  if (target.includes("switchlite")) return "switchlite";
  if (target.includes("switch")) return "switch";
  if (target.includes("psp3000")) return "psp3000";
  if (target.includes("psp2000")) return "psp2000";
  if (target.includes("psp1000")) return "psp1000";
  if (target.includes("psp")) return "psp";
  if (target.includes("dslite")) return "dslite";
  if (
    target.includes("dsill") ||
    target.includes("dsixl") ||
    /dsi(ll|xl)/.test(target)
  )
    return "dsill";
  if (target.includes("dsi")) return "dsi";
  return target;
}

function shipmentColorTokens(value: string): Set<string> {
  const target = compactShipmentName(value);
  const tokens = new Set<string>();
  const pairs: Array<[string, string]> = [
    ["ブラック", "black"],
    ["黒", "black"],
    ["black", "black"],
    ["ホワイト", "white"],
    ["白", "white"],
    ["white", "white"],
    ["パールホワイト", "white"],
    ["pearlwhite", "white"],
    ["pearl white", "white"],
    ["ブルー", "blue"],
    ["青", "blue"],
    ["blue", "blue"],
    ["レッド", "red"],
    ["ワインレッド", "red"],
    ["赤", "red"],
    ["red", "red"],
    ["winered", "red"],
    ["wine red", "red"],
    ["ピンク", "pink"],
    ["pink", "pink"],
    ["ミント", "mint"],
    ["mint", "mint"],
    ["ライム", "lime"],
    ["lime", "lime"],
    ["グリーン", "green"],
    ["緑", "green"],
    ["green", "green"],
    ["イエロー", "yellow"],
    ["黄色", "yellow"],
    ["yellow", "yellow"],
    ["パープル", "purple"],
    ["紫", "purple"],
    ["purple", "purple"],
    ["アクア", "aqua"],
    ["aqua", "aqua"],
    ["ターコイズ", "turquoise"],
    ["turquoise", "turquoise"],
    ["ラベンダー", "lavender"],
    ["lavender", "lavender"],
    ["シルバー", "silver"],
    ["silver", "silver"],
    ["ゴールド", "gold"],
    ["gold", "gold"],
    ["グレー", "gray"],
    ["gray", "gray"],
    ["grey", "gray"],
    ["カーキ", "khaki"],
    ["khaki", "khaki"],
    ["ブラウン", "brown"],
    ["茶", "brown"],
    ["brown", "brown"],
    ["ダークブラウン", "brown"],
    ["darkbrown", "brown"],
    ["dark brown", "brown"],
    ["オレンジ", "orange"],
    ["orange", "orange"],
    ["メタリック", "metallic"],
    ["metallic", "metallic"],
  ];
  for (const [needle, token] of pairs) {
    if (target.includes(compactShipmentName(needle))) tokens.add(token);
  }
  return tokens;
}

export function shipmentProductMatches(
  orderName: string,
  shippedName: string
): boolean {
  const orderModel = shipmentModelKey(orderName);
  const shippedModel = shipmentModelKey(shippedName);
  if (!orderModel || !shippedModel || orderModel !== shippedModel) return false;
  if (isRandomShipmentName(orderName) || isRandomShipmentName(shippedName))
    return true;

  const orderColors = shipmentColorTokens(orderName);
  const shippedColors = shipmentColorTokens(shippedName);
  const orderCompact = compactShipmentName(orderName);
  if (
    orderCompact.includes("other") ||
    orderCompact.includes("その他") ||
    orderCompact.includes("それ以外")
  ) {
    return true;
  }
  if (orderCompact.includes("base") || orderCompact.includes("ベース")) {
    orderColors.delete("base");
  }
  if (orderColors.size === 0 || shippedColors.size === 0) return true;
  for (const color of Array.from(orderColors)) {
    if (color === "metallic") continue;
    if (shippedColors.has(color)) return true;
  }
  return false;
}
