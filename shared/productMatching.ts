export type CsvProductCandidate = {
  name: string;
  qty: number;
};

export type SuggestedCsvProduct = {
  name: string;
  score: number;
};

export type ShipmentAllocationItem = {
  productNameJa?: string | null;
  productNameEn?: string | null;
  quantity: number;
  managementNo?: string | null;
};

export type AllocatedShipmentItem = {
  productNameJa: string;
  productNameEn: string;
  quantity: number;
};

const ACCESSORY_KEYWORDS = [
  "タッチペン",
  "バッテリー",
  "ケース",
  "カバー",
  "ケーブル",
  "アダプター",
  "コントローラー",
  "スタンド",
  "プロテクター",
  "charger",
  "battery",
  "cable",
  "case",
  "stylus",
];

const COLOR_ALIASES: Array<[string, string]> = [
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
  ["アクア", "aqua"],
  ["aqua", "aqua"],
  ["レッド", "red"],
  ["ワインレッド", "red"],
  ["赤", "red"],
  ["red", "red"],
  ["wine red", "red"],
  ["winered", "red"],
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
  ["ブラウン", "brown"],
  ["茶", "brown"],
  ["brown", "brown"],
  ["ダークブラウン", "brown"],
  ["dark brown", "brown"],
  ["darkbrown", "brown"],
  ["オレンジ", "orange"],
  ["orange", "orange"],
  ["メタリック", "metallic"],
  ["metallic", "metallic"],
];

const MODEL_PATTERNS: Array<[RegExp, string]> = [
  [/(?:new\s*2ds\s*(?:ll|xl)|new2ds(?:ll|xl)|n2ds(?:ll|xl))/i, "New2DSLL"],
  [/(?:new\s*3ds\s*(?:ll|xl)|new3ds(?:ll|xl)|n3ds(?:ll|xl))/i, "New3DSLL"],
  [/(?:new\s*3ds|new3ds|n3ds)/i, "New3DS"],
  [/(?:ps\s*vita\s*2000|vita\s*2000|vita2000|pch\s*2000)/i, "Vita2000"],
  [/(?:ps\s*vita\s*(?:1000|1100)|vita\s*(?:1000|1100)|vita(?:1000|1100)|pch\s*1000|pch\s*1100)/i, "Vita1000"],
  [/(?:ps\s*vita|vita)/i, "Vita1000"],
  [/(?:3ds\s*(?:ll|xl)|3ds(?:ll|xl))/i, "3DSLL"],
  [/(?:2ds)(?!\s*(?:ll|xl))/i, "2DS"],
  [/(?:3ds)(?!\s*(?:ll|xl))/i, "3DS"],
  [/(?:ds\s*lite|dslite)/i, "DSLite"],
  [/(?:dsi\s*(?:ll|xl)|dsi(?:ll|xl)|dsill|dsixl)/i, "DSiLL"],
  [/(?:dsi)(?!\s*(?:ll|xl))/i, "DSi"],
  [/(?:psp\s*go|pspgo)/i, "PSPGo"],
  [/(?:psp\s*3000|psp3000)/i, "PSP3000"],
  [/(?:psp\s*2000|psp2000)/i, "PSP2000"],
  [/(?:psp\s*1000|psp1000)/i, "PSP1000"],
  [/(?:psp)/i, "PSP"],
  [/(?:switch\s*lite|switchlite)/i, "SwitchLite"],
  [/(?:switch)/i, "Switch"],
  [/(?:ps5)/i, "PS5"],
  [/(?:ps4)/i, "PS4"],
];

const MODEL_PREFIX_PATTERNS = [
  /^new\s*2ds\s*(?:ll|xl)\s*/i,
  /^new2ds(?:ll|xl)\s*/i,
  /^new\s*3ds\s*(?:ll|xl)\s*/i,
  /^new3ds(?:ll|xl)\s*/i,
  /^new\s*3ds\s*/i,
  /^new3ds\s*/i,
  /^ps\s*vita\s*2000\s*/i,
  /^ps\s*vita\s*1000\s*/i,
  /^ps\s*vita\s*1100\s*/i,
  /^ps\s*vita\s*/i,
  /^vita\s*2000\s*/i,
  /^vita\s*1000\s*/i,
  /^vita\s*1100\s*/i,
  /^vita\s*/i,
  /^3ds\s*(?:ll|xl)\s*/i,
  /^3ds(?:ll|xl)\s*/i,
  /^2ds\s*/i,
  /^3ds\s*/i,
  /^ds\s*lite\s*/i,
  /^dslite\s*/i,
  /^dsi\s*(?:ll|xl)\s*/i,
  /^dsi(?:ll|xl)\s*/i,
  /^dsi\s*/i,
  /^psp\s*go\s*/i,
  /^pspgo\s*/i,
  /^psp\s*(?:go\s*)?/i,
  /^switch\s*lite\s*/i,
  /^switch\s*/i,
  /^ps5\s*/i,
  /^ps4\s*/i,
];

