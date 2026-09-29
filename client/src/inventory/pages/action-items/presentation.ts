import {
  ACTION_ITEM_REVIEWERS as ALL_REVIEWERS,
  type ActionItemReviewer as ReviewerName,
} from "@shared/actionItems";

const SHIPPING_REVIEWERS: ReviewerName[] = ["鈴木さん", "藤本さん"];

const CUSTOM_ASSIGNEE_BADGE_CLASSES = [
  "border-slate-200 bg-slate-100 text-slate-700",
  "border-rose-200 bg-rose-50 text-rose-700",
  "border-cyan-200 bg-cyan-50 text-cyan-700",
  "border-lime-200 bg-lime-50 text-lime-700",
  "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
];

export function getAssigneeBadgeClass(
  assignee: string | null | undefined,
  done: boolean
) {
  const name = assignee || "未設定";
  const base = done ? "opacity-70" : "";
  const fixed: Record<string, string> = {
    仕入れ担当: "border-amber-200 bg-amber-50 text-amber-700",
    荷受担当: "border-sky-200 bg-sky-50 text-sky-700",
    出荷担当: "border-emerald-200 bg-emerald-50 text-emerald-700",
    全員: "border-violet-200 bg-violet-50 text-violet-700",
    未設定: "border-slate-200 bg-slate-100 text-slate-600",
  };
  if (fixed[name]) return `${fixed[name]} ${base}`;

  const hash = Array.from(name).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0
  );
  return `${CUSTOM_ASSIGNEE_BADGE_CLASSES[hash % CUSTOM_ASSIGNEE_BADGE_CLASSES.length]} ${base}`;
}

export function formatDate(value: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAuthorName(value: string | null | undefined) {
  if (!value) return "未設定";
  return value === "cron" ? "自動" : value;
}

function normalizePersonName(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .replace(/[ 　]/g, "")
    .replace(/さん$/, "")
    .replace(/様$/, "");
}

export function getCheckReviewers(item: {
  assignee?: string | null;
  createdBy?: string | null;
}): ReviewerName[] {
  if (item.assignee === "出荷担当") return SHIPPING_REVIEWERS;
  if (item.assignee !== "全員") return [];
  const author = normalizePersonName(item.createdBy);
  return ALL_REVIEWERS.filter(
    reviewer => normalizePersonName(reviewer) !== author
  );
}

export function getTimestamp(value: string | Date | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
