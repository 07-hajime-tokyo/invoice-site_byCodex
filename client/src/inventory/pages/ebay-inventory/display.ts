import {
  normalizeEbayOrderStatus,
  type EbayStockType,
} from "@shared/ebayInventory";
import type { InventoryItem, ShaftSale } from "./types";

export function formatYen(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  const rounded = Math.round(value);
  if (rounded < 0) return `-¥${Math.abs(rounded).toLocaleString()}`;
  return `¥${rounded.toLocaleString()}`;
}

export function numberFromValue(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const num = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

export function amountInputText(value: number | null | undefined) {
  if (value == null || value === 0) return "";
  return String(Math.round(value));
}

export function stockQuantity(item: InventoryItem) {
  return Math.max(0, Math.floor(Number(item.quantity) || 0));
}

export function compareShaftSalesByDateDesc(a: ShaftSale, b: ShaftSale) {
  const dateA = a.soldAt?.slice(0, 10) ?? "";
  const dateB = b.soldAt?.slice(0, 10) ?? "";
  const dateDiff = dateB.localeCompare(dateA);
  if (dateDiff !== 0) return dateDiff;
  return b.id - a.id;
}

export function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function compactDate() {
  return todayJst().replace(/-/g, "");
}

export function stockTypeBadgeClass(type: EbayStockType) {
  if (type === "shaft") return "bg-zinc-700 text-white";
  if (type === "stocked") return "bg-emerald-600 text-white";
  return "bg-sky-600 text-white";
}

export function orderStatusBadgeClass(status: string | null | undefined) {
  const normalized = normalizeEbayOrderStatus(status);
  if (normalized === "cancelled") return "border-red-200 bg-red-50 text-red-700";
  if (normalized === "returned") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-muted bg-muted/40 text-muted-foreground";
}
