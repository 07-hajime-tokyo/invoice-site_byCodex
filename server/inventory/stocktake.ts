import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  localInventories,
  inventoryItemLabels,
  outboundBoxes,
} from "../../drizzle/schema";
import {
  invoiceNoFromManagementNo,
  normalizeAssignedInvoiceNo,
} from "../../shared/invoiceKey";
import {
  emptyStocktakeState,
  stocktakeCode,
  stocktakeScanResult,
  summarizeStocktake,
  type StocktakeSnapshot,
  type StocktakeState,
} from "../../shared/stocktake";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "./db";

// This table only stores observations. No stock, receipt or shipment record is mutated.
export const stocktakeDDL = sql`CREATE TABLE IF NOT EXISTS inventory_stocktakes (
  id varchar(36) NOT NULL PRIMARY KEY,
  basis_date varchar(10) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'open',
  snapshot_json mediumtext NOT NULL,
  state_json mediumtext NOT NULL,
  revision int NOT NULL DEFAULT 0,
  created_by varchar(200) NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at timestamp NULL
)`;
let ready: Promise<void> | undefined;
async function database() {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できません");
  ready ??= db
    .execute(stocktakeDDL)
    .then(() => undefined)
    .catch(error => {
      ready = undefined;
      throw error;
    });
  await ready;
  return db;
}
function records<T>(result: unknown): T[] {
  return (result as [T[], unknown])[0];
}
type Stored = {
  id: string;
  basis_date: string;
  status: string;
  snapshot_json: string;
  state_json: string;
  revision: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};
