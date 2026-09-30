// ============================================================
// 在庫編集フォームの型
// ============================================================
export interface InventoryFormData {
  title: string;
  quantity: string;
  unit: string;
  category: string;
  place: string;
  etc: string;
  purchase_unit_price: string;
  supplierUrl: string;
  supplierName: string;
  ebayListingUrl: string;
}

export const emptyForm: InventoryFormData = {
  title: "",
  quantity: "0",
  unit: "個",
  category: "",
  place: "",
  etc: "",
  purchase_unit_price: "",
  supplierUrl: "",
  supplierName: "",
  ebayListingUrl: "",
};
