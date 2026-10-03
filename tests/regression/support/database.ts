import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { purchaseFixtures } from "../purchase-fixtures";
import { assertTestDatabase, testDatabaseName } from "./test-target.mjs";

export async function connectTestDatabase() {
  assertTestDatabase();
  const db = await mysql.createConnection(process.env.DATABASE_URL!);
  const [rows] = await db.query<RowDataPacket[]>("SELECT DATABASE() AS db");
  if (rows[0].db !== testDatabaseName) {
    await db.end();
    throw new Error("Refusing to modify an unexpected database");
  }
  return db;
}

export async function resetFixtures(db: Connection) {
  assertTestDatabase();
  const [identity] = await db.query<RowDataPacket[]>("SELECT DATABASE() AS db");
  if (identity[0].db !== testDatabaseName)
    throw new Error("Unexpected database");
  const [tables] = await db.query<RowDataPacket[]>("SHOW TABLES");
  await db.query("SET FOREIGN_KEY_CHECKS=0");
  try {
    for (const table of tables) {
      const name = String(Object.values(table)[0]);
      if (!/^[a-zA-Z0-9_]+$/.test(name))
        throw new Error("Unexpected table name");
      // This schema contains test data only. Never reuse it for manual development.
      await db.query(`DELETE FROM \`${name}\``);
    }
  } finally {
    await db.query("SET FOREIGN_KEY_CHECKS=1");
  }
  for (const row of purchaseFixtures) {
    const item = {
      id: row.id,
      inventory_id: row.id,
      title: row.title,
      quantity: String(row.quantity),
      unit_price: String(row.unitPrice),
      etc: row.managementNo,
      status: row.status,
    };
    await db.query("INSERT INTO local_inventories SET ?", {
      id: row.id,
      title: row.title,
      category: row.category,
      quantity: 0,
      unitPrice: row.unitPrice,
      etc: row.managementNo,
      supplierName: "架空仕入先",
      createdAt: row.purchaseDate,
      updatedAt: row.purchaseDate,
    });
    await db.query("INSERT INTO local_purchases SET ?", {
      ...row,
      localInventoryId: row.id,
      purchaseNum: `TEST-${row.id}`,
      itemsJson: JSON.stringify([item]),
      classSource: "manual",
      supplierName: "架空仕入先",
      createdAt: row.purchaseDate,
      updatedAt: row.purchaseDate,
    });
  }
}
