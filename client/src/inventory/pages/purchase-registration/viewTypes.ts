import type { PurchaseRow } from "./dataTypes";

export interface SupplierView {
  name: string;
  url: string;
}

export interface LabelView {
  key: string;
  labelId: string;
  rawStatus: string;
  status: string;
  title: string;
  printTitle: string;
  category: string;
  legacyManagementNo: string;
  assignedInvoiceNo?: string | null;
  allocationLabel: string;
  unitPrice: number;
  supplier: SupplierView;
  purchaseDate: string;
  rowId: number;
  itemId: number;
  inventoryId?: number | null;
  trackingNumber?: string | null;
  carrier?: string | null;
}

export type LabelPrintRequest = (labels: LabelView[]) => void;

import type { ZeroStockPurchaseStatus } from "../purchaseRegistrationZeroStock";

export type { ZeroStockPurchaseStatus };

export interface StockItemView {
  key: string;
  inventoryId: number;
  labelId: string | null;
  status: string;
  title: string;
  category: string;
  legacyManagementNo: string;
  assignedInvoiceNo?: string | null;
  allocationLabel: string;
  unitPrice: number;
  quantity: number;
  supplier: SupplierView;
  purchaseDate: string;
  inboundWaiting?: boolean;
  zeroStockPurchase?: boolean;
  zeroStockStatus?: ZeroStockPurchaseStatus;
}

export interface StockProposalDetail {
  source: "stock" | "waiting";
  managementNo: string;
  labelId?: string | null;
  quantity: number;
  unitPrice: number;
  status: string;
  supplier: SupplierView;
  date: string;
}

export interface StockProposalProduct {
  key: string;
  title: string;
  model: string;
  stockQuantity: number;
  waitingQuantity: number;
  totalQuantity: number;
  unitPriceTotal: number;
  unitPriceQuantity: number;
  minUnitPrice: number | null;
  maxUnitPrice: number | null;
  details: StockProposalDetail[];
  searchText: string;
}

export interface StockProposalGroup {
  model: string;
  stockQuantity: number;
  waitingQuantity: number;
  totalQuantity: number;
  unitPriceTotal: number;
  unitPriceQuantity: number;
  products: StockProposalProduct[];
}

export interface ShippingItemView {
  key: string;
  inventoryId: number;
  labelId: string | null;
  rawStatus: string;
  status: string;
  canShip: boolean;
  title: string;
  legacyManagementNo: string;
  assignedInvoiceNo?: string | null;
  allocationLabel: string;
  unitPrice: number;
  supplier: SupplierView;
  quantity: number;
  maxQuantity: number;
}

export interface ProductSummary {
  key: string;
  title: string;
  managementNos?: string[];
  matchTexts?: string[];
  invoiceOrdered?: number;
  invoiceShipped?: number;
  required: number;
  secured: number;
  waiting: number;
  unitPriceTotal: number;
  unitPriceCount: number;
  sellingPrice?: number | null;
  sellingPriceJpy?: number | null;
  sellingCurrency?: string | null;
}

export type InvoiceProductSummary = {
  productName: string;
  orderQty: number;
  deliveredQty: number;
  sellingPrice?: number | null;
  sellingPriceJpy?: number | null;
  currency?: string | null;
};

export type PurchaseRegistrationInvoice = {
  invoiceNo: string;
  partner: string;
  totalOrderQty: number;
  totalDeliveredQty: number;
  remainingQty: number;
};

export type ProductDetailFilter = {
  productKey?: string;
  productTitle: string;
  mode: "stock" | "waiting";
};

export interface AllocationGroup {
  key: string;
  label: string;
  partner: string;
  rows: PurchaseRow[];
  products: ProductSummary[];
  labels: LabelView[];
  required: number;
  secured: number;
  waiting: number;
  purchaseTotal: number;
  invoiceOrderQty?: number;
  invoiceDeliveredQty?: number;
  invoiceRemainingQty?: number;
}
