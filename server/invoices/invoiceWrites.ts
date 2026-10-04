import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { invoices, invoiceItems } from "../../drizzle/schema";
import { eq, asc, and, isNull } from "drizzle-orm";
import type {
  CreateInvoiceInput,
  UpdateInvoiceInput,
  InvoiceIdInput,
  InvoiceStatusInput,
  SplitInvoiceInput,
} from "./invoiceInput";
import { buildInvoiceRow, buildInvoiceItemRows } from "./invoiceRows";

export async function createInvoice({ input }: { input: CreateInvoiceInput }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.invoiceNumber, input.invoiceNumber),
        isNull(invoices.deletedAt)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `インボイス番号 ${input.invoiceNumber} は既に存在します。新規作成し直してください。`,
    });
  }
  const result = await db
    .insert(invoices)
    .values(buildInvoiceRow(input, input.invoiceNumber));
  const invoiceId = Number(result[0].insertId);

  if (input.items.length > 0) {
    const db2 = await getDb();
    if (!db2) throw new Error("DB not available");
    await db2
      .insert(invoiceItems)
      .values(buildInvoiceItemRows(input.items, invoiceId));
  }

  return { id: invoiceId };
}

export async function updateInvoice({ input }: { input: UpdateInvoiceInput }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(invoices)
    .set(buildInvoiceRow(input, input.invoiceNumber))
    .where(eq(invoices.id, input.id));

  // Replace all items
  await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));
  if (input.items.length > 0) {
    await db
      .insert(invoiceItems)
      .values(buildInvoiceItemRows(input.items, input.id));
  }

  return { success: true };
}

export async function deleteInvoice({ input }: { input: InvoiceIdInput }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // Soft delete: set deletedAt instead of removing the row
  await db
    .update(invoices)
    .set({ deletedAt: new Date() })
    .where(eq(invoices.id, input.id));
  return { success: true };
}

export async function restoreInvoice({ input }: { input: InvoiceIdInput }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(invoices)
    .set({ deletedAt: null })
    .where(eq(invoices.id, input.id));
  return { success: true };
}

export async function permanentlyDeleteInvoice({
  input,
}: {
  input: InvoiceIdInput;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // Verify the invoice is soft-deleted before permanent deletion
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, input.id));
  const inv = rows[0];
  if (!inv) throw new Error("インボイスが見つかりません");
  if (!inv.deletedAt)
    throw new Error("先にソフトデリートしてから完全削除してください");
  // Permanently delete items and invoice
  await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));
  await db.delete(invoices).where(eq(invoices.id, input.id));
  return { success: true, invoiceNumber: inv.invoiceNumber };
}

export async function updateInvoiceStatus({
  input,
}: {
  input: InvoiceStatusInput;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(invoices)
    .set({ status: input.status })
    .where(eq(invoices.id, input.id));
  return { success: true };
}

export async function createSplitInvoices({
  input,
}: {
  input: SplitInvoiceInput;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const createdIds: number[] = [];
  for (const split of input.splits) {
    const invoiceNumber = split.invoiceNumber.trim();
    const normalizedInvoiceNumber = /^\d+$/.test(invoiceNumber)
      ? invoiceNumber.padStart(4, "0")
      : invoiceNumber;
    const result = await db
      .insert(invoices)
      .values(buildInvoiceRow(input, normalizedInvoiceNumber));
    const invoiceId = Number(result[0].insertId);
    createdIds.push(invoiceId);

    if (split.items.length > 0) {
      const db2 = await getDb();
      if (!db2) throw new Error("DB not available");
      await db2
        .insert(invoiceItems)
        .values(buildInvoiceItemRows(split.items, invoiceId));
    }
  }

  return { ids: createdIds, count: createdIds.length };
}

export async function cloneInvoice({ input }: { input: InvoiceIdInput }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // Fetch original invoice
  const origRows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, input.id));
  const orig = origRows[0];
  if (!orig) throw new Error("Invoice not found");
  // Fetch original items
  const origItems = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, input.id))
    .orderBy(asc(invoiceItems.sortOrder));
  // Calculate next invoice number from all existing invoices (excluding soft-deleted)
  const allRows = await db
    .select({ invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(isNull(invoices.deletedAt));
  let maxNum = 0;
  for (const row of allRows) {
    const match = row.invoiceNumber.match(/(\d{3,6})/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const next = maxNum + 1;
  const newInvoiceNumber = String(next).padStart(4, "0");
  // Insert cloned invoice with draft status
  const result = await db.insert(invoices).values({
    invoiceNumber: newInvoiceNumber,
    clientId: orig.clientId,
    clientSnapshot: orig.clientSnapshot,
    invoiceDate: orig.invoiceDate,
    dueDate: orig.dueDate,
    currency: orig.currency,
    showAmounts: orig.showAmounts,
    notes: orig.notes,
    rawChat: orig.rawChat,
    status: "draft",
    accentColor: orig.accentColor ?? "#db8b1a",
  });
  const newId = Number(result[0].insertId);
  // Insert cloned items
  if (origItems.length > 0) {
    await db.insert(invoiceItems).values(
      origItems.map((item, idx) => ({
        invoiceId: newId,
        description: item.description,
        variant: item.variant ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        currency: item.currency,
        sortOrder: item.sortOrder ?? idx,
        tax: item.tax ?? "0",
      }))
    );
  }
  return { id: newId, invoiceNumber: newInvoiceNumber };
}