function unpack(row: Stored) {
  return {
    id: row.id,
    basisDate: row.basis_date,
    status: row.status,
    snapshot: JSON.parse(row.snapshot_json) as StocktakeSnapshot,
    state: JSON.parse(row.state_json) as StocktakeState,
    revision: row.revision,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    s =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "日付が不正です"
  );
const id = z.string().uuid();

export const stocktakeRouter = router({
  list: protectedProcedure.query(async () => {
    const db = await database();
    return records<{
      id: string;
      basisDate: string;
      status: string;
      createdAt: Date;
    }>(
      await db.execute(
        sql`SELECT id, basis_date AS basisDate, status, created_at AS createdAt FROM inventory_stocktakes ORDER BY created_at DESC LIMIT 100`
      )
    );
  }),
  get: protectedProcedure.input(z.object({ id })).query(async ({ input }) => {
    const db = await database();
    const row = records<Stored>(
      await db.execute(
        sql`SELECT * FROM inventory_stocktakes WHERE id = ${input.id}`
      )
    )[0];
    if (!row)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "棚卸が見つかりません",
      });
    return unpack(row);
  }),
  start: protectedProcedure
    .input(
      z.object({ id, basisDate: date, noMovementConfirmed: z.literal(true) })
    )
    .mutation(async ({ input, ctx }) => {
      const today = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
      }).format(new Date());
      if (input.basisDate > today)
        throw new Error("未来の日付では棚卸を開始できません");
      const db = await database();
      return db.transaction(async tx => {
        const previous = records<Stored>(
          await tx.execute(
            sql`SELECT * FROM inventory_stocktakes WHERE id = ${input.id}`
          )
        )[0];
        if (previous) return unpack(previous);
        // A transaction gives all three reads the same point-in-time view.
        const inventories = await tx.select().from(localInventories);
        const labels = await tx
          .select({
            code: inventoryItemLabels.labelId,
            title: inventoryItemLabels.title,
            inventoryId: inventoryItemLabels.localInventoryId,
            status: inventoryItemLabels.status,
            assignedInvoiceNo: inventoryItemLabels.assignedInvoiceNo,
            legacyManagementNo: inventoryItemLabels.legacyManagementNo,
            boxId: inventoryItemLabels.outboundBoxId,
          })
          .from(inventoryItemLabels);
        const boxes = await tx
          .select({
            id: outboundBoxes.id,
            code: outboundBoxes.boxCode,
            status: outboundBoxes.status,
            discardedAt: outboundBoxes.discardedAt,
          })
          .from(outboundBoxes);
        const activeBoxes = boxes.filter(b => !b.discardedAt);
        const snapshot: StocktakeSnapshot = {
          capturedAt: new Date().toISOString(),
          rows: inventories
            .filter(r => !r.isDeleted && r.quantity > 0)
            .map(r => ({
              id: r.id,
              title: r.title,
              category: r.category || "未分類",
              managementNo: r.etc || "",
              quantity: r.quantity,
              unitPrice: Number(r.unitPrice || 0),
              labelIds: labels
                .filter(
                  l =>
                    l.inventoryId === r.id &&
                    ["received", "stocked"].includes(l.status) &&
                    !activeBoxes.some(
                      b => b.id === l.boxId && b.status !== "open"
                    )
                )
                .map(l => l.code),
            })),
          labels: labels.map(l => ({
            code: l.code,
            title: l.title,
            inventoryId: l.inventoryId,
            status: l.status,
            invoiceNo:
              normalizeAssignedInvoiceNo(l.assignedInvoiceNo) ??
              invoiceNoFromManagementNo(l.legacyManagementNo),
            boxCode: activeBoxes.find(b => b.id === l.boxId)?.code ?? null,
          })),
          boxes: activeBoxes.map(b => ({
            code: b.code,
            status: b.status,
            labels: labels.filter(l => l.boxId === b.id).map(l => l.code),
          })),
        };
        await tx.execute(
          sql`INSERT INTO inventory_stocktakes (id, basis_date, snapshot_json, state_json, created_by) VALUES (${input.id}, ${input.basisDate}, ${JSON.stringify(snapshot)}, ${JSON.stringify(emptyStocktakeState())}, ${(ctx.user.name || ctx.user.email || "担当者").slice(0, 200)})`
        );
        const row = records<Stored>(
          await tx.execute(
            sql`SELECT * FROM inventory_stocktakes WHERE id = ${input.id}`
          )
        )[0];
        return unpack(row);
      });
    }),
  record: protectedProcedure
    .input(
      z.object({
        id,
        action: z.discriminatedUnion("type", [
          z.object({ type: z.literal("scan"), code: z.string().max(100) }),
          z.object({
            type: z.literal("manual"),
            inventoryId: z.number().int().positive(),
            quantity: z.number().int().nonnegative().max(100000),
          }),
          z.object({ type: z.literal("finish"), notes: z.string().max(10000) }),
        ]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await database();
      return db.transaction(async tx => {
        const row = records<Stored>(
          await tx.execute(
            sql`SELECT * FROM inventory_stocktakes WHERE id = ${input.id} FOR UPDATE`
          )
        )[0];
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        const session = unpack(row);
        if (row.status !== "open")
          throw new Error("確定済みの棚卸は変更できません");
        const { state, snapshot } = session;
        const operator = (ctx.user.name || ctx.user.email || "担当者").slice(
          0,
          200
        );
        let message = "保存しました";
        const action = input.action;
        if (action.type === "scan") {
          const code = stocktakeCode(action.code);
          if (state.scans.some(s => s.code === code))
            return {
              ...session,
              message: `${code} は確認済みです（二重計上なし）`,
            };
          state.scans.push({ code, at: new Date().toISOString(), operator });
          const result = stocktakeScanResult(snapshot, code);
          message = `${code}：${result.title}${result.kind === "stock" ? " 確認済み" : result.kind === "box" ? " 箱の存在のみ確認（中身は未確認）" : " 別枠・要確認"}`;
        } else if (action.type === "manual") {
          const target = summarizeStocktake(snapshot, state).rows.find(
            r => r.id === action.inventoryId
          );
          if (!target || action.quantity > target.manualCapacity)
            throw new Error("QRなし商品の対象数量を超えています");
          state.manual[String(action.inventoryId)] = {
            quantity: action.quantity,
            at: new Date().toISOString(),
            operator,
          };
        } else {
          const summary = summarizeStocktake(snapshot, state);
          if (
            (summary.differences ||
              summary.boxes.some(
                b => !b.boxConfirmed && b.confirmedContents < b.labels.length
              )) &&
            !action.notes.trim()
          )
            throw new Error(
              "未確認・差異の理由をメモに残してから確定してください"
            );
          state.notes = action.notes.trim();
        }
        const status = action.type === "finish" ? "completed" : "open";
        await tx.execute(
          sql`UPDATE inventory_stocktakes SET state_json = ${JSON.stringify(state)}, revision = revision + 1, status = ${status}, completed_at = ${status === "completed" ? new Date() : null} WHERE id = ${input.id}`
        );
        const updated = records<Stored>(
          await tx.execute(
            sql`SELECT * FROM inventory_stocktakes WHERE id = ${input.id}`
          )
        )[0];
        return { ...unpack(updated), message };
      });
    }),
});
