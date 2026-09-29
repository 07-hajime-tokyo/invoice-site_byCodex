import type { PurchaseItem, PurchaseRow } from "./dataTypes";
import type { StockItemView } from "./viewTypes";
import { parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { getSupplier } from "./supplier";
import { purchaseRowStatusKind, statusLabel } from "./rowStatus";
import { itemStockQuantity, itemQuantity } from "./purchaseItems";
import { getManagementNos } from "./managementNumbers";
import { stockModelName } from "./productPresentation";
import { labelAllocationLabel } from "./labelTitles";
import { toNumber } from "./format";
import { isStockProposalAccessory } from "./stockProposalRules";

// The existing title resolver stays in the screen; construction does not call it.
export function createInboundWaitingStockBuilder(actualProductTitle: (item: PurchaseItem) => string) {
  function buildInboundWaitingStockItemViewsFromRows(rows: PurchaseRow[]): StockItemView[] {
    return rows.flatMap((row) => {
      const rowStatus = purchaseRowStatusKind(row);
      if (rowStatus !== "ordered" && rowStatus !== "inbound_shipped") return [];

      const supplier = getSupplier(row);
      const status = statusLabel(row);
      return row.purchase_items.flatMap((item) => {
        const inventoryId = Number(item.inventory_id);
        if (!Number.isFinite(inventoryId) || inventoryId <= 0) return [];
        if (itemStockQuantity(item) > 0) return [];

        const quantity = Math.max(0, Math.floor(itemQuantity(item)));
        if (quantity <= 0) return [];

        const title = actualProductTitle(item);
        if (isStockProposalAccessory(title, item.category)) return [];

        const rowManagementNos = getManagementNos(row.purchase_items);
        const managementNo = parseEtc(item.etc).managementNo || getManagementNos([item])[0] || rowManagementNos[0] || "-";
        return [
          {
            key: `inbound-waiting-stock-${row.id}-${item.id}-${inventoryId}`,
            inventoryId,
            labelId: null,
            status,
            title,
            category: (item.category ?? "").trim() || stockModelName(title),
            legacyManagementNo: managementNo,
            allocationLabel: labelAllocationLabel(managementNo),
            unitPrice: toNumber(item.unit_price),
            quantity,
            supplier,
            purchaseDate: row.purchase_date ?? item.purchase_date ?? item.estimated_purchase_date ?? "",
            inboundWaiting: true,
          },
        ];
      });
    });
  }

  return buildInboundWaitingStockItemViewsFromRows;
}
