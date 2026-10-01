/**
 * 取引データ商品名からカラー名を抽出する
 * 例: "Vita 1000 コズミックレッド" → "コズミックレッド"
 *     "Vita 1000 レッド&ブルー" → "レッド&ブルー"
 *     "New 3DS ランダムカラー" → "ランダムカラー"
 *     "3DS LL ホワイトベース" → "ホワイトベース"
 * 機種名トークンを除いた最後の部分をカラー名とする
 */
export function extractColorFromCsvName(name: string): string {
  const trimmed = name.trim();
  // 機種名パターンを除去してカラー名を抽出
  // 順番が重要: 長いパターンから先にチェック
  const modelPatterns = [
    /^new\s*2ds\s*ll\s*/i,
    /^new\s*3ds\s*ll\s*/i,
    /^new\s*3ds\s*/i,
    /^2ds\s*/i,
    /^3ds\s*ll\s*/i,
    /^3ds\s*/i,
    /^ds\s*lite\s*/i,
    /^dslite\s*/i,
    /^dsi\s*ll\s*/i,
    /^dsi\s*/i,
    /^ps\s*vita\s*2000\s*/i,
    /^ps\s*vita\s*1000\s*/i,
    /^ps\s*vita\s*/i,
    /^vita\s*2000\s*/i,
    /^vita\s*1000\s*/i,
    /^vita\s*/i,
    /^psp\s*/i,
    /^ps5\s*/i,
    /^ps4\s*/i,
  ];
  let remaining = trimmed;
  let matchedModel = false;
  for (const pat of modelPatterns) {
    if (pat.test(remaining)) {
      matchedModel = true;
      remaining = remaining.replace(pat, "").trim();
      break;
    }
  }
  // 残った文字列がカラー名（空なら元の最後トークンにフォールバック）
  if (remaining) return remaining;
  if (matchedModel) return "";
  const lastSpaceIdx = trimmed.lastIndexOf(" ");
  if (lastSpaceIdx === -1) return trimmed;
  return trimmed.slice(lastSpaceIdx + 1);
}

/**
 * Zaico管理番号にカラー名が含まれるか部分一致チェック
 * 例: managementNo="369_ルカ_コズミックレッド_5/5", colorName="コズミックレッド" → true
 * 例: managementNo="369_ルカ_クリスタルブラック_5/5", colorName="ブラック" → true（部分一致）
 * 例: managementNo="369_ルカ_レッド_5/5", colorName="レッド&ブルー" → true（&区切りで分割して照合）
 * 例: managementNo="371_ルカ_ランダム_3/9", colorName="ランダムカラー" → true（ランダム部分一致）
 * 例: managementNo="371_ルカ_ホワイト_3/9", colorName="ホワイトベース" → true（ホワイト部分一致）
 */
export function managementNoMatchesColor(managementNo: string, colorName: string): boolean {
  if (!colorName || !managementNo) return false;
  const mn = managementNo.toLowerCase();
  const cn = colorName.toLowerCase();
  // 直接部分一致
  if (mn.includes(cn)) return true;
  // 「&」または「、」「,」区切りの複合カラーを分割して各カラーで照合
  if (cn.includes("&") || cn.includes("\u3001") || cn.includes(",")) {
    const parts = cn.split(/[&\u3001,]/).map((p) => p.trim()).filter(Boolean);
    return parts.some((part) => mn.includes(part));
  }
  // 「ランダムカラー」「ランダム」の相互照合
  if ((cn.includes("ランダム") && mn.includes("ランダム")) ||
      (cn.includes("random") && mn.includes("random"))) return true;
  // 「ホワイトベース」→「ホワイト」「ピンク×ホワイト」等の照合
  if (cn.includes("ホワイトベース") && mn.includes("ホワイト")) return true;
  if (cn.includes("ホワイト") && mn.includes("ホワイトベース")) return true;
  // 先頭キーワードの部分一致（例: colorName="ホワイトベース" → mn に「ホワイト」が含まれればOK）
  const cnFirst = cn.split(/[\s×&_]/)[0];
  if (cnFirst && cnFirst.length >= 2 && mn.includes(cnFirst)) return true;
  return false;
}

