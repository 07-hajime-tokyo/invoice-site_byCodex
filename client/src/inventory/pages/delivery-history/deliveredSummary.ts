import { colorKeywordMatches } from "./colorMatching";

// ===== サマリー用精密照合ロジック =====
function _extractColorFromCsvName(name: string): string {
  const trimmed = name.trim();
  const modelPatterns = [
    /^new\s*3ds\s*ll\s*/i, /^new\s*3ds\s*/i, /^new\s*2ds\s*ll\s*/i, /^3ds\s*ll\s*/i, /^3ds\s*/i,
    /^ps\s*vita\s*2000\s*/i, /^ps\s*vita\s*1000\s*/i, /^ps\s*vita\s*/i,
    /^vita\s*2000\s*/i, /^vita\s*1[01][0-9][0-9]\s*/i, /^vita\s*1000\s*/i, /^vita\s*/i,
    /^psp\s*3000\s*/i, /^psp\s*2000\s*/i, /^psp\s*1000\s*/i, /^psp\s*/i,
    /^ps5\s*/i, /^ps4\s*/i,
    /^switch\s*lite\s*/i, /^switch\s*/i,
  ];
  let remaining = trimmed;
  for (const pat of modelPatterns) {
    if (pat.test(remaining)) { remaining = remaining.replace(pat, "").trim(); break; }
  }
  if (remaining) return remaining;
  const lastSpaceIdx = trimmed.lastIndexOf(" ");
  return lastSpaceIdx === -1 ? trimmed : trimmed.slice(lastSpaceIdx + 1);
}
function _extractModelFromCsvName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("new 2ds ll") || n.includes("new2dsll")) return "New2DSLL";
  if (n.includes("vita 2000") || n.includes("vita2000")) return "Vita2000";
  if (n.includes("vita 1000") || n.includes("vita1000") || n.includes("vita 1100") || n.includes("vita1100") || (n.includes("vita") && !n.includes("2000"))) return "Vita1000";
  if (n.includes("new 3ds ll") || n.includes("new3dsll")) return "New3DSLL";
  if (n.includes("new 3ds") || n.includes("new3ds")) return "New3DS";
  if (n.includes("3ds ll") || n.includes("3dsll")) return "3DSLL";
  if (n.includes("3ds")) return "3DS";
  if (n.includes("switch lite") || n.includes("switchlite") || n.includes("スイッチライト")) return "SwitchLite";
  if (n.includes("switch") || n.includes("スイッチ")) return "Switch";
  if (n.includes("psp")) return "PSP";
  if (n.includes("ps5")) return "PS5";
  if (n.includes("ps4")) return "PS4";
  return "";
}
function _matchesModel(title: string, model: string): boolean {
  const t = title.toLowerCase();
  switch (model) {
    case "Vita2000": return t.includes("vita") && (t.includes("2000") || t.includes("vita2000"));
    case "Vita1000": return t.includes("vita") && !t.includes("2000");
    case "New3DSLL": return t.includes("new 3ds ll") || t.includes("new3dsll");
    case "New3DS": return (t.includes("new 3ds") || t.includes("new3ds")) && !t.includes(" ll") && !t.includes("ll");
    case "New2DSLL": return t.includes("new 2ds ll") || t.includes("new2dsll");
    case "3DSLL": return (t.includes("3ds ll") || t.includes("3dsll")) && !t.includes("new");
    case "3DS": return t.includes("3ds") && !t.includes("ll") && !t.includes("new");
    case "SwitchLite": return t.includes("switch lite") || t.includes("switchlite") || t.includes("スイッチライト");
    case "Switch": return (t.includes("switch") || t.includes("スイッチ")) && !t.includes("lite") && !t.includes("ライト");
    case "PSP": return t.includes("psp");
    case "PS5": return t.includes("ps5");
    case "PS4": return t.includes("ps4");
    default: return true;
  }
}
function _getColorKeywords(colorName: string): string[] {
  if (/[&×＆・,，、/]/.test(colorName)) return colorName.split(/[&×＆・,，、/]/).map((p) => p.trim()).filter(Boolean);
  const keywords = [colorName];
  if (colorName.includes("ランダムカラー")) keywords.push("ランダム");
  if (colorName === "ランダム") keywords.push("ランダムカラー");
  if (colorName.includes("ホワイトベース")) keywords.push("ホワイト");
  // 黒/ブラックの相互エイリアス
  if (colorName === "ブラック" || colorName.includes("ブラック")) keywords.push("黒");
  if (colorName === "黒" || colorName.endsWith("黒")) keywords.push("ブラック");
  // 白/ホワイトの相互エイリアス
  if (colorName === "ホワイト" || colorName.includes("ホワイト")) keywords.push("白");
  if (colorName === "白" || colorName.endsWith("白")) keywords.push("ホワイト");
  // レッド/赤の相互エイリアス
  if (colorName === "レッド" || colorName.includes("レッド")) keywords.push("赤");
  if (colorName === "赤" || colorName.endsWith("赤")) keywords.push("レッド");
  // ブルー/青の相互エイリアス
  if (colorName === "ブルー" || colorName.includes("ブルー")) keywords.push("青");
  if (colorName === "青" || colorName.endsWith("青")) keywords.push("ブルー");
  return keywords;
}
function _isRandomColor(colorName: string): boolean {
  const c = colorName.toLowerCase();
  return c.includes("ランダム") || c.includes("random");
}
type _ColorEntry = { colorName: string; csvQty: number; deliveredQty: number; model: string; colorOnly: string };
function _scoreMatch(zaicoTitle: string, entry: _ColorEntry): number {
  if (entry.model && !_matchesModel(zaicoTitle, entry.model)) return -1;
  const zt = zaicoTitle.toLowerCase();
  const zaicoModel = _extractModelFromCsvName(zaicoTitle);
  if (_isRandomColor(entry.colorOnly)) {
    if (!entry.model) return (zt.includes("ランダム") || zt.includes("random")) ? 1 : -1;
    return zaicoModel === entry.model ? 3 : 2;
  } else {
    const zaicoColor = _extractColorFromCsvName(zaicoTitle);
    const csvKeywords = _getColorKeywords(entry.colorOnly);
    const allCsvKeywords = csvKeywords.flatMap((kw) =>
      kw.includes("×") ? [kw, ...kw.split("×").map((p) => p.trim()).filter(Boolean)] : [kw]
    );
    const zaicoColorParts = zaicoColor.includes("×")
      ? [zaicoColor, ...zaicoColor.split("×").map((p) => p.trim()).filter(Boolean)]
      : [zaicoColor];
    const colorMatch = allCsvKeywords.some((kw) => {
      const k = kw.toLowerCase();
      return colorKeywordMatches(kw, zaicoTitle) ||
        zaicoColorParts.some((zp) => { const zc = zp.toLowerCase(); return zc.includes(k) || k.includes(zc); }) ||
        zt.includes(k);
    });
    if (!colorMatch) return -1;
    return zaicoModel === entry.model ? 3 : 2;
  }
}
/** CSV発注商品ごとの出庫数を精密照合で集計する */
export function buildGroupDeliveredSummary(
  csvProducts: Array<{ name: string; qty: number }>,
  allItems: Array<{ title: string; quantity: number }>
): Array<{ name: string; deliveredQty: number }> {
  if (csvProducts.length === 0) return [];
  const colorMap = new Map<string, _ColorEntry>();
  for (const cp of csvProducts) {
    const colorOnly = _extractColorFromCsvName(cp.name);
    const model = _extractModelFromCsvName(cp.name);
    const key = model ? `${model} ${colorOnly}` : colorOnly;
    if (!colorMap.has(key)) colorMap.set(key, { colorName: cp.name, csvQty: 0, deliveredQty: 0, model, colorOnly });
    colorMap.get(key)!.csvQty += cp.qty;
    colorMap.get(key)!.colorName = cp.name; // 最後の商品名を使用
  }
  for (const item of allItems) {
    let bestEntry: _ColorEntry | null = null;
    let bestScore = -1;
    for (const [, entry] of Array.from(colorMap.entries())) {
      const score = _scoreMatch(item.title, entry);
      if (score > bestScore) { bestScore = score; bestEntry = entry; }
    }
    if (bestEntry && bestScore >= 0) bestEntry.deliveredQty += item.quantity;
  }
  return Array.from(colorMap.values()).map((e) => ({ name: e.colorName, deliveredQty: e.deliveredQty }));
}
// ===== サマリー用精密照合ロジック END =====
