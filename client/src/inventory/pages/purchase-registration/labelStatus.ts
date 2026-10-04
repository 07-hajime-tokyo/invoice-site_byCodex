import { normalizedLabelStatus } from "./rowStatus";

// Text preserves status whitespace; badge classification trims it, as before.

export function labelStatusLabel(status?: string | null): string {
  switch ((status ?? "").toLowerCase()) {
    case "received":
      return "入庫済み";
    case "stocked":
      return "在庫";
    case "shipped":
      return "出庫済み";
    case "returned":
      return "返品";
    case "cancelled":
      return "取消";
    case "ordered":
      return "発注済み";
    default:
      return status || "未入庫";
  }
}

export function labelBadgeClass(status?: string | null): string {
  switch (normalizedLabelStatus(status)) {
    case "shipped":
      return "border-blue-200 bg-blue-50 text-blue-800";
    case "received":
    case "stocked":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "ordered":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "returned":
      return "border-purple-200 bg-purple-50 text-purple-800";
    case "cancelled":
      return "border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}
