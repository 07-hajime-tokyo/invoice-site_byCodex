import { normalizeInboundTrackingNumber } from "@shared/inboundDesk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { inventoryItemLabels, localPurchases } from "../../drizzle/schema";
import { protectedProcedure } from "../_core/trpc";
import { updateLocalPurchaseStatus } from "./db";
import { recordWorkLog } from "./workLogs";
import {
  requireDb,
  operatorName,
  normalizeStatus,
  markPurchaseReceivedIfComplete,
} from "./inboundDeskData";

export const inboundReceiveProcedure = protectedProcedure
  .input(
    z.object({
      labelIds: z.array(z.string().min(1).max(80)).min(1).max(100),
      operatorName: z.string().max(200).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const workerName = operatorName(
      input.operatorName,
      ctx.user.name ?? ctx.user.email
    );
    const uniqueIds = Array.from(
      new Set(input.labelIds.map(value => value.trim().toUpperCase()))
    );
    const received: string[] = [];
    const alreadyReceived: string[] = [];
    const notFound: string[] = [];
    const rejected: string[] = [];
    const purchaseIds = new Set<number>();

    for (const labelId of uniqueIds) {
      const [label] = await db
        .select()
        .from(inventoryItemLabels)
        .where(eq(inventoryItemLabels.labelId, labelId))
        .limit(1);
      if (!label) {
        notFound.push(labelId);
        continue;
      }
      const status = normalizeStatus(label.status);
      if (status === "received") {
        alreadyReceived.push(labelId);
        continue;
      }
      if (status !== "ordered") {
        rejected.push(labelId);
        continue;
      }
      const now = new Date();
      await db
        .update(inventoryItemLabels)
        .set({ status: "received", receivedAt: label.receivedAt ?? now })
        .where(eq(inventoryItemLabels.id, label.id));
      received.push(labelId);
      if (label.purchaseId) purchaseIds.add(label.purchaseId);
      await recordWorkLog({
        workerName,
        category: "荷受け",
        status: "done",
        startedAt: now,
        endedAt: now,
        quantity: 1,
        memo: `商品ID: ${labelId}`,
        createdBy: workerName,
        sourceType: "inbound-receipt",
        sourceId: labelId,
        detailsJson: JSON.stringify({ labelId }),
      });
    }
    for (const purchaseId of purchaseIds)
      await markPurchaseReceivedIfComplete(purchaseId);
    return { received, alreadyReceived, notFound, rejected };
  });

export const inboundCloseArrivingBacklogProcedure = protectedProcedure
  .input(
    z.object({
      /** この追跡番号の荷物ごと閉じる。ラベルが無い行も一緒に片付くのでこちらを使う。 */
      trackingNumber: z.string().max(200).optional(),
      labelIds: z.array(z.string().min(1).max(80)).max(200).default([]),
      receivedDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      reason: z.string().max(200).optional(),
      operatorName: z.string().max(200).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const workerName = operatorName(
      input.operatorName,
      ctx.user.name ?? ctx.user.email
    );
    const labelIds = Array.from(
      new Set(input.labelIds.map(value => value.trim().toUpperCase()))
    );
    const [labelRows, purchaseRows] = await Promise.all([
      db.select().from(inventoryItemLabels),
      db.select().from(localPurchases),
    ]);
    const labelById = new Map(
      labelRows.map(row => [row.labelId.trim().toUpperCase(), row])
    );
    const purchaseById = new Map(purchaseRows.map(row => [row.id, row]));

    const resolvePurchase = (label: (typeof labelRows)[number]) => {
      if (label.purchaseId && purchaseById.has(label.purchaseId))
        return purchaseById.get(label.purchaseId)!;
      if (!label.localInventoryId) return null;
      const managementNo = String(label.legacyManagementNo ?? "").trim();
      return (
        purchaseRows.find(
          row =>
            row.localInventoryId === label.localInventoryId &&
            (!managementNo ||
              String(row.managementNo ?? "").trim() === managementNo)
        ) ??
        purchaseRows.find(
          row => row.localInventoryId === label.localInventoryId
        ) ??
        null
      );
    };

    const receivedDate =
      input.receivedDate ?? new Date().toISOString().slice(0, 10);
    const closedPurchaseIds = new Set<number>();
    const closed: string[] = [];
    const skipped: Array<{ labelId: string; reason: string }> = [];

    // 追跡番号が分かっているなら、その荷物の仕入れ行をまとめて閉じる。
    // ラベルが発行されていない行が同じ荷物に混ざっていることがあるため
    // （実データ: 490449489611 は6行あるのにラベルは1つだけだった）。
    const normalizeTracking = (value: unknown) =>
      normalizeInboundTrackingNumber(String(value ?? ""));
    const targetTracking = normalizeTracking(input.trackingNumber);
    if (targetTracking.length >= 4) {
      for (const purchase of purchaseRows) {
        if (normalizeTracking(purchase.trackingNumber) !== targetTracking)
          continue;
        if (purchase.status === "purchased" || purchase.receivedDate) continue;
        await updateLocalPurchaseStatus(purchase.id, "purchased", receivedDate);
        closedPurchaseIds.add(purchase.id);
      }
    }

    for (const labelId of labelIds) {
      const label = labelById.get(labelId);
      if (!label) {
        skipped.push({ labelId, reason: "個体が見つかりません" });
        continue;
      }
      const purchase = resolvePurchase(label);
      if (!purchase) {
        skipped.push({ labelId, reason: "仕入れ行が見つかりません" });
        continue;
      }
      if (purchase.status === "purchased" || purchase.receivedDate) {
        skipped.push({ labelId, reason: "すでに入庫済みです" });
        continue;
      }
      if (closedPurchaseIds.has(purchase.id)) {
        closed.push(labelId);
        continue;
      }
      // 在庫と入庫履歴には触らない。棚卸しで合わせた数字を壊さないため。
      await updateLocalPurchaseStatus(purchase.id, "purchased", receivedDate);
      closedPurchaseIds.add(purchase.id);
      closed.push(labelId);
    }

    const now = new Date();
    await recordWorkLog({
      workerName,
      category: "到着予定のクローズ",
      status: "done",
      startedAt: now,
      endedAt: now,
      quantity: closedPurchaseIds.size,
      memo: `${closedPurchaseIds.size}件の仕入れ行を受領日 ${receivedDate} で閉じた（在庫は動かしていない）${input.reason ? ` / ${input.reason}` : ""}`,
      createdBy: workerName,
      sourceType: "arriving-backlog-close",
      sourceId: labelIds.slice(0, 5).join(","),
      detailsJson: JSON.stringify({
        labelIds,
        purchaseIds: Array.from(closedPurchaseIds),
        receivedDate,
        reason: input.reason ?? null,
        skipped,
      }),
    });

    return { closedPurchases: closedPurchaseIds.size, closed, skipped };
  });
