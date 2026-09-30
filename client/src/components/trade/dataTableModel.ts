// DataTable から抽出した型・定数・純粋関数（逐語移動）
import { TradeRecord, SortKey, SortDir } from "@/lib/csvUtils";

export interface DataTableProps {
  records: TradeRecord[];
  pageSize?: number;
  onRecordUpdated?: () => void;
  totalRecords?: number;
  page?: number;
  sortKey?: SortKey;
  sortDir?: SortDir;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  onSortChange?: (key: SortKey, dir: SortDir) => void;
  onInvoiceNoClick?: (invoiceNo: number) => void;
}

export const VISIBLE_COLUMNS: (keyof TradeRecord)[] = [
  "month",
  "partner",
  "no",
  "paymentDate",
  "productName",
  "quantity",
  "unitPrice",
  "currency",
  "unitPriceJPY",
  "status",
  "totalSales",
  "procurementTotal",
  "shippingCost",
  "customsDuty",
  "profitWithRefund",
];

export const PAGE_SIZE_OPTIONS = [20, 50, 100];
export const MOBILE_META_COLUMNS: (keyof TradeRecord)[] = [
  "quantity",
  "unitPrice",
  "currency",
  "totalSales",
  "procurementTotal",
  "shippingCost",
  "customsDuty",
  "profitWithRefund",
];

export function getTradeRecordId(row: TradeRecord): number | null {
  return typeof row.id === "number" && Number.isFinite(row.id) && row.id > 0 ? row.id : null;
}
