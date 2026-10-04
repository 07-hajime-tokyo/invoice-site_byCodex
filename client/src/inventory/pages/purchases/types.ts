import { type InboundClass } from "@shared/inboundPipeline";

export interface InventoryItemLabel {
  id?: number;
  labelId: string;
  status?: string | null;
  legacyManagementNo?: string | null;
}

export interface PurchaseItem {
  id: number;
  inventory_id: number;
  title: string;
  quantity: string;
  unit: string;
  unit_price: string;
  status: string;
  purchase_date: string | null;
  estimated_purchase_date: string | null;
  etc?: string;
  category: string;
  ebayListingUrl?: string | null;
  itemLabels?: InventoryItemLabel[];
}

export interface Purchase {
  id: number;
  num: string;
  customer_name: string;
  status: string;
  purchaseDate?: string | null;
  purchase_date: string | null;
  estimated_purchase_date: string | null;
  created_at?: string | null;
  createdAt?: string | Date | null;
  csvSupplierName?: string | null;
  csvSupplierUrl?: string | null;
  // T22: 入庫仕訳・工程
  inboundClass?: InboundClass | null;
  classSource?: "auto" | "manual";
  stage?: string;
  stageUpdatedBy?: string | null;
  shaftParentPurchaseId?: number | null;
  purchase_items: PurchaseItem[];
  extra: {
    id: number;
    zaicoId: number;
    shipDate: string | null;
    trackingNumber: string | null;
    carrier: string | null;
    note: string | null;
  } | null;
}

export interface EditState {
  shipDate: string;
  trackingNumber: string;
  carrier: string;
  note: string;
  supplierName: string;
  supplierUrl: string;
  // 商品別編集: inventory_id -> { title, unitPrice, managementNo, estimatedDate, category }
  itemEdits: Record<
    number,
    {
      title: string;
      unitPrice: string;
      quantity: string;
      managementNo: string;
      estimatedDate: string;
      category: string;
    }
  >;
}

export interface OrderedPurchaseForm {
  inventoryId: string;
  title: string;
  quantity: string;
  unitPrice: string;
  customerName: string;
  num: string;
  estimatedPurchaseDate: string;
  memo: string;
  managementNo: string;
  supplierUrl: string;
}

export type InboundTabCountKey = "unclassified" | InboundClass;

export type InboundTabCounts = Record<InboundTabCountKey, number>;
