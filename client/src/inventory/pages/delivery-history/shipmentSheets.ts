export type ShipmentSheetName = "独発送管理" | "サミー発送管理" | "デボン発送管理" | "サイモン発送管理" | "ネレ発送管理";

export const SHIPMENT_SHEET_NAMES: ShipmentSheetName[] = ["独発送管理", "サミー発送管理", "デボン発送管理", "サイモン発送管理", "ネレ発送管理"];

export function detectShipmentSheetNameInText(text: string | null | undefined): ShipmentSheetName | null {
  const haystack = text?.toLowerCase() ?? "";
  if (!haystack) return null;
  if (haystack.includes("デボン") || haystack.includes("devon")) return "デボン発送管理";
  if (haystack.includes("サイモン") || haystack.includes("simon")) return "サイモン発送管理";
  if (haystack.includes("ネレ") || haystack.includes("nele")) return "ネレ発送管理";
  if (haystack.includes("サミー") || haystack.includes("samee") || haystack.includes("sami") || haystack.includes("sammy")) return "サミー発送管理";
  if (haystack.includes("マキシム") || haystack.includes("maxim") || haystack.includes("ルカ") || haystack.includes("luca")) return "独発送管理";
  return null;
}

export function detectShipmentSheetName(primaryText?: string | null, ...fallbackTexts: Array<string | null | undefined>): ShipmentSheetName {
  const primary = detectShipmentSheetNameInText(primaryText);
  if (primary) return primary;

  const haystack = fallbackTexts.filter(Boolean).join(" ").toLowerCase();
  if (haystack.includes("デボン") || haystack.includes("devon")) return "デボン発送管理";
  if (haystack.includes("サイモン") || haystack.includes("simon")) return "サイモン発送管理";
  if (haystack.includes("ネレ") || haystack.includes("nele")) return "ネレ発送管理";
  if (haystack.includes("マキシム") || haystack.includes("maxim")) return "独発送管理";
  if (haystack.includes("サミー") || haystack.includes("samee") || haystack.includes("sami") || haystack.includes("sammy")) {
    return "サミー発送管理";
  }
  return "独発送管理";
}

export function sheetBadgeClass(sheetName: ShipmentSheetName) {
  if (sheetName === "デボン発送管理") return "bg-amber-100 text-amber-700 border-amber-200";
  if (sheetName === "サイモン発送管理") return "bg-cyan-100 text-cyan-700 border-cyan-200";
  if (sheetName === "ネレ発送管理") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (sheetName === "サミー発送管理") return "bg-purple-100 text-purple-700 border-purple-200";
  return "bg-blue-100 text-blue-700 border-blue-200";
}

export function isDollarPartnerName(partner: string): boolean {
  const p = partner.toLowerCase();
  return p.includes("samee") || p.includes("sami") || p.includes("sammy") || partner.includes("サミー");
}
