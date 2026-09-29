import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";

export type DateLike = string | Date | null | undefined;

// APIの列定義を正本にし、画面で扱う日時だけ文字列も許容する。
type WorkOutput = inferRouterOutputs<AppRouter>["inventory"]["workLogs"];
export type WorkLogRecord = Omit<
  WorkOutput["list"][number],
  "startedAt" | "endedAt" | "createdAt" | "updatedAt"
> & {
  startedAt: DateLike;
  endedAt: DateLike;
  createdAt: DateLike;
};
export type WorkOption = Pick<
  WorkOutput["options"]["workers"][number],
  "id" | "name" | "sortOrder"
>;

export type WorkLogForm = {
  workerName: string;
  category: string;
  customCategory: string;
  startedAt: string;
  endedAt: string;
  manualMinutes: string;
  quantity: string;
  memo: string;
  status: "running" | "done";
  sourceType?: string | null;
  sourceId?: string | null;
  detailsJson?: string | null;
};

export type SplitDraft = {
  category: string;
  customCategory: string;
  manualMinutes: string;
  quantity: string;
  memo: string;
};

export type DeliveryDetails = {
  deliveryNo?: string | null;
  deliveryDate?: string | null;
  trackingNumber?: string | null;
  items?: Array<{
    inventoryId?: number | string | null;
    title?: string | null;
    quantity?: number | string | null;
    managementNo?: string | null;
  }>;
};

export const DURATION_PRESETS = [30, 60, 90, 120, 150, 180];

export function toDate(value: DateLike) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toLocalDateTimeInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function toInputDateTime(value: DateLike) {
  const date = toDate(value);
  return date ? toLocalDateTimeInput(date) : "";
}

export function formatDateTime(value: DateLike) {
  const date = toDate(value);
  if (!date) return "-";
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parseNumber(value: string, fallback = 0) {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

export function parseOptionalMinutes(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

export function getDurationMinutes(log: WorkLogRecord, now: Date) {
  if (typeof log.manualMinutes === "number") return log.manualMinutes;
  const started = toDate(log.startedAt);
  const ended = toDate(log.endedAt);
  if (started && ended)
    return Math.max(
      0,
      Math.round((ended.getTime() - started.getTime()) / 60000)
    );
  if (log.status === "running" && started)
    return Math.max(0, Math.round((now.getTime() - started.getTime()) / 60000));
  return 0;
}

export function formatMinutes(minutes: number) {
  if (minutes <= 0) return "0分";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  if (rest === 0) return `${hours}時間`;
  return `${hours}時間${rest}分`;
}

export function parseDetails(
  json: string | null | undefined
): DeliveryDetails | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as DeliveryDetails;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasDetails(log: WorkLogRecord) {
  return (
    log.sourceType === "delivery" &&
    Boolean(parseDetails(log.detailsJson)?.items?.length)
  );
}

export function initialForm(): WorkLogForm {
  return {
    workerName: "鈴木",
    category: "入庫登録",
    customCategory: "",
    startedAt: "",
    endedAt: "",
    manualMinutes: "",
    quantity: "0",
    memo: "",
    status: "done",
  };
}

export function formFromLog(log: WorkLogRecord): WorkLogForm {
  return {
    workerName: log.workerName,
    category: log.category,
    customCategory: "",
    startedAt: toInputDateTime(log.startedAt),
    endedAt: toInputDateTime(log.endedAt),
    manualMinutes: log.manualMinutes == null ? "" : String(log.manualMinutes),
    quantity: String(log.quantity ?? 0),
    memo: log.memo ?? "",
    status: log.status === "running" ? "running" : "done",
    sourceType: log.sourceType,
    sourceId: log.sourceId,
    detailsJson: log.detailsJson,
  };
}

export function initialSplitDraft(
  categoryOptions: WorkOption[] = []
): SplitDraft {
  const preferredCategory =
    categoryOptions.find(item => item.name === "出庫登録") ??
    categoryOptions.find(item => item.name !== "その他") ??
    categoryOptions[0];
  return {
    category: preferredCategory?.name ?? "その他",
    customCategory: "",
    manualMinutes: "30",
    quantity: "0",
    memo: "",
  };
}

export function resolveCategory(
  target: Pick<WorkLogForm, "category" | "customCategory">
) {
  if (target.category === "その他") return target.customCategory.trim();
  return target.category.trim();
}

export const createPayloadFromForm = (target: WorkLogForm) => ({
  workerName: target.workerName.trim(),
  category: resolveCategory(target),
  startedAt: target.startedAt || undefined,
  endedAt: target.endedAt || undefined,
  manualMinutes: parseOptionalMinutes(target.manualMinutes),
  quantity: parseNumber(target.quantity),
  memo: target.memo.trim() || undefined,
  sourceType: target.sourceType ?? undefined,
  sourceId: target.sourceId ?? undefined,
  detailsJson: target.detailsJson ?? undefined,
});

export function summarizeCompletedLogs(
  completedLogs: WorkLogRecord[],
  now: Date
) {
  const totalMinutes = completedLogs.reduce(
    (sum, log) => sum + getDurationMinutes(log, now),
    0
  );
  const totalQuantity = completedLogs.reduce(
    (sum, log) => sum + log.quantity,
    0
  );
  const byCategory = new Map<
    string,
    { count: number; minutes: number; quantity: number }
  >();
  for (const log of completedLogs) {
    const current = byCategory.get(log.category) ?? {
      count: 0,
      minutes: 0,
      quantity: 0,
    };
    current.count += 1;
    current.minutes += getDurationMinutes(log, now);
    current.quantity += log.quantity;
    byCategory.set(log.category, current);
  }
  return {
    totalMinutes,
    totalQuantity,
    categoryRows: Array.from(byCategory.entries()).map(([name, values]) => ({
      name,
      ...values,
    })),
  };
}
