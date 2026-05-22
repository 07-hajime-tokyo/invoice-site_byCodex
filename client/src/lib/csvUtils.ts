/**
 * CSV Utility Functions
 * Design: Scandinavian BI Style
 * Handles parsing of the game console trading data CSV
 */

export const CSV_URL =
  "https://raw.githubusercontent.com/rara-wq/csv-data-site/refs/heads/main/data.csv";

export interface TradeRecord {
  month: string;
  year: string;          // 抽出した年 (e.g. "2025", "2026")
  yearMonth: string;     // "YYYY-MM" 形式 (フィルター用)
  partner: string;
  no: number;
  paymentDate: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  unitPriceJPY: number;
  status: string;
  procurement: string;
  shippingFromTokyo: string;
  totalSales: number;
  procurementTotal: number;
  refund: number;
  shippingCost: number;
  profitWithRefund: number;
  cumulativeProfit: number;
}

export const COLUMN_LABELS: Record<keyof TradeRecord, string> = {
  month: "月",
  year: "年",
  yearMonth: "年月",
  partner: "取引相手",
  no: "No.",
  paymentDate: "支払い日",
  productName: "商品名",
  quantity: "注文数",
  unitPrice: "商品価格",
  currency: "通貨",
  unitPriceJPY: "商品価格(円)",
  status: "状況",
  procurement: "仕入れ",
  shippingFromTokyo: "東京発送",
  totalSales: "売上合計(円)",
  procurementTotal: "仕入れ合計",
  refund: "還付",
  shippingCost: "送料",
  profitWithRefund: "還付込み利益",
  cumulativeProfit: "累積利益",
};

function parseNumber(val: string): number {
  const n = parseFloat(val.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

/** 支払い日の生文字列から年を抽出する */
function extractYear(rawDate: string): string {
  if (!rawDate || rawDate.trim() === "") return "";
  try {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) return String(d.getFullYear());
  } catch {
    // ignore
  }
  // フォールバック: 文字列から4桁の年を探す
  const m = rawDate.match(/\b(20\d{2})\b/);
  return m ? m[1] : "";
}

function parseDate(val: string): string {
  if (!val || val.trim() === "") return "";
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return val;
  }
}

export async function fetchCSVData(): Promise<TradeRecord[]> {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error("CSVの取得に失敗しました");
  const text = await res.text();
  return parseCSV(text);
}

export function parseCSV(text: string): TradeRecord[] {
  const lines = text.split("\n").map((l) => l.trimEnd());
  // Row 1 & 2 are meta rows, row 3 (index 2) is header, data starts at index 3
  const dataLines = lines.slice(3);

  const records: TradeRecord[] = [];

  for (const line of dataLines) {
    if (!line.trim()) continue;
    let cols = parseCSVLine(line);
    if (cols.length < 19) continue;

    // Skip rows that don't start with a valid month number
    const monthVal = cols[0]?.trim();
    if (!monthVal || !/^\d+$/.test(monthVal)) continue;

    // ケース1: 余分な列が挿入されている行を検出して修正する
    // 正常な行は20列。21列の場合、商品名(col4)の直後に余分な列が入っている可能性がある。
    // 判定: col5(注文数)が数値でなく、col6が数値なら1列ずれている
    if (cols.length >= 21) {
      const col5IsNumber = /^\d/.test(cols[5]?.trim() ?? "");
      const col6IsNumber = /^\d/.test(cols[6]?.trim() ?? "");
      if (!col5IsNumber && col6IsNumber) {
        // col5に余分な値が入っている → col5を除去してずれを修正
        cols = [
          ...cols.slice(0, 5),   // 月〜商品名
          ...cols.slice(6),       // 余分な列をスキップして注文数以降
        ];
      }
    }

    // ケース2: 数値がクォートなしでカンマ区切りされて列が分割されている場合を修正する
    // 例: "18,011" → ['18','011'] のように分割されると列がずれる
    // 判定: col[9](正常時は状況文字列)が数値の場合、商品価格(円)がカンマ分割されている証拠
    // （末尾に余分な空列があるだけの行は col[9]が状況文字列なので対象外）
    if (cols.length > 20 && /^-?[\d.]+$/.test(cols[9]?.trim() ?? "")) {
      cols = normalizeNumericColumns(cols);
    }

    const rawDate = cols[3]?.trim() ?? "";
    const year = extractYear(rawDate);
    const yearMonth =
      year && monthVal
        ? `${year}-${monthVal.padStart(2, "0")}`
        : "";

    records.push({
      month: monthVal,
      year,
      yearMonth,
      partner: cols[1]?.trim() ?? "",
      no: parseInt(cols[2]?.trim() ?? "0", 10),
      paymentDate: parseDate(rawDate),
      productName: cols[4]?.trim() ?? "",
      quantity: parseNumber(cols[5] ?? "0"),
      unitPrice: parseNumber(cols[6] ?? "0"),
      currency: cols[7]?.trim() ?? "",
      unitPriceJPY: parseNumber(cols[8] ?? "0"),
      status: cols[9]?.trim() ?? "",
      procurement: cols[11]?.trim() ?? "",
      shippingFromTokyo: cols[12]?.trim() ?? "",
      totalSales: parseNumber(cols[14] ?? "0"),
      procurementTotal: parseNumber(cols[15] ?? "0"),
      refund: parseNumber(cols[16] ?? "0"),
      shippingCost: parseNumber(cols[17] ?? "0"),
      profitWithRefund: parseNumber(cols[18] ?? "0"),
      cumulativeProfit: parseNumber(cols[19] ?? "0"),
    });
  }

  return records;
}

