export interface ZaicoPurchaseItem {
  id: number;
  inventory_id: number;
  title: string;
  quantity: string;
  box_quantity?: string;
  unit: string;
  box_unit?: string;
  unit_price: string;
  status: "not_ordered" | "ordered" | "purchased";
  purchase_date: string | null;
  estimated_purchase_date: string | null;
  etc?: string;
}

export interface ZaicoPurchase {
  id: number;
  num: string;
  customer_name: string;
  status: "none" | "not_ordered" | "ordered" | "purchased" | "quotation_requested";
  total_amount: number;
  purchase_date: string | null;
  estimated_purchase_date: string | null;
  create_user_name: string;
  memo?: string;
  etc?: string;
  created_at: string;
  updated_at: string;
  purchase_items: ZaicoPurchaseItem[];
}

export interface ZaicoInventory {
  id: number;
  title: string;
  quantity: string;
  logical_quantity?: string;
  unit: string;
  category?: string;
  categories?: string[];
  place?: string;
  etc?: string;
  code?: string;
  unit_price?: number;
  purchase_unit_price?: number;
  optional_attributes?: Array<{ name: string; value: string | null }>;
  item_image?: { url: string | null };
  created_at: string;
  updated_at: string;
  last_purchase_date?: string | null;
}

export interface ZaicoDeliveryItem {
  inventory_id: number;
  quantity: number;
  unit_price?: number;
  etc?: string;
}

export interface ZaicoCreateDeliveryPayload {
  num?: string;
  customer_name?: string;
  status: "before_delivery" | "during_delivery" | "completed_delivery";
  delivery_date?: string;
  memo?: string;
  deliveries: ZaicoDeliveryItem[];
}

export interface ZaicoInventoryPayload {
  title: string;
  quantity?: string;
  unit?: string;
  category?: string;
  place?: string;
  etc?: string;
  code?: string;
  purchase_unit_price?: number;
}

export interface ZaicoCreatePurchasePayload {
  num?: string;
  customer_name?: string;
  status?: "none" | "not_ordered" | "ordered" | "purchased" | "quotation_requested";
  purchase_date?: string;
  estimated_purchase_date?: string;
  memo?: string;
  etc?: string;
  purchase_items: Array<{
    inventory_id: number;
    quantity?: number;
    unit_price?: number;
    estimated_purchase_date?: string;
    etc?: string;
  }>;
}

export interface ZaicoUpdatePurchasePayload {
  customer_name?: string;
  estimated_purchase_date?: string;
  memo?: string;
  purchase_items?: Array<{
    id: number;
    inventory_id: number;
    unit_price?: number;
    quantity?: number;
    estimated_purchase_date?: string;
    etc?: string;
  }>;
}

const DISABLED_MESSAGE = "Zaico API integration is disabled. This site uses its own inventory database.";

function disabled(): never {
  throw new Error(DISABLED_MESSAGE);
}

export async function testConnection(_token?: string): Promise<{ success: boolean; message: string }> {
  return { success: false, message: DISABLED_MESSAGE };
}

export async function getPurchases(_token?: string): Promise<ZaicoPurchase[]> {
  disabled();
}

export async function getAllPurchases(_token?: string): Promise<ZaicoPurchase[]> {
  disabled();
}

export async function completePurchase(
  _purchaseId: number,
  _purchaseDate: string,
  _purchaseItems: Array<{ inventory_id: number; quantity: string; unit_price: string }>,
  _operatorToken?: string,
): Promise<{ code: number; status: string; message: string }> {
  disabled();
}

export async function revertPurchase(
  _purchaseId: number,
  _purchaseItems: Array<{ inventory_id: number; quantity: string; unit_price: string }>,
): Promise<{ code: number; status: string; message: string }> {
  disabled();
}

export async function getPurchaseById(_purchaseId: number, _token?: string): Promise<ZaicoPurchase | null> {
  disabled();
}

export async function getInventories(_maxPages = 5): Promise<ZaicoInventory[]> {
  disabled();
}

export async function getInventory(_inventoryId: number): Promise<ZaicoInventory> {
  disabled();
}

export async function deleteInventory(
  _inventoryId: number,
  _operatorToken?: string,
): Promise<{ code: number; status: string; message: string }> {
  disabled();
}

export async function deletePurchase(
  _purchaseId: number,
  _operatorToken?: string,
): Promise<{ code: number; status: string; message: string }> {
  disabled();
}

export async function getLatestPurchaseDateMap(): Promise<Record<number, string>> {
  return {};
}

export async function updateDeliveryNum(
  _deliveryId: number,
  _deliveryNo: string,
): Promise<{ code: number; status: string; message: string }> {
  disabled();
}

export async function createDelivery(
  _payload: ZaicoCreateDeliveryPayload,
): Promise<{ code: number; status: string; message: string; data_id: number }> {
  disabled();
}

export async function createInventory(
  _payload: ZaicoInventoryPayload,
  _operatorToken?: string,
): Promise<{ code: number; status: string; message: string; data_id: number }> {
  disabled();
}

export async function updateInventory(
  _inventoryId: number,
  _payload: ZaicoInventoryPayload,
  _operatorToken?: string,
): Promise<{ code: number; status: string; message: string }> {
  disabled();
}

export async function createPurchase(
  _payload: ZaicoCreatePurchasePayload,
  _operatorToken?: string,
): Promise<{ code: number; status: string; message: string; data_id: number }> {
  disabled();
}

export async function getMaxPurchaseNum(_token?: string): Promise<number> {
  disabled();
}

export async function deleteDelivery(
  _deliveryId: number,
  _operatorToken?: string,
): Promise<{ code: number; status: string; message: string }> {
  disabled();
}

export async function getDelivery(_deliveryId: number, _operatorToken?: string): Promise<unknown> {
  disabled();
}

export async function updatePurchase(
  _purchaseId: number,
  _payload: ZaicoUpdatePurchasePayload,
  _operatorToken?: string,
): Promise<{ code: number; status: string; message: string }> {
  disabled();
}
