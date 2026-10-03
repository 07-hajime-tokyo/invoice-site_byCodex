import { normalizeLooseText, extractModel } from "@shared/productMatching";
import { getDb } from "./db";

export type OrderCsvRow = {
  tradeRecordId: number | null;
  partner: string;
  invoiceNo: string;
  paymentDate: string;
  productName: string;
  orderQty: number;
  sellingPrice: number | null;
  sellingPriceJpy: number | null;
  currency: string;
  status: string;
};

type MaximOrderSplitLine = {
  productName: string;
  orderQty: number;
  sourceModel: string;
};

const MAXIM_415_416_ORDER_SPLITS: Record<string, MaximOrderSplitLine[]> = {
  "415": [
    {
      productName: "PS Vita 1000 ブラック",
      orderQty: 3,
      sourceModel: "Vita1000",
    },
    {
      productName: "PS Vita 1000 ホワイト",
      orderQty: 1,
      sourceModel: "Vita1000",
    },
    {
      productName: "PS Vita 2000 ブラック×レッド",
      orderQty: 1,
      sourceModel: "Vita2000",
    },
    {
      productName: "PS Vita 2000 ブルー",
      orderQty: 2,
      sourceModel: "Vita2000",
    },
    {
      productName: "PS Vita 2000 カーキ×ブラック",
      orderQty: 1,
      sourceModel: "Vita2000",
    },
    { productName: "PSP 1000 ホワイト", orderQty: 1, sourceModel: "PSP1000" },
    { productName: "PSP 2000 シルバー", orderQty: 2, sourceModel: "PSP2000" },
    { productName: "PSP 3000 グリーン", orderQty: 1, sourceModel: "PSP3000" },
    {
      productName: "New 3DS LL ブラック",
      orderQty: 4,
      sourceModel: "New3DSLL",
    },
    {
      productName: "New 3DS LL ホワイト",
      orderQty: 3,
      sourceModel: "New3DSLL",
    },
    { productName: "New 3DS LL ブルー", orderQty: 2, sourceModel: "New3DSLL" },
    { productName: "New 3DS LL レッド", orderQty: 1, sourceModel: "New3DSLL" },
    {
      productName: "New 2DS LL ブラック×ライム",
      orderQty: 1,
      sourceModel: "New2DSLL",
    },
    {
      productName: "New 2DS LL ブラック×ターコイズ",
      orderQty: 1,
      sourceModel: "New2DSLL",
    },
    { productName: "Nintendo 2DS ピンク", orderQty: 1, sourceModel: "2DS" },
  ],
  "416": [
    {
      productName: "PS Vita 1000 ブラック",
      orderQty: 3,
      sourceModel: "Vita1000",
    },
    {
      productName: "PS Vita 1000 ホワイト",
      orderQty: 1,
      sourceModel: "Vita1000",
    },
    {
      productName: "PS Vita 2000 ブラック×レッド",
      orderQty: 1,
      sourceModel: "Vita2000",
    },
    {
      productName: "PS Vita 2000 ブルー",
      orderQty: 1,
      sourceModel: "Vita2000",
    },
    {
      productName: "PS Vita 2000 カーキ×ブラック",
      orderQty: 2,
      sourceModel: "Vita2000",
    },
    { productName: "PSP 1000 ホワイト", orderQty: 1, sourceModel: "PSP1000" },
    { productName: "PSP 2000 シルバー", orderQty: 2, sourceModel: "PSP2000" },
    { productName: "PSP 3000 グリーン", orderQty: 1, sourceModel: "PSP3000" },
    {
      productName: "New 3DS LL ブラック",
      orderQty: 4,
      sourceModel: "New3DSLL",
    },
    {
      productName: "New 3DS LL ホワイト",
      orderQty: 3,
      sourceModel: "New3DSLL",
    },
    { productName: "New 3DS LL ブルー", orderQty: 2, sourceModel: "New3DSLL" },
    { productName: "New 3DS LL レッド", orderQty: 1, sourceModel: "New3DSLL" },
    {
      productName: "New 2DS LL ブラック×ライム",
      orderQty: 1,
      sourceModel: "New2DSLL",
    },
    {
      productName: "New 2DS LL ブラック×ターコイズ",
      orderQty: 1,
      sourceModel: "New2DSLL",
    },
    { productName: "Nintendo 2DS ピンク", orderQty: 1, sourceModel: "2DS" },
  ],
};

function normalizeTradePartnerName(partner: string | null | undefined): string {
  const trimmed = String(partner ?? "").trim();
  if (!trimmed) return "その他";
  const normalized = trimmed.normalize("NFKC").toLowerCase();
  if (normalized === "hennes kamusien") return "サイモン";
  return trimmed;
}

function isMaximPartnerName(partner: string | null | undefined): boolean {
  const normalized = normalizeLooseText(String(partner ?? ""));
  return normalized.includes("マキシム") || normalized.includes("maxim");
}

export function expandMaxim415416OrderRows(
  orderRows: OrderCsvRow[]
): OrderCsvRow[] {
  const invoiceNo = orderRows[0]?.invoiceNo;
  const splitLines = invoiceNo
    ? MAXIM_415_416_ORDER_SPLITS[invoiceNo]
    : undefined;
  if (!splitLines || orderRows.length === 0) return orderRows;
  if (!orderRows.some(row => isMaximPartnerName(row.partner))) return orderRows;

  const rowsByModel = new Map<string, OrderCsvRow>();
  for (const row of orderRows) {
    const model = extractModel(row.productName);
    if (model && !rowsByModel.has(model)) rowsByModel.set(model, row);
  }

  const fallbackRow = orderRows[0];
  return splitLines.map(line => {
    const sourceRow = rowsByModel.get(line.sourceModel) ?? fallbackRow;
    return {
      ...sourceRow,
      tradeRecordId: null,
      productName: line.productName,
      orderQty: line.orderQty,
    };
  });
}

export async function getOrderRowsFromTradeRecords(): Promise<OrderCsvRow[]> {
  const db = await getDb();
  if (!db) return [];
  const { tradeRecords } = await import("../../drizzle/schema");
  const rows = await db
    .select({
      tradeRecordId: tradeRecords.id,
      partner: tradeRecords.partner,
      invoiceNo: tradeRecords.no,
      paymentDate: tradeRecords.paymentDate,
      productName: tradeRecords.productName,
      orderQty: tradeRecords.quantity,
      sellingPrice: tradeRecords.unitPrice,
      sellingPriceJpy: tradeRecords.unitPriceJPY,
      currency: tradeRecords.currency,
      status: tradeRecords.status,
    })
    .from(tradeRecords);

  return rows
    .map(row => ({
      tradeRecordId:
        row.tradeRecordId == null ? null : Number(row.tradeRecordId),
      partner: normalizeTradePartnerName(row.partner),
      invoiceNo: row.invoiceNo != null ? String(row.invoiceNo) : "",
      paymentDate: row.paymentDate ?? "",
      productName: row.productName?.trim() ?? "",
      orderQty: Number(row.orderQty ?? 0) || 0,
      sellingPrice:
        row.sellingPrice == null ? null : Number(row.sellingPrice) || null,
      sellingPriceJpy:
        row.sellingPriceJpy == null
          ? null
          : Number(row.sellingPriceJpy) || null,
      currency: row.currency ?? "",
      status: row.status ?? "",
    }))
    .filter(row => row.invoiceNo && /^\d+$/.test(row.invoiceNo))
    .sort((a, b) => Number(a.invoiceNo) - Number(b.invoiceNo));
}
