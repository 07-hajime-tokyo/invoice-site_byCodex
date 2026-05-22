/**
 * 商品名ユーティリティ
 * - 日本語商品名→英語表示名への変換
 * - 返品商品の正規化（「返品」を除去してメイン商品名に統合）
 * - CSV商品名と在庫商品名の照合
 */

// 日本語→英語の商品名マッピング
const PRODUCT_NAME_MAP: Array<{ patterns: string[]; en: string; canonical: string }> = [
  // PS Vita 1000 (Vita1100はVita1000の別名として同一視)
  { patterns: ["vita1000", "vita 1000", "psvita1000", "ps vita 1000", "vita1100", "vita 1100", "psvita1100", "ps vita 1100"], en: "PS Vita 1000", canonical: "vita1000" },
  // PS Vita 2000
  { patterns: ["vita2000", "vita 2000", "psvita2000", "ps vita 2000", "vita2000"], en: "PS Vita 2000", canonical: "vita2000" },
  // PS Vita (generic)
  { patterns: ["vita", "psvita", "ps vita"], en: "PS Vita", canonical: "vita" },
  // Nintendo Switch Lite
  { patterns: ["switch lite", "スイッチライト", "switchlite", "switch_lite", "switch lite"], en: "Switch Lite", canonical: "switchlite" },
  // Nintendo Switch
  { patterns: ["switch", "スイッチ"], en: "Switch", canonical: "switch" },
  // New 3DS LL / XL
  { patterns: ["new 3ds ll", "new3dsll", "new 3ds xl", "new3dsxl", "new3ds ll", "new3ds_ll", "new 3ds"], en: "New 3DS LL", canonical: "new3dsll" },
  // 3DS LL / XL
  { patterns: ["3ds ll", "3dsll", "3ds xl", "3dsxl", "3ds_ll"], en: "3DS LL", canonical: "3dsll" },
  // 3DS
  { patterns: ["3ds"], en: "3DS", canonical: "3ds" },
  // PSP 3000
  { patterns: ["psp3000", "psp 3000"], en: "PSP 3000", canonical: "psp3000" },
  // PSP 2000
  { patterns: ["psp2000", "psp 2000"], en: "PSP 2000", canonical: "psp2000" },
  // PSP 1000
  { patterns: ["psp1000", "psp 1000"], en: "PSP 1000", canonical: "psp1000" },
  // PSP (generic)
  { patterns: ["psp"], en: "PSP", canonical: "psp" },
  // PS4
  { patterns: ["ps4", "playstation 4", "プレステ4"], en: "PS4", canonical: "ps4" },
  // PS3
  { patterns: ["ps3", "playstation 3", "プレステ3"], en: "PS3", canonical: "ps3" },
  // DS Lite
  { patterns: ["ds lite", "dslite", "ds_lite"], en: "DS Lite", canonical: "dslite" },
  // DS
  { patterns: ["nds", " ds "], en: "DS", canonical: "ds" },
  // Wii U
  { patterns: ["wii u", "wiiu"], en: "Wii U", canonical: "wiiu" },
  // Wii
  { patterns: ["wii"], en: "Wii", canonical: "wii" },
  // Game Boy Advance SP
  { patterns: ["gba sp", "gbasp", "game boy advance sp", "ゲームボーイアドバンスsp"], en: "GBA SP", canonical: "gbasp" },
  // Game Boy Advance
  { patterns: ["gba", "game boy advance", "ゲームボーイアドバンス"], en: "GBA", canonical: "gba" },
  // Game Boy Color
  { patterns: ["gbc", "game boy color", "ゲームボーイカラー"], en: "Game Boy Color", canonical: "gbc" },
  // Game Boy
  { patterns: ["game boy", "ゲームボーイ"], en: "Game Boy", canonical: "gameboy" },
];

