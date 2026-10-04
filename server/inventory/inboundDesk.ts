import { TRPCError } from "@trpc/server";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  inventoryItemLabels,
  localInventories,
  outboundBoxes,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { createDeliveryHistory, createStandaloneItemLabel } from "./db";
import { recordWorkLog } from "./workLogs";
import {
  DEFECT_PHOTO_KINDS,
  DEFECT_TAGS,
  LISTING_KINDS,
  type DefectPhoto,
  type DefectTag,
  type ListingKind,
} from "./defectiveListing";
import { uploadDefectivePhotos } from "./defectivePhotos";
import { syncDefectiveListingByLabelId } from "./defectiveSync";
import { rotateListingPhoto } from "./listingPhotoStorage";
import {
  createDefectiveGroup,
  dissolveDefectiveGroup,
  listDefectiveGroups,
  listYahooListingQueue,
  searchStockForListing,
  syncDefectiveGroup,
} from "./defectiveGroups";
import { normalizeStatus, requireDb, operatorName } from "./inboundDeskData";
import {
  createDefectiveInventory,
  insertInspectionActionItem,
  inboundInspectProcedure,
  inboundCloseInspectionBacklogProcedure,
} from "./inboundInspection";
export {
  inboundInspectionInputSchema,
  insertInspectionActionItem,
  createDefectiveInventory,
} from "./inboundInspection";
import {
  inboundUndoPreviewProcedure,
  inboundUndoProcedure,
} from "./inboundUndoOperations";
import {
  inboundReceiveProcedure,
  inboundCloseArrivingBacklogProcedure,
} from "./inboundReceipt";
import {
  inboundReceivedLabelIdsOnProcedure,
  inboundReceivedLabelsOnProcedure,
  inboundDailyActivityProcedure,
  inboundSaveFulfillmentSnapshotProcedure,
  inboundFulfillmentSnapshotDatesProcedure,
  inboundFulfillmentSnapshotProcedure,
  inboundSnapshotProcedure,
} from "./inboundDeskQueries";

export const restockToDefectiveInputSchema = z
  .object({
    labelId: z.string().min(1).max(80),
    operatorName: z.string().max(200).optional(),
    /** 既定はジャンク。動作するが不要になった在庫を国内で売るときだけ surplus */
    listingKind: z.enum(LISTING_KINDS).default("junk"),
    /** 代替品の仕入れ依頼を「やること」へ出すか。明示的に頼まれたときだけ true */
    requestReplacement: z.boolean().default(false),
    defectTags: z.array(z.enum(DEFECT_TAGS)).max(9).default([]),
    defectNote: z.string().max(500).optional(),
    defectPhotos: z.array(z.object({
      url: z.string().url().max(2_000),
      key: z.string().min(1).max(512),
      kind: z.enum(DEFECT_PHOTO_KINDS),
    })).max(10).optional(),
  })
  .superRefine((value, context) => {
    // 不良で出すなら何が悪いのかが要る。動作品には不良タグが存在しないので求めない
    if (value.listingKind === "junk" && value.defectTags.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["defectTags"],
        message: "不良タグを1つ以上選んでください",
      });
    }
  });

export function restockToDefectiveBlockReason(input: {
  status: string;
  boxStatus?: string | null;
  boxCode?: string | null;
  alreadyDefective?: boolean;
}): string | null {
  const status = normalizeStatus(input.status);
  if (input.boxStatus === "shipped") {
    return `${input.boxCode ?? "箱"} の追跡番号を解除し、封を解いてから不良在庫へ移してください`;
  }
  if (input.boxStatus === "sealed") {
    return `${input.boxCode ?? "箱"} の封を解いてから不良在庫へ移してください`;
  }
  if (input.boxStatus === "open") {
    return `${input.boxCode ?? "箱"} から個体を取り出してから不良在庫へ移してください`;
  }
  if (status === "shipped") {
    return "出荷済みの個体は本操作の対象外です。返品フローで処理してください";
  }
  if (input.alreadyDefective) return "この個体は既に不良在庫として登録済みです";
  if (status !== "stocked") return `在庫化済み（stocked）の個体だけ変更できます。現在: ${input.status}`;
  return null;
}

