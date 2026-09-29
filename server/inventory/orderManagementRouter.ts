import { protectedProcedure as publicProcedure } from "../_core/trpc";
import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import {
  getDb,
  getAllDeliveryHistories,
  getAllInvoiceMemos,
  getLocalInventoryByZaicoIdOrId,
  getLocalPurchaseById,
  getLocalPurchases,
  updateLocalPurchaseStatus,
  updateLocalInventory,
  createPurchaseHistory,
  updateDeliveryHistoryItemsJson,
  isZaicoEnabled,
  getDeliveryHistories,
  getPurchaseHistories,
  getLocalInventories,
  getDeletedInventories,
  getLocalInventoryInfoByZaicoIds,
} from "./db";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import {
  getOrderRowsFromTradeRecords,
  type OrderCsvRow,
  expandMaxim415416OrderRows,
} from "./orderTradeRows";
import {
  isRandomShipmentName,
  shipmentProductMatches,
  normalizeDeclarationCurrency,
  type ShipmentGasItem,
} from "./shipmentDeclarationRules";
import {
  invoiceNoFromManagementNo,
  normalizeAssignedInvoiceNo,
  resolveDeliveryItemInvoiceNo,
} from "@shared/invoiceKey";
import { createStepTimer } from "./stepTimer";
import { getOrderManagementShipmentProgressByInvoice } from "./shipmentProgressSheets";
import {
  type TradeShipmentProgressEntry,
  summarizeShipmentProgress,
  allocateShipmentProgressToProducts,
  buildShipmentProgressProductTotals,
} from "@shared/tradeSheetStatus";
import {
  buildInventoryManagementNoMap,
  buildAssignedInvoiceNoMap,
  parseDeliveryItemsJson,
  withAssignedInvoiceNo,
  type StoredDeliveryItem,
  invoiceNoFromDeliveryNo,
  invoiceNoPrefixFromDeliveryNo,
} from "./deliveryInvoiceAttribution";
import { isClosedTradeYear } from "@shared/tradeStatus";
import {
  extractManagementHints,
  suggestCsvProduct,
  allocateShipmentItemsToCsvProducts,
  inventoryItemCanMatchCsvProduct,
} from "@shared/productMatching";
import {
  deliveryProductNameMatchesOrderProduct,
  suggestCsvProductNameFromHints,
} from "./orderProductMatching";
import { isReceivedLabelStatus } from "./labelViews";
import { getInventoryManagementNo } from "./managementNo";
import { type LocalPurchaseRow } from "./purchaseRowTypes";
import { localPurchaseMatchesInventoryLabel } from "./purchases/labelMatching";
import { resolveWorkOperatorName } from "./workOperator";
import { filterLabelsByManagementNo } from "./purchases/labels";
import { recordWorkLog } from "./workLogs";
import { getPurchases, getInventories } from "./zaico";

