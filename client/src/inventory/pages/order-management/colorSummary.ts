import {
  colorlessQualifierMatches,
  extractColorFromCsvName,
  extractModelFromCsvName,
  getColorKeywords,
  hasColorlessQualifierText,
  hasLimitedEditionMarker,
  isColorlessRandomColor,
  isOtherColor,
  isRandomColor,
  matchesModel,
  normalizeLooseText,
} from "./colorMatching";
import { csvProductGroupKey, findCsvProductByTitleAndManagement, findDeliveryCsvProduct } from "./csvProductMatching";
import type { ColorSummary, ColorSummaryWithModel, SummaryItem } from "./types";

function isVita2000AquaBlueMisdelivery(title: string, entry: ColorSummaryWithModel): boolean {
  const normalizedTitle = normalizeLooseText(title);
  const normalizedColor = normalizeLooseText(entry.colorOnly);
  return entry.model === "Vita2000" &&
    normalizedColor.includes("アクア") &&
    normalizedTitle.includes("駿河屋誤発送") &&
    (normalizedTitle.includes("ブルー") || normalizedTitle.includes("blue") || normalizedTitle.includes("青"));
}

export function buildColorSummary(item: SummaryItem): ColorSummary[] {
  if (item.csvProducts.length === 0) return [];

  // 取引データ商品から「機種+カラー名」をグループキーにして発注数を収集
  const colorMap = new Map<string, ColorSummaryWithModel>();

  for (const csvProd of item.csvProducts) {
    const colorOnly = extractColorFromCsvName(csvProd.name);
    const model = extractModelFromCsvName(csvProd.name);
    // グループキー: 機種がある場合は「機種 カラー名」、ない場合は「カラー名」のみ
    const groupKey = model ? [model, colorOnly].filter(Boolean).join(" ") : colorOnly;
    if (!colorMap.has(groupKey)) {
      colorMap.set(groupKey, {
        colorName: groupKey,
        csvQty: 0,
        zaicoCount: 0,
        purchasedCount: 0,
        stockCount: 0,
        deliveredCount: 0,
        model,
        colorOnly,
      });
    }
    colorMap.get(groupKey)!.csvQty += csvProd.qty;
  }

  /**
   * Zaico商品タイトルがグループエントリにマッチするか判定し、スコアを返す
   * スコア -1: 不一致
   * スコア 1～: 一致度（高いほど優先）
   *
   * 照合ルール:
   * 1. 機種が一致しない場合は即座に除外
   * 2. CSVが「ランダムカラー」の場合: Zaico商品名に同じ機種が含まれればマッチ（色は不問）
   * 3. CSVが通常カラーの場合: Zaico商品名に同じ機種かつ同じカラーが含まれればマッチ
   */
  function scoreMatch(zaicoTitle: string, entry: ColorSummaryWithModel, managementNo = ""): number {
    // 機種チェック
    if (entry.model && !matchesModel(zaicoTitle, managementNo, entry.model)) return -1;
    const targetText = `${zaicoTitle} ${managementNo}`.trim();
    const entryLimited = hasLimitedEditionMarker(entry.colorName) || hasLimitedEditionMarker(entry.colorOnly);
    const targetLimited = hasLimitedEditionMarker(targetText);
    if (entryLimited) return targetLimited ? 6 : -1;
    if (targetLimited) return -1;
    const managementText = managementNo.toLowerCase();
    const entryColorText = entry.colorOnly.toLowerCase();
    if (managementText && entryColorText && !isRandomColor(entry.colorOnly) && managementText.includes(entryColorText)) return 7;
    const zt = targetText.toLowerCase();
    const zaicoModel = extractModelFromCsvName(targetText);
    const targetIsRandomColor = isRandomColor(targetText);
    if (isVita2000AquaBlueMisdelivery(targetText, entry)) return 5;

    const entryIsRandomColor = isRandomColor(entry.colorOnly);
    const entryIsColorlessRandomColor = isColorlessRandomColor(entry.colorOnly);
    if (entryIsRandomColor || entryIsColorlessRandomColor) {
      if (entryIsColorlessRandomColor && !colorlessQualifierMatches(entry.colorOnly, targetText)) return -1;
      // ランダムカラーグループ: 機種が一致するものはすべて満たす
      // 機種情報がある場合は已にチェック済みなので、ここに届いたら機種一致
      // 機種なしの場合はランダムカラーという文字列を商品名に含むか確認
      if (!entry.model) {
        if (zt.includes("ランダム") || zt.includes("random")) return 1;
        return -1;
      }
      // 機種一致するのでマッチ（Zaico商品名の機種が一致するかどうかでスコア差をつける）
      if (entryIsColorlessRandomColor && !entryIsRandomColor && hasColorlessQualifierText(entry.colorOnly)) {
        if (targetIsRandomColor) return zaicoModel === entry.model ? 2 : 1;
        return zaicoModel === entry.model ? 4 : 3;
      }
      return zaicoModel === entry.model ? 3 : 2;
    } else if (isOtherColor(entry.colorOnly)) {
      return zaicoModel === entry.model ? 1 : -1;
    } else {
      // 通常カラー: Zaico商品名にカラー名が含まれるか確認
      const zaicoColor = extractColorFromCsvName(targetText);
      if (
        entry.model === "Vita2000" &&
        entry.colorOnly.includes("アクア") &&
        targetText.includes("駿河屋誤発送") &&
        targetText.includes("ブルー")
      ) {
        return 4;
      }
      // 「×」区切りの複合カラーの場合は分割して各キーワードを取得
      const csvKeywords = getColorKeywords(entry.colorOnly);
      // 「×」区切りも分割する
      const allCsvKeywords = csvKeywords.flatMap((kw) =>
        kw.includes("×") ? [kw, ...kw.split("×").map((p) => p.trim()).filter(Boolean)] : [kw]
      );
      // Zaico商品名のカラーキーワード（「×」分割も含む）
      const zaicoColorParts = zaicoColor.includes("×")
        ? [zaicoColor, ...zaicoColor.split("×").map((p) => p.trim()).filter(Boolean)]
        : [zaicoColor];
      // カラー照合: CSVキーワードとZaicoカラーキーワードのいずれかが部分一致
      const colorMatch = allCsvKeywords.some((kw) => {
        const k = kw.toLowerCase();
        const normalizedK = normalizeLooseText(k);
        const normalizedTitle = normalizeLooseText(zt);
        return zaicoColorParts.some((zp) => {
          const zc = zp.toLowerCase();
          const normalizedZc = normalizeLooseText(zc);
          return zc.includes(k) ||
            k.includes(zc) ||
            normalizedZc.includes(normalizedK) ||
            normalizedK.includes(normalizedZc);
        }) || zt.includes(k) || normalizedTitle.includes(normalizedK);
      });
      if (!colorMatch) return -1;
      // 機種が完全一致する場合は高スコア
      return zaicoModel === entry.model ? 3 : 2;
    }
  }

  // 発注一覧からグループ別に発注数・入庫済み数を集計
  for (const pi of item.purchaseItems) {
    const csvProd = findCsvProductByTitleAndManagement(item, pi.title, pi.managementNo);
    if (csvProd) {
      const entry = colorMap.get(csvProductGroupKey(csvProd.name));
      if (entry) {
        entry.zaicoCount += pi.quantity;
        if (pi.status === "purchased") entry.purchasedCount += pi.quantity;
        continue;
      }
    }

    let bestEntry: ColorSummaryWithModel | null = null;
    let bestScore = -1;
    for (const [, entry] of Array.from(colorMap.entries())) {
      const score = scoreMatch(pi.title, entry, pi.managementNo);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }
    if (bestEntry && bestScore >= 0) {
      bestEntry.zaicoCount += pi.quantity;
      if (pi.status === "purchased") bestEntry.purchasedCount += pi.quantity;
    }
  }

  // 在庫一覧からグループ別に在庫数を集計
  for (const inv of item.inventoryItems) {
    const csvProd = findCsvProductByTitleAndManagement(item, inv.title, inv.managementNo);
    if (csvProd) {
      const entry = colorMap.get(csvProductGroupKey(csvProd.name));
      if (entry) {
        entry.stockCount += inv.quantity;
        continue;
      }
    }

    let bestEntry: ColorSummaryWithModel | null = null;
    let bestScore = -1;
    for (const [, entry] of Array.from(colorMap.entries())) {
      const score = scoreMatch(inv.title, entry, inv.managementNo);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }
    if (bestEntry && bestScore >= 0) bestEntry.stockCount += inv.quantity;
  }

  // 発注進捗の出庫数はスプシ発送管理の shipped を優先する。
  const shipmentItemsForProgress = item.shipmentProgressSource === "sheet"
    ? item.sheetShipmentItems ?? []
    : item.deliveryItems;
  for (const d of shipmentItemsForProgress) {
    const csvProd = findDeliveryCsvProduct(item, d);
    if (csvProd) {
      const entry = colorMap.get(csvProductGroupKey(csvProd.name));
      if (entry) {
        entry.deliveredCount += d.quantity;
        continue;
      }
    }

    let bestEntry: ColorSummaryWithModel | null = null;
    let bestScore = -1;
    for (const [, entry] of Array.from(colorMap.entries())) {
      const score = scoreMatch(d.title, entry, d.managementNo);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }
    if (bestEntry && bestScore >= 0) bestEntry.deliveredCount += d.quantity;
  }

  return Array.from(colorMap.values()).sort((a, b) => a.colorName.localeCompare(b.colorName, "ja"));
}