async function loadRestockCandidate(labelId: string) {
  const db = await requireDb();
  const normalizedId = labelId.trim().toUpperCase();
  const [label] = await db.select().from(inventoryItemLabels)
    .where(eq(inventoryItemLabels.labelId, normalizedId)).limit(1);
  if (!label) return null;
  const [inventory] = label.localInventoryId
    ? await db.select().from(localInventories)
        .where(eq(localInventories.id, label.localInventoryId)).limit(1)
    : [];
  const [box] = label.outboundBoxId
    ? await db.select().from(outboundBoxes)
        .where(eq(outboundBoxes.id, label.outboundBoxId)).limit(1)
    : [];
  const reason = restockToDefectiveBlockReason({
    status: label.status,
    boxStatus: box?.status,
    boxCode: box?.boxCode,
    alreadyDefective: Boolean(label.defectRecordedAt),
  });
  return {
    label,
    inventory: inventory ?? null,
    box: box ?? null,
    eligible: !reason,
    reason,
  };
}

const RESTOCK_CANDIDATE_BULK_CHUNK_SIZE = 1000;
type RestockCandidate = NonNullable<Awaited<ReturnType<typeof loadRestockCandidate>>>;

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function loadRestockCandidatesBulk(): Promise<RestockCandidate[]> {
  const db = await requireDb();

  const labels = await db.select().from(inventoryItemLabels)
    .where(eq(inventoryItemLabels.status, "stocked"));
  if (labels.length === 0) return [];

  const inventoryIds = [...new Set(
    labels.map(label => label.localInventoryId).filter((id): id is number => id != null)
  )];
  const boxIds = [...new Set(
    labels.map(label => label.outboundBoxId).filter((id): id is number => id != null)
  )];

  const loadInventoryRows = async () => {
    const rows: Array<typeof localInventories.$inferSelect> = [];
    for (const chunk of chunkValues(inventoryIds, RESTOCK_CANDIDATE_BULK_CHUNK_SIZE)) {
      rows.push(...await db.select().from(localInventories).where(inArray(localInventories.id, chunk)));
    }
    return rows;
  };
  const loadBoxRows = async () => {
    const rows: Array<typeof outboundBoxes.$inferSelect> = [];
    for (const chunk of chunkValues(boxIds, RESTOCK_CANDIDATE_BULK_CHUNK_SIZE)) {
      rows.push(...await db.select().from(outboundBoxes).where(inArray(outboundBoxes.id, chunk)));
    }
    return rows;
  };

  const [inventoryRows, boxRows] = await Promise.all([
    inventoryIds.length ? loadInventoryRows() : Promise.resolve([]),
    boxIds.length ? loadBoxRows() : Promise.resolve([]),
  ]);

  const inventoryById = new Map(inventoryRows.map(row => [row.id, row]));
  const boxById = new Map(boxRows.map(row => [row.id, row]));

  return labels.map(label => {
    const inventory = label.localInventoryId != null
      ? inventoryById.get(label.localInventoryId) ?? null
      : null;
    const box = label.outboundBoxId != null
      ? boxById.get(label.outboundBoxId) ?? null
      : null;
    const reason = restockToDefectiveBlockReason({
      status: label.status,
      boxStatus: box?.status,
      boxCode: box?.boxCode,
      alreadyDefective: Boolean(label.defectRecordedAt),
    });
    return {
      label,
      inventory,
      box,
      eligible: !reason,
      reason,
    } as RestockCandidate;
  });
}

/**
 * 在庫の1個体をヤフオク出品待ちへ移す。
 * 元の在庫を1減らし、出品用の在庫行を1つ作って、相場取得とシート書き込みを非同期で走らせる。
 * 1件用と一括用の両方から呼ぶ。
 */