/**
 * 数値がクォートなしでカンマ区切りされて列が分割されている場合を修正する。
 * 列構成:
 *   [0]月 [1]取引相手 [2]No. [3]支払い日 [4]商品名 [5]注文数 [6]商品価格 [7]通貨
 *   [8]商品価格(円) [9]状況 [10]空 [11]仕入れ [12]東京発送 [13]空 [14]数量×商品価格
 *   [15]仕入れ合計 [16]還付 [17]送料 [18]還付込み利益 [19]累積利益
 */
function normalizeNumericColumns(cols: string[]): string[] {
  // col[0..7]: 月、取引相手、No.、支払い日、商品名、注文数、商品価格、通貨 → 固定
  const fixed = cols.slice(0, 8);
  let i = 8;

  // col[8]: 商品価格(円) — 最大10列までカンマ分割された数値断片を結合
  const unitPriceJPY = consumeOneNumber(cols, i);
  i = unitPriceJPY.nextIndex;

  // col[9]: 状況 (数値でない文字列)
  const status = cols[i]?.trim() ?? "";
  i++;

  // col[10]: 空
  const empty10 = cols[i] ?? "";
  i++;

  // col[11]: 仕入れ
  const procurement = cols[i]?.trim() ?? "";
  i++;

  // col[12]: 東京発送
  const shipping = cols[i]?.trim() ?? "";
  i++;

  // col[13]: 空
  const empty13 = cols[i] ?? "";
  i++;

  // 余分な空列をスキップ（数値列の前に余分な空列が挿入されている場合）
  if (i < cols.length && (cols[i]?.trim() ?? "") === "") {
    const nextI = i + 1;
    if (nextI < cols.length && /^-?[\d.]+$/.test(cols[nextI]?.trim() ?? "")) {
      i++; // 余分な空列をスキップ
    }
  }

  // col[14]: 数量×商品価格(円)
  const totalSales = consumeOneNumber(cols, i);
  i = totalSales.nextIndex;

  // col[15]: 仕入れ合計
  const procTotal = consumeOneNumber(cols, i);
  i = procTotal.nextIndex;

  // col[16]: 還付
  const refund = consumeOneNumber(cols, i);
  i = refund.nextIndex;

  // col[17]: 送料
  const shippingCost = consumeOneNumber(cols, i);
  i = shippingCost.nextIndex;

  // col[18]: 還付込み利益
  const profit = consumeOneNumber(cols, i);
  i = profit.nextIndex;

  // col[19]: 累積利益
  const cumProfit = consumeOneNumber(cols, i);

  return [
    ...fixed,
    unitPriceJPY.value,
    status,
    empty10,
    procurement,
    shipping,
    empty13,
    totalSales.value,
    procTotal.value,
    refund.value,
    shippingCost.value,
    profit.value,
    cumProfit.value,
  ];
}

/**
 * 1つの数値を消費する。カンマ区切りで分割された場合は最大10列まで断片を結合する。
 * 例: ['18','011'] → '18011'、['360','228'] → '360228'
 * 次の列が3桁の数字のみの場合に限り結合（カンマ区切りの後半部分のパターン）。
 */
function consumeOneNumber(
  cols: string[],
  startIndex: number
): { value: string; nextIndex: number } {
  let i = startIndex;
  const v = cols[i]?.trim() ?? "";
  if (!/^-?[\d.]+$/.test(v)) {
    return { value: "", nextIndex: i };
  }
  let result = v;
  i++;
  // 次が3桁の数字のみならカンマ区切りの後半部分として結合
  if (i < cols.length && /^\d{3}$/.test(cols[i]?.trim() ?? "")) {
    result += cols[i].trim();
    i++;
  }
  return { value: result, nextIndex: i };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
}

export function formatCurrency(n: number): string {
  return "¥" + n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
}

export type SortKey = keyof TradeRecord;
export type SortDir = "asc" | "desc" | "none";

export function sortRecords(
  records: TradeRecord[],
  key: SortKey,
  dir: SortDir
): TradeRecord[] {
  if (dir === "none") return records;
  return [...records].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "number" && typeof bv === "number") {
      return dir === "asc" ? av - bv : bv - av;
    }
    const as = String(av ?? "");
    const bs = String(bv ?? "");
    return dir === "asc" ? as.localeCompare(bs, "ja") : bs.localeCompare(as, "ja");
  });
}

export function filterRecords(
  records: TradeRecord[],
  search: string,
  filters: Partial<Record<keyof TradeRecord, string>>
): TradeRecord[] {
  let result = records;

  // Full-text search
  // スペースを除去した形でも比較することで「New3DSLL」と「New 3DS LL」を同一視する
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    const qNoSpace = q.replace(/\s+/g, "");
    result = result.filter((r) =>
      Object.values(r).some((v) => {
        const s = String(v).toLowerCase();
        const sNoSpace = s.replace(/\s+/g, "");
        return s.includes(q) || sNoSpace.includes(qNoSpace);
      })
    );
  }

  // Column filters
  for (const [key, val] of Object.entries(filters)) {
    if (!val || val === "__all__") continue;
    result = result.filter(
      (r) => String(r[key as keyof TradeRecord]) === val
    );
  }

  return result;
}

export function getUniqueValues(
  records: TradeRecord[],
  key: keyof TradeRecord
): string[] {
  const set = new Set<string>();
  for (const r of records) {
    const v = String(r[key] ?? "");
    if (v) set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
}
