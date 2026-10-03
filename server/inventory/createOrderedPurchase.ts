import { protectedProcedure as publicProcedure } from "../_core/trpc";
import { z } from "zod";
import {
  isZaicoEnabled,
  getLocalInventoryByZaicoIdOrId,
  getLocalPurchases,
  updateLocalInventory,
  updateLocalPurchase,
  insertLocalPurchase,
  ensureInventoryItemLabels,
} from "./db";
import { getInventoryManagementNo } from "./managementNo";
import { resolveOperatorToken } from "./workOperator";
import { createPurchase } from "./zaico";

export const createOrderedPurchaseProcedure = publicProcedure
  .input(
    z.object({
      inventoryId: z.number().int().positive(),
      title: z.string().min(1),
      quantity: z.number().positive("数量は1以上にしてください"),
      unitPrice: z.number().optional(),
      customerName: z.string().optional(),
      supplierName: z.string().nullable().optional(),
      supplierUrl: z.string().nullable().optional(),
      num: z.string().optional(),
      estimatedPurchaseDate: z.string().optional(),
      memo: z.string().optional(),
      managementNo: z.string().optional(),
      operatorKey: z.enum(["default", "A", "B"]).optional(),
    })
  )
  .mutation(async ({ input }) => {
    const zaicoEnabled = await isZaicoEnabled();

    if (!zaicoEnabled) {
      // Zaico連携OFF: ローカルDBに発注データを作成
      // 最大の発注Noを取得して+1する
      const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
      const allPurchases = await getLocalPurchases();
      const linkedInventoryId = localInv?.id ?? input.inventoryId;
      const managementNo = input.managementNo?.trim() || null;
      const supplierName =
        input.supplierName !== undefined
          ? input.supplierName?.trim() || null
          : input.customerName?.trim() || localInv?.supplierName || null;
      const supplierUrl =
        input.supplierUrl !== undefined
          ? input.supplierUrl?.trim() || null
          : (localInv?.supplierUrl ?? null);
      const unitPrice =
        input.unitPrice != null
          ? input.unitPrice
          : localInv?.unitPrice != null
            ? Number(localInv.unitPrice)
            : undefined;
      const maxNum = allPurchases.reduce((max, p) => {
        const n = parseInt(p.purchaseNum ?? "0", 10);
        return n > max ? n : max;
      }, 0);
      const newNum = String(maxNum + 1);
      const existing = managementNo
        ? allPurchases.find(
            purchase =>
              getInventoryManagementNo(purchase.managementNo) === managementNo
          )
        : undefined;
      if (localInv && unitPrice != null && Number.isFinite(unitPrice)) {
        await updateLocalInventory(localInv.id, {
          unitPrice: String(unitPrice),
          supplierName: supplierName ?? localInv.supplierName,
          supplierUrl: supplierUrl ?? localInv.supplierUrl,
        });
      }
      const purchaseData = {
        purchaseNum: input.num ?? existing?.purchaseNum ?? newNum,
        status: "ordered",
        itemsJson: JSON.stringify([
          {
            id: 0,
            title: input.title,
            quantity: String(input.quantity),
            unit_price: unitPrice ?? null,
            etc: managementNo,
            status: "ordered",
            inventory_id: linkedInventoryId,
            inventoryId: linkedInventoryId,
          },
        ]),
        localInventoryId: linkedInventoryId,
        title: input.title,
        category: localInv?.category ?? null,
        quantity: input.quantity,
        unitPrice:
          unitPrice != null && Number.isFinite(unitPrice)
            ? String(unitPrice)
            : null,
        managementNo,
        purchaseDate: input.estimatedPurchaseDate ?? null,
        receivedDate: null,
        supplierUrl,
        supplierName,
      };
      const purchaseId = existing
        ? (await updateLocalPurchase(existing.id, purchaseData), existing.id)
        : await insertLocalPurchase({
            zaicoId: null,
            ...purchaseData,
            inboundClass: null,
            classSource: "auto",
            stage: "ordered",
            stageUpdatedBy: "ui",
            stageUpdatedAt: new Date(),
            shaftParentPurchaseId: null,
          });
      if (purchaseId > 0) {
        await ensureInventoryItemLabels({
          purchaseId,
          localInventoryId: linkedInventoryId,
          legacyManagementNo: managementNo,
          title: input.title,
          quantity: input.quantity,
          status: "ordered",
          sourceKey: managementNo
            ? `management:${managementNo}`
            : `purchase:${purchaseId}`,
        });
      }
      return {
        code: 200,
        status: "ok",
        message: "発注データを登録しました（ローカルDB）",
        data_id: purchaseId,
      };
    }

    const token = resolveOperatorToken(input.operatorKey);
    const payload = {
      status: "ordered" as const,
      customer_name: input.customerName ?? input.supplierName ?? undefined,
      num: input.num,
      memo: input.memo,
      purchase_items: [
        {
          inventory_id: input.inventoryId,
          quantity: input.quantity,
          unit_price: input.unitPrice,
          estimated_purchase_date: input.estimatedPurchaseDate,
          etc: input.managementNo,
        },
      ],
    };
    return createPurchase(payload, token);
  });
