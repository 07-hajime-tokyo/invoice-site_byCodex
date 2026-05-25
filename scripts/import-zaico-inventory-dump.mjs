import fs from "node:fs";
import zlib from "node:zlib";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const dumpPath = process.argv[2];

if (!dumpPath) {
  console.error("Usage: node scripts/import-zaico-inventory-dump.mjs <dump.sql|dump.sql.gz>");
  process.exit(1);
}

dotenv.config({ path: ".env.local" });
dotenv.config({ path: "../invoice-site/.env", override: !process.env.DATABASE_URL });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const inventoryTables = new Set([
  "local_inventories",
  "deleted_inventories",
  "inventory_extras",
  "inventory_memos",
  "local_purchases",
  "purchase_histories",
  "purchase_extras",
  "delivery_histories",
  "customers",
  "partner_portals",
  "partner_messages",
  "partner_message_threads",
  "fedex_shipments",
  "manual_shipments",
  "shipment_checks",
  "monthly_reports",
  "monthly_domestic_items",
  "domestic_products",
  "invoice_memos",
  "invoice_manual_items",
  "monthly_report_costs",
]);

function readDump(filePath) {
  const data = fs.readFileSync(filePath);
  if (filePath.endsWith(".gz")) return zlib.gunzipSync(data).toString("utf8");
  return data.toString("utf8");
}

function extractInsertStatements(sql) {
  const inserts = [];
  const re = /INSERT INTO `([^`]+)` \(([^)]+)\) VALUES ([\s\S]*?);/g;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const [, table, columnSql, valuesSql] = match;
    if (!inventoryTables.has(table)) continue;
    const columns = columnSql
      .split(",")
      .map((column) => column.trim().replace(/^`|`$/g, ""))
      .filter(Boolean);
    if (columns.length === 0) continue;
    inserts.push({ table, columns, valuesSql });
  }
  return inserts;
}

async function countRows(conn, tables) {
  const rows = [];
  for (const table of tables) {
    const [result] = await conn.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
    rows.push({ table, count: Number(result[0]?.count ?? 0) });
  }
  return rows;
}

function buildUpsert({ table, columns, valuesSql }) {
  const quotedColumns = columns.map((column) => `\`${column}\``);
  const updates = columns
    .filter((column) => column !== "id")
    .map((column) => `\`${column}\`=VALUES(\`${column}\`)`);
  return [
    `INSERT INTO \`${table}\` (${quotedColumns.join(",")}) VALUES ${valuesSql}`,
    updates.length > 0 ? `ON DUPLICATE KEY UPDATE ${updates.join(",")}` : "ON DUPLICATE KEY UPDATE `id`=`id`",
  ].join(" ");
}

const sql = readDump(dumpPath);
const inserts = extractInsertStatements(sql);
const tables = [...new Set(inserts.map((insert) => insert.table))].sort();

if (inserts.length === 0) {
  console.error("No inventory INSERT statements found in dump.");
  process.exit(1);
}

const conn = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

try {
  console.log("Before import:");
  console.table(await countRows(conn, tables));

  await conn.query("SET FOREIGN_KEY_CHECKS=0");
  for (const insert of inserts) {
    await conn.query(buildUpsert(insert));
    console.log(`Imported ${insert.table}`);
  }
  await conn.query("SET FOREIGN_KEY_CHECKS=1");

  console.log("After import:");
  console.table(await countRows(conn, tables));
} finally {
  await conn.end();
}