const LIMITED_EDITION_PRODUCT_KEYWORDS: Array<[string, string[]]> = [
  ["monster-ball", ["モンスターボール", "monster ball", "monsterball"]],
  ["minecraft", ["マインクラフト", "minecraft"]],
  ["animal-crossing", ["どうぶつの森", "animal crossing", "animalcrossing"]],
  ["pikachu", ["ピカチュウ", "pikachu"]],
  ["pokemon", ["ポケモン", "pokemon"]],
  ["mario", ["マリオ", "mario"]],
  ["luigi", ["ルイージ", "luigi"]],
  ["zelda", ["ゼルダ", "ハイラル", "zelda", "hyrule"]],
  ["limited", ["限定版", "限定", "limited edition", "limited", "special edition"]],
];

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .trim();
}

export function normalizeLooseText(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s　・･_\-ー,、/]/g, "");
}

export function extractManagementInvoiceKey(value: string | null | undefined): string | null {
  const normalized = normalizeText(value ?? "");
  const match = normalized.match(/^(\d+)/);
  return match?.[1] ?? null;
}

export function extractManagementHints(...values: Array<string | null | undefined>): string[] {
  const hints: string[] = [];
  const managementTokenPattern =
    /(?:\d{3}[_*][^\s,\u3001\uFF0C;\uFF1B]*|ebay_[^\s,\u3001\uFF0C;\uFF1B]*|E\d{4}[^\s,\u3001\uFF0C;\uFF1B]*)/gi;

  for (const value of values) {
    const text = normalizeText(value ?? "");
    if (!text) continue;
    hints.push(text);
    for (const match of text.match(managementTokenPattern) ?? []) {
      const token = match.trim();
      if (token) hints.push(token);
    }
  }

  return Array.from(new Set(hints));
}

export function extractModel(title: string): string {
  const normalized = normalizeText(title);
  const loose = normalizeLooseText(normalized);
  for (const [pattern, model] of MODEL_PATTERNS) {
    if (pattern.test(normalized) || pattern.test(loose)) return model;
  }
  return "";
}

export function extractPreferredModel(itemTitle: string, managementNo: string): string {
  return extractModel(managementNo) || extractModel(itemTitle);
}

export function extractColor(name: string): string {
  const trimmed = normalizeText(name);
  const withoutBrand = trimmed.replace(/^(?:toynet|hori|pdp|cyber|nintendo|sony|sega|microsoft|\w+net)\s+/i, "").trim();
  for (const source of [withoutBrand, trimmed]) {
    for (const pattern of MODEL_PREFIX_PATTERNS) {
      if (pattern.test(source)) {
        const result = source.replace(pattern, "").trim();
        if (result) return result;
      }
    }
  }
  const lastSpaceIndex = trimmed.lastIndexOf(" ");
  return lastSpaceIndex >= 0 ? trimmed.slice(lastSpaceIndex + 1).trim() : trimmed;
}

export function isRandomColor(colorName: string): boolean {
  const normalized = normalizeText(colorName).toLowerCase();
  return normalized.includes("ランダム") || normalized.includes("random") || normalized.includes("ramdom");
}

export function isAccessory(title: string): boolean {
  if (extractModel(title)) return false;
  const normalized = normalizeText(title).toLowerCase();
  return ACCESSORY_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function isOtherColor(colorName: string): boolean {
  const normalized = normalizeText(colorName).toLowerCase();
  return normalized === "other" ||
    normalized.includes("other color") ||
    normalized.includes("その他") ||
    normalized.includes("それ以外") ||
    normalized.includes("以外");
}

function isBaseColorProduct(colorName: string): boolean {
  const normalized = normalizeLooseText(colorName);
  return normalized.includes("base") || normalized.includes("ベース");
}

function limitedEditionProductKey(value: string): string | null {
  const normalized = normalizeLooseText(value);
  for (const [key, keywords] of LIMITED_EDITION_PRODUCT_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(normalizeLooseText(keyword)))) return key;
  }
  return null;
}

function limitedEditionKeysCompatible(a: string | null, b: string | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a === b || a === "limited" || b === "limited";
}

