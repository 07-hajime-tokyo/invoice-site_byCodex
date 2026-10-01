export type ShipmentItem = {
  productNameJa: string;
  productNameEn: string;
  quantity: number;
  invoiceNo?: string | null;
  managementNo?: string | null;
};

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

export type CsvInvoiceData = {
  partner: string;
  paymentDate: string;
  products: Array<{ name: string; qty: number }>;
  isComplete?: boolean;
};

export type ShipmentInvoiceProductMatch = { name: string; qty: number; index: number };

export type ShipmentInvoiceResolution = { invoiceNo: string; product: ShipmentInvoiceProductMatch | null };

export type ShipmentInvoiceUsage = Map<string, number>;