// カラーマッピング（日本語→英語）
const COLOR_MAP: Record<string, string> = {
  "ブラック": "Black",
  "黒": "Black",
  "ホワイト": "White",
  "白": "White",
  "レッド": "Red",
  "赤": "Red",
  "ブルー": "Blue",
  "青": "Blue",
  "シルバー": "Silver",
  "銀": "Silver",
  "ゴールド": "Gold",
  "金": "Gold",
  "ピンク": "Pink",
  "グリーン": "Green",
  "緑": "Green",
  "イエロー": "Yellow",
  "黄": "Yellow",
  "パープル": "Purple",
  "紫": "Purple",
  "オレンジ": "Orange",
  "グレー": "Gray",
  "灰": "Gray",
  "ブラウン": "Brown",
  "茶": "Brown",
  "ライトブルー": "Light Blue",
  "スカイブルー": "Sky Blue",
  "ネイビー": "Navy",
  "ベージュ": "Beige",
  "クリーム": "Cream",
  "ミント": "Mint",
  "ターコイズ": "Turquoise",
  "バイオレット": "Violet",
  "コーラル": "Coral",
  "ライム": "Lime",
  "ランダム": "Random Color",
  "ランダムカラー": "Random Color",
  "アクア": "Aqua",
  "ホワイトベース": "White",
  "ピンクホワイト": "Pink/White",
  "ミントホワイト": "Mint/White",
  "カーキ": "Khaki",
  "カーキブラック": "Khaki/Black",
  "カーキ・ブラック": "Khaki/Black",
  "ライトピンク": "Light Pink",
  "ライトグリーン": "Light Green",
  "ライトイエロー": "Light Yellow",
  "ライトパープル": "Light Purple",
  "ライトオレンジ": "Light Orange",
  "ダークブルー": "Dark Blue",
  "ダークグリーン": "Dark Green",
  "ダークレッド": "Dark Red",
  "ダークグレー": "Dark Gray",
  "ローズ": "Rose",
  "ローズゴールド": "Rose Gold",
  "マゼンタ": "Magenta",
  "チャコール": "Charcoal",
  "スカーレット": "Scarlet",
  "ミステリアスブラック": "Mysterious Black",
  "ミステリアス": "Mysterious",
  "パールホワイト": "Pearl White",
  "パール": "Pearl",
  "ライトブラウン": "Light Brown",
  "ダークブラウン": "Dark Brown",
  "ブルーブラック": "Blue/Black",
  "レッドブラック": "Red/Black",
  "ホワイトブルー": "White/Blue",
  "ホワイトレッド": "White/Red",
  "ホワイトグリーン": "White/Green",
  "ブラックホワイト": "Black/White",
  "ブラックレッド": "Black/Red",
  "ブラックブルー": "Black/Blue",
  "ブラックゴールド": "Black/Gold",
  "ブラックシルバー": "Black/Silver",
  "ブラックピンク": "Black/Pink",
  "ブラックグリーン": "Black/Green",
  "ブラックオレンジ": "Black/Orange",
  "ブラックパープル": "Black/Purple",
  "ブラックイエロー": "Black/Yellow",
  "ブラックグレー": "Black/Gray",
  "ブラックブラウン": "Black/Brown",
  "ブラックカーキ": "Black/Khaki",
};

// 英語カラーマッピング（英語→正規化）
const EN_COLOR_NORMALIZE: Record<string, string> = {
  "black": "Black",
  "white": "White",
  "red": "Red",
  "blue": "Blue",
  "silver": "Silver",
  "gold": "Gold",
  "pink": "Pink",
  "green": "Green",
  "yellow": "Yellow",
  "purple": "Purple",
  "orange": "Orange",
  "gray": "Gray",
  "grey": "Gray",
  "brown": "Brown",
  "khaki": "Khaki",
  "navy": "Navy",
  "beige": "Beige",
  "mint": "Mint",
  "turquoise": "Turquoise",
  "coral": "Coral",
  "lime": "Lime",
  "aqua": "Aqua",
  "random": "Random Color",
  "random color": "Random Color",
};

/**
 * 商品名から「返品」を除去して正規化する
 * 例: "vita1000黒 返品" → "vita1000黒"
 */
export function normalizeProductName(name: string): string {
  return name
    .replace(/\s*返品\s*/g, "")
    .replace(/\s*返却\s*/g, "")
    .trim();
}

/**
 * 商品名が返品かどうかを判定する
 */
export function isReturnProduct(name: string): boolean {
  return /返品|返却/.test(name);
}

/**
 * 日本語商品名を英語表示名に変換する
 * 例: "PS Vita 1000 ブラック" → "PS Vita 1000 Black"
 * 例: "vita1000黒" → "PS Vita 1000 Black"
 */
export function toEnglishProductName(jaName: string): string {
  if (!jaName) return jaName;

  const lower = jaName.toLowerCase();

  // まず機種名を特定
  let modelEn = "";
  for (const entry of PRODUCT_NAME_MAP) {
    if (entry.patterns.some((p) => lower.includes(p.toLowerCase()))) {
      modelEn = entry.en;
      break;
    }
  }

  if (!modelEn) {
    // 機種名が特定できない場合はカラーだけ変換して返す
    return translateColors(jaName);
  }

  // カラーを抽出して英語に変換
  const colorEn = extractColorEn(jaName);

  if (colorEn) {
    return `${modelEn} ${colorEn}`;
  }
  return modelEn;
}

/**
 * 商品名からcanonical機種IDを抽出する
 * 例: "toynet PS Vita2000 カーキ・ブラック" → "vita2000"
 * 例: "Switch Lite Random Color" → "switchlite"
 */
