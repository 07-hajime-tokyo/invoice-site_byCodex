import { suggestCsvProduct } from "@shared/productMatching";
import type { HistoryItem } from "./types";
import { colorKeywordMatches, extractModelName, isRandomColor } from "./colorMatching";

/**
 * csvProductsのスプシ商品名リストと出庫アイテムを照合して集計する
 * - csvProductにランダムカラーが含まれる → 同じ機種の出庫アイテムを全部合算
 * - csvProductに色が1色のみ明示 → その色キーワードが出庫商品名に含まれるものを集計
 * - csvProductに複数色（「&」「×」「＆」区切り）→ いずれかの色キーワードが含まれるものを集計
 * - それ以外（機種名のみ等）→ 同じ機種名でまとめる
 */
export function aggregateItemsByCsvProducts(
  csvProducts: Array<{ name: string; qty: number }>,
  deliveredItems: HistoryItem[]
): Array<{ csvName: string; csvQty: number; deliveredQty: number }> {
  if (csvProducts.length === 0) {
    // csvProductsがない場合は機種名でまとめる
    const modelMap: Record<string, number> = {};
    for (const item of deliveredItems) {
      const model = extractModelName(item.title);
      modelMap[model] = (modelMap[model] ?? 0) + item.quantity;
    }
    return Object.entries(modelMap).map(([name, qty]) => ({ csvName: name, csvQty: 0, deliveredQty: qty }));
  }

  {
    const deliveredByCsvName = new Map<string, number>();
    const unmatchedMap = new Map<string, number>();
    for (const item of deliveredItems) {
      const suggestion = suggestCsvProduct(item.title, item.managementNo ?? "", csvProducts);
      if (suggestion) {
        deliveredByCsvName.set(suggestion.name, (deliveredByCsvName.get(suggestion.name) ?? 0) + item.quantity);
      } else {
        unmatchedMap.set(item.title, (unmatchedMap.get(item.title) ?? 0) + item.quantity);
      }
    }
    const result = csvProducts.map((csvProd) => ({
      csvName: csvProd.name,
      csvQty: csvProd.qty,
      deliveredQty: deliveredByCsvName.get(csvProd.name) ?? 0,
    }));
    const unmatchedItems = Array.from(unmatchedMap.entries())
      .filter(([, qty]) => qty > 0)
      .map(([name, qty]) => ({ csvName: name, csvQty: 0, deliveredQty: qty }));
    return [...result, ...unmatchedItems];
  }

  /** csv商品名から色部分キーワードリストを抽出する */
  function extractColorKeywords(csvName: string): string[] {
    // _extractColorFromCsvName相当：機種名パターンを除いた残りを色部分とする
    const modelPats = [
      /^(toynet\s*)?new\s*2ds\s*ll\s*/i,
      /^(toynet\s*)?new\s*3ds\s*ll\s*/i,
      /^(toynet\s*)?new\s*3ds\s*/i,
      /^(toynet\s*)?3ds\s*ll\s*/i,
      /^(toynet\s*)?3ds\s*/i,
      /^(toynet\s*|toy\s*net\s*)?ps\s*vita\s*2000\s*/i,
      /^(toynet\s*|toy\s*net\s*)?ps\s*vita\s*1000\s*/i,
      /^(toynet\s*|toy\s*net\s*)?ps\s*vita\s*/i,
      /^(toynet\s*|toy\s*net\s*)?vita\s*2000\s*/i,
      /^(toynet\s*|toy\s*net\s*)?vita\s*1[01][0-9][0-9]\s*/i,
      /^(toynet\s*|toy\s*net\s*)?vita\s*/i,
      /^(toynet\s*)?psp\s*3000\s*/i,
      /^(toynet\s*)?psp\s*2000\s*/i,
      /^(toynet\s*)?psp\s*1000\s*/i,
      /^(toynet\s*)?psp\s*/i,
      /^(toynet\s*)?ps5\s*/i,
      /^(toynet\s*)?ps4\s*/i,
      /^(toynet\s*)?switch\s*lite\s*/i,
      /^(toynet\s*)?switch\s*/i,
    ];
    let remaining = csvName.trim();
    for (const pat of modelPats) {
      if (pat.test(remaining)) { remaining = remaining.replace(pat, "").trim(); break; }
    }
    if (!remaining) return [];
    // 「ランダムカラー」「ランダム」「random」は空リスト（ランダム判定は別途）
    if (isRandomColor(remaining)) return [];
    // 「◯◯ベース」の場合はベース色のみをキーワードとして返す
    // 例: "ホワイトベース" → ["ホワイト"]（ピンク×ホワイト、ミントホワイト等も一致させる）
    const baseMatch = remaining.match(/^(.+?)ベース$/i);
    if (baseMatch) {
      const baseColor = baseMatch[1].trim();
      return baseColor ? [baseColor] : [];
    }
    // 複数色区切り（&, ×, ＆, ・, カンマ）で分割
    const parts = remaining.split(/[&×＆・,，、/]/).map((p) => p.trim()).filter(Boolean);
    return parts.length > 1 ? parts : [remaining];
  }

  const result = csvProducts.map((csvProd) => {
    const csvRandom = isRandomColor(csvProd.name);
    const csvModel = extractModelName(csvProd.name);
    const colorKeywords = extractColorKeywords(csvProd.name);
    let deliveredQty = 0;
    for (const item of deliveredItems) {
      const itemModel = extractModelName(item.title);
      if (itemModel !== csvModel) continue;
      if (csvRandom || colorKeywords.length === 0) {
        // ランダムカラー or 色部分なし: 同じ機種名なら全部合算
        deliveredQty += item.quantity;
      } else {
        // 色キーワードのいずれかが出庫商品名に含まれるか確認
        const matched = colorKeywords.some((kw) => colorKeywordMatches(kw, item.title));
        if (matched) deliveredQty += item.quantity;
      }
    }
    return { csvName: csvProd.name, csvQty: csvProd.qty, deliveredQty };
  });

  // CSVに登録されていない出庫商品を「未分類」として追加
  // （どのcsvProductにもマッチしなかった出庫アイテムを集計）
  const unmatchedMap: Record<string, number> = {};
  for (const item of deliveredItems) {
    const itemModel = extractModelName(item.title);
    // いずれかのcsvProductにマッチしているか確認
    const isMatched = csvProducts.some((csvProd) => {
      const csvModel = extractModelName(csvProd.name);
      if (itemModel !== csvModel) return false;
      const csvRandom = isRandomColor(csvProd.name);
      const colorKeywords = extractColorKeywords(csvProd.name);
      if (csvRandom || colorKeywords.length === 0) return true;
      return colorKeywords.some((kw) => colorKeywordMatches(kw, item.title));
    });
    if (!isMatched) {
      unmatchedMap[item.title] = (unmatchedMap[item.title] ?? 0) + item.quantity;
    }
  }
  const unmatchedItems = Object.entries(unmatchedMap)
    .filter(([, qty]) => qty > 0)
    .map(([name, qty]) => ({ csvName: name, csvQty: 0, deliveredQty: qty }));

  return [...result, ...unmatchedItems];
}
