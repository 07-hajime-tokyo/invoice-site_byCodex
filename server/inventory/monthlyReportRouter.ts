import { z } from "zod";
import { protectedProcedure as publicProcedure, router } from "../_core/trpc";
import {
  createMonthlyReport,
  getMonthlyReports,
  getMonthlyReportById,
  getMonthlyReportCosts,
  deleteMonthlyReport,
  upsertMonthlyReportCost,
} from "./db";
import {
  buildSnapshotBreakdown,
  parseDailySnapshotDate,
} from "@shared/inventorySnapshot";
import { listDailySnapshots, captureDailySnapshot } from "./dailySnapshot";
import { buildMonthlyReportPreview } from "./monthlyReportPreview";

export const snapshotRouter = router({
  /**
   * 日次スナップショットの推移を返す。
   * 明細JSONは重いので、一覧では区分別サマリーだけに畳んで返す。
   */
  list: publicProcedure
    .input(
      z
        .object({ limit: z.number().int().positive().max(400).default(120) })
        .optional()
    )
    .query(async ({ input }) => {
      const rows = await listDailySnapshots(input?.limit ?? 120);
      return rows.map(({ report, date }) => {
        let breakdown = null;
        try {
          const inventorySummary = JSON.parse(
            report.inventorySummaryJson ?? "[]"
          );
          const invoiceList = JSON.parse(report.invoiceListJson ?? "[]");
          breakdown = buildSnapshotBreakdown(inventorySummary, invoiceList);
        } catch {
          breakdown = null;
        }
        return {
          id: report.id,
          date,
          label: report.label,
          createdBy: report.createdBy,
          createdAt: report.createdAt,
          breakdown,
        };
      });
    }),

  /**
   * 手動でその日のスナップショットを保存する。
   * 画面が持っているプレビュー結果をそのまま渡す（preview を再計算すると重いため）。
   */
  capture: publicProcedure
    .input(
      z.object({
        inventorySummaryJson: z.string(),
        invoiceListJson: z.string(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        force: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const preview = {
        inventorySummary: JSON.parse(input.inventorySummaryJson),
        invoiceList: JSON.parse(input.invoiceListJson),
      };
      return captureDailySnapshot(preview, {
        date: input.date,
        force: input.force,
        createdBy: (ctx as { user?: { name?: string } }).user?.name ?? "manual",
      });
    }),
});

export const monthlyReportRouter = router({
  /**
   * 月次レポート生成用データを取得する（保存はしない）
   * - 在庫金額サマリー（カテゴリ×商品別）
   * - 支払い済み・未完了インボイス一覧（G列販売価格・H列通貨込み）
   * - 各インボイスの発注済み商品・在庫商品リスト（仕入単価付き）
   * - 備考欄からtoynet等の国内卸使用情報を解析
   */
  preview: publicProcedure.query(buildMonthlyReportPreview),

  /** レポートを保存する */
  save: publicProcedure
    .input(
      z.object({
        yearMonth: z.string().max(7),
        label: z.string().max(200).optional(),
        inventorySummaryJson: z.string(),
        invoiceListJson: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = await createMonthlyReport({
        yearMonth: input.yearMonth,
        label: input.label ?? null,
        inventorySummaryJson: input.inventorySummaryJson,
        invoiceListJson: input.invoiceListJson,
        createdBy: (ctx as { user?: { name?: string } }).user?.name ?? null,
      });
      return { id };
    }),

  /**
   * レポート一覧を取得する
   * 日次スナップショット（label が "[日次] " 始まり）は既定で除外する。
   * 月次の保存済み一覧に毎日の自動保存が混ざると使い物にならないため。
   */
  list: publicProcedure
    .input(z.object({ includeDaily: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const reports = await getMonthlyReports(input?.includeDaily ? 50 : 400);
      if (input?.includeDaily) return reports;
      return reports
        .filter(report => parseDailySnapshotDate(report.label) === null)
        .slice(0, 50);
    }),

  /** レポート詳細を取得する */
  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const report = await getMonthlyReportById(input.id);
      if (!report) return null;
      const costs = await getMonthlyReportCosts(input.id);
      return { ...report, costs };
    }),

  /** レポートを削除する */
  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteMonthlyReport(input.id);
      return { success: true };
    }),

  /** 仕入れ単価を保存する（手入力分） */
  upsertCost: publicProcedure
    .input(
      z.object({
        reportId: z.number(),
        invoiceKey: z.string().max(50),
        itemKey: z.string().max(500),
        title: z.string().max(500).optional(),
        quantity: z.number().int(),
        unitPrice: z.number().nullable(),
        itemType: z.enum(["ordered", "stock"]).default("ordered"),
        isManual: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const subtotal =
        input.unitPrice != null ? input.unitPrice * input.quantity : null;
      await upsertMonthlyReportCost({
        reportId: input.reportId,
        invoiceKey: input.invoiceKey,
        itemKey: input.itemKey,
        title: input.title ?? null,
        quantity: input.quantity,
        unitPrice: input.unitPrice != null ? String(input.unitPrice) : null,
        subtotal: subtotal != null ? String(subtotal) : null,
        itemType: input.itemType,
        isManual: input.isManual ? 1 : 0,
      });
      return { success: true };
    }),
});
