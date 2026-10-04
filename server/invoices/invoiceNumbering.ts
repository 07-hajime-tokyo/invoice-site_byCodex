import { getDb } from "../db";
import { invoices } from "../../drizzle/schema";
import { desc } from "drizzle-orm";
import { generateInvoiceNumber } from "./numbering";

export async function getNextInvoiceNumber() {
  const db = await getDb();
  if (!db) return generateInvoiceNumber();
  const rows = await db
    .select({ invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .orderBy(desc(invoices.createdAt));
  // Find max numeric suffix from INV-YYYYMMDD-NNN format
  let maxNum = 0;
  for (const row of rows) {
    const match = row.invoiceNumber.match(/(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const next = maxNum + 1;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `INV-${y}${m}${d}-${String(next).padStart(3, "0")}`;
}
