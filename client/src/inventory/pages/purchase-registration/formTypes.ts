import type { Carrier } from "@/inventory/lib/tracking";

export type StatusFilter = "all" | "ordered" | "received" | "missing_tracking";

export type WorkflowTab = "order" | "labels" | "scan" | "stock" | "shipping" | "returns";

export type StockViewMode = "list" | "proposal";

export type TrackingFormState = { shipDate: string; trackingNumber: string; carrier: "auto" | Carrier };

export type PurchaseEditFormState = {
  title: string;
  managementNo: string;
  category: string;
  quantity: string;
  unitPrice: string;
  estimatedDate: string;
  supplierName: string;
  supplierUrl: string;
  shipDate: string;
  trackingNumber: string;
  carrier: "auto" | Carrier;
};

export type StockEditFormState = {
  title: string;
  managementNo: string;
  category: string;
  quantity: string;
  unit: string;
  place: string;
  unitPrice: string;
  supplierName: string;
  supplierUrl: string;
};
