export type {
  InventorySummaryItem,
  ProductRow,
  PurchaseItemForReport,
  StockItemForReport,
  DeliveryItemForReport,
  InvoiceForReport,
  PreviewData,
} from "@shared/monthlyReport";

// 仕入れ単価の手入力状態: key = `${invoiceNo}__${itemKey}`
export type CostOverrides = Record<string, number | null>;
