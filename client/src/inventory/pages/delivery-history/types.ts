export interface HistoryItem {
  inventoryId: number;
  title: string;
  quantity: number;
  managementNo?: string;
  labelId?: string;
}

export type FedexShipmentView = {
  id: number;
  deliveryNo?: string;
  sheetName: string;
  shippingDate: string;
  trackingNumber: string;
  spreadsheetStatus: string;
  spreadsheetError?: string | null;
  itemsJson?: string;
  historyId?: number | null;
};

export interface CancelledItem {
  inventoryId: number;
  quantity: number;
  cancelledAt: string;
}

export interface InventoryDetail {
  id: number;
  title: string;
  quantity: string;
  unit: string;
  category?: string;
  categories?: string[];
  place?: string;
  etc?: string;
  unit_price?: number;
  purchase_unit_price?: number;
  optional_attributes?: Array<{ name: string; value: string | null }>;
  itemLabels?: Array<{ labelId: string }>;
  item_image?: { url: string | null };
  created_at: string;
  updated_at: string;
  _fromLocalDb?: boolean;
}

export type GroupedHistoryEntry = [string, Array<{
  id: number;
  deliveryNo: string;
  createdAt: string | Date;
  items: unknown;
  deletedInventoryIds?: number[] | null;
  cancelledItemsJson?: string | null;
  zaicoDeliveryId?: number | null;
}>];
