import type { InspectionOutcome } from "@shared/inboundDesk";
export type { InspectionOutcome } from "@shared/inboundDesk";
import {
  invoiceAllocation,
  type InboundBox,
  type InboundLabel,
} from "@/inventory/lib/inboundDesk";

export type Phase = "receive" | "inspect" | "review";

/** 不良と判定したときの仕分け先 */
export type DefectDestination = "junk" | "returned";

/**
 * 数字は3本とも別の母数を数える。
 * 以前は①も②も status="received" を数えていたため、荷受けボタンを押す前の荷物が
 * 画面のどこにも出ず、「検品待ちの数字が出ない」状態になっていた。
 */
export const PHASES: Array<{ value: Phase; number: string; label: string }> = [
  { value: "receive", number: "①", label: "到着予定" },
  { value: "inspect", number: "②", label: "動作確認待ち" },
  { value: "review", number: "③", label: "検品済み" },
];

export const OUTCOME_LABELS: Record<InspectionOutcome, string> = {
  stocked: "動作確認OK",
  defective: "不良在庫（旧）",
  junk: "不良・ジャンク売",
  returned: "不良・返品",
};

export const DEFECT_DESTINATIONS: Array<{
  value: DefectDestination;
  label: string;
  hint: string;
}> = [
  { value: "junk", label: "ジャンク売", hint: "ジャンク売り在庫に回します" },
  { value: "returned", label: "返品", hint: "仕入先へ返品します" },
];

export const CARRIER_LABELS: Record<string, string> = {
  yamato: "ヤマト運輸",
  sagawa: "佐川急便",
  japanpost: "日本郵便",
  amazon: "Amazon",
  ecohai: "エコ配",
  seino: "西濃運輸",
  fukuyama: "福山通運",
};

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatUpdatedTime(value: number) {
  if (!value) return "未取得";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function carrierLabel(box: InboundBox) {
  return (
    CARRIER_LABELS[box.carrier.trim().toLowerCase()] ??
    (box.carrier.trim() || "業者不明")
  );
}

export function allocationBadge(label: InboundLabel) {
  return invoiceAllocation(label.legacyManagementNo).label;
}
