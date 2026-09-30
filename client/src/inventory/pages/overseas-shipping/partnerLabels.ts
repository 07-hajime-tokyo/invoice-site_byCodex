import type { PartnerTab } from "./types";

// 取引先ラベルを返す
export function partnerLabel(sheetName: string): string {
  if (sheetName === "独発送管理") return "Luca/Maxim";
  if (sheetName === "サミー発送管理") return "Samee";
  if (sheetName === "サイモン発送管理") return "Simon";
  if (sheetName === "ネレ発送管理") return "Nele";
  return sheetName;
}

export function partnerTabLabel(tab: PartnerTab): string {
  if (tab === "luca") return "Luca/Maxim";
  if (tab === "samee") return "Samee";
  if (tab === "simon") return "Simon";
  if (tab === "nele") return "Nele";
  return "すべて";
}

export function partnerTabSheetName(tab: PartnerTab): string | null {
  if (tab === "luca") return "独発送管理";
  if (tab === "samee") return "サミー発送管理";
  if (tab === "simon") return "サイモン発送管理";
  if (tab === "nele") return "ネレ発送管理";
  return null;
}
