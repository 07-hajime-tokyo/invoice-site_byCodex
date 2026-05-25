import fs from "node:fs";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const [sourceEnvPath, targetEnvPath] = process.argv.slice(2);

if (!sourceEnvPath || !targetEnvPath) {
  console.error("Usage: node scripts/sync-zaico-inventory-db.mjs <source-env> <target-env>");
  process.exit(1);
}

const inventoryTables = [
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
  "partner_message_threads",
  "partner_messages",
  "fedex_shipments",
  "manual_shipments",
  "shipment_checks",
  "monthly_reports",
  "monthly_domestic_items",
  "domestic_products",
  "invoice_memos",
  "invoice_manual_items",
  "monthly_report_costs",
];

const databaseUrlKeys = [
  "DATABASE_URL",
  "DATABASE_PRIVATE_URL",
  "TIDB_DATABASE_URL",
  "MYSQL_URL",
];

function quoteIdent(value) {
  return `\`${String(value).replace(/`/g, "``")}\``;
}

function loadDatabaseUrl(envPath) {
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  for (const key of databaseUrlKeys) {
    if (parsed[key]) return parsed[key];
  }
  throw new Error(`No database URL found in ${envPath}`);
}

async function connect(envPath) {
  return mysql.createConnection({
    uri: loadDatabaseUrl(envPath),
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });
}

async function getTables(conn) {
  const [rows] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  return new Set(rows.map((row) => Object.values(row)[0]));
}

async function getColumns(conn, table) {
  const [rows] = await conn.query(`SHOW COLUMNS FROM ${quoteIdent(table)}`);
  return rows.map((row) => row.Field);
}

async function getCount(conn, table) {
  const [rows] = await conn.query(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)}`);
  return Number(rows[0]?.count ?? 0);
}

async function readRows(conn, table, columns) {
  const columnSql = columns.map(quoteIdent).join(", ");
  const [rows] = await conn.query(`SELECT ${columnSql} FROM ${quoteIdent(table)}`);
  return rows;
}

async function upsertRows(conn, table, columns, rows) {
  if (rows.length === 0) return;

  const columnSql = columns.map(quoteIdent).join(", ");
  const updateColumns = columns.filter((column) => column !== "id");
  const updateSql = updateColumns.length > 0
    ? updateColumns.map((column) => `${quoteIdent(column)}=VALUES(${quoteIdent(column)})`).join(", ")
    : `${quoteIdent(columns[0])}=VALUES(${quoteIdent(columns[0])})`;

  const chunkSize = 200;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const placeholders = chunk
      .map(() => `(${columns.map(() => "?").join(", ")})`)
      .join(", ");
    const values = [];
    for (const row of chunk) {
      for (const column of columns) {
        values.push(row[column]);
      }
    }
    await conn.query(
      `INSERT INTO ${quoteIdent(table)} (${columnSql}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updateSql}`,
      values,
    );
  }
}

async function syncTable(source, target, table) {
  const sourceColumns = await getColumns(source, table);
  const targetColumns = await getColumns(target, table);
  const targetColumnSet = new Set(targetColumns);
  const columns = sourceColumns.filter((column) => targetColumnSet.has(column));

  if (columns.length === 0) {
    return { table, sourceCount: 0, beforeCount: 0, afterCount: 0, skipped: "no common columns" };
  }

  const sourceCount = await getCount(source, table);
  const beforeCount = await getCount(target, table);
  const rows = await readRows(source, table, columns);
  await upsertRows(target, table, columns, rows);
  const afterCount = await getCount(target, table);

  return { table, sourceCount, beforeCount, afterCount, imported: rows.length };
}

const source = await connect(sourceEnvPath);
const target = await connect(targetEnvPath);

try {
  const sourceTables = await getTables(source);
  const targetTables = await getTables(target);
  const tables = inventoryTables.filter((table) => sourceTables.has(table) && targetTables.has(table));
  const skippedTables = inventoryTables.filter((table) => !sourceTables.has(table) || !targetTables.has(table));

  await target.query("SET FOREIGN_KEY_CHECKS=0");
  const results = [];
  for (const table of tables) {
    const result = await syncTable(source, target, table);
    results.push(result);
    console.log(`${table}: ${result.beforeCount} -> ${result.afterCount} (source ${result.sourceCount})`);
  }
  await target.query("SET FOREIGN_KEY_CHECKS=1");

  console.log("\nSynced tables:");
  console.table(results);
  if (skippedTables.length > 0) {
    console.log("\nSkipped tables:");
    console.log(skippedTables.join(", "));
  }
} finally {
  await target.query("SET FOREIGN_KEY_CHECKS=1").catch(() => undefined);
  await source.end();
  await target.end();
}
