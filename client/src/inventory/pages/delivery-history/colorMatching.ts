/**
 * 商品名がランダムカラーかどうかを判定
 * 「ランダムカラー」「Random color」「random」等を含む場合はtrue
 */
export function isRandomColor(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("ランダム") || lower.includes("random") || lower.includes("ramdom");
}

export function normalizeColorText(value: string): string {
  return value.toLowerCase().replace(/[　\s・･_\-ー,，、&＆×/]/g, "");
}

export function colorAliases(value: string): string[] {
  const normalized = normalizeColorText(value);
  const groups = [
    ["black", "ブラック", "黒"],
    ["white", "ホワイト", "白"],
    ["red", "レッド", "赤"],
    ["blue", "ブルー", "青"],
    ["pink", "ピンク"],
    ["green", "グリーン", "緑"],
    ["yellow", "イエロー", "黄色"],
    ["silver", "シルバー", "銀"],
    ["gold", "ゴールド", "金"],
    ["gray", "grey", "グレー", "グレイ"],
    ["orange", "オレンジ"],
    ["purple", "パープル", "紫"],
    ["lime", "ライム"],
    ["mint", "ミント"],
    ["turquoise", "ターコイズ"],
    ["aqua", "アクア"],
    ["lavender", "ラベンダー"],
  ];
  const matched = groups.find((group) => group.some((alias) => normalized.includes(normalizeColorText(alias))));
  return matched ?? [value];
}

export function colorKeywordMatches(keyword: string, title: string): boolean {
  const titleNorm = normalizeColorText(title);
  return colorAliases(keyword).some((alias) => {
    const aliasNorm = normalizeColorText(alias);
    return aliasNorm.length > 0 && titleNorm.includes(aliasNorm);
  });
}

/**
 * 商品名から機種名（ベース名）を抽出
 * 例: "Toynet Vita2000 アクアブルー" → "Vita2000"
 *     "PS Vita 2000 ランダムカラー" → "Vita2000"
 *     "PSP3000 ブラック" → "PSP3000 ブラック"（色明示なのでそのまま）
 *     "PSP3000 ランダムカラー" → "PSP3000"（ランダムなので機種名のみ）
 */
export function extractModelName(name: string): string {
  // 正規化: 全角スペース→半角、前後空白除去
  const normalized = name.replace(/　/g, " ").trim();
  // 既知の機種パターン（長い名前を先にマッチ）
  const modelPatterns = [
    { pattern: /PS\s*Vita\s*2000|Vita\s*2000|VITA2000/i, canonical: "Vita2000" },
    { pattern: /PS\s*Vita\s*1[01][0-9][0-9]|Vita\s*1[01][0-9][0-9]|VITA1[01][0-9][0-9]/i, canonical: "Vita1000" },
    { pattern: /New\s*2DS\s*LL|New2DSLL|N2DSLL/i, canonical: "New2DSLL" },
    { pattern: /New\s*3DS\s*LL|New3DSLL|N3DSLL/i, canonical: "New3DSLL" },
    { pattern: /New\s*3DS(?!\s*LL)/i, canonical: "New3DS" },
    { pattern: /3DS\s*LL/i, canonical: "3DSLL" },
    { pattern: /3DS(?!\s*LL)/i, canonical: "3DS" },
    { pattern: /PSP\s*3000/i, canonical: "PSP3000" },
    { pattern: /PSP\s*2000/i, canonical: "PSP2000" },
    { pattern: /PSP\s*1000/i, canonical: "PSP1000" },
    { pattern: /Switch\s*Lite|スイッチライト/i, canonical: "SwitchLite" },
    { pattern: /Nintendo\s*Switch|スイッチ/i, canonical: "Switch" },
    { pattern: /DS\s*Lite|DSLite/i, canonical: "DSLite" },
    { pattern: /DS(?!\s*Lite)/i, canonical: "DS" },
  ];
  for (const { pattern, canonical } of modelPatterns) {
    if (pattern.test(normalized)) return canonical;
  }
  // マッチしない場合はそのまま返す
  return normalized;
}
