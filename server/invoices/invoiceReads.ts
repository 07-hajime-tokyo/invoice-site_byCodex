import { getDb } from "../db";
import { invoices, invoiceItems } from "../../drizzle/schema";
import { eq, desc, asc, sql, isNull, isNotNull } from "drizzle-orm";
import type { InvoiceIdInput } from "./invoiceInput";

export async function listInvoices() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(invoices)
    .where(isNull(invoices.deletedAt))
    .orderBy(desc(invoices.createdAt));
  const result = await Promise.all(
    rows.map(async inv => {
      const countRows = await db
        .select({ count: sql<number>`count(*)` })
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, inv.id));
      const sumRows = await db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(quantity AS DECIMAL(10,2)) * CAST(unitPrice AS DECIMAL(12,2))), 0)`,
        })
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, inv.id));
      return {
        ...inv,
        itemCount: Number(countRows[0]?.count ?? 0),
        totalAmount: Number(sumRows[0]?.total ?? 0),
      };
    })
  );
  return result;
}

export async function getInvoice({ input }: { input: InvoiceIdInput }) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, input.id));
  const inv = rows[0];
  if (!inv) return null;
  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, input.id))
    .orderBy(asc(invoiceItems.sortOrder));
  return { ...inv, items };
}

export async function listDeletedInvoices() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(invoices)
    .where(isNotNull(invoices.deletedAt))
    .orderBy(desc(invoices.deletedAt));
  const result = await Promise.all(
    rows.map(async inv => {
      const countRows = await db
        .select({ count: sql<number>`count(*)` })
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, inv.id));
      const sumRows = await db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(quantity AS DECIMAL(10,2)) * CAST(unitPrice AS DECIMAL(12,2))), 0)`,
        })
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, inv.id));
      return {
        ...inv,
        itemCount: Number(countRows[0]?.count ?? 0),
        totalAmount: Number(sumRows[0]?.total ?? 0),
      };
    })
  );
  return result;
}

export async function getLatestInvoice() {
  const db = await getDb();
  if (!db) return null;
  // 番号の最大値（末尾の数字が最大）のインボイスを取得
  const rows = await db
    .select()
    .from(invoices)
    .orderBy(desc(invoices.createdAt));
  let maxNum = 0;
  let latestInvoice = null;
  for (const row of rows) {
    const match = row.invoiceNumber.match(/(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) {
        maxNum = n;
        latestInvoice = row;
      }
    }
  }
  if (!latestInvoice) return null;
  // 明細も取得
  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, latestInvoice.id))
    .orderBy(asc(invoiceItems.sortOrder));
  return { ...latestInvoice, items };
}
