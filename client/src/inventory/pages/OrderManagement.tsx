import { useState, useMemo, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Search, X, ChevronDown, ChevronRight, Download, BarChart2, Package, Pencil, Check, AlertTriangle, CheckCircle2, Loader2, ExternalLink,
} from "lucide-react";

type SummaryItem = {
  key: string;
  partner: string;
  csvOrderQty: number;
  csvStatus: string;
  manualComplete: boolean;
  csvProducts: Array<{ name: string; qty: number; status: string; paymentDate: string }>;
  orderedCount: number;
  purchasedCount: number;
  deliveredCount: number;
  stockCount: number;
  purchaseItems: Array<{
    purchaseId: number;
    num: string;
    title: string;
    quantity: number;
    status: string;
    managementNo: string;
  }>;
  inventoryItems: Array<{
    inventoryId: number;
    title: string;
    quantity: number;
    managementNo: string;
    etc: string;
  }>;
  deliveryItems: Array<{
    deliveryNo: string;
    title: string;
    quantity: number;
    deliveredAt: string;
    managementNo: string;
  }>;
};

/** CSVエクスポート */
function exportOrderManagementCSV(items: SummaryItem[]) {
  const rows: string[][] = [
    ["インボイスNo", "取引先", "取引データ発注数", "入庫済み数", "出庫済み数", "在庫数", "進捗率"],
  ];
  for (const item of items) {
    const progress = item.csvOrderQty > 0
      ? Math.round((item.deliveredCount / item.csvOrderQty) * 100)
      : 0;
    rows.push([
      item.key,
      item.partner,
      String(item.csvOrderQty),
      String(item.purchasedCount),
      String(item.deliveredCount),
      String(item.stockCount),
      `${progress}%`,
    ]);
  }
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `発注管理_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 進捗バーの色を返す */
function progressColor(pct: number): string {
  if (pct >= 100) return "bg-green-500";
  if (pct >= 70) return "bg-blue-500";
  if (pct >= 40) return "bg-yellow-500";
  return "bg-red-500";
}

/**
 * 取引データ商品名からカラー名を抽出する
 * 例: "Vita 1000 コズミックレッド" → "コズミックレッド"
 *     "Vita 1000 レッド&ブルー" → "レッド&ブルー"
 *     "New 3DS ランダムカラー" → "ランダムカラー"
 *     "3DS LL ホワイトベース" → "ホワイトベース"
 * 機種名トークンを除いた最後の部分をカラー名とする
 */
function extractColorFromCsvName(name: string): string {
  const trimmed = name.trim();
  // 機種名パターンを除去してカラー名を抽出
  // 順番が重要: 長いパターンから先にチェック
  const modelPatterns = [
    /^new\s*3ds\s*ll\s*/i,
    /^new\s*3ds\s*/i,
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
  for (const pat of modelPatterns) {
    if (pat.test(remaining)) {
      remaining = remaining.replace(pat, "").trim();
      break;
    }
  }
  // 残った文字列がカラー名（空なら元の最後トークンにフォールバック）
  if (remaining) return remaining;
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
function managementNoMatchesColor(managementNo: string, colorName: string): boolean {
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
 * SummaryItemのcsvProductsとpurchaseItems/inventoryItems/deliveryItemsを
 * カラー名でグループ化して集計する
 */
type ColorSummary = {
  colorName: string;
  csvQty: number;         // 取引データ発注数
  zaicoCount: number;     // 発注一覧に登録された数（status問わず）
  purchasedCount: number; // 入庫済み数（status=purchased）
  stockCount: number;     // 在庫数
  deliveredCount: number; // 出庫済み数
};

/**
 * カラー名のキーワード一覧を返す
 * 例: "ブラック" → ["ブラック"]
 * 例: "レッド&ブルー" → ["レッド", "ブルー"]
 * 例: "ランダムカラー" → ["ランダムカラー", "ランダム"]
 * 例: "ホワイトベース" → ["ホワイトベース", "ホワイト"]
 */
function getColorKeywords(colorName: string): string[] {
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
function extractModelFromCsvName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("new 2ds ll") || n.includes("new2dsll")) return "New2DSLL";
  if (n.includes("vita 2000") || n.includes("vita2000")) return "Vita2000";
  if (n.includes("vita 1000") || n.includes("vita1000") || (n.includes("vita") && !n.includes("2000"))) return "Vita1000";
  if (n.includes("new 3ds ll") || n.includes("new3dsll")) return "New3DSLL";
  if (n.includes("new 3ds") || n.includes("new3ds")) return "New3DS";
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
function matchesModel(title: string, managementNo: string, model: string): boolean {
  const t = title.toLowerCase();
  const m = managementNo.toLowerCase();
  switch (model) {
    case "Vita2000": return t.includes("vita") && (t.includes("2000") || t.includes("vita2000")) ||
      (m.includes("vita2000") || (m.includes("vita") && m.includes("2000")));
    case "Vita1000": return (t.includes("vita") && !t.includes("2000")) || (m.includes("vita") && !m.includes("2000"));
    case "New3DSLL": return t.includes("new 3ds ll") || t.includes("new3dsll") || m.includes("new3dsll");
    case "New3DS":
      // "new 3ds" を含み、かつ "ll" を含まない
      return (t.includes("new 3ds") || t.includes("new3ds") || m.includes("new3ds")) &&
        !t.includes(" ll") && !t.includes("ll") && !m.includes("ll");
    case "New2DSLL": return t.includes("new 2ds ll") || t.includes("new2dsll") || m.includes("new2dsll");
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
function isRandomColor(colorName: string): boolean {
  const c = colorName.toLowerCase();
  return c.includes("ランダム") || c.includes("random") || c.includes("ramdom");
}

function normalizeColorToken(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isColorlessRandomColor(colorName: string): boolean {
  if (!colorName.normalize("NFKC").trim()) return true;
  const compact = normalizeColorToken(colorName);
  if (!compact) return false;
  if (/^(psp|pspgo|ps5|ps4|psvita|vita|vita1000|vita2000|new3dsll|new3ds|new2dsll|3dsll|3ds|dslite|dsill|dsi)$/.test(compact)) return true;
  if (/^\d{3,4}$/.test(compact)) return true;
  if (/^(?:\d{3,4})?(?:grade|rank)[abc]$/.test(compact)) return true;
  if (/^\d{3,4}(?:only|body|console|unit|set)$/.test(compact)) return true;
  return false;
}

function colorlessQualifierMatches(colorName: string, title: string): boolean {
  const compactColor = normalizeColorToken(colorName);
  const compactTitle = normalizeColorToken(title);
  const version = compactColor.match(/(?:1000|2000|3000)/)?.[0];
  if (version && !compactTitle.includes(version)) return false;
  const grade = compactColor.match(/(?:grade|rank)([abc])/)?.[1];
  if (grade && !compactTitle.includes(`grade${grade}`) && !compactTitle.includes(`rank${grade}`)) return false;
  return true;
}

function isOtherColor(colorName: string): boolean {
  const c = colorName.normalize("NFKC").trim().toLowerCase();
  return c === "other" ||
    c.includes("other color") ||
    c.includes("その他") ||
    c.includes("それ以外") ||
    c.includes("以外");
}

type ColorSummaryWithModel = ColorSummary & { model: string; colorOnly: string };

function buildColorSummary(item: SummaryItem): ColorSummary[] {
  if (item.csvProducts.length === 0) return [];

  // 取引データ商品から「機種+カラー名」をグループキーにして発注数を収集
  const colorMap = new Map<string, ColorSummaryWithModel>();

  for (const csvProd of item.csvProducts) {
    const colorOnly = extractColorFromCsvName(csvProd.name);
    const model = extractModelFromCsvName(csvProd.name);
    // グループキー: 機種がある場合は「機種 カラー名」、ない場合は「カラー名」のみ
    const groupKey = model ? `${model} ${colorOnly}` : colorOnly;
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
  function scoreMatch(zaicoTitle: string, entry: ColorSummaryWithModel): number {
    // 機種チェック
    if (entry.model && !matchesModel(zaicoTitle, "", entry.model)) return -1;
    const zt = zaicoTitle.toLowerCase();
    const zaicoModel = extractModelFromCsvName(zaicoTitle);

    if (isRandomColor(entry.colorOnly) || isColorlessRandomColor(entry.colorOnly)) {
      if (isColorlessRandomColor(entry.colorOnly) && !colorlessQualifierMatches(entry.colorOnly, zaicoTitle)) return -1;
      // ランダムカラーグループ: 機種が一致するものはすべて満たす
      // 機種情報がある場合は已にチェック済みなので、ここに届いたら機種一致
      // 機種なしの場合はランダムカラーという文字列を商品名に含むか確認
      if (!entry.model) {
        if (zt.includes("ランダム") || zt.includes("random")) return 1;
        return -1;
      }
      // 機種一致するのでマッチ（Zaico商品名の機種が一致するかどうかでスコア差をつける）
      return zaicoModel === entry.model ? 3 : 2;
    } else if (isOtherColor(entry.colorOnly)) {
      return zaicoModel === entry.model ? 1 : -1;
    } else {
      // 通常カラー: Zaico商品名にカラー名が含まれるか確認
      const zaicoColor = extractColorFromCsvName(zaicoTitle);
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
        return zaicoColorParts.some((zp) => {
          const zc = zp.toLowerCase();
          return zc.includes(k) || k.includes(zc);
        }) || zt.includes(k);
      });
      if (!colorMatch) return -1;
      // 機種が完全一致する場合は高スコア
      return zaicoModel === entry.model ? 3 : 2;
    }
  }

  // 発注一覧からグループ別に発注数・入庫済み数を集計
  for (const pi of item.purchaseItems) {
    let bestEntry: ColorSummaryWithModel | null = null;
    let bestScore = -1;
    for (const [, entry] of Array.from(colorMap.entries())) {
      const score = scoreMatch(pi.title, entry);
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
    let bestEntry: ColorSummaryWithModel | null = null;
    let bestScore = -1;
    for (const [, entry] of Array.from(colorMap.entries())) {
      const score = scoreMatch(inv.title, entry);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }
    if (bestEntry && bestScore >= 0) bestEntry.stockCount += inv.quantity;
  }

  // 出庫履歴からグループ別に出庫数を集計
  for (const d of item.deliveryItems) {
    let bestEntry: ColorSummaryWithModel | null = null;
    let bestScore = -1;
    for (const [, entry] of Array.from(colorMap.entries())) {
      const score = scoreMatch(d.title, entry);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }
    if (bestEntry && bestScore >= 0) bestEntry.deliveredCount += d.quantity;
  }

  return Array.from(colorMap.values()).sort((a, b) => a.colorName.localeCompare(b.colorName, "ja"));
}

/** インボイスメモのインライン編集コンポーネント */
function InvoiceMemoField({ invoiceKey, colorKey }: { invoiceKey: string; colorKey: string }) {
  const { data: memos } = trpc.inventory.invoiceMemo.list.useQuery({ invoiceKey });
  const upsertMemo = trpc.inventory.invoiceMemo.upsert.useMutation();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const currentMemo = memos?.find((m) => m.colorKey === colorKey)?.memo ?? "";

  const startEdit = useCallback(() => {
    setDraft(currentMemo);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [currentMemo]);

  const save = useCallback(async () => {
    await upsertMemo.mutateAsync({ invoiceKey, colorKey, memo: draft });
    await utils.inventory.invoiceMemo.list.invalidate({ invoiceKey });
    setEditing(false);
  }, [upsertMemo, utils, invoiceKey, colorKey, draft]);

  if (editing) {
    return (
      <div className="flex items-center gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          className="text-xs border rounded px-2 py-0.5 w-48 bg-background"
          placeholder="メモを入力..."
        />
        <button
          onClick={save}
          className="text-green-600 hover:text-green-700 p-0.5"
          title="保存"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1 ml-2 cursor-pointer group"
      onClick={(e) => { e.stopPropagation(); startEdit(); }}
      title="クリックしてメモを編集"
    >
      {currentMemo ? (
        <span className="text-xs text-muted-foreground max-w-[200px] truncate">{currentMemo}</span>
      ) : (
        <span className="text-xs text-muted-foreground/40 hidden group-hover:inline">メモを追加</span>
      )}
      <Pencil className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </div>
  );
}

/** 発注詳細パネル */
function PurchaseDetailPanel({ purchaseId }: { purchaseId: number }) {
  const { data: allPurchases, isLoading } = trpc.inventory.zaico.getPurchasesWithCategory.useQuery();
  const purchase = allPurchases?.find((p: { id: number }) => p.id === purchaseId);
  if (isLoading) return <div className="px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />読み込み中...</div>;
  if (!purchase) return <div className="px-4 py-2 text-xs text-muted-foreground">詳細情報を取得できませんでした</div>;
  const p = purchase as unknown as {
    id: number; num: string; status: string; purchase_date: string | null;
    purchase_items: Array<{ id: number; title: string; quantity: string; etc: string | null; unit_price: string | null; }>;
    extra?: { shipDate?: string | null; trackingNumber?: string | null; supplierName?: string | null; supplierUrl?: string | null; } | null;
    csvSupplierName?: string | null;
  };
  return (
    <div className="px-4 py-2.5 bg-blue-50/30 border-t border-blue-100 text-sm space-y-1.5">
      {(p.extra?.trackingNumber) && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">追跡番号</span>
          <span className="font-mono text-right">{p.extra?.trackingNumber}</span>
        </div>
      )}
      {p.purchase_date && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">発注日</span>
          <span className="text-right">{new Date(p.purchase_date).toLocaleDateString("ja-JP")}</span>
        </div>
      )}
      {(p.extra?.supplierName ?? p.csvSupplierName) && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">仕入先</span>
          <span className="text-right">{p.extra?.supplierName ?? p.csvSupplierName}</span>
        </div>
      )}
      {p.purchase_items.map((item, i) => item.unit_price != null && (
        <div key={i} className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
          <span className="font-semibold text-right">¥{Number(item.unit_price).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

/** 在庫詳細パネル */
function InventoryDetailPanel({ inventoryId, unitPrice: propUnitPrice, trackingNumber: propTracking, supplierUrl: propSupplierUrl, supplierName: propSupplierName }: {
  inventoryId: number; unitPrice?: string; trackingNumber?: string; supplierUrl?: string; supplierName?: string;
}) {
  const { data: detail, isLoading } = trpc.inventory.zaico.getInventoryById.useQuery({ inventoryId });
  if (isLoading) return <div className="px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />読み込み中...</div>;
  // Zaicoデータが取れない場合（削除済み商品等）はプロップスのデータだけで表示
  if (!detail) {
    if (!propUnitPrice && !propTracking && !propSupplierName) {
      return <div className="px-4 py-2 text-xs text-muted-foreground">詳細情報を取得できませんでした（削除済み商品）</div>;
    }
    return (
      <div className="px-4 py-2.5 bg-purple-50/30 border-t border-purple-100 text-sm space-y-1.5">
        {propTracking && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground flex-shrink-0">追跡番号</span>
            <span className="font-mono text-right">{propTracking}</span>
          </div>
        )}
        {propSupplierName && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground flex-shrink-0">仕入先</span>
            {propSupplierUrl ? (
              <a href={propSupplierUrl} target="_blank" rel="noopener noreferrer" className="text-right text-primary hover:underline flex items-center gap-1">
                <ExternalLink className="h-3 w-3 flex-shrink-0" />{propSupplierName}
              </a>
            ) : (
              <span className="text-right">{propSupplierName}</span>
            )}
          </div>
        )}
        {propUnitPrice && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
            <span className="font-semibold text-right">¥{Number(propUnitPrice).toLocaleString()}</span>
          </div>
        )}
      </div>
    );
  }
  const inv = detail as {
    id: number; title: string; quantity: string; unit: string; place?: string | null;
    purchase_unit_price?: number | null; unit_price?: number | null;
    etc?: string | null; item_image?: { url: string } | null;
    optional_attributes?: Array<{ name: string; value: string | null }> | null;
    updated_at?: string | null;
  };
  // 仕入単価: props層渡し > Zaicoデータ
  const displayUnitPrice = propUnitPrice !== undefined && propUnitPrice !== "" ? Number(propUnitPrice) : (inv.purchase_unit_price ?? inv.unit_price);
  // 追跡番号・仕入先: props層渡しを優先
  const displayTracking = propTracking || null;
  const displaySupplierName = propSupplierName || null;
  const displaySupplierUrl = propSupplierUrl || null;
  return (
    <div className="px-4 py-2.5 bg-purple-50/30 border-t border-purple-100 text-sm space-y-1.5">
      {inv.item_image?.url && (
        <div className="flex justify-center pb-1">
          <img src={inv.item_image.url} alt={inv.title} loading="lazy" decoding="async" className="h-20 w-20 object-contain rounded border bg-muted/20" />
        </div>
      )}
      {displayTracking && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">追跡番号</span>
          <span className="font-mono text-right">{displayTracking}</span>
        </div>
      )}
      {displaySupplierName && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">仕入先</span>
          {displaySupplierUrl ? (
            <a href={displaySupplierUrl} target="_blank" rel="noopener noreferrer" className="text-right text-primary hover:underline flex items-center gap-1">
              <ExternalLink className="h-3 w-3 flex-shrink-0" />{displaySupplierName}
            </a>
          ) : (
            <span className="text-right">{displaySupplierName}</span>
          )}
        </div>
      )}
      {displayUnitPrice != null && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
          <span className="font-semibold text-right">¥{displayUnitPrice.toLocaleString()}</span>
        </div>
      )}
      {inv.place && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">保管場所</span>
          <span className="text-right">{inv.place}</span>
        </div>
      )}
      {inv.optional_attributes?.map((attr) =>
        attr.value && attr.name !== "仕入単価" ? (
          <div key={attr.name} className="flex justify-between gap-2">
            <span className="text-muted-foreground flex-shrink-0">{attr.name}</span>
            <span className="text-right">{attr.value}</span>
          </div>
        ) : null
      )}
    </div>
  );
}

/** 出庫詳細パネル（サーバーから取得済みの仕入情報を直接受取る） */
function DeliveryDetailPanel({ deliveryNo, deliveredAt, unitPrice, trackingNumber, supplierUrl, supplierName }: {
  deliveryNo: string; deliveredAt: string; unitPrice: string; trackingNumber: string; supplierUrl: string; supplierName: string;
}) {
  return (
    <div className="px-4 py-2.5 bg-orange-50/30 border-t border-orange-100 text-sm space-y-1.5">
      {trackingNumber && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">追跡番号</span>
          <span className="font-mono text-right">{trackingNumber}</span>
        </div>
      )}
      {supplierName && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">仕入先</span>
          {supplierUrl ? (
            <a href={supplierUrl} target="_blank" rel="noopener noreferrer" className="text-right text-primary hover:underline flex items-center gap-1">
              <ExternalLink className="h-3 w-3 flex-shrink-0" />{supplierName}
            </a>
          ) : (
            <span className="text-right">{supplierName}</span>
          )}
        </div>
      )}
      {unitPrice !== "" && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
          <span className="font-semibold text-right">¥{Number(unitPrice).toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

export default function OrderManagement() {
  const [, setLocation] = useLocation();
  const { data: summary, isLoading, refetch } = trpc.inventory.orderManagement.getSummary.useQuery();
  const setManualComplete = trpc.inventory.invoiceMemo.setManualComplete.useMutation({
    onSuccess: () => refetch(),
  });
  const utils = trpc.useUtils();
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    try { return localStorage.getItem("om_searchQuery") ?? ""; } catch { return ""; }
  });
  const [selectedPartners, setSelectedPartners] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("om_selectedPartners");
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed);
      }
    } catch {}
    return new Set<string>();
  });
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  // 商品詳細トグル状態: "type-invoiceKey-idx" -> boolean
  const [openDetailItems, setOpenDetailItems] = useState<Record<string, boolean>>({});
  function toggleDetailItem(key: string) {
    setOpenDetailItems((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  const [hideCompleted, setHideCompleted] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("om_hideCompleted");
      return v === null ? true : v === "true";
    } catch { return true; }
  });

  // フィルター変更時にlocalStorageに保存
  const handleSearchQuery = (v: string) => {
    setSearchQuery(v);
    try { localStorage.setItem("om_searchQuery", v); } catch {}
  };
  const handleTogglePartner = (v: string) => {
    setSelectedPartners((prev) => {
      const next = new Set(prev);
      if (v === "すべて") {
        // 「すべて」をクリックしたら選択をすべてクリア
        next.clear();
      } else if (next.has(v)) {
        next.delete(v);
      } else {
        next.add(v);
      }
      try { localStorage.setItem("om_selectedPartners", JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };
  const handleHideCompleted = () => {
    setHideCompleted((prev) => {
      const next = !prev;
      try { localStorage.setItem("om_hideCompleted", String(next)); } catch {}
      return next;
    });
  };

  // 取引先一覧を集計
  const partners = useMemo(() => {
    if (!summary) return ["すべて"];
    const set = new Set<string>();
    for (const item of summary as SummaryItem[]) {
      set.add(item.partner || "その他");
    }
    return ["すべて", ...Array.from(set).sort()];
  }, [summary]);

  // 8桁日付形式（YYYYMMDD）の出庫Noを判定する関数
  const isDateBasedKey = (key: string) => /^\d{8}$/.test(key);

  const filtered = useMemo(() => {
    if (!summary) return [];
    const q = searchQuery.trim().toLowerCase();
    return (summary as SummaryItem[]).filter((item) => {
      // 8桁日付形式の出庫Noは除外
      if (isDateBasedKey(item.key)) return false;
      // 完了判定: 出庫数>=発注数 OR manualComplete OR csvStatus=complete
      const isComplete = item.manualComplete || item.csvStatus === "complete" ||
        (item.csvOrderQty > 0 && item.deliveredCount >= item.csvOrderQty);
      // 未完了のみ表示トグル
      if (hideCompleted && isComplete) return false;
      if (selectedPartners.size > 0 && !selectedPartners.has(item.partner || "その他")) return false;
      if (!q) return true;
      if (item.key.toLowerCase().includes(q)) return true;
      if ((item.partner ?? "").toLowerCase().includes(q)) return true;
      if (item.purchaseItems.some((p) => p.managementNo.toLowerCase().includes(q) || p.title.toLowerCase().includes(q))) return true;
      if (item.inventoryItems.some((i) => i.managementNo.toLowerCase().includes(q) || i.title.toLowerCase().includes(q))) return true;
      if (item.csvProducts.some((p) => p.name.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [summary, searchQuery, selectedPartners, hideCompleted]);

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー（スクロール固定） */}
      <div className="-mx-4 px-4 pb-2 pt-1">
      <div className="rounded-xl border bg-card shadow-sm px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">発注管理</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              インボイスNo別 発注数・出庫数・進捗 ({filtered.length} 件)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={hideCompleted ? "default" : "outline"}
              size="sm"
              onClick={handleHideCompleted}
              className="text-xs"
            >
              {hideCompleted ? "未完了のみ" : "全件表示"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => filtered.length > 0 && exportOrderManagementCSV(filtered)}
            >
              <Download className="h-4 w-4 mr-1.5" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              更新
            </Button>
          </div>
        </div>
        {/* 検索バー */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="インボイスNo・取引先・商品名で検索..."
            value={searchQuery}
            onChange={(e) => handleSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      </div>

      {/* ローディング */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" />
          データを読み込み中...
        </div>
      )}

      {/* 取引先タブ（複数選択対応） */}
      {partners.length > 1 && !isLoading && (
        <div className="flex flex-wrap gap-2 items-center">
          <button
            key="すべて"
            onClick={() => handleTogglePartner("すべて")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedPartners.size === 0
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            すべて
          </button>
          {partners.filter((p) => p !== "すべて").map((p) => {
            const isSelected = selectedPartners.has(p);
            return (
              <button
                key={p}
                onClick={() => handleTogglePartner(p)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {isSelected && <Check className="h-3 w-3" />}
                {p}
              </button>
            );
          })}
          {selectedPartners.size > 0 && (
            <button
              onClick={() => handleTogglePartner("すべて")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-1"
            >
              <X className="h-3.5 w-3.5" />
              選択解除
            </button>
          )}
        </div>
      )}

      {/* データなし */}
      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <BarChart2 className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm">
            {searchQuery ? "検索条件に一致するデータがありません" : "データがありません"}
          </p>
        </div>
      )}

      {/* 集計カード一覧 */}
      <div className="space-y-3">
        {filtered.map((item) => {
          const isExpanded = expandedKeys.has(item.key);
          const pct = item.csvOrderQty > 0
            ? Math.round((item.deliveredCount / item.csvOrderQty) * 100)
            : 0;
          const remaining = Math.max(0, item.csvOrderQty - item.deliveredCount);
          // 超過出庫: 出庫数が発注数を超えている
          const excessDelivery = item.csvOrderQty > 0 && item.deliveredCount > item.csvOrderQty
            ? item.deliveredCount - item.csvOrderQty
            : 0;
          // 完了判定: manualComplete OR csvStatus=complete のみ
          // ※出庫数>=発注数だけでは完了にしない（超過出庫の場合は手動完了が必要）
          // ※ちょうど一致（出庫==発注）の場合は自動完了
          const isAutoComplete = item.csvOrderQty > 0 && item.deliveredCount === item.csvOrderQty;
          const isComplete = item.manualComplete || item.csvStatus === "complete" || isAutoComplete;
          const colorSummary = buildColorSummary(item);

          // カラー別の超過・不足を集計
          let colorOverUnder: { over: number; under: number };
          if (colorSummary.length > 0) {
            colorOverUnder = colorSummary.reduce(
              (acc, cs) => {
                const diff = (cs.deliveredCount + cs.zaicoCount + cs.stockCount) - cs.csvQty;
                if (diff > 0) acc.over += diff;
                else if (diff < 0) acc.under += Math.abs(diff);
                return acc;
              },
              { over: 0, under: 0 }
            );
          } else if (item.csvOrderQty > 0) {
            const totalZaico = item.purchaseItems.reduce((sum, pi) => sum + pi.quantity, 0);
            const totalStock = item.inventoryItems.reduce((sum, inv) => sum + inv.quantity, 0);
            const totalDelivered = item.deliveryItems.reduce((sum, d) => sum + d.quantity, 0);
            const diff = (totalDelivered + totalZaico + totalStock) - item.csvOrderQty;
            colorOverUnder = {
              over: diff > 0 ? diff : 0,
              under: diff < 0 ? Math.abs(diff) : 0,
            };
          } else {
            colorOverUnder = { over: 0, under: 0 };
          }

          return (
            <div key={item.key} className="rounded-lg border bg-card shadow-sm overflow-hidden">
              {/* 超過出庫時の注意バナー */}
              {excessDelivery > 0 && (
                <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                  <span>
                    超過出庫: 発注数 <strong>{item.csvOrderQty}個</strong> に対して出庫数が <strong>{item.deliveredCount}個</strong>（{excessDelivery}個超過）— 内容を確認の上、手動完了してください
                  </span>
                  {!item.manualComplete && (
                    <button
                      className="ml-auto flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-700 text-xs font-medium"
                      onClick={(e) => { e.stopPropagation(); setManualComplete.mutate({ invoiceKey: item.key, completed: true }); }}
                    >
                      <CheckCircle2 className="h-3 w-3" />完了にする
                    </button>
                  )}
                </div>
              )}
              {/* 手動完了時の解除バナー */}
              {item.manualComplete && (
                <div className="flex items-center gap-2 px-4 py-1 bg-green-50 border-b border-green-200 text-green-800 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  <span>手動完了済み</span>
                  <button
                    className="ml-auto text-green-700 underline hover:no-underline text-xs"
                    onClick={(e) => { e.stopPropagation(); setManualComplete.mutate({ invoiceKey: item.key, completed: false }); }}
                  >
                    完了を解除
                  </button>
                </div>
              )}
              {/* カードヘッダー */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => toggleExpand(item.key)}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base text-foreground">No.{item.key}</span>
                      {item.partner && item.partner !== "その他" && (
                        <Badge variant="secondary" className="text-xs font-medium">
                          {item.partner}
                        </Badge>
                      )}
                      {remaining > 0 && !isComplete && (
                        <Badge variant="destructive" className="text-xs">
                          残 {remaining}個
                        </Badge>
                      )}
                      {isComplete && (
                        <Badge className="text-xs bg-green-500 text-white">完了</Badge>
                      )}
                      {/* カラー別超過バッジのみ（不足バッジは削除） */}
                      {colorSummary.length > 0 ? (
                        colorSummary.map((cs) => {
                          const diff = (cs.deliveredCount + cs.zaicoCount + cs.stockCount) - cs.csvQty;
                          if (diff <= 0) return null; // 不足・ちょうどはバッジ非表示
                          return (
                            <Badge
                              key={cs.colorName}
                              className="text-xs bg-amber-500 text-white"
                            >
                              {cs.colorName}: 出庫{cs.deliveredCount}個 &gt; 発注{cs.csvQty}個（{diff}個超過）
                            </Badge>
                          );
                        })
                      ) : (
                        <>
                          {colorOverUnder.over > 0 && (
                            <Badge className="text-xs bg-amber-500 text-white">
                              出庫{item.deliveredCount}個 &gt; 発注{item.csvOrderQty}個（{colorOverUnder.over}個超過）
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                    {/* 進捗バー */}
                    {item.csvOrderQty > 0 && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${progressColor(pct)}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          出庫{item.deliveredCount}/{item.csvOrderQty}個 ({pct}%)
                        </span>
                      </div>
                    )}
                    {/* 取引データ商品名（1件目のみ表示） */}
                    {item.csvProducts.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {item.csvProducts[0].name}
                        {item.csvProducts.length > 1 && ` 他${item.csvProducts.length - 1}件`}
                      </p>
                    )}
                  </div>
                </div>
                {/* サマリーバッジ（右側） */}
                <div className="flex items-center gap-1.5 flex-wrap justify-end flex-shrink-0 ml-3">
                  {item.csvOrderQty > 0 && (
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-muted-foreground">発注:</span>
                      <Badge variant="outline" className="text-gray-700 text-xs px-1.5 py-0">
                        {item.csvOrderQty}個
                      </Badge>
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">出庫:</span>
                    <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50 text-xs px-1.5 py-0">
                      {item.deliveredCount}個
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">在庫:</span>
                    <Badge variant="outline" className="text-purple-600 border-purple-200 bg-purple-50 text-xs px-1.5 py-0">
                      {item.stockCount}個
                    </Badge>
                  </div>
                </div>
              </div>

              {/* 展開時の詳細 */}
              {isExpanded && (
                <div className="border-t divide-y">
                  {/* インボイス備考欄 */}
                  <div className="px-4 py-2.5 bg-yellow-50/60 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground flex-shrink-0">備考:</span>
                    <InvoiceMemoField invoiceKey={item.key} colorKey="__invoice__" />
                  </div>
                  {/* 取引データ発注明細 */}
                  {item.csvProducts.length > 0 && (
                    <div className="px-4 py-3 bg-gray-50/50">
                      <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-gray-500"></span>
                        取引データ発注明細（{item.csvProducts.length}件）
                      </p>
                      <div className="space-y-1.5">
                        {item.csvProducts.map((p, i) => (
                          <div key={i} className="flex items-center justify-between text-sm bg-white rounded px-3 py-1.5 border border-gray-100">
                            <div className="min-w-0 flex-1">
                              <span className="font-medium text-foreground">{p.name}</span>

                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              <span className="text-sm font-medium">{p.qty}個</span>
                              {p.status && (
                                <Badge variant="outline" className="text-xs">{p.status}</Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 発注一覧＋カラー別集計 */}
                  {item.purchaseItems.length > 0 && (
                    <div className="px-4 py-3 bg-blue-50/30">
                      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                        <p className="text-xs font-semibold text-blue-700 flex items-center gap-1">
                          <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                          発注一覧（{item.purchaseItems.length}件）
                        </p>
                        {/* カラー別集計バッジ＋メモ欄 */}
                        {colorSummary.length > 0 && (
                          <div className="flex flex-col gap-1.5">
                            {colorSummary.map((cs) => (
                              <div key={cs.colorName} className="flex items-center gap-1.5 flex-wrap">
                                <div
                                  className="flex items-center gap-1 bg-white border border-blue-100 rounded-full px-2 py-0.5 text-xs"
                                  title={`${cs.colorName}: 取引データ発注${cs.csvQty}個 / 発注${cs.zaicoCount}個 / 入庫済${cs.purchasedCount}個 / 出庫${cs.deliveredCount}個 / 在庫${cs.stockCount}個`}
                                >
                                  <span className="font-medium text-blue-800">{cs.colorName}</span>
                                  <span className="text-muted-foreground">
                                    {cs.zaicoCount}/{cs.csvQty}
                                  </span>
                                  {cs.stockCount > 0 && (
                                    <span className="text-purple-600 font-medium">在{cs.stockCount}</span>
                                  )}
                                </div>
                                <InvoiceMemoField invoiceKey={item.key} colorKey={cs.colorName} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {item.purchaseItems.map((p, i) => {
                          const detailKey = `purchase-${item.key}-${i}`;
                          const isOpen = !!openDetailItems[detailKey];
                          return (
                            <div key={i} className="rounded border border-blue-100 bg-white overflow-hidden">
                              <button
                                onClick={() => toggleDetailItem(detailKey)}
                                className={`w-full flex items-center justify-between text-sm px-3 py-1.5 hover:bg-blue-50/50 transition-colors ${isOpen ? "bg-blue-50/50" : ""}`}
                              >
                                <div className="min-w-0 flex-1 flex items-center gap-1.5 text-left">
                                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                                  <span className="text-xs text-muted-foreground">{p.num}</span>
                                  <span className="font-medium text-foreground">{p.title}</span>
                                  <span className="text-xs text-muted-foreground">({p.managementNo})</span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <span className="text-sm font-medium">{p.quantity}個</span>
                                  <Badge variant="outline" className={p.status === "purchased" ? "text-green-600 border-green-200 bg-green-50 text-xs" : "text-blue-600 border-blue-200 bg-blue-50 text-xs"}>
                                    {p.status === "purchased" ? "入庫済" : "発注済"}
                                  </Badge>
                                </div>
                              </button>
                              {isOpen && (
                                <PurchaseDetailPanel purchaseId={p.purchaseId} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 在庫一覧 */}
                  {item.inventoryItems.length > 0 && (
                    <div className="px-4 py-3 bg-purple-50/30">
                      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                        <p className="text-xs font-semibold text-purple-700 flex items-center gap-1">
                          <span className="inline-block w-2 h-2 rounded-full bg-purple-500"></span>
                          在庫一覧（{item.inventoryItems.length}件）
                        </p>
                        {/* 在庫カラー別集計バッジ */}
                        {colorSummary.length > 0 && colorSummary.some((cs) => cs.stockCount > 0) && (
                          <div className="flex flex-wrap gap-1.5">
                            {colorSummary.filter((cs) => cs.stockCount > 0).map((cs) => (
                              <div
                                key={cs.colorName}
                                className="flex items-center gap-1 bg-white border border-purple-100 rounded-full px-2 py-0.5 text-xs"
                                title={`${cs.colorName}: 在庫${cs.stockCount}個 / 取引データ発注${cs.csvQty}個`}
                              >
                                <span className="font-medium text-purple-800">{cs.colorName}</span>
                                <span className="text-muted-foreground">
                                  {cs.stockCount}/{cs.csvQty}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {item.inventoryItems.map((inv, i) => {
                          const detailKey = `inventory-${item.key}-${i}`;
                          const isOpen = !!openDetailItems[detailKey];
                          return (
                            <div key={i} className="rounded border border-purple-100 bg-white overflow-hidden">
                              <button
                                onClick={() => toggleDetailItem(detailKey)}
                                className={`w-full flex items-center justify-between text-sm px-3 py-1.5 hover:bg-purple-50/50 transition-colors ${isOpen ? "bg-purple-50/50" : ""}`}
                              >
                                <div className="min-w-0 flex-1 flex items-center gap-1.5 text-left">
                                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                                  <span className="font-medium text-foreground">{inv.title}</span>
                                  <span className="text-xs text-muted-foreground">({inv.managementNo})</span>
                                </div>
                                <span className="text-sm font-medium flex-shrink-0 ml-2">{inv.quantity}個</span>
                              </button>
                              {isOpen && (
                                <InventoryDetailPanel
                                  inventoryId={inv.inventoryId}
                                  unitPrice={(inv as { unitPrice?: string }).unitPrice}
                                  trackingNumber={(inv as { trackingNumber?: string }).trackingNumber}
                                  supplierUrl={(inv as { supplierUrl?: string }).supplierUrl}
                                  supplierName={(inv as { supplierName?: string }).supplierName}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 出庫履歴 */}
                  {item.deliveryItems.length > 0 && (
                    <div className="px-4 py-3 bg-orange-50/30">
                      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                        <p className="text-xs font-semibold text-orange-700 flex items-center gap-1">
                          <span className="inline-block w-2 h-2 rounded-full bg-orange-500"></span>
                          出庫履歴（{item.deliveryItems.length}件）
                        </p>
                        {/* 出庫カラー別集計バッジ */}
                        {colorSummary.length > 0 && colorSummary.some((cs) => cs.deliveredCount > 0) && (
                          <div className="flex flex-wrap gap-1.5">
                            {colorSummary.filter((cs) => cs.deliveredCount > 0).map((cs) => (
                              <div
                                key={cs.colorName}
                                className="flex items-center gap-1 bg-white border border-orange-100 rounded-full px-2 py-0.5 text-xs"
                                title={`${cs.colorName}: 出庫${cs.deliveredCount}個 / 取引データ発注${cs.csvQty}個`}
                              >
                                <span className="font-medium text-orange-800">{cs.colorName}</span>
                                <span className="text-muted-foreground">
                                  {cs.deliveredCount}/{cs.csvQty}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {item.deliveryItems.map((d, i) => {
                          const detailKey = `delivery-${item.key}-${i}`;
                          const isOpen = !!openDetailItems[detailKey];
                          return (
                            <div key={i} className="rounded border border-orange-100 bg-white overflow-hidden">
                              <button
                                onClick={() => toggleDetailItem(detailKey)}
                                className={`w-full flex items-center justify-between text-sm px-3 py-1.5 hover:bg-orange-50/50 transition-colors ${isOpen ? "bg-orange-50/50" : ""}`}
                              >
                                <div className="min-w-0 flex-1 flex items-center gap-1.5 text-left">
                                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                                  <button
                                    type="button"
                                    className="text-xs text-primary hover:underline font-mono"
                                    onClick={(e) => { e.stopPropagation(); const no = d.deliveryNo.match(/^(\d+)/)?.[1]; if (no) setLocation(`/inventory/delivery-history?group=${no}`); }}
                                  >{d.deliveryNo}</button>
                                  <span className="font-medium text-foreground">{d.title.replace(/\s*[（(][^）)]*[）)]\s*/g, "").trim()}</span>
                                  {d.managementNo && (
                                    <span className="text-xs text-muted-foreground">({d.managementNo})</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <span className="text-sm font-medium">{d.quantity}個</span>
                                  <button
                                    type="button"
                                    className="text-xs text-primary hover:underline"
                                    onClick={(e) => { e.stopPropagation(); const dateStr = new Date(d.deliveredAt).toISOString().slice(0, 10); setLocation(`/inventory/delivery-history?date=${dateStr}`); }}
                                  >{new Date(d.deliveredAt).toLocaleDateString("ja-JP")}</button>
                                </div>
                              </button>
                              {isOpen && (
                                <DeliveryDetailPanel
                                  deliveryNo={d.deliveryNo}
                                  deliveredAt={d.deliveredAt}
                                  unitPrice={(d as { unitPrice?: string }).unitPrice ?? ""}
                                  trackingNumber={(d as { trackingNumber?: string }).trackingNumber ?? ""}
                                  supplierUrl={(d as { supplierUrl?: string }).supplierUrl ?? ""}
                                  supplierName={(d as { supplierName?: string }).supplierName ?? ""}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 詳細なし */}
                  {item.csvProducts.length === 0 && item.purchaseItems.length === 0 && item.inventoryItems.length === 0 && item.deliveryItems.length === 0 && (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      詳細データがありません
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