async function moveStockToListing(
  input: {
    labelId: string;
    listingKind: ListingKind;
    defectTags: readonly DefectTag[];
    defectNote?: string;
    defectPhotos?: DefectPhoto[];
    /** 代替品の仕入れ依頼を「やること」へ出すか。既定は出さない */
    requestReplacement?: boolean;
  },
  workerName: string
) {
  const labelId = input.labelId.trim().toUpperCase();
  const candidate = await loadRestockCandidate(labelId);
  if (!candidate) {
    throw new TRPCError({ code: "NOT_FOUND", message: `商品ID ${labelId} が見つかりません` });
  }
  if (!candidate.eligible) {
    throw new TRPCError({ code: "BAD_REQUEST", message: candidate.reason ?? "不良在庫へ移せません" });
  }
  if (!candidate.inventory) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${labelId} に在庫情報が紐づいていません` });
  }
  const currentQuantity = Number(candidate.inventory.quantity ?? 0);
  if (currentQuantity < 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${labelId} の在庫数が0のため不良在庫へ移せません` });
  }
  const defectPhotos = (input.defectPhotos ?? []) as DefectPhoto[];
  const expectedPhotoPrefix = `defective/${labelId}/`;
  if (defectPhotos.some(photo => !photo.key.startsWith(expectedPhotoPrefix))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "写真の商品IDと対象の商品IDが一致しません" });
  }

  const db = await requireDb();
  const now = new Date();
  const defectiveInventoryId = await db.transaction(async tx => {
    const quantityUpdate = await tx.update(localInventories)
      .set({ quantity: sql`${localInventories.quantity} - 1` })
      .where(and(
        eq(localInventories.id, candidate.inventory!.id),
        gt(localInventories.quantity, 0),
      ));
    const quantityChanged = Number((quantityUpdate[0] as { affectedRows?: number }).affectedRows ?? 0) === 1;
    if (!quantityChanged) {
      throw new TRPCError({ code: "CONFLICT", message: `${labelId} の在庫数が既に変更されています。画面を更新してください` });
    }

    const inventoryId = await createDefectiveInventory({
      label: candidate.label,
      sourceInventory: candidate.inventory!,
      destination: input.listingKind === "surplus" ? "surplus" : "defective",
    }, tx);
    const labelUpdate = await tx.update(inventoryItemLabels).set({
      status: "stocked",
      localInventoryId: inventoryId,
      outboundBoxId: null,
      shippedAt: null,
      listingKind: input.listingKind,
      defectTags: input.defectTags.join(","),
      defectNote: input.defectNote?.trim() || null,
      defectPhotosJson: JSON.stringify(defectPhotos),
      defectRecordedAt: now,
      defectiveSheetSyncedAt: null,
    }).where(and(
      eq(inventoryItemLabels.id, candidate.label.id),
      eq(inventoryItemLabels.status, "stocked"),
      isNull(inventoryItemLabels.outboundBoxId),
      isNull(inventoryItemLabels.defectRecordedAt),
    ));
    const labelChanged = Number((labelUpdate[0] as { affectedRows?: number }).affectedRows ?? 0) === 1;
    if (!labelChanged) {
      throw new TRPCError({ code: "CONFLICT", message: `${labelId} の状態が既に変更されています。画面を更新してください` });
    }
    return inventoryId;
  });
  // 代替品の仕入れ依頼は、明示的に頼まれたときだけ「やること」へ出す。
  // ヤフオクへ回す＝売り切る判断なので、自動で仕入れ直す前提に立たない（村上さん指示・2026-08-18）
  const actionItemId = input.requestReplacement
    ? await insertInspectionActionItem({
        labelId,
        title: candidate.label.title,
        legacyManagementNo: candidate.label.legacyManagementNo,
        createdBy: workerName,
      })
    : null;
  await recordWorkLog({
    workerName,
    category:
      input.listingKind === "surplus"
        ? "在庫から国内販売へ変更"
        : "在庫から不良在庫へ変更",
    status: "done",
    startedAt: now,
    endedAt: now,
    quantity: 1,
    memo: `${labelId} / ${candidate.label.title}`,
    createdBy: workerName,
    sourceType: "restock-to-defective",
    sourceId: labelId,
    detailsJson: JSON.stringify({
      labelId,
      sourceInventoryId: candidate.inventory.id,
      defectiveInventoryId,
      listingKind: input.listingKind,
      defectTags: input.defectTags,
      photoCount: defectPhotos.length,
      actionItemId,
    }),
  });
  setImmediate(() => {
    void syncDefectiveListingByLabelId(labelId).catch(error => {
      console.error("[defective-listing] restock preparation failed", {
        labelId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
  return { labelId, defectiveInventoryId, actionItemId, listingPreparation: "queued" as const };
}

export const inboundDeskRouter = router({
  defectiveGroups: protectedProcedure.query(() => listDefectiveGroups()),

  /**
   * 在庫に無いものを手入力で出品待ちへ入れる。
   * 空箱などの付属品は取引ハブに在庫登録されないが、ヤフオクには出す。
   * 個体ラベルを1つ発行して、写真・相場・シート・出庫の既存経路にそのまま乗せる。
   */
  createManualListing: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(500),
      listingKind: z.enum(LISTING_KINDS).default("surplus"),
      note: z.string().max(500).optional(),
      unitPrice: z.number().int().min(0).max(10_000_000).optional(),
      operatorName: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const workerName = operatorName(input.operatorName, ctx.user.name ?? ctx.user.email);
      const db = await requireDb();
      const now = new Date();
      const title = input.title.trim();

      const [inventoryResult] = await db.insert(localInventories).values({
        zaicoId: null,
        title,
        category: input.listingKind === "junk" ? "ジャンク売り" : "国内販売",
        place: null,
        quantity: 1,
        unit: null,
        unitPrice: input.unitPrice == null ? null : String(input.unitPrice),
        etc: null,
        supplierUrl: null,
        supplierName: null,
        ebayListingUrl: null,
        ebayOrderUrl: null,
        ebayOrderStatus: "normal",
        isDeleted: 0,
      });
      const inventoryId = Number((inventoryResult as { insertId?: number }).insertId ?? 0);
      if (!inventoryId) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "在庫行を作成できませんでした" });
      }

      const label = await createStandaloneItemLabel({
        purchaseId: null,
        localInventoryId: inventoryId,
        legacyManagementNo: null,
        title,
        status: "stocked",
        sourceKey: "manual-listing",
        receivedAt: now,
        listingKind: input.listingKind,
        defectTags: "",
        defectNote: input.note?.trim() || null,
        defectPhotosJson: JSON.stringify([]),
        defectRecordedAt: now,
      });

      // 手入力と分かるように在庫の備考へラベルを書き戻す
      await db.update(localInventories)
        .set({ etc: `在庫_手入力_${label.labelId}` })
        .where(eq(localInventories.id, inventoryId));

      await recordWorkLog({
        workerName,
        category: "ヤフオク出品を手入力で追加",
        status: "done",
        startedAt: now,
        endedAt: now,
        quantity: 1,
        memo: `${label.labelId} / ${title}`,
        createdBy: workerName,
        sourceType: "manual-listing",
        sourceId: label.labelId,
        detailsJson: JSON.stringify({ labelId: label.labelId, inventoryId, listingKind: input.listingKind }),
      });

      const result = await syncDefectiveListingByLabelId(label.labelId);
      return { labelId: label.labelId, inventoryId, sheet: result.sheet };
    }),

  /**
   * ヤフオクで売れて発送したことを記録する。
   * 在庫を0にし、出庫履歴へ1行残し、シートの発送状況を更新する。
   * FedExの海外発送とは別経路なので、出庫Noは ヤフオクYYMMDD で分けている。
   */
  markListingShipped: protectedProcedure
    .input(z.object({
      labelId: z.string().min(1).max(80),
      shippedOn: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).optional(),
      operatorName: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const workerName = operatorName(input.operatorName, ctx.user.name ?? ctx.user.email);
      const db = await requireDb();
      const labelId = input.labelId.trim().toUpperCase();
      const [label] = await db.select().from(inventoryItemLabels)
        .where(eq(inventoryItemLabels.labelId, labelId)).limit(1);
      if (!label) {
        throw new TRPCError({ code: "NOT_FOUND", message: `商品ID ${labelId} が見つかりません` });
      }
      if (!label.defectRecordedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${labelId} は出品待ちに入っていません` });
      }
      if (label.shippedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${labelId} は既に発送済みです` });
      }
      if (label.outboundBoxId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${labelId} は箱に入っています。箱から出してください` });
      }

      const shippedAt = input.shippedOn ? new Date(`${input.shippedOn}T00:00:00+09:00`) : new Date();
      const [inventory] = label.localInventoryId
        ? await db.select().from(localInventories).where(eq(localInventories.id, label.localInventoryId)).limit(1)
        : [];

      const claimed = await db.update(inventoryItemLabels)
        .set({ status: "shipped", shippedAt })
        .where(and(
          eq(inventoryItemLabels.id, label.id),
          isNull(inventoryItemLabels.shippedAt),
        ));
      if (Number((claimed[0] as { affectedRows?: number }).affectedRows ?? 0) !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: `${labelId} は既に発送済みです。画面を更新してください` });
      }

      if (inventory && Number(inventory.quantity ?? 0) > 0) {
        await db.update(localInventories)
          .set({ quantity: sql`GREATEST(${localInventories.quantity} - 1, 0)` })
          .where(eq(localInventories.id, inventory.id));
      }

      const stamp = new Date(shippedAt.getTime() + 9 * 60 * 60 * 1_000)
        .toISOString().slice(2, 10).replace(/-/g, "");
      const deliveryHistoryId = await createDeliveryHistory({
        deliveryNo: `ヤフオク${stamp}`,
        zaicoDeliveryId: null,
        itemsJson: JSON.stringify([{
          inventoryId: inventory?.id ?? null,
          title: label.title,
          quantity: 1,
          labelId,
          channel: "yahoo-auction",
          managementNo: inventory?.etc ?? null,
        }]),
        status: "success",
      });

      await recordWorkLog({
        workerName,
        category: "ヤフオク発送",
        status: "done",
        startedAt: shippedAt,
        endedAt: shippedAt,
        quantity: 1,
        memo: `${labelId} / ${label.title}`,
        createdBy: workerName,
        sourceType: "yahoo-shipment",
        sourceId: labelId,
        detailsJson: JSON.stringify({ labelId, deliveryHistoryId, inventoryId: inventory?.id ?? null }),
      });

      const result = await syncDefectiveListingByLabelId(labelId, { reuseFreshMarket: true });
      return { labelId, deliveryHistoryId, sheet: result.sheet };
    }),

  /**
   * 写真の向きをまとめて直す。
   * 「どの辺を上にするか」で受け取る。1枚ずつ90度ずつ押していくと10枚で時間がかかるため、
   * 選び終えてから一括で適用する（村上さん指示・2026-08-18）。
   */
  rotateListingPhotos: protectedProcedure
    .input(z.object({
      labelId: z.string().min(1).max(80),
      rotations: z.array(z.object({
        photoKey: z.string().min(1).max(512),
        /** 上にしたい辺。top はそのまま */
        topEdge: z.enum(["top", "right", "bottom", "left"]),
      })).min(1).max(10),
    }))
    .mutation(async ({ input }) => {
      const labelId = input.labelId.trim().toUpperCase();
      // 「その辺を上へ」を時計回りの角度に直す。右辺を上へ持ち上げるには反時計回り90度＝270度
      const degreesFor = { top: 0, right: 270, bottom: 180, left: 90 } as const;
      const applied: string[] = [];
      const failed: Array<{ photoKey: string; message: string }> = [];
      const urlByKey = new Map<string, string>();
      for (const rotation of input.rotations) {
        const degrees = degreesFor[rotation.topEdge];
        if (degrees === 0) continue;
        if (!rotation.photoKey.startsWith(`defective/${labelId}/`)) {
          failed.push({ photoKey: rotation.photoKey, message: "商品IDが一致しません" });
          continue;
        }
        try {
          const result = await rotateListingPhoto(rotation.photoKey, degrees as 90 | 180 | 270);
          urlByKey.set(rotation.photoKey, result.url);
          applied.push(rotation.photoKey);
        } catch (error) {
          failed.push({
            photoKey: rotation.photoKey,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (applied.length > 0) {
        // 回した写真だけURLを差し替える。Sheetsのキャッシュを外すため
        const db = await requireDb();
        const [label] = await db.select().from(inventoryItemLabels)
          .where(eq(inventoryItemLabels.labelId, labelId)).limit(1);
        if (label) {
          let photos: DefectPhoto[] = [];
          try {
            const parsed = JSON.parse(label.defectPhotosJson ?? "[]");
            photos = Array.isArray(parsed) ? parsed : [];
          } catch {
            photos = [];
          }
          const next = photos.map(photo =>
            urlByKey.has(photo.key) ? { ...photo, url: urlByKey.get(photo.key)! } : photo
          );
          await db.update(inventoryItemLabels)
            .set({ defectPhotosJson: JSON.stringify(next) })
            .where(eq(inventoryItemLabels.id, label.id));
        }
      }

      const result = await syncDefectiveListingByLabelId(labelId, { reuseFreshMarket: true });
      return { applied, failed, sheet: result.sheet };
    }),

  /** 出品写真を回す。向きはソフトから判断できないので人が直す */
  rotateListingPhoto: protectedProcedure
    .input(z.object({
      labelId: z.string().min(1).max(80),
      photoKey: z.string().min(1).max(512),
      degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]).default(90),
    }))
    .mutation(async ({ input }) => {
      const labelId = input.labelId.trim().toUpperCase();
      if (!input.photoKey.startsWith(`defective/${labelId}/`)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "写真の商品IDが一致しません" });
      }
      await rotateListingPhoto(input.photoKey, input.degrees);
      // Sheetsは同じURLをキャッシュするので、キャッシュ破棄のために書き直す
      const result = await syncDefectiveListingByLabelId(labelId, { reuseFreshMarket: true });
      return { photoKey: input.photoKey, sheet: result.sheet };
    }),

  /** ヤフオク出品画面が読む出品待ち一覧。荷受けの当日分に縛られない */
  yahooListingQueue: protectedProcedure.query(() => listYahooListingQueue()),

  /** 出品待ちへ入れる在庫を商品名で探す */
  searchStockForListing: protectedProcedure
    .input(z.object({ query: z.string().max(200).default("") }))
    .query(({ input }) => searchStockForListing(input.query)),

  createDefectiveGroup: protectedProcedure
    .input(z.object({
      labelIds: z.array(z.string().min(1).max(80)).min(2).max(50),
      operatorName: z.string().max(200).optional(),
    }))
    .mutation(({ input, ctx }) => createDefectiveGroup(
      input.labelIds,
      operatorName(input.operatorName, ctx.user.name ?? ctx.user.email),
    )),

  syncDefectiveGroup: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => syncDefectiveGroup(input.id)),

  dissolveDefectiveGroup: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => dissolveDefectiveGroup(input.id)),

  listRestockCandidates: protectedProcedure.query(async () => {
    const candidates = await loadRestockCandidatesBulk();
    return candidates.filter(candidate => !candidate.label.defectRecordedAt);
  }),

  lookupRestockCandidate: protectedProcedure
    .input(z.object({ labelId: z.string().min(1).max(80) }))
    .query(async ({ input }) => loadRestockCandidate(input.labelId)),

  /**
   * 指定日に荷受けした商品IDを返す。
   * 「荷受日」は配送伝票のバーコードを読んだ時点（receivedAt）で、入庫日（動作確認OKで作られる
   * 入庫履歴の日付）とは別物。実データで8日ずれていた例がある（2026-08-15）。
   * 日付の区切りは Asia/Tokyo。
   */
  receivedLabelIdsOn: inboundReceivedLabelIdsOnProcedure,

  /**
   * 指定日に荷受けしたラベルそのもの。ラベル印刷が「画面にどこまで読み込まれているか」に
   * 左右されないよう、IDだけでなく印刷に要る項目まで返す。在庫用（インボイス紐付けなし）や、
   * 発注一覧のページから外れたものを取りこぼさないため。
   */
  receivedLabelsOn: inboundReceivedLabelsOnProcedure,

  /**
   * 指定日に何をしたかの一覧。荷受けと動作確認を作業ログから拾う。
   * 充足状況（一覧）は「今」の状態から毎回計算しているので過去日を再現できない。
   * 「その日に何を触ったか」はここで出す。日付の区切りは Asia/Tokyo。
   */
  dailyActivity: inboundDailyActivityProcedure,

  /**
   * 過去の荷受け分を、動作確認を通さずに待ち行列から外す（遡及クローズ）。
   *
   * 動作確認フェーズは開発の途中から入ったため、それ以前に荷受けした個体が
   * 「検品待ち」に取り残されている。中には既に従来経路で出庫済みのものもある
   * （2026-08-16 実データで No.398/399/402 の完了済みインボイス分を確認）。
   *
   * 通常の inspect は在庫を増やす経路を通るので、ここでは絶対に使わない。
   * この処理は status を進めるだけで、在庫・入庫履歴・やることには一切触れない。
   */
  /**
   * 到着予定に取り残された仕入れ行を、在庫を動かさずに閉じる。
   *
   * 現物はとっくに届いていて、棚卸しで在庫数も合わせ済みなのに、
   * 仕入れ行の入庫登録だけが入っていない、という記録が残る。
   * （実データ: 追跡番号 490449489611 の6点のうち3点だけ入庫登録されていた）
   *
   * ここで入庫処理を通すと在庫が二重に増える。status と受領日だけ進めて、
   * 在庫・入庫履歴・やることには一切触れない。closeInspectionBacklog と同じ考え方。
   */
  closeArrivingBacklog: inboundCloseArrivingBacklogProcedure,

  closeInspectionBacklog: inboundCloseInspectionBacklogProcedure,

  /** その日の充足状況を1行だけ残す。同じ日に何度押しても上書きになる。 */
  saveFulfillmentSnapshot: inboundSaveFulfillmentSnapshotProcedure,

  /** 保存済みスナップショットのある日付。印刷画面の日付候補に使う。 */
  fulfillmentSnapshotDates: inboundFulfillmentSnapshotDatesProcedure,

  /** 指定日の充足状況。保存が無ければ null を返す（今の状態で代用しない）。 */
  fulfillmentSnapshot: inboundFulfillmentSnapshotProcedure,

  snapshot: inboundSnapshotProcedure,

  undoPreview: inboundUndoPreviewProcedure,

  undo: inboundUndoProcedure,

  receive: inboundReceiveProcedure,

  uploadDefectPhotos: protectedProcedure
    .input(
      z.object({
        labelId: z.string().min(1).max(80),
        files: z
          .array(
            z.object({
              base64: z.string().min(1).max(20 * 1024 * 1024),
              mimeType: z.string().regex(/^image\//i).max(100),
              kind: z.enum(DEFECT_PHOTO_KINDS),
            })
          )
          .max(10)
          .refine(
            files =>
              files.reduce((sum, file) => sum + file.base64.length, 0) <=
              45 * 1024 * 1024,
            "写真の合計サイズは45MB以下にしてください"
          ),
      })
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const labelId = input.labelId.trim().toUpperCase();
      const [label] = await db
        .select({
          id: inventoryItemLabels.id,
          status: inventoryItemLabels.status,
          outboundBoxId: inventoryItemLabels.outboundBoxId,
          defectRecordedAt: inventoryItemLabels.defectRecordedAt,
        })
        .from(inventoryItemLabels)
        .where(eq(inventoryItemLabels.labelId, labelId))
        .limit(1);
      if (!label)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `商品ID ${labelId} が見つかりません`,
        });
      const candidate = await loadRestockCandidate(labelId);
      const status = normalizeStatus(label.status);
      if (
        status !== "received" &&
        (status !== "stocked" || !candidate?.eligible)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            candidate?.reason ??
            `${labelId} は動作確認待ち・在庫化済みのどちらでもありません`,
        });
      return { photos: await uploadDefectivePhotos(labelId, input.files) };
    }),

  /**
   * 出品待ちへ入れたあとから写真とメモを足す。
   * まとめて登録してから、あとで棚の前で撮る運用に必要。
   * uploadDefectPhotos は登録「前」の個体しか受け付けないので別口にしている。
   */
  attachListingPhotos: protectedProcedure
    .input(z.object({
      labelId: z.string().min(1).max(80),
      defectNote: z.string().max(500).optional(),
      replaceExisting: z.boolean().default(false),
      files: z.array(z.object({
        base64: z.string().min(1).max(20 * 1024 * 1024),
        mimeType: z.string().regex(/^image\//i).max(100),
        kind: z.enum(DEFECT_PHOTO_KINDS),
      })).max(10).default([]).refine(
        files => files.reduce((sum, file) => sum + file.base64.length, 0) <= 45 * 1024 * 1024,
        "写真の合計サイズは45MB以下にしてください"
      ),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const labelId = input.labelId.trim().toUpperCase();
      const [label] = await db.select().from(inventoryItemLabels)
        .where(eq(inventoryItemLabels.labelId, labelId)).limit(1);
      if (!label) {
        throw new TRPCError({ code: "NOT_FOUND", message: `商品ID ${labelId} が見つかりません` });
      }
      if (!label.defectRecordedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${labelId} はまだ出品待ちに入っていません` });
      }
      if (label.outboundBoxId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${labelId} は箱に入っています。箱から出してください` });
      }
      const existing = input.replaceExisting
        ? []
        : (() => {
            try {
              const parsed = JSON.parse(label.defectPhotosJson ?? "[]") as DefectPhoto[];
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })();
      // 既存枚数の続きから採番する。0から振り直すと1枚目を上書きしてしまう
      const uploaded = input.files.length
        ? await uploadDefectivePhotos(
            labelId,
            input.files,
            undefined,
            existing.length
          )
        : [];
      // 同じキーが二重に並ばないよう、キーで一意にしてから10枚で切る
      const merged = [...existing, ...uploaded];
      const photos = merged
        .filter((photo, index) => merged.findIndex(other => other.key === photo.key) === index)
        .slice(0, 10);
      await db.update(inventoryItemLabels).set({
        defectPhotosJson: JSON.stringify(photos),
        ...(input.defectNote === undefined
          ? {}
          : { defectNote: input.defectNote.trim() || null }),
        defectiveSheetSyncedAt: null,
      }).where(eq(inventoryItemLabels.id, label.id));
      // 写真が増えるとタイトルの【写真未撮影】が外れるので、その場でシートを書き直す
      const result = await syncDefectiveListingByLabelId(labelId, {
        reuseFreshMarket: true,
      });
      return { labelId, photoCount: photos.length, sheet: result.sheet };
    }),

  refreshDefectiveListing: protectedProcedure
    .input(
      z.object({
        labelId: z.string().min(1).max(80),
        keyword: z.string().max(200).optional(),
        /**
         * シートへ送り直すだけのときは true。
         * 相場を取り直さないぶん速く、ヤフオクへの往復も増やさない。
         */
        reuseFreshMarket: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) =>
      syncDefectiveListingByLabelId(input.labelId, {
        keyword: input.keyword,
        reuseFreshMarket: input.reuseFreshMarket,
      })
    ),

  /**
   * 同じ商品名の在庫をまとめて出品待ちへ入れる。
   * スイッチのタブレットのように数十台あるものを1台ずつ登録させないための入口。
   * 写真は個体ごとではなく、後から代表1台に付ける運用にする。
   */
  restockManyToListing: protectedProcedure
    .input(z.object({
      labelIds: z.array(z.string().min(1).max(80)).min(1).max(100),
      operatorName: z.string().max(200).optional(),
      listingKind: z.enum(LISTING_KINDS).default("junk"),
      requestReplacement: z.boolean().default(false),
      defectTags: z.array(z.enum(DEFECT_TAGS)).max(9).default([]),
      defectNote: z.string().max(500).optional(),
    }).superRefine((value, context) => {
      if (value.listingKind === "junk" && value.defectTags.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["defectTags"],
          message: "不良タグを1つ以上選んでください",
        });
      }
    }))
    .mutation(async ({ input, ctx }) => {
      const workerName = operatorName(input.operatorName, ctx.user.name ?? ctx.user.email);
      const moved: string[] = [];
      const failed: Array<{ labelId: string; message: string }> = [];
      // 1台失敗しても残りを進める。58台の途中で止まると、どこまで済んだか分からなくなる
      for (const rawLabelId of input.labelIds) {
        try {
          const result = await moveStockToListing({
            labelId: rawLabelId,
            listingKind: input.listingKind,
            requestReplacement: input.requestReplacement,
            defectTags: input.defectTags,
            defectNote: input.defectNote,
            defectPhotos: [],
          }, workerName);
          moved.push(result.labelId);
        } catch (error) {
          failed.push({
            labelId: rawLabelId.trim().toUpperCase(),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { moved, failed };
    }),

  restockToDefective: protectedProcedure
    .input(restockToDefectiveInputSchema)
    .mutation(async ({ input, ctx }) =>
      moveStockToListing(
        input,
        operatorName(input.operatorName, ctx.user.name ?? ctx.user.email)
      )
    ),

  inspect: inboundInspectProcedure,
});