/**
 * カラー名のキーワード一覧を返す
 * 例: "ブラック" → ["ブラック"]
 * 例: "レッド&ブルー" → ["レッド", "ブルー"]
 * 例: "ランダムカラー" → ["ランダムカラー", "ランダム"]
 * 例: "ホワイトベース" → ["ホワイトベース", "ホワイト"]
 */
export function getColorKeywords(colorName: string): string[] {
  // 「、」（全角カンマ）または「,」（半角カンマ）区切りの複合カラーを分割
  // 例: "ホワイト、レッド、ブルー" → ["ホワイト", "レッド", "ブルー"]
  if (colorName.includes("\u3001") || colorName.includes(",")) {
    return colorName.split(/[\u3001,]/).map((p) => p.trim()).filter(Boolean);
  }
  if (colorName.includes("&")) {
    return colorName.split("&").map((p) => p.trim()).filter(Boolean);
  }
  const keywords = [colorName];
  // ランダムカラーは「ランダム」でも照合
  if (colorName.includes("ランダムカラー")) keywords.push("ランダム");
  if (colorName === "ランダム") keywords.push("ランダムカラー");
  // ホワイトベースは「ホワイト」でも照合（ピンク×ホワイト等を含む）
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

/**
 * 取引データ商品名から機種キーワードを抽出する
 * 例: "PS Vita 2000 ランダムカラー" → "Vita2000"
 *     "New 3DS ランダムカラー" → "New3DS"
 *     "3DS LL ホワイトベース" → "3DSLL"
 *     "New 2DS LL ブラック×ターコイズ" → "New2DSLL"
 */
export function extractModelFromCsvName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("new 2ds ll") || n.includes("new2dsll")) return "New2DSLL";
  if (n.includes("vita 2000") || n.includes("vita2000")) return "Vita2000";
  if (n.includes("vita 1000") || n.includes("vita1000") || (n.includes("vita") && !n.includes("2000"))) return "Vita1000";
  if (n.includes("new 3ds ll") || n.includes("new 3dsll") || n.includes("new3ds ll") || n.includes("new3dsll")) return "New3DSLL";
  if (n.includes("new 3ds") || n.includes("new3ds")) return "New3DS";
  if (n.includes("2ds")) return "2DS";
  if (n.includes("3ds ll") || n.includes("3dsll")) return "3DSLL";
  if (n.includes("3ds")) return "3DS";
  if (n.includes("ds lite") || n.includes("dslite")) return "DSLite";
  if (n.includes("dsi ll") || n.includes("dsi xl") || n.includes("dsill")) return "DSiLL";
  if (n.includes("dsi")) return "DSi";
  if (n.includes("psp")) return "PSP";
  if (n.includes("ps5")) return "PS5";
  if (n.includes("ps4")) return "PS4";
  return "";
}

/**
 * 商品タイトルが指定の機種に属するかチェック（タイトルのみで判定、管理番号は参考にしない）
 */