export function productNamesCanMatch(itemText: string, csvProductName: string): boolean {
  return limitedEditionKeysCompatible(limitedEditionProductKey(itemText), limitedEditionProductKey(csvProductName));
}

function normalizeColorToken(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeColorlessQualifierToken(value: string): string {
  return normalizeColorToken(value).replace(
    /(?:badscreens?|goodcondition|badcondition|damaged?|damage|condition|screens?|screenburn|scratched?|faulty|junk|tested|working)/g,
    "",
  );
}

function hasColorlessQualifierText(value: string): boolean {
  const compact = normalizeColorToken(value);
  return compact !== normalizeColorlessQualifierToken(value);
}

function isColorlessRandomColor(colorName: string): boolean {
  const normalized = normalizeText(colorName);
  if (!normalized) return true;
  const compact = normalizeColorlessQualifierToken(normalized);
  if (!compact) return false;
  if (/^(psp|pspgo|psp1000|psp2000|psp3000|ps5|ps4|psvita|vita|vita1000|vita2000|new3dsll|new3ds|new2dsll|2ds|3dsll|3ds|dslite|dsill|dsi)$/.test(compact)) return true;
  if (/^\d{3,4}$/.test(compact)) return true;
  if (/^(?:\d{3,4})?(?:grade|rank)[abc]$/.test(compact)) return true;
  if (/^\d{3,4}(?:only|body|console|unit|set)$/.test(compact)) return true;
  return false;
}

function colorlessQualifierMatches(colorName: string, targetText: string): boolean {
  const compactColor = normalizeColorlessQualifierToken(colorName);
  const compactTarget = normalizeColorToken(targetText);
  const version = compactColor.match(/(?:1000|2000|3000)/)?.[0];
  if (version && !compactTarget.includes(version)) return false;
  const grade = compactColor.match(/(?:grade|rank)([abc])/)?.[1];
  if (grade && !compactTarget.includes(`grade${grade}`) && !compactTarget.includes(`rank${grade}`)) return false;
  return true;
}

function colorTokens(value: string): Set<string> {
  const target = normalizeLooseText(value);
  const tokens = new Set<string>();
  for (const [alias, token] of COLOR_ALIASES) {
    if (target.includes(normalizeLooseText(alias))) tokens.add(token);
  }
  return tokens;
}

function splitColorParts(colorName: string): string[] {
  const normalized = normalizeText(colorName);
  return normalized
    .split(/[&、,／/×xXｘＸ]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function includesColorText(targetText: string, colorName: string): boolean {
  const color = normalizeText(colorName);
  if (!color) return false;

  const looseTarget = normalizeLooseText(targetText);
  const looseColor = normalizeLooseText(color);
  if (looseColor && (looseTarget.includes(looseColor) || looseColor.includes(looseTarget))) return true;

  const csvTokens = colorTokens(color);
  const targetTokens = colorTokens(targetText);
  for (const token of Array.from(csvTokens)) {
    if (targetTokens.has(token)) return true;
  }
  return false;
}

function isVita2000AquaBlueMisdelivery(itemTitle: string, csvProductName: string): boolean {
  const item = normalizeLooseText(itemTitle);
  const csv = normalizeLooseText(csvProductName);
  return extractModel(itemTitle) === "Vita2000" &&
    csv.includes("アクア") &&
    item.includes("駿河屋誤発送") &&
    (item.includes("ブルー") || item.includes("blue") || item.includes("青"));
}

function scoreCsvProduct(itemTitle: string, managementNo: string, csvProductName: string): number {
  const targetText = `${normalizeText(itemTitle)} ${normalizeText(managementNo)}`.trim();
  const targetIsRandomColor = isRandomColor(targetText) || isRandomColor(extractColor(targetText));
  const itemModel = extractPreferredModel(itemTitle, managementNo);
  const csvModel = extractModel(csvProductName);
  if (csvModel && (!itemModel || itemModel !== csvModel)) return -1;

  const csvLimitedKey = limitedEditionProductKey(csvProductName);
  const targetLimitedKey = limitedEditionProductKey(targetText);
  if (!limitedEditionKeysCompatible(targetLimitedKey, csvLimitedKey)) return -1;
  if (csvLimitedKey && targetLimitedKey) return csvLimitedKey === targetLimitedKey ? 95 : 90;

  const csvColor = extractColor(csvProductName);
  const managementText = normalizeLooseText(managementNo);
  const csvColorText = normalizeLooseText(csvColor);

  if (isVita2000AquaBlueMisdelivery(itemTitle, csvProductName)) return 80;
  if (isBaseColorProduct(csvColor)) {
    const csvTokens = colorTokens(csvColor);
    const targetTokens = colorTokens(targetText);
    if (Array.from(csvTokens).some((token) => targetTokens.has(token))) return 72;
    return csvModel ? 58 : -1;
  }
  if (managementText && csvColorText && !isRandomColor(csvColor) && managementText.includes(csvColorText)) return 70;

  const csvIsRandomColor = isRandomColor(csvColor);
  const csvIsColorlessRandomColor = isColorlessRandomColor(csvColor);
  if (csvIsRandomColor || csvIsColorlessRandomColor) {
    if (csvIsColorlessRandomColor && !colorlessQualifierMatches(csvColor, targetText)) return -1;
    if (csvModel && csvIsColorlessRandomColor && !csvIsRandomColor && hasColorlessQualifierText(csvColor)) {
      return targetIsRandomColor ? 25 : 35;
    }
    return csvModel ? 30 : 10;
  }

  if (isOtherColor(csvColor)) return csvModel ? 20 : -1;

  const parts = splitColorParts(csvColor);
  if (parts.length > 1) {
    const matchedPartCount = parts.filter((part) => includesColorText(targetText, part)).length;
    if (matchedPartCount > 0) return 45 + matchedPartCount;
    return -1;
  }

  if (includesColorText(targetText, csvColor)) return 60;
  return -1;
}

export function suggestCsvProduct(
  itemTitle: string,
  managementNo: string,
  csvProducts: CsvProductCandidate[],
): SuggestedCsvProduct | null {
  let best: SuggestedCsvProduct | null = null;
  let tie = false;

  for (const product of csvProducts) {
    const score = scoreCsvProduct(itemTitle, managementNo, product.name);
    if (score < 0) continue;
    if (!best || score > best.score) {
      best = { name: product.name, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }

  if (!best || tie) {
    const model = extractPreferredModel(itemTitle, managementNo);
    if (!model) return null;
    const targetText = `${itemTitle} ${managementNo}`;
    const sameModelCandidates = csvProducts.filter((product) =>
      extractModel(product.name) === model &&
      productNamesCanMatch(targetText, product.name)
    );
    if (sameModelCandidates.length === 1) {
      return { name: sameModelCandidates[0].name, score: 1 };
    }
    return null;
  }
  return best;
}

const MODEL_ONLY_LOOSE_ALIASES: Record<string, string[]> = {
  New2DSLL: ["new2dsll", "new2dsxl", "n2dsll", "n2dsxl"],
  New3DSLL: ["new3dsll", "new3dsxl", "n3dsll", "n3dsxl"],
  New3DS: ["new3ds", "n3ds"],
  Vita2000: ["psvita2000", "vita2000", "pch2000"],
  Vita1000: ["psvita1000", "vita1000", "psvita1100", "vita1100", "pch1000", "pch1100", "psvita"],
  "3DSLL": ["3dsll", "3dsxl"],
  "2DS": ["2ds"],
  "3DS": ["3ds"],
  DSLite: ["dslite", "dsl"],
  DSiLL: ["dsill", "dsixl", "dsilll"],
  DSi: ["dsi"],
  PSPGo: ["pspgo"],
  PSP3000: ["psp3000"],
  PSP2000: ["psp2000"],
  PSP1000: ["psp1000"],
  PSP: ["psp"],
  SwitchLite: ["switchlite"],
  Switch: ["switch"],
  PS5: ["ps5"],
  PS4: ["ps4"],
};

type ShipmentAllocationRow = CsvProductCandidate & {
  index: number;
  model: string;
  used: number;
  wildcard: boolean;
  colorTokens: Set<string>;
};

function shipmentItemName(item: ShipmentAllocationItem): string {
  return String(item.productNameJa || item.productNameEn || "").trim();
}

function suggestShipmentCsvProductName(
  itemTitle: string,
  managementText: string,
  csvProducts: CsvProductCandidate[],
): string | null {
  const suggestion = suggestCsvProduct(itemTitle, managementText, csvProducts);
  if (suggestion) return suggestion.name;

  const model = extractPreferredModel(itemTitle, managementText);
  if (!model) return null;

  const targetText = `${itemTitle} ${managementText}`;
  const sameModelCandidates = csvProducts.filter((product) =>
    extractModel(product.name) === model &&
    productNamesCanMatch(targetText, product.name)
  );
  return sameModelCandidates.length === 1 ? sameModelCandidates[0].name : null;
}

function isModelOnlyProductName(productName: string): boolean {
  const model = extractModel(productName);
  if (!model) return false;
  return MODEL_ONLY_LOOSE_ALIASES[model]?.includes(normalizeLooseText(productName)) ?? false;
}

function isWildcardShipmentRow(productName: string): boolean {
  const model = extractModel(productName);
  if (!model) return false;
  if (isModelOnlyProductName(productName)) return true;

  const color = extractColor(productName);
  return isRandomColor(color) || isOtherColor(color) || isColorlessRandomColor(color);
}

function hasAnySharedToken(a: Set<string>, b: Set<string>): boolean {
  for (const token of Array.from(a)) {
    if (b.has(token)) return true;
  }
  return false;
}

function addUniqueRow(target: ShipmentAllocationRow[], seen: Set<number>, row: ShipmentAllocationRow): void {
  if (seen.has(row.index)) return;
  seen.add(row.index);
  target.push(row);
}

function shipmentRowCapacity(row: ShipmentAllocationRow): number {
  if (!Number.isFinite(row.qty) || row.qty <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, row.qty - row.used);
}

function allocateQuantityToRows(
  rows: ShipmentAllocationRow[],
  quantity: number,
  addAllocated: (name: string, quantity: number) => void,
): number {
  let remaining = quantity;
  rows.forEach((row, index) => {
    if (remaining <= 0) return;
    const isLast = index === rows.length - 1;
    const allocatable = isLast ? remaining : Math.min(remaining, shipmentRowCapacity(row));
    if (allocatable <= 0) return;
    row.used += allocatable;
    addAllocated(row.name, allocatable);
    remaining -= allocatable;
  });
  return remaining;
}

export function allocateShipmentItemsToCsvProducts(
  items: ShipmentAllocationItem[],
  csvProducts: CsvProductCandidate[],
): AllocatedShipmentItem[] {
  const products = csvProducts
    .map((product) => ({ name: product.name.trim(), qty: Number(product.qty ?? 0) || 0 }))
    .filter((product) => product.name);
  const rows: ShipmentAllocationRow[] = products.map((product, index) => ({
    ...product,
    index,
    model: extractModel(product.name),
    used: 0,
    wildcard: isWildcardShipmentRow(product.name),
    colorTokens: colorTokens(product.name),
  }));

  const allocated = new Map<string, AllocatedShipmentItem>();
  const addAllocated = (name: string, quantity: number) => {
    if (!name || quantity <= 0) return;
    const current = allocated.get(name);
    if (current) current.quantity += quantity;
    else allocated.set(name, { productNameJa: name, productNameEn: name, quantity });
  };

  for (const item of items) {
    const itemName = shipmentItemName(item);
    const quantity = Number(item.quantity ?? 0) || 0;
    if (!itemName || quantity <= 0) continue;

    const managementText = Array.from(new Set(extractManagementHints(item.managementNo, itemName))).join(" ");
    const itemMatchText = `${itemName} ${managementText}`;
    const itemModel = extractPreferredModel(itemName, managementText);
    const itemTokens = colorTokens(itemMatchText);
    const suggestionName =
      (managementText ? suggestShipmentCsvProductName("", managementText, products) : null) ??
      suggestShipmentCsvProductName(itemName, managementText, products);

    const candidateRows: ShipmentAllocationRow[] = [];
    const seen = new Set<number>();
    for (const row of rows) {
      if (suggestionName && row.name === suggestionName) addUniqueRow(candidateRows, seen, row);
    }

    if (itemModel) {
      const specificRows = rows
        .filter((row) =>
          row.model === itemModel &&
          productNamesCanMatch(itemMatchText, row.name) &&
          !row.wildcard &&
          !seen.has(row.index) &&
          row.colorTokens.size > 0 &&
          itemTokens.size > 0 &&
          hasAnySharedToken(row.colorTokens, itemTokens)
        )
        .sort((a, b) => b.colorTokens.size - a.colorTokens.size || a.index - b.index);
      for (const row of specificRows) addUniqueRow(candidateRows, seen, row);

      const wildcardRows = rows.filter((row) =>
        row.model === itemModel &&
        productNamesCanMatch(itemMatchText, row.name) &&
        row.wildcard &&
        !seen.has(row.index)
      );
      for (const row of wildcardRows) addUniqueRow(candidateRows, seen, row);
    }

    const remaining = allocateQuantityToRows(candidateRows, quantity, addAllocated);
    if (remaining > 0) addAllocated(itemName, remaining);
  }

  return Array.from(allocated.values()).filter((item) => item.quantity > 0);
}
