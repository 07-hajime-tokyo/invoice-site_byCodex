import { type OrderedPurchaseForm } from "./types";

export const CARRIER_OPTIONS = [
  { value: "auto", label: "自動判別" },
  { value: "japanpost", label: "日本郵便" },
  { value: "yamato", label: "ヤマト運輸" },
  { value: "sagawa", label: "佐川急便" },
  { value: "amazon", label: "Amazon" },
  { value: "seino", label: "西激運輸" },
  { value: "ecohai", label: "エコ配" },
  { value: "fukuyama", label: "福山通運" },
];

export const PURCHASE_STATUS_FILTER_KEY = "purchases-statusFilter-v2";

export const LEGACY_PURCHASE_STATUS_FILTER_KEY = "purchases-statusFilter";

export const PURCHASE_INBOUND_TAB_KEY = "purchases-inboundTab-v1";

export const emptyOrderedForm: OrderedPurchaseForm = {
  inventoryId: "",
  title: "",
  quantity: "1",
  unitPrice: "",
  customerName: "",
  num: "",
  estimatedPurchaseDate: "",
  memo: "",
  managementNo: "",
  supplierUrl: "",
};