export function matchesModel(title: string, managementNo: string, model: string): boolean {
  const t = title.toLowerCase();
  const m = managementNo.toLowerCase();
  const explicitModel = extractModelFromCsvName(`${title} ${managementNo}`);
  if (explicitModel) return explicitModel === model;
  switch (model) {
    case "Vita2000": return t.includes("vita") && (t.includes("2000") || t.includes("vita2000")) ||
      (m.includes("vita2000") || (m.includes("vita") && m.includes("2000")));
    case "Vita1000": return (t.includes("vita") && !t.includes("2000")) || (m.includes("vita") && !m.includes("2000"));
    case "New3DSLL": return t.includes("new 3ds ll") || t.includes("new 3dsll") || t.includes("new3ds ll") || t.includes("new3dsll") || m.includes("new 3ds ll") || m.includes("new 3dsll") || m.includes("new3ds ll") || m.includes("new3dsll");
    case "New3DS":
      // "new 3ds" を含み、かつ "ll" を含まない
      return (t.includes("new 3ds") || t.includes("new3ds") || m.includes("new3ds")) &&
        !t.includes(" ll") && !t.includes("ll") && !m.includes("ll");
    case "New2DSLL": return t.includes("new 2ds ll") || t.includes("new2dsll") || m.includes("new2dsll");
    case "2DS": return (t.includes("2ds") || m.includes("2ds")) && !t.includes("new") && !m.includes("new") && !t.includes("ll") && !m.includes("ll");
    case "3DSLL": return (t.includes("3ds ll") || t.includes("3dsll") || m.includes("3dsll")) && !t.includes("new") && !m.includes("new");
    case "3DS": return (t.includes("3ds") || m.includes("3ds")) && !t.includes("ll") && !m.includes("ll") && !t.includes("new") && !m.includes("new");
    case "DSLite": return t.includes("ds lite") || t.includes("dslite") || m.includes("dslite") || m.includes("ds lite");
    case "DSiLL": return t.includes("dsi ll") || t.includes("dsi xl") || t.includes("dsill") || m.includes("dsill") || m.includes("dsi ll");
    case "DSi": return (t.includes("dsi") || m.includes("dsi")) && !t.includes("ll") && !t.includes("xl") && !m.includes("ll") && !m.includes("xl");
    case "PSP": return t.includes("psp") || m.includes("psp");
    case "PS5": return t.includes("ps5") || m.includes("ps5");
    case "PS4": return t.includes("ps4") || m.includes("ps4");
    default: return true;
  }
}

/**
 * カラーが「ランダムカラー」かどうか判定
 */
export function isRandomColor(colorName: string): boolean {
  const c = colorName.toLowerCase();
  return c.includes("ランダム") || c.includes("random") || c.includes("ramdom");
}

export function normalizeColorToken(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normalizeColorlessQualifierToken(value: string): string {
  return normalizeColorToken(value).replace(
    /(?:badscreens?|goodcondition|badcondition|damaged?|damage|condition|screens?|screenburn|scratched?|faulty|junk|tested|working)/g,
    "",
  );
}

export function hasColorlessQualifierText(value: string): boolean {
  const compact = normalizeColorToken(value);
  return compact !== normalizeColorlessQualifierToken(value);
}

export function isColorlessRandomColor(colorName: string): boolean {
  if (!colorName.normalize("NFKC").trim()) return true;
  const compact = normalizeColorlessQualifierToken(colorName);
  if (!compact) return false;
  if (/^(psp|pspgo|ps5|ps4|psvita|vita|vita1000|vita2000|new3dsll|new3ds|new2dsll|2ds|3dsll|3ds|dslite|dsill|dsi)$/.test(compact)) return true;
  if (/^\d{3,4}$/.test(compact)) return true;
  if (/^(?:\d{3,4})?(?:grade|rank)[abc]$/.test(compact)) return true;
  if (/^\d{3,4}(?:only|body|console|unit|set)$/.test(compact)) return true;
  return false;
}

export function colorlessQualifierMatches(colorName: string, title: string): boolean {
  const compactColor = normalizeColorlessQualifierToken(colorName);
  const compactTitle = normalizeColorToken(title);
  const version = compactColor.match(/(?:1000|2000|3000)/)?.[0];
  if (version && !compactTitle.includes(version)) return false;
  const grade = compactColor.match(/(?:grade|rank)([abc])/)?.[1];
  if (grade && !compactTitle.includes(`grade${grade}`) && !compactTitle.includes(`rank${grade}`)) return false;
  return true;
}

export function isOtherColor(colorName: string): boolean {
  const c = colorName.normalize("NFKC").trim().toLowerCase();
  return c === "other" ||
    c.includes("other color") ||
    c.includes("その他") ||
    c.includes("それ以外") ||
    c.includes("以外");
}

export function hasLimitedEditionMarker(value: string | null | undefined): boolean {
  const v = (value ?? "").normalize("NFKC").toLowerCase();
  return v.includes("限定版") || v.includes("limited") || v.includes("special edition");
}

export function normalizeLooseText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s　・･_\-ー,、]/g, "");
}
