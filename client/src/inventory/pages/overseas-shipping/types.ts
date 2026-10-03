// 型定義
export type FedexShipment = {
  id: number;
  deliveryNo: string;
  sheetName: string;
  shippingDate: string;
  trackingNumber: string;
  itemsJson: string;
  spreadsheetStatus: string;
  operatorName: string | null;
  createdAt: Date;
};
export type ShipmentItem = {
  productNameJa: string;
  productNameEn: string;
  quantity: number;
  invoiceNo?: string;
  managementNo?: string | null;
};
export type CsvInvoiceData = {
  partner: string;
  paymentDate: string;
  products: Array<{ name: string; qty: number }>;
  isComplete?: boolean;
};
export type OrderSummaryItem = {
  key: string;
  csvOrderQty: number;
  csvStatus: string;
  manualComplete: boolean;
  deliveredCount: number;
  deliveryItems: Array<{
    title: string;
    quantity: number;
    managementNo: string;
    csvProductName?: string | null;
  }>;
};
export type PartnerPortal = {
  id: number;
  partnerCode: string;
  partnerName: string;
  sheetName: string;
  password: string;
  isActive: number;
};
export type PartnerMessage = {
  id: number;
  partnerCode: string;
  partnerName: string;
  fedexShipmentId: number | null;
  message: string;
  isRead: number;
  replyText: string | null;
  repliedAt: Date | null;
  isDeleted: number;
  createdAt: Date;
};

export type ShipmentInvoiceProductMatch = { name: string; qty: number; index: number };
export type ShipmentInvoiceResolution = { invoiceNo: string; product: ShipmentInvoiceProductMatch | null };
export type ShipmentInvoiceUsage = Map<string, number>;

export type PartnerTab = "all" | "luca" | "samee" | "simon" | "nele";

// インボイスエントリの型
export type InvoiceEntry = {
  invoiceNo: string;
  partner: string;
  paymentDate: string;
  products: Array<{ name: string; qty: number }>;
  isComplete: boolean;
  totalOrderQty: number;
  shipments: Array<{
    shipment: FedexShipment;
    item: ShipmentItem;
    itemIndex: number;
  }>;
  totalShippedQty: number;
  deliveryItems: OrderSummaryItem["deliveryItems"];
};

export type AggregatedShipmentRow = {
  key: string;
  shippingDate: string;
  trackingNumber: string;
  productName: string;
  quantity: number;
  productOrder: number;
};
