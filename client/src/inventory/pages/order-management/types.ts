export type SummaryDeliveryItem = {
  deliveryNo: string;
  title: string;
  quantity: number;
  deliveredAt: string;
  managementNo: string;
  tradeRecordId?: number | null;
  csvProductName?: string | null;
};

export type SummaryItem = {
  key: string;
  partner: string;
  csvOrderQty: number;
  csvStatus: string;
  manualComplete: boolean;
  csvProducts: Array<{ name: string; qty: number; status: string; paymentDate: string }>;
  orderedCount: number;
  purchasedCount: number;
  deliveredCount: number;
  stockCount: number;
  shipmentProgressSource?: "sheet" | "delivery_history";
  purchaseItems: Array<{
    purchaseId: number;
    num: string;
    title: string;
    quantity: number;
    status: string;
    managementNo: string;
  }>;
  inventoryItems: Array<{
    inventoryId: number;
    title: string;
    quantity: number;
    managementNo: string;
    etc: string;
  }>;
  deliveryItems: SummaryDeliveryItem[];
  sheetShipmentItems?: SummaryDeliveryItem[];
};

export type CsvProductSummary = SummaryItem["csvProducts"][number];

export type DeliveryItem = SummaryItem["deliveryItems"][number];

/**
 * SummaryItemのcsvProductsとpurchaseItems/inventoryItems/deliveryItemsを
 * カラー名でグループ化して集計する
 */
export type ColorSummary = {
  colorName: string;
  csvQty: number;         // 取引データ発注数
  zaicoCount: number;     // 発注一覧に登録された数（status問わず）
  purchasedCount: number; // 入庫済み数（status=purchased）
  stockCount: number;     // 在庫数
  deliveredCount: number; // 出庫済み数
};

export type ColorSummaryWithModel = ColorSummary & { model: string; colorOnly: string };

export type CsvProductCandidate = { name: string; qty: number };

export type AggregatedDeliveryItem = {
  key: string;
  title: string;
  quantity: number;
  deliveryNo: string;
  managementNo: string;
  deliveredAt: string;
  deliveredDateKey: string;
  items: DeliveryItem[];
};
