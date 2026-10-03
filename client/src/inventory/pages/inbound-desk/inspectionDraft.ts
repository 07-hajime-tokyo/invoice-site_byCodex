import type { DefectTag, DefectPhoto } from "@shared/defectInspection";
import type { DefectDestination, InspectionOutcome } from "@shared/inboundDesk";

/** 動作確認の入力途中を端末に残しておくキー（QR印刷などへ移動しても消えないように） */
export const INSPECTION_DRAFT_STORAGE_KEY = "inbound-desk-inspection-draft-v1";

export type InspectionDecision = {
  outcome: "stocked" | DefectDestination | null;
  requestReplacement: boolean;
  defectTags?: DefectTag[];
  defectNote?: string;
  defectPhotos?: DefectPhoto[];
};

export type InspectionDraft = Record<string, InspectionDecision>;

export function loadInspectionDraft(): InspectionDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(INSPECTION_DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(
        ([labelId, value]) => {
          if (typeof value === "string") {
            const legacyOutcome = value as InspectionOutcome;
            return [
              labelId,
              {
                outcome: legacyOutcome === "defective" ? "junk" : legacyOutcome,
                requestReplacement: legacyOutcome === "defective",
              } satisfies InspectionDecision,
            ];
          }
          return [labelId, value as InspectionDecision];
        }
      )
    );
  } catch {
    return {};
  }
}

export function saveInspectionDraft(draft: InspectionDraft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      INSPECTION_DRAFT_STORAGE_KEY,
      JSON.stringify(draft)
    );
  } catch {
    // 保存できなくても動作確認自体は続けられるので握りつぶす
  }
}