/**
 * canonical IDから英語機種名を取得する
 * 例: "psp1000" → "PSP 1000"
 */
export function getModelEnByCanonical(canonical: string): string {
  const entry = PRODUCT_NAME_MAP.find(e => e.canonical === canonical);
  return entry?.en ?? "";
}

export function extractCanonicalModel(name: string): string {
  const lower = name.toLowerCase()
    // toynetプレフィックスを除去
    .replace(/^toynet\s+/i, "")
    // "new " を保持しつつ処理
    .trim();

  for (const entry of PRODUCT_NAME_MAP) {
    if (entry.patterns.some((p) => lower.includes(p.toLowerCase()))) {
      return entry.canonical;
    }
  }
  return "";
}

/**
 * 商品名からカラーキーワードのセットを抽出する（正規化済み英語）
 * 例: "vita2000 カーキ・ブラック" → ["Khaki", "Black"]
 * 例: "Switch Lite Random Color" → ["Random Color"]
 */
function extractColorSet(name: string): Set<string> {
  const colors = new Set<string>();
  const lower = name.toLowerCase();

  // 日本語カラーを先に確認（長いパターン優先）
  const sortedJa = Object.entries(COLOR_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [ja, en] of sortedJa) {
    if (lower.includes(ja.toLowerCase())) {
      // 正規化：スラッシュ区切りを分割
      en.split("/").forEach((c) => colors.add(c.trim()));
    }
  }

  // 英語カラーを確認
  const sortedEn = Object.entries(EN_COLOR_NORMALIZE).sort((a, b) => b[0].length - a[0].length);
  for (const [en, normalized] of sortedEn) {
    if (lower.includes(en.toLowerCase())) {
      normalized.split("/").forEach((c) => colors.add(c.trim()));
    }
  }

  return colors;
}

/**
 * 在庫商品名がCSV商品名に該当するか照合する
 *
 * 照合ルール:
 * 1. 機種名（canonical）が一致すること
 * 2. カラーが一致するか、どちらかが「Random Color」を含む場合はカラー不問
 * 3. どちらかのカラーが空（カラー不明）の場合は機種名一致のみで照合
 *
 * 例:
 * - "toynet PS Vita2000 カーキ・ブラック" vs "PS Vita 2000 Random Color" → true（Random Colorは全色対応）
 * - "toynet スイッチライト" vs "Switch Lite Random Color" → true
 * - "PS Vita 1000 ブラック" vs "PS Vita 1000 Black" → true
 * - "PS Vita 1000 ブラック" vs "PS Vita 2000 Black" → false（機種違い）
 */
export function matchesCsvProductName(inventoryName: string, csvProductName: string): boolean {
  if (!inventoryName || !csvProductName) return false;

  const invNormalized = normalizeProductName(inventoryName);
  const csvNormalized = normalizeProductName(csvProductName);

  // 1. 機種名の照合
  const invModel = extractCanonicalModel(invNormalized);
  const csvModel = extractCanonicalModel(csvNormalized);

  if (!invModel || !csvModel) {
    // 機種名が特定できない場合は部分一致フォールバック
    const a = invNormalized.toLowerCase();
    const b = csvNormalized.toLowerCase();
    return a.includes(b) || b.includes(a);
  }

  if (invModel !== csvModel) return false;

  // 2. カラーの照合
  const invColors = extractColorSet(invNormalized);
  const csvColors = extractColorSet(csvNormalized);

  // どちらかが「Random Color」を含む場合は全色対応
  if (invColors.has("Random Color") || csvColors.has("Random Color")) return true;

  // どちらかのカラーが空の場合は機種名一致のみで照合
  if (invColors.size === 0 || csvColors.size === 0) return true;

  // カラーに共通要素があるか確認
  const invColorArr = Array.from(invColors);
  for (const color of invColorArr) {
    if (csvColors.has(color)) return true;
  }

  return false;
}

/**
 * 商品名からカラー部分を英語で抽出する
 */
function extractColorEn(name: string): string {
  const lower = name.toLowerCase();

  // 長いパターンから先にマッチ
  const sortedColors = Object.entries(COLOR_MAP).sort(
    (a, b) => b[0].length - a[0].length
  );

  for (const [ja, en] of sortedColors) {
    if (lower.includes(ja.toLowerCase())) {
      return en;
    }
  }
  return "";
}

/**
 * テキスト中の日本語カラー名を英語に置換する
 */
function translateColors(text: string): string {
  let result = text;
  const sortedColors = Object.entries(COLOR_MAP).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [ja, en] of sortedColors) {
    result = result.replace(new RegExp(ja, "gi"), en);
  }
  return result;
}
