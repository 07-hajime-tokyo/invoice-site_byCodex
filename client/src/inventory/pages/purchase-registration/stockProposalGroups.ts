import type { PurchaseItem, PurchaseRow } from "./dataTypes";
import type { StockItemView, StockProposalGroup, StockProposalProduct, PurchaseRegistrationInvoice } from "./viewTypes";
import { parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { isUnfinishedInvoiceManagementNo, isExcludedStockProposalManagementNo, isStockProposalAccessory, stockProposalModelName, isStockWaitingPurchaseRow } from "./stockProposalRules";
import { addStockProposalPrice, appendStockProposalDetail, getOrCreateStockProposalProduct } from "./stockProposalValues";
import { getSupplier } from "./supplier";
import { statusLabel } from "./rowStatus";
import { itemQuantity } from "./purchaseItems";
import { getManagementNos } from "./managementNumbers";
import { toNumber } from "./format";
import { STOCK_MODEL_ORDER } from "./productPresentation";

// The existing title resolver stays in the screen; construction does not call it.
export function createStockProposalBuilder(actualProductTitle: (item: PurchaseItem) => string) {
  function buildStockProposalGroups(
    stockItems: StockItemView[],
    purchaseRows: PurchaseRow[],
    searchText: string,
    unfinishedInvoices: PurchaseRegistrationInvoice[] = [],
  ): StockProposalGroup[] {
    const productMap = new Map<string, StockProposalProduct>();
    const unfinishedInvoiceNos = new Set(unfinishedInvoices.map((invoice) => invoice.invoiceNo.trim()).filter(Boolean));

    for (const item of stockItems) {
      if (isUnfinishedInvoiceManagementNo(item.legacyManagementNo, unfinishedInvoiceNos)) continue;
      if (isExcludedStockProposalManagementNo(item.legacyManagementNo)) continue;
      if (isStockProposalAccessory(item.title, item.category)) continue;
      const model = stockProposalModelName(item.title, item.category);
      const product = getOrCreateStockProposalProduct(productMap, item.title, model);
      product.stockQuantity += item.quantity;
      product.totalQuantity += item.quantity;
      addStockProposalPrice(product, item.unitPrice, item.quantity);
      appendStockProposalDetail(product, {
        source: "stock",
        managementNo: item.legacyManagementNo,
        labelId: item.labelId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        status: item.status,
        supplier: item.supplier,
        date: item.purchaseDate,
      });
    }

    for (const row of purchaseRows) {
      if (!isStockWaitingPurchaseRow(row, unfinishedInvoiceNos)) continue;
      const supplier = getSupplier(row);
      const rowStatus = statusLabel(row);
      for (const item of row.purchase_items) {
        const quantity = itemQuantity(item);
        if (quantity <= 0) continue;
        const managementNo = parseEtc(item.etc).managementNo || getManagementNos([item])[0] || getManagementNos(row.purchase_items)[0] || "-";
        const title = actualProductTitle(item);
        if (isUnfinishedInvoiceManagementNo(managementNo, unfinishedInvoiceNos)) continue;
        if (isExcludedStockProposalManagementNo(managementNo)) continue;
        if (isStockProposalAccessory(title, item.category)) continue;
        const model = stockProposalModelName(title, item.category);
        const product = getOrCreateStockProposalProduct(productMap, title, model);
        const unitPrice = toNumber(item.unit_price);
        product.waitingQuantity += quantity;
        product.totalQuantity += quantity;
        addStockProposalPrice(product, unitPrice, quantity);
        appendStockProposalDetail(product, {
          source: "waiting",
          managementNo,
          quantity,
          unitPrice,
          status: rowStatus,
          supplier,
          date: row.purchase_date ?? item.purchase_date ?? item.estimated_purchase_date ?? "",
        });
      }
    }

    const normalizedSearch = searchText.trim().toLowerCase();
    const products = Array.from(productMap.values())
      .filter((product) => !normalizedSearch || product.searchText.includes(normalizedSearch))
      .sort((a, b) => {
        const modelCompare = a.model.localeCompare(b.model, "ja", { numeric: true });
        if (modelCompare !== 0) return modelCompare;
        return a.title.localeCompare(b.title, "ja", { numeric: true });
      });

    const groupMap = new Map<string, StockProposalProduct[]>();
    for (const product of products) {
      const current = groupMap.get(product.model) ?? [];
      current.push(product);
      groupMap.set(product.model, current);
    }

    return Array.from(groupMap.entries())
      .map(([model, groupProducts]) => ({
        model,
        products: groupProducts,
        stockQuantity: groupProducts.reduce((total, product) => total + product.stockQuantity, 0),
        waitingQuantity: groupProducts.reduce((total, product) => total + product.waitingQuantity, 0),
        totalQuantity: groupProducts.reduce((total, product) => total + product.totalQuantity, 0),
        unitPriceTotal: groupProducts.reduce((total, product) => total + product.unitPriceTotal, 0),
        unitPriceQuantity: groupProducts.reduce((total, product) => total + product.unitPriceQuantity, 0),
      }))
      .sort((a, b) => {
        const orderA = STOCK_MODEL_ORDER.indexOf(a.model);
        const orderB = STOCK_MODEL_ORDER.indexOf(b.model);
        const normalizedA = orderA === -1 ? STOCK_MODEL_ORDER.length : orderA;
        const normalizedB = orderB === -1 ? STOCK_MODEL_ORDER.length : orderB;
        if (normalizedA !== normalizedB) return normalizedA - normalizedB;
        return a.model.localeCompare(b.model, "ja", { numeric: true });
      });
  }

  return buildStockProposalGroups;
}
