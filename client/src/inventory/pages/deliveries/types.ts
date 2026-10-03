export interface InventoryItemLabel {
  id?: number;
  labelId: string;
  status?: string | null;
  legacyManagementNo?: string | null;
}

export interface InventoryItem {
  id: number;
  title: string;
  quantity: string;
  unit: string;
  category?: string;
  categories?: string[];
  place?: string;
  etc?: string;
  code?: string;
  unit_price?: number;
  purchase_unit_price?: number;
  last_purchase_date?: string | null;
  updated_at?: string;
  created_at?: string;
  supplierUrl?: string | null;
  supplierName?: string | null;
  ebayListingUrl?: string | null;
  itemLabels?: InventoryItemLabel[];
}

export interface DeliveryItem {
  inventoryId: number;
  title: string;
  quantity: number;
  unit: string;
  checked: boolean;
  etc?: string; // 管理番号（取引先自動判別用）
  unitPrice?: number; // 仕入価格（unit_price）
  sellingPrice?: number | null; // ユーロ建て販売価格（CSVから取得）
  currency?: string; // 通貨（例: EUR）
  tradeRecordId?: number | null; // 確定した取引データ行
  csvProductName?: string | null; // 確定した注文行の商品名。nullは紐づけなし
}
