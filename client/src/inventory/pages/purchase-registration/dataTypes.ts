import type { InboundClass } from "@shared/inboundPipeline";

export interface InventoryItemLabel {
  id?: number;
  labelId: string;
  status?: string | null;
  legacyManagementNo?: string | null;
  localInventoryId?: number | null;
  assignedInvoiceNo?: string | null;
  outboundBoxId?: number | null;
  deliveryHistoryId?: number | null;
}

export interface PurchaseItem {
  id: number;
  inventory_id?: number | null;
  title: string;
  quantity: string;
  unit?: string;
  unit_price?: string | number | null;
  status?: string;
  purchase_date?: string | null;
  estimated_purchase_date?: string | null;
  etc?: string | null;
  category?: string | null;
  itemLabels?: InventoryItemLabel[];
  currentInventoryQuantity?: string | number | null;
}

export interface PurchaseRow {
  id: number;
  num?: string | null;
  purchase_date?: string | null;
  purchaseDate?: string | Date | null;
  created_at?: string | null;
  createdAt?: string | Date | null;
  status?: string | null;
  inboundClass?: InboundClass | null;
  stage?: string | null;
  csvSupplierName?: string | null;
  csvSupplierUrl?: string | null;
  extra?: { shipDate?: string | null; trackingNumber?: string | null; carrier?: string | null; note?: string | null } | null;
  purchase_items: PurchaseItem[];
}

export interface InventoryItem {
  id: number;
  title: string;
  quantity?: string | number | null;
  unit?: string | null;
  category?: string | null;
  categories?: string[] | null;
  place?: string | null;
  etc?: string | null;
  unit_price?: string | number | null;
  purchase_unit_price?: string | number | null;
  last_purchase_date?: string | null;
  updated_at?: string | null;
  supplierUrl?: string | null;
  supplierName?: string | null;
  itemLabels?: InventoryItemLabel[];
  isDeleted?: number | boolean | null;
}
