import {
  isZaicoEnabled,
  getLocalInventories,
  getLatestPurchaseDateMapFromDB,
  getLocalPurchases,
  getAllInvoiceMemos,
  getAllDeliveryHistories,
  getLocalPurchaseUnitPriceMap,
  getPurchaseHistories,
  getUnitPricesByInventoryIds,
  getLocalInventoryUnitPriceByZaicoIds,
  getDeletedInventoryUnitPriceByZaicoIds,
} from "./db";
import { getInventories, getAllPurchases } from "./zaico";
import { getOrderRowsFromTradeRecords } from "./orderTradeRows";
import { invoiceNoPrefixFromDeliveryNo } from "./deliveryInvoiceAttribution";
import { parseMoneyNumber } from "./inventoryMoney";
import type {
  InventorySummaryItem,
  PurchaseItemForReport,
  StockItemForReport,
  DeliveryItemForReport,
  InvoiceForReport,
} from "@shared/monthlyReport";

export async function buildMonthlyReportPreview() {
  // 1-3. 在庫一覧・発注一覧・インボイスメモ・CSV・DB出庫履歴を並列取得して処理時間を短縮
  const zaicoEnabledForReport = await isZaicoEnabled();
  const getInventoriesForReport = async () => {
    if (zaicoEnabledForReport) return getInventories();
    const [localInvs, dbDateMap] = await Promise.all([
      getLocalInventories(),
      getLatestPurchaseDateMapFromDB(),
    ]);
    return localInvs.map(inv => ({
      id: inv.zaicoId ?? inv.id,
      title: inv.title,
      quantity: String(inv.quantity ?? 0),
      unit_price: inv.unitPrice != null ? Number(inv.unitPrice) : null,
      category: inv.category ?? null,
      categories: inv.category ? [inv.category] : [],
      etc: inv.etc ?? null,
      optional_attributes: [] as Array<{ name: string; value: string | null }>,
      last_purchase_date: dbDateMap[inv.zaicoId ?? inv.id] ?? null,
    }));
  };
  const getPurchasesForReport = async () => {
    if (zaicoEnabledForReport) return getAllPurchases();
    const localPurchaseRows = await getLocalPurchases();
    return localPurchaseRows.map(purchase => {
      let items: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(purchase.itemsJson ?? "[]");
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        items = [];
      }
      if (items.length === 0) {
        items = [
          {
            id: purchase.id,
            title: purchase.title,
            quantity: purchase.quantity,
            unit_price: purchase.unitPrice,
            etc: purchase.managementNo,
            status: purchase.status,
          },
        ];
      }
      return {
        id: purchase.zaicoId ?? purchase.id,
        num:
          purchase.purchaseNum ?? purchase.managementNo ?? String(purchase.id),
        purchase_items: items.map((item, index) => ({
          id: Number(item.id ?? purchase.zaicoId ?? purchase.id + index),
          title: String(item.title ?? purchase.title ?? ""),
          quantity: String(item.quantity ?? purchase.quantity ?? 1),
          unit_price:
            item.unit_price ?? item.unitPrice ?? purchase.unitPrice ?? null,
          etc: item.etc ?? purchase.managementNo ?? null,
          status: purchase.status === "purchased" ? "purchased" : "ordered",
          inventory_id:
            item.inventory_id ??
            item.inventoryId ??
            purchase.localInventoryId ??
            null,
        })),
      };
    });
  };
  const [
    inventories,
    allPurchases,
    allMemos,
    allDeliveriesForParallel,
    orderRows,
    localPurchaseUnitPriceMap,
    allPurchaseHistories,
  ] = await Promise.all([
    getInventoriesForReport(),
    getPurchasesForReport(),
    getAllInvoiceMemos(),
    getAllDeliveryHistories().catch(() => []),
    getOrderRowsFromTradeRecords().catch(() => []),
    getLocalPurchaseUnitPriceMap().catch(() => new Map<string, number>()),
    getPurchaseHistories(2000).catch(() => []),
  ]);
  const invoiceMemoMap = new Map<string, string>();
  for (const m of allMemos) {
    if (m.colorKey === "__invoice__") invoiceMemoMap.set(m.invoiceKey, m.memo);
  }
  // 手動完了セット
  const manualCompleteSet = new Set<string>(
    allMemos
      .filter(m => m.colorKey === "__manual_complete__" && m.memo === "1")
      .map(m => m.invoiceKey)
  );

  // 4. CSVからインボイス情報取得（G列販売価格・H列通貨・D列支払日込み）
  type CsvInvoiceRow = {
    partner: string;
    invoiceNo: string;
    paymentDate: string;
    productName: string;
    orderQty: number;
    sellingPrice: number | null;
    currency: string;
    rowStatus: string; // 行単位のstatus
  };
  const csvRows: CsvInvoiceRow[] = [];
  try {
    csvRows.push(
      ...orderRows.map(row => ({
        partner: row.partner,
        invoiceNo: row.invoiceNo,
        paymentDate: row.paymentDate,
        productName: row.productName,
        orderQty: row.orderQty,
        sellingPrice: row.sellingPrice,
        currency: row.currency,
        rowStatus: row.status === "complete" ? "complete" : "",
      }))
    );
  } catch (e) {
    console.error("Trade order data error:", e);
  }

  // 5. CSVインボイスマップ構築
  // 完了判定: 全行がcompleteの場合のみインボイス全体をcomplete扱い
  type CsvInvoiceSummary = {
    partner: string;
    paymentDate: string;
    products: Array<{
      name: string;
      qty: number;
      sellingPrice: number | null;
      currency: string;
      tradeAmount: number | null;
    }>;
    totalOrderQty: number;
    allRowsComplete: boolean; // 全行completeか
    hasAnyRow: boolean;
  };
  const csvInvoiceMap = new Map<string, CsvInvoiceSummary>();
  for (const row of csvRows) {
    const tradeAmount =
      row.sellingPrice != null ? row.sellingPrice * row.orderQty : null;
    const existing = csvInvoiceMap.get(row.invoiceNo);
    if (existing) {
      existing.totalOrderQty += row.orderQty;
      existing.products.push({
        name: row.productName,
        qty: row.orderQty,
        sellingPrice: row.sellingPrice,
        currency: row.currency,
        tradeAmount,
      });
      // 1行でも未完了があればallRowsCompleteをfalseに
      if (row.rowStatus !== "complete") existing.allRowsComplete = false;
    } else {
      csvInvoiceMap.set(row.invoiceNo, {
        partner: row.partner,
        paymentDate: row.paymentDate,
        products: [
          {
            name: row.productName,
            qty: row.orderQty,
            sellingPrice: row.sellingPrice,
            currency: row.currency,
            tradeAmount,
          },
        ],
        totalOrderQty: row.orderQty,
        allRowsComplete: row.rowStatus === "complete",
        hasAnyRow: true,
      });
    }
  }
  const inventorySummary: Array<
    InventorySummaryItem & { managementNo: string }
  > = [];
  for (const inv of inventories) {
    const qty =
      typeof inv.quantity === "number"
        ? inv.quantity
        : parseInt(String(inv.quantity), 10) || 0;
    if (qty <= 0) continue;
    let unitPrice: number | null = null;
    if (inv.optional_attributes) {
      const priceAttr = inv.optional_attributes.find(
        (a: { name: string; value: string | null }) => a.name === "仕入単価"
      );
      if (priceAttr?.value) unitPrice = parseMoneyNumber(priceAttr.value);
    }
    if (unitPrice == null && inv.unit_price != null) {
      unitPrice = parseMoneyNumber(inv.unit_price);
    }
    const category = inv.categories?.[0] ?? inv.category ?? "未分類";
    const managementNo =
      String(inv.etc ?? "")
        .split(",")[0]
        ?.trim() ?? "";
    inventorySummary.push({
      category,
      managementNo,
      title: inv.title,
      quantity: qty,
      unitPrice,
      totalValue: unitPrice != null ? unitPrice * qty : null,
    });
  }
  inventorySummary.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.title.localeCompare(b.title) ||
      a.managementNo.localeCompare(b.managementNo, "ja", { numeric: true })
  );

  // 「テスト」を含む発注済み商品を除外するヘルパー
  const isTestItem = (
    title: string,
    etc: string | undefined | null
  ): boolean => {
    const lowerTitle = title.toLowerCase();
    const lowerEtc = (etc ?? "").toLowerCase();
    return (
      lowerTitle.includes("テスト") ||
      lowerTitle.includes("test") ||
      lowerEtc.includes("テスト") ||
      lowerEtc.includes("test")
    );
  };

  const purchaseByInvoice = new Map<string, PurchaseItemForReport[]>();
  for (const p of allPurchases) {
    // 各purchase_item[].etcの先頭数字をインボイスNoとして紐付け
    // purchase_items[].etc = "372_ルカ_ブラック_8/10" のような管理番号
    for (const pItem of p.purchase_items) {
      const title = String(pItem.title ?? "");
      const itemEtc = typeof pItem.etc === "string" ? pItem.etc : "";
      const purchaseNum =
        typeof p.num === "string" ? p.num : String(p.num ?? "");
      // 「テスト」を含む商品は月次棚卸しから除外
      if (isTestItem(title, itemEtc)) continue;
      // status=ordered（未入庫）のみ表示（入庫済み=purchasedは除外）
      if (pItem.status !== "ordered") continue;
      // pItem.etcが設定されていればそこから、なければp.num（発注No）から抽出
      const itemEtcFirstPart = itemEtc.split(",")[0]?.trim() ?? "";
      const itemEtcInvoiceNo = invoiceNoPrefixFromDeliveryNo(itemEtcFirstPart);
      const numInvoiceNo = invoiceNoPrefixFromDeliveryNo(purchaseNum);
      const invoiceNo = itemEtcInvoiceNo ?? numInvoiceNo;
      if (!invoiceNo) continue;
      const managementNo = itemEtcInvoiceNo ? itemEtcFirstPart : purchaseNum;
      let unitPrice: number | null = null;
      const upStr = pItem.unit_price != null ? String(pItem.unit_price) : "";
      if (upStr) unitPrice = parseMoneyNumber(upStr);
      // Zaicoの仕入単価が未設定の場合、ローカルDB（local_purchases）の管理番号で補完
      if (unitPrice == null && managementNo) {
        unitPrice = localPurchaseUnitPriceMap.get(managementNo) ?? null;
      }
      const item: PurchaseItemForReport = {
        zaicoId: Number(pItem.id),
        title,
        quantity: parseInt(String(pItem.quantity), 10) || 0,
        unitPrice,
        managementNo,
        status: pItem.status,
      };
      const arr = purchaseByInvoice.get(invoiceNo) ?? [];
      arr.push(item);
      purchaseByInvoice.set(invoiceNo, arr);
    }
  }

  // csvInvoiceMapから支払済み・未完了のインボイスNoセットを構築（在庫一覧の絞り込みに使用）
  const invoiceNoSet = new Set<string>();
  for (const [invoiceNo, csvInvoice] of Array.from(csvInvoiceMap.entries())) {
    if (!csvInvoice.paymentDate) continue; // 支払日なし = 未払いは除外
    if (manualCompleteSet.has(invoiceNo) || csvInvoice.allRowsComplete)
      continue; // 完了済みは除外
    invoiceNoSet.add(invoiceNo);
  }

  const stockByInvoice = new Map<string, StockItemForReport[]>();
  for (const inv of inventories) {
    const mgmtNo = inv.etc ?? "";
    const firstPart = mgmtNo.split(",")[0]?.trim() ?? "";
    const invoiceNo = invoiceNoPrefixFromDeliveryNo(firstPart);
    if (!invoiceNo) continue;
    // 対象インボイスNoに含まれる商品のみ表示
    if (!invoiceNoSet.has(invoiceNo)) continue;
    const qty =
      typeof inv.quantity === "number"
        ? inv.quantity
        : parseInt(String(inv.quantity), 10) || 0;
    if (qty <= 0) continue;
    let unitPrice: number | null = null;
    if (inv.optional_attributes) {
      const priceAttr = inv.optional_attributes.find(
        (a: { name: string; value: string | null }) => a.name === "仕入単価"
      );
      if (priceAttr?.value) unitPrice = parseMoneyNumber(priceAttr.value);
    }
    if (unitPrice == null && inv.unit_price != null)
      unitPrice = parseMoneyNumber(inv.unit_price);
    const category = inv.categories?.[0] ?? inv.category ?? "未分類";
    const item: StockItemForReport = {
      inventoryId: inv.id,
      title: inv.title,
      quantity: qty,
      unitPrice,
      managementNo: firstPart,
      category,
    };
    const arr = stockByInvoice.get(invoiceNo) ?? [];
    arr.push(item);
    stockByInvoice.set(invoiceNo, arr);
  }

  // 8. 出庫履歴を全件取得してインボイスNoでグループ化
  type DeliveryItemForReport = {
    inventoryId: number;
    title: string;
    quantity: number;
    unitPrice: number | null;
    managementNo: string;
    deliveredAt: string;
    deliveryNo: string;
  };
  const deliveryByInvoice = new Map<string, DeliveryItemForReport[]>();
  try {
    // 並列取得済みのallDeliveriesForParallelを使用（重複取得なし）
    // まず全inventoryIdを収集してpurchase_historiesから仕入単価を一括取得
    const allDeliveryInventoryIds: number[] = [];
    for (const dh of allDeliveriesForParallel) {
      if (dh.status !== "success") continue;
      let items: Array<{
        inventoryId: number;
        title: string;
        quantity: number;
        unitPrice?: number | null;
        etc?: string;
      }> = [];
      try {
        items = JSON.parse(dh.itemsJson);
      } catch {
        continue;
      }
      for (const item of items) {
        if (item.inventoryId) allDeliveryInventoryIds.push(item.inventoryId);
      }
    }
    // purchase_historiesから仕入単価を一括取得（inventoryIdをキーに）
    const uniqueInventoryIds = Array.from(new Set(allDeliveryInventoryIds));
    // local_inventoriesからもzaicoIdベースで仕入単価を一括取得（purchase_historiesにない場合のフォールバック）
    // deleted_inventoriesからも取得（在庫削除後も仕入単価を保持するため）
    const [unitPriceMap, localInvUnitPriceMap, deletedInvUnitPriceMap] =
      await Promise.all([
        getUnitPricesByInventoryIds(uniqueInventoryIds),
        getLocalInventoryUnitPriceByZaicoIds(uniqueInventoryIds),
        getDeletedInventoryUnitPriceByZaicoIds(uniqueInventoryIds),
      ]);

    for (const dh of allDeliveriesForParallel) {
      if (dh.status !== "success") continue;
      let items: Array<{
        inventoryId: number;
        title: string;
        quantity: number;
        unitPrice?: number | null;
        etc?: string;
      }> = [];
      try {
        items = JSON.parse(dh.itemsJson);
      } catch {
        continue;
      }
      // deliveryNoからもインボイスNoを抽出（例: "372_luca20260326" → "372"）
      const deliveryNoInvoice = invoiceNoPrefixFromDeliveryNo(dh.deliveryNo);
      for (const item of items) {
        const mgmtNo = item.etc ?? "";
        const firstPart = mgmtNo.split(",")[0]?.trim() ?? "";
        const itemInvoiceNo = invoiceNoPrefixFromDeliveryNo(firstPart);
        // item.etcからマッチしない場合はdeliveryNoから抽出したinvoiceNoを使用
        const invoiceNo = itemInvoiceNo ?? deliveryNoInvoice;
        if (!invoiceNo) continue;
        // 仕入単価補完優先順位: itemsJson保存値 > purchase_histories > local_inventories > deleted_inventories
        const unitPrice =
          item.unitPrice != null
            ? item.unitPrice
            : (unitPriceMap.get(item.inventoryId) ??
              localInvUnitPriceMap.get(item.inventoryId) ??
              deletedInvUnitPriceMap.get(item.inventoryId) ??
              null);
        const deliveryItem: DeliveryItemForReport = {
          inventoryId: item.inventoryId,
          title: item.title,
          quantity: item.quantity,
          unitPrice,
          managementNo: firstPart,
          deliveredAt:
            dh.createdAt instanceof Date
              ? dh.createdAt.toISOString()
              : String(dh.createdAt),
          deliveryNo: dh.deliveryNo,
        };
        const arr = deliveryByInvoice.get(invoiceNo) ?? [];
        arr.push(deliveryItem);
        deliveryByInvoice.set(invoiceNo, arr);
      }
    }
  } catch (e) {
    console.error("Delivery history fetch error:", e);
  }

  // 9a. 出庫済みinventoryIdのセットを構築（purchaseByInvoiceのフィルタリングに使用）
  const deliveredInventoryIds = new Set<number>();
  for (const items of Array.from(deliveryByInvoice.values())) {
    for (const di of items) {
      if (di.inventoryId) deliveredInventoryIds.add(di.inventoryId);
    }
  }

  // 9b. purchase_historiesから zaicoId→inventoryId のマップを構築
  // これにより purchaseByInvoice の zaicoId が出庫済みかどうか判定できる
  const purchaseZaicoIdToInventoryId = new Map<number, number>();
  for (const ph of allPurchaseHistories) {
    if (ph.cancelled === 0 && ph.zaicoId && ph.inventoryId) {
      purchaseZaicoIdToInventoryId.set(ph.zaicoId, ph.inventoryId);
    }
  }

  // 9c. purchaseByInvoice から出庫済み商品を除外
  for (const [invoiceNo, items] of Array.from(purchaseByInvoice.entries())) {
    const filtered = items.filter((pi: PurchaseItemForReport) => {
      const inventoryId = purchaseZaicoIdToInventoryId.get(pi.zaicoId);
      if (!inventoryId) return true; // 入庫履歴がない（未入庫）→ 発注済み商品として残す
      return !deliveredInventoryIds.has(inventoryId); // 出庫済みなら除外
    });
    if (filtered.length === 0) {
      purchaseByInvoice.delete(invoiceNo);
    } else {
      purchaseByInvoice.set(invoiceNo, filtered);
    }
  }

  // 9d. 入庫済み・未出庫の商品を stockByInvoice に追加
  // purchase_histories に記録があり、出庫済みでなく、Zaico在庫一覧に既に存在しない商品を追加
  // stockByInvoice に既にある inventoryId は重複追加しない
  const stockInventoryIds = new Set<number>();
  for (const items of Array.from(stockByInvoice.values())) {
    for (const si of items) stockInventoryIds.add(si.inventoryId);
  }

  for (const ph of allPurchaseHistories) {
    if (ph.cancelled !== 0) continue; // 取り消し済みは除外
    if (!ph.inventoryId) continue;
    if (deliveredInventoryIds.has(ph.inventoryId)) continue; // 出庫済みは除外
    if (stockInventoryIds.has(ph.inventoryId)) continue; // 既にZaico在庫一覧に存在する
    // 管理番号からインボイスNoを抽出
    const mgmtNo = ph.kanriNo ?? "";
    const firstPart = mgmtNo.split(",")[0]?.trim() ?? "";
    const invoiceNo = invoiceNoPrefixFromDeliveryNo(firstPart);
    if (!invoiceNo) continue;
    // 仕入単価
    const unitPrice = ph.unitPrice != null ? parseFloat(ph.unitPrice) : null;
    const qty = parseInt(String(ph.quantity), 10) || 0;
    if (qty <= 0) continue;
    const item: StockItemForReport = {
      inventoryId: ph.inventoryId,
      title: ph.title,
      quantity: qty,
      unitPrice,
      managementNo: firstPart,
      category: ph.category ?? "未分類",
    };
    const arr = stockByInvoice.get(invoiceNo) ?? [];
    arr.push(item);
    stockByInvoice.set(invoiceNo, arr);
    stockInventoryIds.add(ph.inventoryId); // 重複追加防止
  }

  // 9. 支払い済み・未完了インボイスを抽出
  const invoiceList: InvoiceForReport[] = [];
  for (const [invoiceNo, csvInvoice] of Array.from(csvInvoiceMap.entries())) {
    if (!csvInvoice.paymentDate) continue; // 支払日なし = 未払い
    // 完了判定: 全行completeまたは手動完了の場合のみ除外
    const isComplete =
      manualCompleteSet.has(invoiceNo) || csvInvoice.allRowsComplete;
    if (isComplete) continue; // 完了済みは除外
    const purchaseItems = purchaseByInvoice.get(invoiceNo) ?? [];
    const stockItems = stockByInvoice.get(invoiceNo) ?? [];
    const deliveryItems = deliveryByInvoice.get(invoiceNo) ?? [];
    const domesticNote = invoiceMemoMap.get(invoiceNo) ?? null;
    let totalPurchaseCost: number | null = null;
    for (const pi of purchaseItems) {
      if (pi.unitPrice != null)
        totalPurchaseCost =
          (totalPurchaseCost ?? 0) + pi.unitPrice * pi.quantity;
    }
    let totalStockCost: number | null = null;
    for (const si of stockItems) {
      if (si.unitPrice != null)
        totalStockCost = (totalStockCost ?? 0) + si.unitPrice * si.quantity;
    }
    invoiceList.push({
      invoiceNo,
      partner: csvInvoice.partner,
      paymentDate: csvInvoice.paymentDate,
      products: csvInvoice.products,
      totalOrderQty: csvInvoice.totalOrderQty,
      purchaseItems,
      stockItems,
      deliveryItems,
      domesticNote,
      totalPurchaseCost,
      totalStockCost,
    });
  }
  invoiceList.sort((a, b) => parseInt(a.invoiceNo) - parseInt(b.invoiceNo));

  return { inventorySummary, invoiceList };
}
