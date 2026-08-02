/**
 * 在庫変動履歴
 *
 * 在庫の作成・更新・削除を inventory_memos テーブルへ自動記録する。
 * これまでは「在庫数変更」ダイアログから手動で登録したときだけ履歴が残り、
 * 編集フォームやAPI経由の変更は痕跡が残らなかった。
 *
 * 記録に失敗しても本体の更新は成功させる（履歴のためにユーザー操作を失敗させない）。
 */

import { createInventoryMemo } from "./db";

/** 変更の種類。既存の increase / decrease / set と併存させる */
export type InventoryChangeType = "created" | "updated" | "deleted";

/** 変更元。どこからの操作かを memo に残して原因追跡に使う */
export type InventoryChangeSource = "ui" | "api" | "cron" | "delivery" | "purchase";

type FieldKey =
  | "title"
  | "quantity"
  | "unit"
  | "category"
  | "place"
  | "etc"
  | "unitPrice"
  | "supplierName"
  | "supplierUrl"
  | "ebayListingUrl"
  | "ebayOrderUrl"
  | "ebayOrderStatus";

const FIELD_LABELS: Record<FieldKey, string> = {
  title: "商品名",
  quantity: "在庫数",
  unit: "単位",
  category: "カテゴリ",
  place: "保管場所",
  etc: "管理番号・備考",
  unitPrice: "仕入単価",
  supplierName: "仕入先",
  supplierUrl: "仕入先URL",
  ebayListingUrl: "eBay出品URL",
  ebayOrderUrl: "eBay注文URL",
  ebayOrderStatus: "eBay状態",
};

const TRACKED_FIELDS = Object.keys(FIELD_LABELS) as FieldKey[];

export type InventoryFieldValues = Partial<Record<FieldKey, unknown>>;

function normalize(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** 表示用に長い値を切り詰める */
function truncate(value: string | null, max = 60): string {
  if (value == null) return "（空）";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export type FieldDiff = { field: FieldKey; label: string; before: string | null; after: string | null };

/** 変更前後を比較して、実際に変わった項目だけ返す */
export function diffInventoryFields(
  before: InventoryFieldValues,
  after: InventoryFieldValues
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of TRACKED_FIELDS) {
    // after に含まれない項目は「変更対象外」として比較しない
    if (!(field in after)) continue;
    const beforeValue = normalize(before[field]);
    const afterValue = normalize(after[field]);
    if (beforeValue === afterValue) continue;
    diffs.push({ field, label: FIELD_LABELS[field], before: beforeValue, after: afterValue });
  }
  return diffs;
}

function toInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = Math.floor(Number(value));
  return Number.isFinite(num) ? num : null;
}

export type RecordInventoryChangeParams = {
  inventoryId: number;
  title?: string | null;
  changeType: InventoryChangeType;
  source: InventoryChangeSource;
  diffs?: FieldDiff[];
  quantityBefore?: unknown;
  quantityAfter?: unknown;
  operatorName?: string | null;
  /** 追加で残したい一言 */
  note?: string | null;
};

/**
 * 在庫の変更を1件記録する。
 * 例外は握りつぶす（呼び出し元の更新処理を巻き込まないため）。
 */
export async function recordInventoryChange(params: RecordInventoryChangeParams): Promise<void> {
  try {
    const quantityBefore = toInt(params.quantityBefore);
    const quantityAfter = toInt(params.quantityAfter);
    const quantityDelta =
      quantityBefore != null && quantityAfter != null ? quantityAfter - quantityBefore : null;

    const parts: string[] = [];
    if (params.changeType === "created") parts.push("新規登録");
    else if (params.changeType === "deleted") parts.push("削除");

    for (const diff of params.diffs ?? []) {
      parts.push(`${diff.label}: ${truncate(diff.before)} → ${truncate(diff.after)}`);
    }
    if (params.note) parts.push(params.note);
    parts.push(`[${params.source}]`);

    await createInventoryMemo({
      zaicoInventoryId: params.inventoryId,
      title: params.title ?? null,
      changeType: params.changeType,
      quantityBefore,
      quantityAfter,
      quantityDelta,
      memo: parts.join(" / ").slice(0, 1000),
      operatorName: params.operatorName ?? null,
    });
  } catch (error) {
    console.error("[changeLog] failed to record inventory change", error);
  }
}