export const orderManagementRouter = router({
  /**
   * 箱の中身をFedEx送り状の申告明細にする。
   *
   * 単価と通貨は取引データ（trade_records）が持っている。箱→個体ラベル→旧管理番号→
   * インボイスNo の経路は既にFedEx紐付けで通っているので、突き合わせて金額を出すだけ。
   * 突き合わせは発送管理シート書き込みと同じ shipmentProductMatches を使う。
   */
  boxDeclaration: protectedProcedure
    .input(z.object({ boxCode: z.string().min(1).max(20) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      const { outboundBoxes: boxTbl, inventoryItemLabels: labelTbl } =
        await import("../../drizzle/schema");
      const boxCode = input.boxCode.normalize("NFKC").trim().toUpperCase();
      const [box] = await db
        .select()
        .from(boxTbl)
        .where(eq(boxTbl.boxCode, boxCode))
        .limit(1);
      if (!box)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${boxCode} が見つかりません`,
        });

      const labels = await db
        .select({
          labelId: labelTbl.labelId,
          title: labelTbl.title,
          legacyManagementNo: labelTbl.legacyManagementNo,
          assignedInvoiceNo: labelTbl.assignedInvoiceNo,
        })
        .from(labelTbl)
        .where(eq(labelTbl.outboundBoxId, box.id));

      const orderRows = await getOrderRowsFromTradeRecords().catch(() => []);
      const rowsByInvoice = new Map<string, OrderCsvRow[]>();
      for (const row of orderRows) {
        if (!row.productName.trim()) continue;
        rowsByInvoice.set(row.invoiceNo, [
          ...(rowsByInvoice.get(row.invoiceNo) ?? []),
          row,
        ]);
      }

      type DeclarationLine = {
        key: string;
        invoiceNo: string | null;
        partner: string;
        productName: string;
        quantity: number;
        /** 旧管理番号からインボイスNoを読めず、箱の中の他インボイスから推定した行 */
        estimatedQuantity: number;
        unitPrice: number | null;
        currency: string;
        subtotal: number | null;
      };
      const lineByKey = new Map<string, DeclarationLine>();
      const unmatched: Array<{
        labelId: string;
        title: string;
        managementNo: string | null;
        invoiceCandidates: string[];
        reason: string;
      }> = [];

      /** 色まで一致する行を優先し、無ければ「ランダムカラー」等の総称行に落とす。 */
      function pickRow(
        candidates: OrderCsvRow[],
        title: string
      ): OrderCsvRow | null {
        const exact = candidates.find(
          row =>
            !isRandomShipmentName(row.productName) &&
            shipmentProductMatches(row.productName, title)
        );
        return (
          exact ??
          candidates.find(row =>
            shipmentProductMatches(row.productName, title)
          ) ??
          null
        );
      }

      // 在庫から充当したぶんは旧管理番号にインボイスNoが無い。
      // その場合は「この箱に入っている他のインボイス」だけを探索範囲にして推定する。
      // 候補が1つに絞れないときは推定せず、未照合として人に返す。
      const invoicesInBox = Array.from(
        new Set(
          labels
            .map(row =>
              invoiceNoFromManagementNo(row.legacyManagementNo?.trim() || null)
            )
            .filter((value): value is string => Boolean(value))
        )
      );

      for (const label of labels) {
        const managementNo = label.legacyManagementNo?.trim() || null;
        // 人が指定した引当先があればそれが正。在庫充当や別インボイスからの振替はこれで解決する。
        const invoiceNo =
          normalizeAssignedInvoiceNo(label.assignedInvoiceNo) ??
          invoiceNoFromManagementNo(managementNo);
        const title = String(label.title ?? "").trim();
        let matched = invoiceNo
          ? pickRow(rowsByInvoice.get(invoiceNo) ?? [], title)
          : null;
        let estimated = false;

        if (!matched && !invoiceNo) {
          const guesses = invoicesInBox
            .map(candidateInvoiceNo =>
              pickRow(rowsByInvoice.get(candidateInvoiceNo) ?? [], title)
            )
            .filter((row): row is OrderCsvRow => Boolean(row));
          const distinct = new Map(
            guesses.map(row => [`${row.invoiceNo}::${row.productName}`, row])
          );
          if (distinct.size === 1) {
            matched = Array.from(distinct.values())[0];
            estimated = true;
          }
        }

        if (!matched) {
          unmatched.push({
            labelId: label.labelId,
            title,
            managementNo,
            invoiceCandidates: invoicesInBox,
            reason: !invoiceNo
              ? "旧管理番号からインボイスNoを読めず、この箱のインボイスからも1つに絞れません"
              : (rowsByInvoice.get(invoiceNo) ?? []).length === 0
                ? `取引データにNo.${invoiceNo}の明細がありません`
                : `No.${invoiceNo}の明細に一致する商品名が見つかりません`,
          });
          continue;
        }

        const key = `${matched.invoiceNo}::${matched.productName}`;
        const current = lineByKey.get(key);
        if (current) {
          current.quantity += 1;
          if (estimated) current.estimatedQuantity += 1;
          current.subtotal =
            current.unitPrice == null
              ? null
              : current.unitPrice * current.quantity;
          continue;
        }
        lineByKey.set(key, {
          key,
          invoiceNo: matched.invoiceNo,
          partner: matched.partner,
          productName: matched.productName,
          quantity: 1,
          estimatedQuantity: estimated ? 1 : 0,
          unitPrice: matched.sellingPrice,
          currency: normalizeDeclarationCurrency(matched.currency),
          subtotal: matched.sellingPrice,
        });
      }

      const lines = Array.from(lineByKey.values()).sort((a, b) => {
        const invoiceDiff = Number(a.invoiceNo ?? 0) - Number(b.invoiceNo ?? 0);
        return invoiceDiff !== 0
          ? invoiceDiff
          : a.productName.localeCompare(b.productName, "ja");
      });

      const totalsByCurrency = new Map<
        string,
        {
          currency: string;
          quantity: number;
          amount: number;
          incomplete: boolean;
        }
      >();
      for (const line of lines) {
        const current = totalsByCurrency.get(line.currency) ?? {
          currency: line.currency,
          quantity: 0,
          amount: 0,
          incomplete: false,
        };
        current.quantity += line.quantity;
        if (line.subtotal == null) current.incomplete = true;
        else current.amount += line.subtotal;
        totalsByCurrency.set(line.currency, current);
      }

      return {
        boxCode: box.boxCode,
        status: box.status,
        trackingNumber: box.trackingNumber ?? null,
        itemCount: labels.length,
        lines,
        totals: Array.from(totalsByCurrency.values()),
        unmatched,
      };
    }),

  /**
   * GitHub Raw URLからCSVを取得してインボイスNo・取引先・発注数をパースする
   */
  getCsvData: publicProcedure.query(async () => {
    try {
      return await getOrderRowsFromTradeRecords();
    } catch (err) {
      console.error("Trade order data error:", err);
      return [];
    }
  }),

  getPurchaseRegistrationInvoices: publicProcedure.query(async () => {
    try {
      const t = createStepTimer("purchaseRegistrationInvoices");
      let orderRowsMs = 0;
      let deliveryHistoriesMs = 0;
      let memosMs = 0;
      let shipmentProgressMs = 0;
      let inventoryManagementNoMapMs = 0;
      let assignedInvoiceNoMapMs = 0;

      const [
        orderRows,
        histories,
        allMemos,
        shipmentProgressByInvoice,
        inventoryManagementNoMap,
        assignedInvoiceNoMap,
      ] = await t.step("parallelFetch", () => {
        const orderRowsStartedAt = Date.now();
        const orderRowsPromise = getOrderRowsFromTradeRecords().finally(() => {
          orderRowsMs = Date.now() - orderRowsStartedAt;
        });
        const deliveryHistoriesStartedAt = Date.now();
        const deliveryHistoriesPromise = getAllDeliveryHistories()
          .catch(() => [])
          .finally(() => {
            deliveryHistoriesMs = Date.now() - deliveryHistoriesStartedAt;
          });
        const memosStartedAt = Date.now();
        const memosPromise = getAllInvoiceMemos()
          .catch(() => [])
          .finally(() => {
            memosMs = Date.now() - memosStartedAt;
          });
        const shipmentProgressStartedAt = Date.now();
        const shipmentProgressPromise =
          getOrderManagementShipmentProgressByInvoice()
            .catch(error => {
              console.warn(
                "[OrderManagement] Failed to load shipment progress sheet",
                error
              );
              return new Map<string, TradeShipmentProgressEntry[]>();
            })
            .finally(() => {
              shipmentProgressMs = Date.now() - shipmentProgressStartedAt;
            });
        // 出庫Noの文字列ではなく明細1点ずつの管理番号でインボイスに振り分ける。
        // 箱ID（B000002）のように出庫Noから読めない出庫でも、中身が403と408に
        // 分かれていればそれぞれに計上される。従来の出庫Noは接頭辞で当たるので挙動は変わらない。
        const inventoryManagementNoMapStartedAt = Date.now();
        const inventoryManagementNoMapPromise = buildInventoryManagementNoMap()
          .catch(() => new Map<number, string>())
          .finally(() => {
            inventoryManagementNoMapMs =
              Date.now() - inventoryManagementNoMapStartedAt;
          });
        const assignedInvoiceNoMapStartedAt = Date.now();
        const assignedInvoiceNoMapPromise = buildAssignedInvoiceNoMap()
          .catch(() => new Map<string, string>())
          .finally(() => {
            assignedInvoiceNoMapMs = Date.now() - assignedInvoiceNoMapStartedAt;
          });
        return Promise.all([
          orderRowsPromise,
          deliveryHistoriesPromise,
          memosPromise,
          shipmentProgressPromise,
          inventoryManagementNoMapPromise,
          assignedInvoiceNoMapPromise,
        ]);
      });

      const manualCompleteSet = new Set<string>(
        allMemos
          .filter(
            memo => memo.colorKey === "__manual_complete__" && memo.memo === "1"
          )
          .map(memo => String(memo.invoiceKey))
      );

      const invoiceMap = new Map<
        string,
        {
          invoiceNo: string;
          partner: string;
          totalOrderQty: number;
        }
      >();

      for (const row of orderRows) {
        const invoiceNumber = Number(row.invoiceNo);
        if (!Number.isFinite(invoiceNumber) || invoiceNumber <= 383) continue;
        if (
          manualCompleteSet.has(row.invoiceNo) ||
          isClosedTradeYear(row.paymentDate)
        )
          continue;

        const current = invoiceMap.get(row.invoiceNo) ?? {
          invoiceNo: row.invoiceNo,
          partner: row.partner,
          totalOrderQty: 0,
        };
        current.totalOrderQty += Number(row.orderQty ?? 0) || 0;
        if (!current.partner && row.partner) current.partner = row.partner;
        invoiceMap.set(row.invoiceNo, current);
      }

      const sheetDeliveredQtyByInvoiceNo = new Map<string, number>();
      for (const [invoiceNo, entries] of shipmentProgressByInvoice.entries()) {
        if (!invoiceMap.has(invoiceNo)) continue;
        sheetDeliveredQtyByInvoiceNo.set(
          invoiceNo,
          summarizeShipmentProgress(entries).shippedQty
        );
      }

      const deliveredQtyByInvoiceNo = await t.step(
        "aggregateDeliveries",
        async () => {
          const deliveredQtyByInvoiceNo = new Map<string, number>();
          for (const history of histories) {
            if (history.status !== "success") continue;

            type CancelledDeliveryItem = {
              inventoryId?: number;
              quantity?: unknown;
            };
            const items = parseDeliveryItemsJson(history.itemsJson);
            let cancelledItems: CancelledDeliveryItem[] = [];
            try {
              const parsed = JSON.parse(history.cancelledItemsJson || "[]");
              cancelledItems = Array.isArray(parsed) ? parsed : [];
            } catch {
              cancelledItems = [];
            }

            const cancelledByInventoryId = new Map<number, number>();
            for (const item of cancelledItems) {
              const inventoryId = Number(item.inventoryId ?? 0);
              const quantity = Number(item.quantity ?? 0);
              if (inventoryId > 0 && quantity > 0) {
                cancelledByInventoryId.set(
                  inventoryId,
                  (cancelledByInventoryId.get(inventoryId) ?? 0) + quantity
                );
              }
            }

            for (const item of items) {
              const quantity = Number(item.quantity ?? 0);
              if (quantity <= 0) continue;
              const inventoryId =
                item.inventoryId == null ? undefined : Number(item.inventoryId);
              const cancelledQty = inventoryId
                ? (cancelledByInventoryId.get(inventoryId) ?? 0)
                : 0;
              const usedCancelledQty = Math.min(quantity, cancelledQty);
              if (inventoryId && usedCancelledQty > 0) {
                cancelledByInventoryId.set(
                  inventoryId,
                  cancelledQty - usedCancelledQty
                );
              }
              const deliveredQty = Math.max(0, quantity - usedCancelledQty);
              if (deliveredQty <= 0) continue;

              const invoiceNo = resolveDeliveryItemInvoiceNo(
                withAssignedInvoiceNo(item, assignedInvoiceNoMap),
                history.deliveryNo,
                inventoryId ? inventoryManagementNoMap.get(inventoryId) : null
              );
              if (!invoiceNo || !invoiceMap.has(invoiceNo)) continue;
              deliveredQtyByInvoiceNo.set(
                invoiceNo,
                (deliveredQtyByInvoiceNo.get(invoiceNo) ?? 0) + deliveredQty
              );
            }
          }
          return deliveredQtyByInvoiceNo;
        }
      );

      const response = await t.step("buildResponse", async () =>
        Array.from(invoiceMap.values())
          .map(invoice => {
            const totalDeliveredQty = sheetDeliveredQtyByInvoiceNo.has(
              invoice.invoiceNo
            )
              ? (sheetDeliveredQtyByInvoiceNo.get(invoice.invoiceNo) ?? 0)
              : (deliveredQtyByInvoiceNo.get(invoice.invoiceNo) ?? 0);
            const remainingQty = Math.max(
              0,
              invoice.totalOrderQty - totalDeliveredQty
            );
            return {
              ...invoice,
              totalDeliveredQty,
              remainingQty,
            };
          })
          .filter(invoice => invoice.remainingQty > 0)
          .sort((a, b) => Number(b.invoiceNo) - Number(a.invoiceNo))
      );
      t.done({
        orderRowCount: orderRows.length,
        historyCount: histories.length,
        invoiceCount: response.length,
        orderRowsMs,
        deliveryHistoriesMs,
        memosMs,
        shipmentProgressMs,
        inventoryManagementNoMapMs,
        assignedInvoiceNoMapMs,
      });
      return response;
    } catch (err) {
      console.error("getPurchaseRegistrationInvoices error:", err);
      return [];
    }
  }),

  getInvoiceProducts: publicProcedure
    .input(z.object({ invoiceNo: z.string().min(1) }))
    .query(async ({ input }) => {
      const invoiceNo = input.invoiceNo.trim();
      const rawOrderRows = (await getOrderRowsFromTradeRecords()).filter(
        row => row.invoiceNo === invoiceNo
      );
      const orderRows = expandMaxim415416OrderRows(rawOrderRows);
      const csvProducts = orderRows.map(row => ({
        name: row.productName,
        qty: row.orderQty,
      }));
      const shipmentEntries = (
        await getOrderManagementShipmentProgressByInvoice().catch(error => {
          console.warn(
            "[OrderManagement] Failed to load shipment progress sheet",
            error
          );
          return new Map<string, TradeShipmentProgressEntry[]>();
        })
      ).get(invoiceNo);

      type StoredDeliveryItem = {
        inventoryId?: number;
        title?: string;
        quantity?: unknown;
        managementNo?: string | null;
        tradeRecordId?: number | null;
        csvProductName?: string | null;
      };
      type CancelledDeliveryItem = { inventoryId?: number; quantity?: unknown };

      const deliveredByTradeRecordId = new Map<number, number>();
      const deliveredByProductName = new Map<string, number>();
      const inventoryManagementMap = await buildInventoryManagementNoMap();
      // 出庫Noの接頭辞ではなく明細の管理番号で判定する。1箱に複数インボイスが
      // 混ざっていても、このインボイスの明細を持つ出庫は拾う（明細側でも再度絞る）。
      const assignedInvoiceNoMap = await buildAssignedInvoiceNoMap().catch(
        () => new Map<string, string>()
      );
      const deliveryItemInvoiceNo = (
        item: StoredDeliveryItem,
        deliveryNo: string
      ) =>
        resolveDeliveryItemInvoiceNo(
          withAssignedInvoiceNo(item, assignedInvoiceNoMap),
          deliveryNo,
          item.inventoryId
            ? inventoryManagementMap.get(Number(item.inventoryId))
            : null
        );
      const deliveries = (await getAllDeliveryHistories()).filter(history => {
        if (history.status !== "success") return false;
        const items = parseDeliveryItemsJson(
          history.itemsJson
        ) as StoredDeliveryItem[];
        return items.some(
          item => deliveryItemInvoiceNo(item, history.deliveryNo) === invoiceNo
        );
      });

      const addByTradeRecordId = (tradeRecordId: number, quantity: number) => {
        deliveredByTradeRecordId.set(
          tradeRecordId,
          (deliveredByTradeRecordId.get(tradeRecordId) ?? 0) + quantity
        );
      };
      const addByProductName = (productName: string, quantity: number) => {
        const name = productName.trim();
        if (!name) return;
        deliveredByProductName.set(
          name,
          (deliveredByProductName.get(name) ?? 0) + quantity
        );
      };
      const consumeCancelledQuantity = (
        cancelledByInventoryId: Map<number, number>,
        inventoryId: number | undefined,
        quantity: number
      ) => {
        if (!inventoryId) return 0;
        const cancelledQty = cancelledByInventoryId.get(inventoryId) ?? 0;
        const usedQty = Math.min(quantity, cancelledQty);
        if (usedQty > 0)
          cancelledByInventoryId.set(inventoryId, cancelledQty - usedQty);
        return usedQty;
      };

      for (const delivery of deliveries) {
        let items: StoredDeliveryItem[] = [];
        let cancelledItems: CancelledDeliveryItem[] = [];
        try {
          const parsed = JSON.parse(delivery.itemsJson || "[]");
          items = Array.isArray(parsed) ? parsed : [];
        } catch {
          items = [];
        }
        try {
          const parsed = JSON.parse(delivery.cancelledItemsJson || "[]");
          cancelledItems = Array.isArray(parsed) ? parsed : [];
        } catch {
          cancelledItems = [];
        }

        const cancelledByInventoryId = new Map<number, number>();
        const allocationItems: ShipmentGasItem[] = [];
        for (const item of cancelledItems) {
          const inventoryId = Number(item.inventoryId ?? 0);
          const quantity = Number(item.quantity ?? 0);
          if (inventoryId > 0 && quantity > 0) {
            cancelledByInventoryId.set(
              inventoryId,
              (cancelledByInventoryId.get(inventoryId) ?? 0) + quantity
            );
          }
        }

        for (const item of items) {
          const quantity = Number(item.quantity ?? 0);
          if (quantity <= 0) continue;
          // 他インボイス宛の明細が同じ箱に入っていることがある。ここで落とす。
          if (deliveryItemInvoiceNo(item, delivery.deliveryNo) !== invoiceNo)
            continue;
          const inventoryId =
            item.inventoryId == null ? undefined : Number(item.inventoryId);
          const effectiveQuantity =
            quantity -
            consumeCancelledQuantity(
              cancelledByInventoryId,
              inventoryId,
              quantity
            );
          if (effectiveQuantity <= 0) continue;

          const tradeRecordId =
            item.tradeRecordId == null ? null : Number(item.tradeRecordId);
          if (
            tradeRecordId &&
            orderRows.some(row => row.tradeRecordId === tradeRecordId)
          ) {
            addByTradeRecordId(tradeRecordId, effectiveQuantity);
            continue;
          }

          const fallbackManagement = inventoryId
            ? (inventoryManagementMap.get(inventoryId) ?? "")
            : "";
          const storedCsvProductName =
            typeof item.csvProductName === "string"
              ? item.csvProductName.trim()
              : "";
          const title = String(item.title ?? "").trim();
          const managementText = Array.from(
            new Set(
              extractManagementHints(
                item.managementNo,
                fallbackManagement.split(",")[0],
                fallbackManagement,
                delivery.deliveryNo,
                title,
                storedCsvProductName
              )
            )
          ).join(" ");
          const allocationName = storedCsvProductName || title;
          if (allocationName) {
            allocationItems.push({
              productNameJa: allocationName,
              productNameEn: allocationName,
              quantity: effectiveQuantity,
              managementNo: managementText || null,
            });
            continue;
          }

          const suggestion = suggestCsvProduct(
            title,
            String(item.managementNo ?? fallbackManagement),
            csvProducts
          );
          if (suggestion) {
            addByProductName(suggestion.name, effectiveQuantity);
            continue;
          }

          const rawTitle = String(item.title ?? "").trim();
          if (rawTitle) addByProductName(rawTitle, effectiveQuantity);
        }

        const allocatedItems =
          allocationItems.length > 0 && csvProducts.length > 0
            ? allocateShipmentItemsToCsvProducts(allocationItems, csvProducts)
            : allocationItems;
        for (const item of allocatedItems) {
          addByProductName(item.productNameJa, item.quantity);
        }
      }

      const remainingNameDelivered = new Map(deliveredByProductName);
      const consumeDeliveredByProductName = (
        productName: string,
        quantityNeeded: number
      ): number => {
        let allocated = 0;
        const consume = (key: string, quantity: number) => {
          const remaining = Math.max(0, quantityNeeded - allocated);
          if (remaining <= 0 || quantity <= 0) return;
          const used = Math.min(remaining, quantity);
          allocated += used;
          if (used > 0) remainingNameDelivered.set(key, quantity - used);
        };

        const exactKey = productName.trim();
        if (exactKey) {
          consume(exactKey, remainingNameDelivered.get(exactKey) ?? 0);
        }
        if (allocated >= quantityNeeded) return allocated;

        for (const [key, quantity] of Array.from(
          remainingNameDelivered.entries()
        )) {
          if (key === exactKey || quantity <= 0) continue;
          if (
            !deliveryProductNameMatchesOrderProduct(
              key,
              productName,
              csvProducts
            )
          )
            continue;
          consume(key, quantity);
          if (allocated >= quantityNeeded) break;
        }
        return allocated;
      };
      const sheetAllocations = shipmentEntries?.length
        ? allocateShipmentProgressToProducts(orderRows, shipmentEntries)
        : null;
      const products = orderRows.map((row, index) => {
        const deliveredQty = sheetAllocations
          ? (sheetAllocations[index]?.shippedQty ?? 0)
          : (() => {
              const byId = row.tradeRecordId
                ? (deliveredByTradeRecordId.get(row.tradeRecordId) ?? 0)
                : 0;
              const allocatedByName = consumeDeliveredByProductName(
                row.productName,
                Math.max(0, row.orderQty - byId)
              );
              return byId + allocatedByName;
            })();
        return {
          tradeRecordId: row.tradeRecordId,
          productName: row.productName,
          orderQty: row.orderQty,
          deliveredQty,
          remainingQty: Math.max(0, row.orderQty - deliveredQty),
          sellingPrice: row.sellingPrice,
          sellingPriceJpy: row.sellingPriceJpy,
          currency: row.currency,
          paymentDate: row.paymentDate,
          status: row.status,
        };
      });

      return {
        invoiceNo,
        products,
        totalOrderQty: products.reduce(
          (sum, product) => sum + product.orderQty,
          0
        ),
        totalDeliveredQty: products.reduce(
          (sum, product) => sum + product.deliveredQty,
          0
        ),
      };
    }),

  receivePurchaseLabel: publicProcedure
    .input(
      z.object({
        labelId: z.string().min(1).max(80),
        operatorName: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const labelId = input.labelId.trim().toUpperCase();
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });

      const { inventoryItemLabels: labelTbl } = await import(
        "../../drizzle/schema"
      );
      const [label] = await db
        .select()
        .from(labelTbl)
        .where(eq(labelTbl.labelId, labelId))
        .limit(1);
      if (!label) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `商品ID ${labelId} が見つかりません`,
        });
      }

      const currentStatus = String(label.status ?? "")
        .trim()
        .toLowerCase();
      const alreadyReceived = isReceivedLabelStatus(currentStatus);
      const localInventoryId = label.localInventoryId ?? null;
      const inventory = localInventoryId
        ? await getLocalInventoryByZaicoIdOrId(localInventoryId)
        : null;
      const labelManagementNo = String(
        label.legacyManagementNo ??
          getInventoryManagementNo(inventory?.etc) ??
          ""
      ).trim();
      let purchase: LocalPurchaseRow | null = label.purchaseId
        ? await getLocalPurchaseById(label.purchaseId)
        : null;
      if (!purchase && localInventoryId) {
        const candidatePurchases = (await getLocalPurchases()).filter(row =>
          localPurchaseMatchesInventoryLabel(
            row,
            localInventoryId,
            labelManagementNo
          )
        );
        purchase =
          candidatePurchases.find(row => row.status !== "purchased") ??
          candidatePurchases[0] ??
          null;
      }
      const today = new Date().toISOString().slice(0, 10);
      const operatorName = resolveWorkOperatorName(
        input.operatorName,
        ctx.user?.name ?? ctx.user?.email ?? null
      );

      const markPurchaseReceivedIfReady = async () => {
        if (!purchase || purchase.status === "purchased") return;
        let labelsForPurchase = await db
          .select()
          .from(labelTbl)
          .where(eq(labelTbl.purchaseId, purchase.id));
        if (labelsForPurchase.length === 0 && purchase.localInventoryId) {
          const inventoryLabels = await db
            .select()
            .from(labelTbl)
            .where(eq(labelTbl.localInventoryId, purchase.localInventoryId));
          labelsForPurchase = filterLabelsByManagementNo(
            inventoryLabels,
            String(purchase.managementNo ?? labelManagementNo ?? "").trim()
          );
        } else {
          labelsForPurchase = filterLabelsByManagementNo(
            labelsForPurchase,
            String(purchase.managementNo ?? labelManagementNo ?? "").trim()
          );
        }

        const relevantLabels =
          labelsForPurchase.length > 0 ? labelsForPurchase : [label];
        const requiredQuantity = Math.max(
          1,
          Math.floor(Number(purchase.quantity ?? 1)) || 1
        );
        const receivedCount = relevantLabels.filter(
          row => row.id === label.id || isReceivedLabelStatus(row.status)
        ).length;
        if (
          receivedCount >= Math.min(requiredQuantity, relevantLabels.length)
        ) {
          await updateLocalPurchaseStatus(purchase.id, "purchased", today);
          purchase = { ...purchase, status: "purchased", receivedDate: today };
        }
      };

      if (!alreadyReceived) {
        const now = new Date();
        await db
          .update(labelTbl)
          .set({ status: "received", receivedAt: label.receivedAt ?? now })
          .where(eq(labelTbl.id, label.id));

        if (inventory) {
          await updateLocalInventory(inventory.id, {
            quantity: Number(inventory.quantity ?? 0) + 1,
          });
        }

        const historyZaicoId =
          purchase?.zaicoId ??
          purchase?.id ??
          inventory?.zaicoId ??
          inventory?.id ??
          localInventoryId;
        if (historyZaicoId) {
          const historyManagementNo =
            label.legacyManagementNo ??
            purchase?.managementNo ??
            getInventoryManagementNo(inventory?.etc) ??
            null;
          const historyTitle =
            label.title || purchase?.title || inventory?.title || labelId;
          const historyCategory =
            purchase?.category ?? inventory?.category ?? null;
          const historySupplier =
            purchase?.supplierName ?? inventory?.supplierName ?? null;
          const historyUnitPrice =
            purchase?.unitPrice == null
              ? inventory?.unitPrice == null
                ? null
                : String(inventory.unitPrice)
              : String(purchase.unitPrice);
          await createPurchaseHistory({
            zaicoId: historyZaicoId,
            kanriNo: historyManagementNo,
            title: historyTitle,
            category: historyCategory,
            supplier: historySupplier,
            quantity: "1",
            unitPrice: historyUnitPrice,
            purchaseDate: today,
            inventoryId: inventory?.id ?? localInventoryId,
            cancelled: 0,
            operatorName,
          });

          await recordWorkLog({
            workerName: operatorName,
            category: "入庫登録",
            status: "done",
            startedAt: now,
            endedAt: now,
            quantity: 1,
            memo: `商品ID: ${labelId}`,
            createdBy: operatorName,
            sourceType: "purchase-label",
            sourceId: labelId,
            detailsJson: JSON.stringify({
              labelId,
              purchaseId: purchase?.id ?? null,
              inventoryId: inventory?.id ?? localInventoryId,
              managementNo: historyManagementNo,
            }),
          });
        }
      } else {
        const historyZaicoId =
          purchase?.zaicoId ??
          purchase?.id ??
          inventory?.zaicoId ??
          inventory?.id ??
          localInventoryId;
        if (historyZaicoId) {
          const { purchaseHistories: purchaseHistoriesTbl } = await import(
            "../../drizzle/schema"
          );
          const historyManagementNo =
            label.legacyManagementNo ??
            purchase?.managementNo ??
            getInventoryManagementNo(inventory?.etc) ??
            null;
          const historyTitle =
            label.title || purchase?.title || inventory?.title || labelId;
          const existingHistory = await db
            .select({ id: purchaseHistoriesTbl.id })
            .from(purchaseHistoriesTbl)
            .where(
              and(
                eq(purchaseHistoriesTbl.zaicoId, historyZaicoId),
                eq(purchaseHistoriesTbl.title, historyTitle),
                eq(purchaseHistoriesTbl.cancelled, 0)
              )
            )
            .limit(1);

          if (existingHistory.length === 0) {
            const now = new Date();
            const receivedAt = label.receivedAt
              ? new Date(label.receivedAt)
              : now;
            const purchaseDate = Number.isNaN(receivedAt.getTime())
              ? today
              : receivedAt.toISOString().slice(0, 10);
            const historyCategory =
              purchase?.category ?? inventory?.category ?? null;
            const historySupplier =
              purchase?.supplierName ?? inventory?.supplierName ?? null;
            const historyUnitPrice =
              purchase?.unitPrice == null
                ? inventory?.unitPrice == null
                  ? null
                  : String(inventory.unitPrice)
                : String(purchase.unitPrice);

            await createPurchaseHistory({
              zaicoId: historyZaicoId,
              kanriNo: historyManagementNo,
              title: historyTitle,
              category: historyCategory,
              supplier: historySupplier,
              quantity: "1",
              unitPrice: historyUnitPrice,
              purchaseDate,
              inventoryId: inventory?.id ?? localInventoryId,
              cancelled: 0,
              operatorName,
            });

            await recordWorkLog({
              workerName: operatorName,
              category: "入庫登録",
              status: "done",
              startedAt: now,
              endedAt: now,
              quantity: 1,
              memo: `商品ID: ${labelId} / 履歴補完`,
              createdBy: operatorName,
              sourceType: "purchase-label",
              sourceId: labelId,
              detailsJson: JSON.stringify({
                labelId,
                purchaseId: purchase?.id ?? null,
                inventoryId: inventory?.id ?? localInventoryId,
                managementNo: historyManagementNo,
                recoveredHistory: true,
              }),
            });
          }
        }
      }

      await markPurchaseReceivedIfReady();

      const [updatedLabel] = await db
        .select()
        .from(labelTbl)
        .where(eq(labelTbl.id, label.id))
        .limit(1);
      return {
        labelId,
        alreadyReceived,
        status:
          updatedLabel?.status ?? (alreadyReceived ? label.status : "received"),
        title: updatedLabel?.title ?? label.title,
        legacyManagementNo:
          updatedLabel?.legacyManagementNo ?? label.legacyManagementNo,
        purchaseId:
          updatedLabel?.purchaseId ?? label.purchaseId ?? purchase?.id ?? null,
        localInventoryId:
          updatedLabel?.localInventoryId ?? label.localInventoryId,
        inventoryQuantity: inventory
          ? Number(inventory.quantity ?? 0) + (alreadyReceived ? 0 : 1)
          : null,
      };
    }),

  /**
   * 管理番号の先頭数字をキーに、発注済み数・出庫済み数・在庫数を集計する
   * 出庫 No の先頭数字（_ より前）と管理番号の先頭数字を照合
   * CSVのインボイスNoとも照合して発注数・取引先を追加
   */
  backfillDeliveryOrderLines: publicProcedure
    .input(
      z
        .object({
          dryRun: z.boolean().optional(),
          overwrite: z.boolean().optional(),
          limit: z.number().int().positive().max(5000).optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      const dryRun = input?.dryRun ?? false;
      const overwrite = input?.overwrite ?? false;
      const limit = input?.limit ?? 2000;
      const orderRows = await getOrderRowsFromTradeRecords();
      const rowsByInvoice = new Map<string, OrderCsvRow[]>();
      for (const row of orderRows) {
        const list = rowsByInvoice.get(row.invoiceNo) ?? [];
        list.push(row);
        rowsByInvoice.set(row.invoiceNo, list);
      }

      const timeOf = (value: unknown) =>
        value instanceof Date
          ? value.getTime()
          : new Date(String(value)).getTime();
      const histories = (await getAllDeliveryHistories())
        .slice(0, limit)
        .filter(history => history.status === "success")
        .sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt));
      const inventoryManagementMap = await buildInventoryManagementNoMap();
      const remainingByTradeRecordId = new Map<number, number>();
      for (const row of orderRows) {
        if (row.tradeRecordId)
          remainingByTradeRecordId.set(row.tradeRecordId, row.orderQty);
      }

      let scannedHistories = 0;
      let scannedItems = 0;
      let updatedHistories = 0;
      let updatedItems = 0;
      let alreadyLinkedItems = 0;
      let skippedNoInvoice = 0;
      let skippedNoRows = 0;
      let skippedNoMatch = 0;

      const consumeLinkedQuantity = (item: StoredDeliveryItem) => {
        const tradeRecordId =
          item.tradeRecordId == null ? null : Number(item.tradeRecordId);
        if (!tradeRecordId) return;
        const quantity = Number(item.quantity ?? 0) || 0;
        if (quantity <= 0) return;
        remainingByTradeRecordId.set(
          tradeRecordId,
          Math.max(
            0,
            (remainingByTradeRecordId.get(tradeRecordId) ?? 0) - quantity
          )
        );
      };

      for (const history of histories) {
        scannedHistories += 1;
        const invoiceNo = invoiceNoFromDeliveryNo(history.deliveryNo);
        const items = parseDeliveryItemsJson(history.itemsJson);
        if (!invoiceNo) {
          skippedNoInvoice += items.length;
          continue;
        }
        const rows = rowsByInvoice.get(invoiceNo);
        if (!rows || rows.length === 0) {
          skippedNoRows += items.length;
          continue;
        }

        const csvProducts = rows.map(row => ({
          name: row.productName,
          qty: row.orderQty,
        }));
        let hasChange = false;
        const nextItems = items.map(item => {
          scannedItems += 1;
          const quantity = Number(item.quantity ?? 0) || 0;
          if (quantity <= 0) return item;

          const hasExistingLink =
            item.tradeRecordId != null || item.csvProductName !== undefined;
          if (hasExistingLink && !overwrite) {
            alreadyLinkedItems += 1;
            consumeLinkedQuantity(item);
            return item;
          }

          const inventoryId =
            item.inventoryId == null ? null : Number(item.inventoryId);
          const fallbackManagement = inventoryId
            ? (inventoryManagementMap.get(inventoryId) ?? "")
            : "";
          const managementNo = String(
            item.managementNo || fallbackManagement.split(",")[0] || ""
          ).trim();
          const managementHints = extractManagementHints(
            managementNo,
            fallbackManagement,
            history.deliveryNo
          );
          const suggestionName =
            suggestCsvProductNameFromHints("", managementHints, csvProducts) ??
            suggestCsvProductNameFromHints(
              String(item.title ?? ""),
              managementHints,
              csvProducts
            );
          if (!suggestionName) {
            skippedNoMatch += 1;
            return item;
          }

          const candidateRows = rows.filter(
            row => row.productName === suggestionName
          );
          const chosenRow =
            candidateRows.find(
              row =>
                row.tradeRecordId &&
                (remainingByTradeRecordId.get(row.tradeRecordId) ?? 0) >=
                  quantity
            ) ??
            candidateRows.find(
              row =>
                row.tradeRecordId &&
                (remainingByTradeRecordId.get(row.tradeRecordId) ?? 0) > 0
            ) ??
            candidateRows[0];
          if (!chosenRow) {
            skippedNoMatch += 1;
            return item;
          }

          if (chosenRow.tradeRecordId) {
            remainingByTradeRecordId.set(
              chosenRow.tradeRecordId,
              Math.max(
                0,
                (remainingByTradeRecordId.get(chosenRow.tradeRecordId) ?? 0) -
                  quantity
              )
            );
          }

          const nextItem = {
            ...item,
            csvProductName: suggestionName,
            ...(chosenRow.tradeRecordId
              ? { tradeRecordId: chosenRow.tradeRecordId }
              : {}),
            ...(!item.managementNo && managementNo ? { managementNo } : {}),
          };
          const changed =
            item.csvProductName !== nextItem.csvProductName ||
            item.tradeRecordId !== nextItem.tradeRecordId ||
            item.managementNo !== nextItem.managementNo;
          if (changed) {
            hasChange = true;
            updatedItems += 1;
          }
          return nextItem;
        });

        if (hasChange) {
          updatedHistories += 1;
          if (!dryRun) {
            await updateDeliveryHistoryItemsJson(
              history.id,
              JSON.stringify(nextItems)
            );
          }
        }
      }

      return {
        dryRun,
        overwrite,
        scannedHistories,
        scannedItems,
        updatedHistories,
        updatedItems,
        alreadyLinkedItems,
        skippedNoInvoice,
        skippedNoRows,
        skippedNoMatch,
      };
    }),

  getSummary: publicProcedure.query(async () => {
    const zaicoEnabled = await isZaicoEnabled();
    type CsvRow = {
      partner: string;
      invoiceNo: string;
      productName: string;
      orderQty: number;
      status: string;
      paymentDate: string;
    };
    const deliveriesPromise = getDeliveryHistories(1000);
    const allMemosPromise = getAllInvoiceMemos();
    const shipmentProgressPromise =
      getOrderManagementShipmentProgressByInvoice().catch(error => {
        console.warn(
          "[OrderManagement] Failed to load shipment progress sheet",
          error
        );
        return new Map<string, TradeShipmentProgressEntry[]>();
      });
    const csvRowsPromise: Promise<CsvRow[]> =
      getOrderRowsFromTradeRecords().catch(e => {
        console.error("Trade order data error:", e);
        return [];
      });
    // 1. 発注済み入庫一覧（ordered + purchased）を取得
    let allPurchases: Array<{
      id: number;
      num: string;
      status: string;
      purchase_items: Array<{
        inventory_id?: number | null;
        title: string;
        quantity: string;
        unit_price?: string | number | null;
        etc?: string | null;
      }>;
    }>;
    if (!zaicoEnabled) {
      const [localPurchaseRows, _purchaseHistForStatus] = await Promise.all([
        getLocalPurchases(),
        getPurchaseHistories(2000),
      ]);
      // purchase_historiesから有効な入庫履歴（cancelled=0）のzaicoIdセットを構築（ステータス証明用）
      const _purchasedIds = new Set<number>(
        _purchaseHistForStatus
          .filter(h => h.cancelled === 0 && h.zaicoId != null)
          .map(h => h.zaicoId as number)
      );
      allPurchases = localPurchaseRows.map(p => {
        const fallbackItem = {
          inventory_id: p.localInventoryId ?? null,
          title: p.title ?? "",
          quantity: String(p.quantity ?? 1),
          unit_price: p.unitPrice != null ? Number(p.unitPrice) : null,
          etc: p.managementNo ?? null,
        };
        let items: Array<{
          inventory_id?: number | null;
          title: string;
          quantity: string;
          unit_price?: string | number | null;
          etc?: string | null;
        }> = [];
        try {
          const parsed = JSON.parse(p.itemsJson ?? "[]");
          const parsedItems = Array.isArray(parsed) ? parsed : [];
          items = (parsedItems.length > 0 ? parsedItems : [fallbackItem]).map(
            raw => {
              const item = raw as Record<string, unknown>;
              return {
                inventory_id:
                  typeof item.inventory_id === "number"
                    ? item.inventory_id
                    : typeof item.inventoryId === "number"
                      ? item.inventoryId
                      : (p.localInventoryId ?? null),
                title: String(item.title ?? p.title ?? ""),
                quantity: String(item.quantity ?? p.quantity ?? 1),
                unit_price: (item.unit_price ??
                  item.unitPrice ??
                  p.unitPrice ??
                  null) as string | number | null,
                etc: (item.etc ??
                  item.managementNo ??
                  p.managementNo ??
                  null) as string | null,
              };
            }
          );
        } catch {
          items = [fallbackItem];
        }
        const localId = p.zaicoId ?? p.id;
        const isPurchased =
          p.status === "purchased" || _purchasedIds.has(localId);
        return {
          id: localId,
          num: p.purchaseNum ?? "",
          status: isPurchased ? "purchased" : "ordered",
          purchase_items: items,
        };
      });
    } else {
      allPurchases = await getPurchases();
    }
    // 2. 在庫一覧を取得
    let inventories: Array<{
      id: number;
      title: string;
      quantity: string;
      etc?: string | null;
    }>;
    if (!zaicoEnabled) {
      const localInvRows = await getLocalInventories();
      inventories = localInvRows.map(inv => ({
        id: inv.zaicoId ?? inv.id,
        title: inv.title,
        quantity: String(inv.quantity ?? 0),
        etc: inv.etc ?? null,
      }));
    } else {
      inventories = await getInventories();
    }
    // 3. 出庫履歴を全件取得
    const deliveries = await deliveriesPromise;
    const shipmentProgressByInvoice = await shipmentProgressPromise;
    // 5. 全インボイスの手動完了フラグを取得
    const allMemos = await allMemosPromise;
    const manualCompleteSet = new Set<string>(
      allMemos
        .filter(m => m.colorKey === "__manual_complete__" && m.memo === "1")
        .map(m => m.invoiceKey)
    );
    // 4. GitHub CSVからインボイスNo・取引先・発注数を取得
    const csvRows = await csvRowsPromise;
    // CSVインボイスNoマップ: invoiceNo -> { partner, totalOrderQty, products }
    type CsvInvoice = {
      partner: string;
      totalOrderQty: number;
      products: Array<{
        name: string;
        qty: number;
        status: string;
        paymentDate: string;
      }>;
    };
    const csvInvoiceMap = new Map<string, CsvInvoice>();
    for (const row of csvRows) {
      const existing = csvInvoiceMap.get(row.invoiceNo);
      if (existing) {
        existing.totalOrderQty += row.orderQty;
        existing.products.push({
          name: row.productName,
          qty: row.orderQty,
          status: row.status,
          paymentDate: row.paymentDate,
        });
      } else {
        csvInvoiceMap.set(row.invoiceNo, {
          partner: row.partner,
          totalOrderQty: row.orderQty,
          products: [
            {
              name: row.productName,
              qty: row.orderQty,
              status: row.status,
              paymentDate: row.paymentDate,
            },
          ],
        });
      }
    }

    // 管理番号の先頭数字を抽出する関数
    // etc フィールド: "管理番号, 日付, 仕入先"
    function extractKey(etc?: string | null): string | null {
      if (!etc) return null;
      const raw = etc.split(",")[0]?.trim() ?? "";
      // 数字始まりまたは「在庫」始まりのみ対象
      if (!/^\d/.test(raw) && !/^在庫/.test(raw)) return null;
      // 先頭の数字部分を抽出（_ または - または 空白で区切る）
      return invoiceNoPrefixFromDeliveryNo(raw);
    }

    // 出庫 No から先頭数字を抽出する関数
    function extractKeyFromDeliveryNo(deliveryNo: string): string | null {
      return invoiceNoPrefixFromDeliveryNo(deliveryNo);
    }

    // キー別に集計マップを構築
    type GroupData = {
      key: string;
      partner: string; // 取引先名（CSVから）
      csvOrderQty: number; // CSVの発注数
      csvStatus: string; // CSVの状況（complete等）
      manualComplete: boolean; // 手動完了フラグ
      csvProducts: Array<{
        name: string;
        qty: number;
        status: string;
        paymentDate: string;
      }>; // CSVの商品明細
      orderedCount: number; // 発注済み数（ordered）
      purchasedCount: number; // 入庫済み数（purchased）
      deliveredCount: number; // 出庫済み数
      stockCount: number; // 在庫数
      shipmentProgressSource: "sheet" | "delivery_history";
      purchaseItems: Array<{
        purchaseId: number;
        num: string;
        title: string;
        quantity: number;
        status: string;
        managementNo: string;
      }>;
      inventoryItems: Array<{
        inventoryId: number;
        title: string;
        quantity: number;
        managementNo: string;
        etc: string;
        unitPrice: string;
        trackingNumber: string;
        supplierUrl: string;
        supplierName: string;
      }>;
      deliveryItems: Array<{
        deliveryNo: string;
        title: string;
        quantity: number;
        deliveredAt: string;
        managementNo: string;
        unitPrice: string;
        trackingNumber: string;
        supplierUrl: string;
        supplierName: string;
        tradeRecordId?: number | null;
        csvProductName?: string | null;
      }>;
      sheetShipmentItems: Array<{
        deliveryNo: string;
        title: string;
        quantity: number;
        deliveredAt: string;
        managementNo: string;
        unitPrice: string;
        trackingNumber: string;
        supplierUrl: string;
        supplierName: string;
        tradeRecordId?: number | null;
        csvProductName?: string | null;
      }>;
    };

    const groups = new Map<string, GroupData>();

    function getOrCreate(key: string): GroupData {
      if (!groups.has(key)) {
        // CSVインボイスマップから取引先・発注数・状況を取得
        const csvData = csvInvoiceMap.get(key);
        // 全商品がcompleteならcomplete
        const allComplete = csvData?.products.length
          ? csvData.products.every(p => p.status === "complete")
          : false;
        groups.set(key, {
          key,
          partner: csvData?.partner ?? "その他",
          csvOrderQty: csvData?.totalOrderQty ?? 0,
          csvStatus: allComplete ? "complete" : "",
          manualComplete: manualCompleteSet.has(key),
          csvProducts: csvData?.products ?? [],
          orderedCount: 0,
          purchasedCount: 0,
          deliveredCount: 0,
          stockCount: 0,
          shipmentProgressSource: "delivery_history",
          purchaseItems: [],
          inventoryItems: [],
          deliveryItems: [],
          sheetShipmentItems: [],
        });
      }
      return groups.get(key)!;
    }

    // CSVインボイスマップにあるキーを先に登録（CSVのインボイスNoが存在するキーを必ず表示）
    for (const invoiceNo of Array.from(csvInvoiceMap.keys())) {
      getOrCreate(invoiceNo);
    }

    const invoiceNosWithShipmentSheetRows = new Set<string>();
    for (const [invoiceNo, entries] of shipmentProgressByInvoice.entries()) {
      const groupData = groups.get(invoiceNo);
      if (!groupData || entries.length === 0) continue;

      invoiceNosWithShipmentSheetRows.add(invoiceNo);
      groupData.deliveredCount = summarizeShipmentProgress(entries).shippedQty;
      groupData.shipmentProgressSource = "sheet";

      const productTotals = buildShipmentProgressProductTotals(
        groupData.csvProducts.map(product => ({
          name: product.name,
          qty: product.qty,
        })),
        entries
      );
      groupData.sheetShipmentItems = Array.from(productTotals.entries())
        .filter(([, total]) => total.shippedQty > 0)
        .map(([productName, total]) => ({
          deliveryNo: "スプシ発送管理",
          title: productName,
          quantity: total.shippedQty,
          deliveredAt: "",
          managementNo: "",
          unitPrice: "",
          trackingNumber: "",
          supplierUrl: "",
          supplierName: "",
          tradeRecordId: null,
          csvProductName: productName,
        }));
    }

    // 発注データを集計
    for (const purchase of allPurchases) {
      for (const item of purchase.purchase_items) {
        const key = extractKey(item.etc);
        if (!key) continue;
        const g = getOrCreate(key);
        const qty = parseFloat(item.quantity) || 1;
        if (purchase.status === "ordered") {
          g.orderedCount += qty;
        } else if (purchase.status === "purchased") {
          g.purchasedCount += qty;
        }
        // 発注一覧には未入庫の発注済み/発送済みだけを表示する。入庫済みは在庫一覧側で表示する。
        if (purchase.status !== "purchased") {
          g.purchaseItems.push({
            purchaseId: purchase.id,
            num: purchase.num,
            title: item.title,
            quantity: qty,
            status: purchase.status,
            managementNo: item.etc?.split(",")[0]?.trim() ?? "",
          });
        }
      }
    }

    // ============================================================
    // 在庫商品がCSV商品名にマッチするか判定する関数群
    // ============================================================

    // 周辺機器・アクセサリーキーワード（ゲーム機本体ではないものを除外）
    const ACCESSORY_KEYWORDS = [
      "タッチペン",
      "バッテリー",
      "ケース",
      "カバー",
      "ケーブル",
      "アダプター",
      "コントローラー",
      "スタンド",
      "プロテクター",
      "charger",
      "battery",
      "cable",
      "case",
      "stylus",
    ];
    function isAccessory(title: string): boolean {
      const t = title.toLowerCase();
      return ACCESSORY_KEYWORDS.some(kw => t.includes(kw.toLowerCase()));
    }

    // 商品名から機種を抽出（長いパターンを優先）
    function extractModelFromTitle(title: string): string {
      const t = title.toLowerCase();
      if (t.includes("new 2ds ll") || t.includes("new2dsll")) return "New2DSLL";
      if (
        t.includes("vita 2000") ||
        t.includes("vita2000") ||
        (t.includes("vita") && t.includes("2000"))
      )
        return "Vita2000";
      if (
        t.includes("vita 1000") ||
        t.includes("vita1000") ||
        (t.includes("vita") && !t.includes("2000"))
      )
        return "Vita1000";
      if (
        t.includes("new 3ds ll") ||
        t.includes("new 3dsll") ||
        t.includes("new3ds ll") ||
        t.includes("new3dsll")
      )
        return "New3DSLL";
      if ((t.includes("new 3ds") || t.includes("new3ds")) && !t.includes("ll"))
        return "New3DS";
      if (t.includes("2ds") && !t.includes("new") && !t.includes("ll"))
        return "2DS";
      if ((t.includes("3ds ll") || t.includes("3dsll")) && !t.includes("new"))
        return "3DSLL";
      if (t.includes("3ds") && !t.includes("ll") && !t.includes("new"))
        return "3DS";
      if (t.includes("ds lite") || t.includes("dslite")) return "DSLite";
      if (t.includes("dsi ll") || t.includes("dsi xl") || t.includes("dsill"))
        return "DSiLL";
      if (t.includes("dsi")) return "DSi";
      if (t.includes("psp")) return "PSP";
      if (t.includes("ps5")) return "PS5";
      if (t.includes("ps4")) return "PS4";
      return "";
    }

    // 商品名からカラー部分を抽出（メーカー名・機種名プレフィックスを除去）
    // 例: "toynet PS Vita2000 グレイシャー・ホワイト" -> "グレイシャー・ホワイト"
    function extractColorFromName(name: string): string {
      const trimmed = name.trim();
      // まずメーカー名・ブランド名プレフィックスを除去（先頭の非機種名ワードを除去）
      const brandPattern =
        /^(?:toynet|hori|pdp|cyber|nintendo|sony|sega|microsoft|\w+net)\s+/i;
      let working = trimmed.replace(brandPattern, "").trim();

      const modelPatterns = [
        /^new\s*2ds\s*ll\s*/i,
        /^new\s*3ds\s*ll\s*/i,
        /^new\s*3ds\s*/i,
        /^2ds\s*/i,
        /^3ds\s*ll\s*/i,
        /^3ds\s*/i,
        /^ds\s*lite\s*/i,
        /^dslite\s*/i,
        /^dsi\s*ll\s*/i,
        /^dsi\s*/i,
        /^ps\s*vita\s*2000\s*/i,
        /^ps\s*vita\s*1000\s*/i,
        /^ps\s*vita\s*/i,
        /^vita\s*2000\s*/i,
        /^vita\s*1000\s*/i,
        /^vita\s*/i,
        /^psp\s*(?:go\s*)?/i,
        /^ps5\s*/i,
        /^ps4\s*/i,
      ];
      // 元の文字列とブランド除去後の両方で試す
      for (const source of [working, trimmed]) {
        for (const pat of modelPatterns) {
          if (pat.test(source)) {
            const result = source.replace(pat, "").trim();
            if (result) return result;
          }
        }
      }
      // どのパターンにも一致しない場合は元の文字列をそのまま返す
      return trimmed;
    }

    // カラーが「ランダムカラー」か判定
    function isRandomColorName(colorName: string): boolean {
      const c = colorName.toLowerCase();
      return (
        c.includes("ランダム") || c.includes("random") || c.includes("ramdom")
      );
    }

    // カラーが「○○ベース」か判定し、ベース色を返す（例: "ホワイトベース" → "ホワイト"）
    function normalizeColorToken(value: string): string {
      return value
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
    }

    function isColorlessRandomColorName(colorName: string): boolean {
      if (!colorName.normalize("NFKC").trim()) return true;
      const compact = normalizeColorToken(colorName);
      if (!compact) return false;
      if (
        /^(psp|pspgo|ps5|ps4|psvita|vita|vita1000|vita2000|new3dsll|new3ds|new2dsll|2ds|3dsll|3ds|dslite|dsill|dsi)$/.test(
          compact
        )
      )
        return true;
      if (/^\d{3,4}$/.test(compact)) return true;
      if (/^(?:\d{3,4})?(?:grade|rank)[abc]$/.test(compact)) return true;
      if (/^\d{3,4}(?:only|body|console|unit|set)$/.test(compact)) return true;
      return false;
    }

    function colorlessQualifierMatches(
      colorName: string,
      title: string,
      managementNo = ""
    ): boolean {
      const compactColor = normalizeColorToken(colorName);
      const compactTarget = normalizeColorToken(`${title} ${managementNo}`);
      const version = compactColor.match(/(?:1000|2000|3000)/)?.[0];
      if (version && !compactTarget.includes(version)) return false;
      const grade = compactColor.match(/(?:grade|rank)([abc])/)?.[1];
      if (
        grade &&
        !compactTarget.includes(`grade${grade}`) &&
        !compactTarget.includes(`rank${grade}`)
      )
        return false;
      return true;
    }

    function isOtherColorName(colorName: string): boolean {
      const c = colorName.normalize("NFKC").trim().toLowerCase();
      return (
        c === "other" ||
        c.includes("other color") ||
        c.includes("その他") ||
        c.includes("それ以外") ||
        c.includes("以外")
      );
    }

    function hasLimitedEditionMarker(
      value: string | null | undefined
    ): boolean {
      const v = (value ?? "").normalize("NFKC").toLowerCase();
      return (
        v.includes("限定版") ||
        v.includes("limited") ||
        v.includes("special edition")
      );
    }

    function extractBaseColor(colorName: string): string | null {
      const m = colorName.match(/^(.+?)ベース$/);
      return m ? m[1].trim() : null;
    }

    // 在庫商品名がCSV商品名にマッチするか判定（管理番号も参照可能）
    // csvProductName: CSVの商品名（例: "New3DS ランダムカラー"、"Vita 1000 レッド&ブルー"）
    // invTitle: Zaico在庫商品名（例: "Vita1000 コズミックレッド"）
    // invManagementNo: Zaico在庫管理番号（例: "369_ルカ_レッド_3/10"）
    function invMatchesCsvProduct(
      csvProductName: string,
      invTitle: string,
      invManagementNo?: string
    ): boolean {
      const managementHints = extractManagementHints(invManagementNo, invTitle);
      if (
        !inventoryItemCanMatchCsvProduct(
          `${invTitle} ${invManagementNo ?? ""}`,
          csvProductName
        )
      )
        return false;
      return (
        suggestCsvProductNameFromHints("", managementHints, [
          { name: csvProductName, qty: 1 },
        ]) === csvProductName ||
        suggestCsvProductNameFromHints(invTitle, managementHints, [
          { name: csvProductName, qty: 1 },
        ]) === csvProductName
      );
    }

    // inventoryId -> 仕入情報マップ（入庫履歴の最新レコードを使用）
    // 在庫集計ループ前に構築する必要がある
    type PurchaseInfo = {
      unitPrice: string;
      trackingNumber: string;
      supplierUrl: string;
      supplierName: string;
    };
    const purchaseInfoMap = new Map<number, PurchaseInfo>();
    const _deletedInvListForInfo = await getDeletedInventories(1000);
    const _purchaseHistListForInfo = await getPurchaseHistories(1000);
    for (const ph of _purchaseHistListForInfo) {
      if (ph.inventoryId && !purchaseInfoMap.has(ph.inventoryId)) {
        purchaseInfoMap.set(ph.inventoryId, {
          unitPrice: ph.unitPrice ?? "",
          trackingNumber:
            (ph as { trackingNumber?: string | null }).trackingNumber ?? "",
          supplierUrl:
            (ph as { supplierUrl?: string | null }).supplierUrl ?? "",
          supplierName:
            (ph as { supplierName?: string | null }).supplierName ?? "",
        });
      }
    }
    for (const del of _deletedInvListForInfo) {
      if (del.zaicoId && !purchaseInfoMap.has(del.zaicoId)) {
        const matchPh = _purchaseHistListForInfo.find(
          ph => ph.inventoryId === del.zaicoId
        );
        if (matchPh) {
          purchaseInfoMap.set(del.zaicoId, {
            unitPrice: matchPh.unitPrice ?? "",
            trackingNumber:
              (matchPh as { trackingNumber?: string | null }).trackingNumber ??
              "",
            supplierUrl:
              (matchPh as { supplierUrl?: string | null }).supplierUrl ?? "",
            supplierName:
              (matchPh as { supplierName?: string | null }).supplierName ?? "",
          });
        }
      }
    }

    // local_inventoriesからzaicoIdベースの仕入先・仕入単価をフォールバックとして取得
    // 入庫履歴がない商品でもDBに同期済みの仕入先・仕入単価を表示するため
    const allInvZaicoIds = inventories
      .map((inv: { id: number }) => inv.id)
      .filter((id: number) => id > 0);
    const localInvInfoMap =
      await getLocalInventoryInfoByZaicoIds(allInvZaicoIds);
    // purchaseInfoMapにない商品はlocal_inventoriesから補完
    for (const [zaicoId, info] of Array.from(localInvInfoMap.entries())) {
      if (
        !purchaseInfoMap.has(zaicoId) &&
        (info.unitPrice || info.supplierName || info.supplierUrl)
      ) {
        purchaseInfoMap.set(zaicoId, {
          unitPrice: info.unitPrice,
          trackingNumber: "",
          supplierUrl: info.supplierUrl,
          supplierName: info.supplierName,
        });
      }
    }
    // 在庫データを集計（在庫0は除外）
    for (const inv of inventories) {
      const qty = parseFloat(inv.quantity) || 0;
      if (qty <= 0) continue;

      // 周辺機器・アクセサリーは除外
      if (isAccessory(inv.title)) continue;

      // まずetcフィールドからインボイスNoを抽出
      const keyFromEtc = extractKey(inv.etc);

      if (keyFromEtc) {
        // etcにインボイスNoがある場合: そのインボイスのCSV商品名と照合してマッチするもののみ追加
        const g = getOrCreate(keyFromEtc);
        const csvProducts = g.csvProducts;
        const invMgmtNo = inv.etc?.split(",")[0]?.trim() ?? "";
        // インボイスのCSV商品のいそれかにマッチする場合のみ追加（管理番号も渡す）
        const matches =
          csvProducts.length === 0 ||
          csvProducts.some(cp =>
            invMatchesCsvProduct(cp.name, inv.title, invMgmtNo)
          );
        if (matches) {
          g.stockCount += qty;
          const pInfo1 = purchaseInfoMap.get(inv.id) ?? {
            unitPrice: "",
            trackingNumber: "",
            supplierUrl: "",
            supplierName: "",
          };
          g.inventoryItems.push({
            inventoryId: inv.id,
            title: inv.title,
            quantity: qty,
            managementNo: invMgmtNo,
            etc: inv.etc ?? "",
            unitPrice: pInfo1.unitPrice,
            trackingNumber: pInfo1.trackingNumber,
            supplierUrl: pInfo1.supplierUrl,
            supplierName: pInfo1.supplierName,
          });
        }
      } else {
        // etcにインボイスNoがない場合: 商品名から機種を判定し、各インボイスのCSV商品名と照合
        const invModel = extractModelFromTitle(inv.title);
        if (!invModel) continue;

        for (const [, groupData] of Array.from(groups.entries())) {
          // CSV商品がないインボイスはスキップ（CSVにないインボイスに在庫を結びつけない）
          if (groupData.csvProducts.length === 0) continue;
          // そのインボイスのCSV商品のいずれかにマッチするか確認（etcなしの場合管理番号は空文字列）
          const matchesCsv = groupData.csvProducts.some(cp =>
            invMatchesCsvProduct(cp.name, inv.title, "")
          );
          if (matchesCsv) {
            groupData.stockCount += qty;
            const pInfo2 = purchaseInfoMap.get(inv.id) ?? {
              unitPrice: "",
              trackingNumber: "",
              supplierUrl: "",
              supplierName: "",
            };
            groupData.inventoryItems.push({
              inventoryId: inv.id,
              title: inv.title,
              quantity: qty,
              managementNo: inv.etc?.split(",")[0]?.trim() ?? "",
              etc: inv.etc ?? "",
              unitPrice: pInfo2.unitPrice,
              trackingNumber: pInfo2.trackingNumber,
              supplierUrl: pInfo2.supplierUrl,
              supplierName: pInfo2.supplierName,
            });
            break; // 最初に一致したインボイスに追加
          }
        }
      }
    }

    // 出庫履歴データを集計
    // 削除済み在庫・入庫履歴からも管理番号を補完
    const deletedInvList = await getDeletedInventories(1000);
    const purchaseHistList = await getPurchaseHistories(1000);
    // inventoryId -> etc のマップ（現在在庫 + 削除済み在庫 + 入庫履歴のkanriNoで補完）
    const inventoryEtcMap = new Map<number, string>(
      inventories.map((inv: { id: number; etc?: string | null }) => [
        inv.id,
        inv.etc ?? "",
      ])
    );
    // 削除済み在庫のetcを追加（zaicoIdをキーとして使用）
    for (const del of deletedInvList) {
      if (del.zaicoId && del.etc && !inventoryEtcMap.has(del.zaicoId)) {
        inventoryEtcMap.set(del.zaicoId, del.etc);
      }
    }
    // 入庫履歴のkanriNoを追加（inventoryIdをキーとして使用）
    for (const ph of purchaseHistList) {
      if (
        ph.inventoryId &&
        ph.kanriNo &&
        !inventoryEtcMap.has(ph.inventoryId)
      ) {
        inventoryEtcMap.set(ph.inventoryId, ph.kanriNo);
      }
    }
    const assignedInvoiceNoMap = await buildAssignedInvoiceNoMap().catch(
      () => new Map<string, string>()
    );
    for (const delivery of deliveries) {
      if (delivery.status !== "success") continue;

      const deliveryKey = extractKeyFromDeliveryNo(delivery.deliveryNo);
      const items = JSON.parse(delivery.itemsJson) as Array<{
        inventoryId: number;
        labelId?: string | null;
        title: string;
        quantity: number;
        managementNo?: string | null;
        tradeRecordId?: number | null;
        csvProductName?: string | null;
      }>;
      const cancelledItems = delivery.cancelledItemsJson
        ? (JSON.parse(delivery.cancelledItemsJson) as Array<{
            inventoryId: number;
            quantity: number;
            cancelledAt: string;
          }>)
        : [];
      const cancelledQtyByInventoryId = new Map<number, number>();
      for (const cancelled of cancelledItems) {
        cancelledQtyByInventoryId.set(
          cancelled.inventoryId,
          (cancelledQtyByInventoryId.get(cancelled.inventoryId) ?? 0) +
            cancelled.quantity
        );
      }

      for (const item of items) {
        const cancelledQty = Math.min(
          item.quantity,
          cancelledQtyByInventoryId.get(item.inventoryId) ?? 0
        );
        if (cancelledQty > 0) {
          cancelledQtyByInventoryId.set(
            item.inventoryId,
            (cancelledQtyByInventoryId.get(item.inventoryId) ?? 0) -
              cancelledQty
          );
        }
        const activeQuantity = item.quantity - cancelledQty;
        if (activeQuantity <= 0) continue;

        const etc = inventoryEtcMap.get(item.inventoryId) ?? "";
        const rawMgmt = etc.split(",")[0]?.trim() ?? "";
        // 出庫Noから読めない箱ID出庫（B000002 など）は、明細ごとの管理番号で振り分ける。
        // 出庫Noに宛先が書いてあるときはそちらが優先（在庫を別インボイスへ充てる運用があるため）。
        const assigned = normalizeAssignedInvoiceNo(
          assignedInvoiceNoMap.get(
            String(item.labelId ?? "")
              .trim()
              .toUpperCase()
          )
        );
        const key =
          assigned ??
          deliveryKey ??
          resolveDeliveryItemInvoiceNo(item, delivery.deliveryNo, rawMgmt);
        if (!key) continue;

        const g = getOrCreate(key);
        if (!invoiceNosWithShipmentSheetRows.has(key)) {
          g.deliveredCount += activeQuantity;
        }
        // 管理番号として有効な形式: 「在庫」始まり、または3、4桁の数字始まり（例: 371_ルカ_1/5、在庫0408_1）
        const isValidMgmt =
          /^在庫/.test(rawMgmt) ||
          /^ebay/i.test(rawMgmt) ||
          /^\d{3,4}[^\d]/.test(rawMgmt) ||
          /^\d{3,4}$/.test(rawMgmt);
        const managementNo = isValidMgmt ? rawMgmt : "";
        const pInfo3 = purchaseInfoMap.get(item.inventoryId) ?? {
          unitPrice: "",
          trackingNumber: "",
          supplierUrl: "",
          supplierName: "",
        };
        g.deliveryItems.push({
          deliveryNo: delivery.deliveryNo,
          title: item.title,
          quantity: activeQuantity,
          deliveredAt: delivery.createdAt.toISOString(),
          managementNo,
          unitPrice: pInfo3.unitPrice,
          trackingNumber: pInfo3.trackingNumber,
          supplierUrl: pInfo3.supplierUrl,
          supplierName: pInfo3.supplierName,
          tradeRecordId: item.tradeRecordId ?? null,
          csvProductName: item.csvProductName,
        });
      }
    }

    const summaries = Array.from(groups.values()).map(g => {
      const isAutoComplete =
        g.csvOrderQty > 0 && g.deliveredCount >= g.csvOrderQty;
      const isComplete =
        g.manualComplete || g.csvStatus === "complete" || isAutoComplete;
      if (!isComplete) return g;
      return {
        ...g,
        csvProducts: g.csvProducts.map(p => ({ ...p, status: "complete" })),
      };
    });

    // キーの昇順でソートして返却
    return summaries.sort((a, b) => {
      const na = parseInt(a.key, 10);
      const nb = parseInt(b.key, 10);
      return na - nb;
    });
  }),

  /**
   * 未完了インボイス一覧を返す（出庫登録フォーム用）
   * 完了判定: manualComplete || csvStatus=complete || deliveredCount >= csvOrderQty
   */
  getIncompleteInvoices: publicProcedure.query(async () => {
    try {
      type CsvRow = { partner: string; invoiceNo: string; status: string };
      const rows: CsvRow[] = (await getOrderRowsFromTradeRecords()).map(
        ({ partner, invoiceNo, status }) => ({ partner, invoiceNo, status })
      );
      // 完了ステータス以外を未完了として返す
      const allMemos = await getAllInvoiceMemos();
      const manualCompleteSet = new Set<string>(
        allMemos
          .filter(m => m.colorKey === "__manual_complete__" && m.memo === "1")
          .map(m => m.invoiceKey)
      );
      // invoiceNoごとに集約（同一invoiceNoの行が複数ある場合）
      const invoiceMap = new Map<
        string,
        { partner: string; allComplete: boolean }
      >();
      for (const row of rows) {
        const existing = invoiceMap.get(row.invoiceNo);
        const rowComplete = row.status.toLowerCase() === "complete";
        if (!existing) {
          invoiceMap.set(row.invoiceNo, {
            partner: row.partner,
            allComplete: rowComplete,
          });
        } else {
          if (!rowComplete) existing.allComplete = false;
        }
      }
      // 未完了のみ抽出（手動完了フラグがなかつcsvStatusが完了でない）
      const incomplete: { invoiceNo: string; partner: string }[] = [];
      for (const [invoiceNo, data] of Array.from(invoiceMap.entries())) {
        if (!manualCompleteSet.has(invoiceNo) && !data.allComplete) {
          incomplete.push({ invoiceNo, partner: data.partner });
        }
      }
      // invoiceNoの降順で返す（新しいものが先）
      return incomplete.sort(
        (a, b) => parseInt(b.invoiceNo, 10) - parseInt(a.invoiceNo, 10)
      );
    } catch (err) {
      console.error("getIncompleteInvoices error:", err);
      return [];
    }
  }),
});
