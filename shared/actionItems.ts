/** やることの画面とAPIで共用する定義。画面固有の入力制限はここへ混ぜない。 */
export const ACTION_ITEM_ASSIGNEE_ORDER: readonly string[] = [
  "全員",
  "仕入れ担当",
  "荷受担当",
  "出荷担当",
];
export const ACTION_ITEM_REVIEWERS = [
  "村上さん",
  "鈴木さん",
  "藤本さん",
  "野田さん",
] as const;
export type ActionItemReviewer = (typeof ACTION_ITEM_REVIEWERS)[number];
export const ACTION_ITEM_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

/** 保存するタイトル・人名・ファイル名用。改行を保持する詳細/返信本文には使わない。 */
export function normalizeActionItemSingleLineText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function compareActionItemAssignees(a: string, b: string) {
  const aIndex = ACTION_ITEM_ASSIGNEE_ORDER.indexOf(a);
  const bIndex = ACTION_ITEM_ASSIGNEE_ORDER.indexOf(b);
  if (aIndex !== -1 || bIndex !== -1) {
    return (
      (aIndex === -1 ? ACTION_ITEM_ASSIGNEE_ORDER.length : aIndex) -
      (bIndex === -1 ? ACTION_ITEM_ASSIGNEE_ORDER.length : bIndex)
    );
  }
  return a.localeCompare(b, "ja");
}

/** 読取時は旧画面と同じく空のキーも保持。保存時の除外はAPI側で行う。 */
export function parseActionItemReviewerChecks(
  value: string | null | undefined
): Record<string, boolean> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(
        ([key, checked]) => [key, Boolean(checked)]
      )
    );
  } catch {
    return {};
  }
}
