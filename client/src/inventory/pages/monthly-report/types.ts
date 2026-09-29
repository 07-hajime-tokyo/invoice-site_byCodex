export type InventorySummaryItem = {
  category: string;
  managementNo?: string;
  title: string;
  quantity: number;
  unitPrice: number | null;
  totalValue: number | null;
};

export type ProductRow = {
  name: string;
  qty: number;
  sellingPrice: number | null;
  currency: string;
  tradeAmount: number | null;
};

export type PurchaseItemForReport = {
  zaicoId: number;
  title: string;
  quantity: number;
  unitPrice: number | null;
  managementNo: string;
  status: string;
};

export type StockItemForReport = {
  inventoryId: number;
  title: string;
  quantity: number;
  unitPrice: number | null;
  managementNo: string;
  category: string;
};

export type DeliveryItemForReport = {
  inventoryId: number;
  title: string;
  quantity: number;
  unitPrice: number | null;
  managementNo: string;
  deliveredAt: string;
  deliveryNo: string;
};

export type InvoiceForReport = {
  invoiceNo: string;
  partner: string;
  paymentDate: string;
  products: ProductRow[];
  totalOrderQty: number;
  purchaseItems: PurchaseItemForReport[];
  stockItems: StockItemForReport[];
  deliveryItems: DeliveryItemForReport[];
  domesticNote: string | null;
  totalPurchaseCost: number | null;
  totalStockCost: number | null;
};

export type PreviewData = {
  inventorySummary: InventorySummaryItem[];
  invoiceList: InvoiceForReport[];
};

// 仕入れ単価の手入力状態: key = `${invoiceNo}__${itemKey}`
export type CostOverrides = Record<string, number | null>;

