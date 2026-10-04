import {
  type EbayOrderStatus,
  type EbayStockType,
} from "@shared/ebayInventory";

export const NINJA_MASTER_URL =
  "https://docs.google.com/spreadsheets/d/1xfiDJnNqnc12N-jJDGZavEEzsi-j_BCBxXHzZwzsaHo/edit?gid=1727357177#gid=1727357177";
export const YAHOO_AUCTION_SALES_URL = "https://salesmanagement.yahoo.co.jp/list";

export type InventoryItem = {
  id: number;
  title: string;
  quantity: string;
  unit?: string | null;
  category?: string | null;
  categories?: string[];
  place?: string | null;
  etc?: string | null;
  unit_price?: number | null;
  purchase_unit_price?: number | null;
  supplierUrl?: string | null;
  supplierName?: string | null;
  ebayListingUrl?: string | null;
  ebayOrderUrl?: string | null;
  ebayOrderStatus?: EbayOrderStatus | string | null;
  last_purchase_date?: string | null;
  updated_at?: string | null;
};

export type EbayInventoryItem = InventoryItem & {
  managementNo: string;
  ebayStockType: EbayStockType | null;
};

export type ShaftSale = {
  id: number;
  inventoryId?: number | null;
  managementNo: string;
  title: string;
  category?: string | null;
  quantity: number;
  unitPrice?: string | number | null;
  saleAmount: string | number;
  saleUrl?: string | null;
  profitAmount?: string | number | null;
  soldAt?: string | null;
  supplierName?: string | null;
  supplierUrl?: string | null;
  updatedAt?: string | null;
};

export type EditForm = {
  title: string;
  quantity: string;
  unit: string;
  category: string;
  unitPrice: string;
  place: string;
  managementNo: string;
  supplierName: string;
  supplierUrl: string;
  ebayListingUrl: string;
  ebayOrderUrl: string;
  ebayOrderStatus: EbayOrderStatus;
};

export const stockTypeOptions: Array<{ value: EbayStockType; label: string }> = [
  { value: "stocked", label: "有在庫" },
  { value: "dropship", label: "無在庫" },
  { value: "shaft", label: "シャフト" },
];

export type ShaftSalesSort = "soldAtDesc" | "saleAmountDesc" | "saleAmountAsc";
