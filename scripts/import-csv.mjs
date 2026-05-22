/**
 * Import trade records from Google Sheets CSV into the database.
 * Run: node scripts/import-csv.mjs
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

const CSV_URL =
  "https://raw.githubusercontent.com/07-hajime-tokyo/csv-data-site/main/data.csv";

// GitHub Personal Access Token for private repository access
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function parseNumber(val) {
  if (!val || val.trim() === "") return 0;
  const n = parseFloat(val.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseDate(val) {
  if (!val || val.trim() === "") return null;
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  } catch {
    // ignore
  }
  return val.trim() || null;
}

/**
 * Simple CSV parser that handles quoted fields with commas inside.
 */
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

async function main() {
  console.log("Fetching CSV from GitHub...");
  const fetchOptions = {};
  if (GITHUB_TOKEN) {
    fetchOptions.headers = { Authorization: `token ${GITHUB_TOKEN}` };
  }
  const res = await fetch(CSV_URL, fetchOptions);
  if (!res.ok) {
    throw new Error(`Failed to fetch CSV: ${res.status} ${res.statusText}`);
  }
  const csvText = await res.text();

  const lines = csvText.split("\n").filter((l) => l.trim() !== "");
  // Row 0: metadata (最終更新日時)
  // Row 1: metadata (exchange rates)
  // Row 2: header row
  // Row 3+: data rows
  const headerLine = lines[2];
  const headers = parseCSVLine(headerLine);
  console.log("Headers:", headers);

  const dataLines = lines.slice(3);
  const records = dataLines.map((line) => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] || "";
    });
    return obj;
  });

  // Filter valid rows (月 must be a number)
  const validRecords = records.filter((r) => {
    const month = r["月"] || "";
    return month && /^\d+$/.test(month.trim());
  });

  console.log(`Found ${validRecords.length} valid records to import.`);

  const conn = await createConnection(process.env.DATABASE_URL);

  // Clear existing data
  const [existing] = await conn.execute("SELECT COUNT(*) as cnt FROM trade_records");
  console.log(`Existing records in DB: ${existing[0].cnt}`);
  await conn.execute("DELETE FROM trade_records");
  console.log("Cleared existing trade_records.");

  let imported = 0;
  for (const r of validRecords) {
    const month = (r["月"] || "").trim();
    const partner = (r["取引相手"] || "").trim();
    const no = parseInt(r["No."] || "0") || null;
    const paymentDate = parseDate(r["支払い日"]);
    const productName = (r["商品名"] || "").trim();
    const quantity = parseNumber(r["注文数"]);
    const unitPrice = parseNumber(r["商品価格"]);
    const currency = (r["通貨"] || "").trim();
    const unitPriceJPY = parseNumber(r["商品価格(円)"]);
    const status = (r["状況"] || "").trim();
    const procurement = (r["仕入れ"] || "").trim();
    // カラム名が長いため、インデックスで取得
    const shippingFromTokyo = (r["東京からの発送(仕入れ終了)"] || r["東京からの発送"] || "").trim();
    const totalSales = parseNumber(r["数量×商品価格(円)"]);
    const procurementTotal = parseNumber(r["仕入れ合計"]);
    const refund = parseNumber(r["還付"]);
    const shippingCost = parseNumber(r["送料(1つ550円)"] || r["送料"]);
    const profitWithRefund = parseNumber(r["還付込み利益"]);
    const cumulativeProfit = parseNumber(r["累積利益"]);

    await conn.execute(
      `INSERT INTO trade_records 
        (month, partner, no, paymentDate, productName, quantity, unitPrice, currency, 
         unitPriceJPY, status, procurement, shippingFromTokyo, totalSales, 
         procurementTotal, refund, shippingCost, profitWithRefund, cumulativeProfit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        month, partner, no, paymentDate, productName, quantity, unitPrice, currency,
        unitPriceJPY, status, procurement, shippingFromTokyo, totalSales,
        procurementTotal, refund, shippingCost, profitWithRefund, cumulativeProfit,
      ]
    );
    imported++;
    if (imported % 50 === 0) console.log(`  Imported ${imported}...`);
  }

  console.log(`✓ Imported ${imported} records successfully.`);
  await conn.end();
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
