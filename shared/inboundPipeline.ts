/**
 * 入庫仕訳・工程パイプライン（T22）
 *
 * 荷受を分類（eBay発送待ち / オレゴン倉庫 / 直取 / 国内出品・発送待ち）へ仕訳し、
 * 分類ごとの作業工程（荷受→登録→…）を1つずつ進めるための、
 * サーバー・クライアント共有の純ロジック層。
 *
 * ここには DB や tRPC への依存を持ち込まず、入力→出力が決まる純関数のみを置く
 * （テスト可能に保つ / ヒューリスティックを1箇所に集約するため）。
 */

import { extractManagementNo, isEbayManagementNo } from "./ebayInventory";

/** 入庫分類。null = 未仕訳 */
export type InboundClass = "ebay" | "oregon" | "direct" | "domestic";

/** 分類の判定根拠。auto=自動判定 / manual=人間が上書き */
export type ClassSource = "auto" | "manual";

/** タブに出す分類の並び順（未仕訳は先頭ゲート、完了は各タブ内） */
export const INBOUND_CLASS_ORDER: readonly InboundClass[] = [
  "ebay",
  "oregon",
  "direct",
  "domestic",
] as const;

/** 分類ラベル（画面表示用） */
export const INBOUND_CLASS_LABEL: Record<InboundClass, string> = {
  ebay: "eBay発送待ち",
  oregon: "オレゴン倉庫",
  direct: "直取",
  domestic: "国内出品・発送待ち",
};

/** 未仕訳（inboundClass=null）のタブラベル */
export const UNCLASSIFIED_LABEL = "未仕訳";

export function getInboundClassLabel(value: InboundClass | null | undefined): string {
  if (value && value in INBOUND_CLASS_LABEL) return INBOUND_CLASS_LABEL[value];
  return UNCLASSIFIED_LABEL;
}

// ============================================================
// 工程（stage）定義
// ============================================================

/**
 * 分類ごとの工程列。順に1つずつ進む前提。
 * 末尾が「完了」工程。
 */
export const INBOUND_STAGES: Record<InboundClass, readonly string[]> = {
  ebay: ["received", "registered", "labeled", "packed"],
  oregon: ["received", "registered", "warehouse_shipped"],
  direct: ["received", "registered", "handed_over"],
  domestic: ["registered", "listed", "shipped"],
};

/** 未仕訳のとき（分類未定）に取りうる初期工程 */
export const DEFAULT_STAGE = "received";

/** 工程コード→日本語ラベル */
export const STAGE_LABEL: Record<string, string> = {
  received: "荷受",
  registered: "登録",
  labeled: "ラベル",
  packed: "梱包",
  warehouse_shipped: "倉庫発送",
  handed_over: "引渡",
  listed: "出品",
  shipped: "発送",
};

export function getStageLabel(stage: string | null | undefined): string {
  const key = String(stage ?? "").trim();
  return STAGE_LABEL[key] ?? key;
}

/**
 * 指定分類の工程列を返す。分類が未定（null）なら eBay 相当の
 * 「荷受→登録」までを共通の前段として返す（未仕訳でも荷受・登録は共通のため）。
 */
export function getStagesForClass(inboundClass: InboundClass | null | undefined): readonly string[] {
  if (inboundClass && inboundClass in INBOUND_STAGES) return INBOUND_STAGES[inboundClass];
  // 未仕訳: 分類が決まるまでは荷受・登録の2工程だけを見せる
  return ["received", "registered"];
}

/** その分類・工程が「登録」工程かどうか（status=purchased 連動判定に使う） */
export function isRegisterStage(stage: string | null | undefined): boolean {
  return String(stage ?? "").trim() === "registered";
}

export type LocalRegistrationItem = {
  inventoryId: number;
  quantity: number;
  unitPrice: string;
  title: string;
};

/**
 * local_purchases.itemsJson を、実在庫へ反映できる安全な登録明細へ変換する。
 * 壊れたJSONや在庫IDのない行を黙って「登録済み」にしないため、変換不能時は空配列を返す。
 */
export function parseLocalRegistrationItems(
  itemsJson: string | null | undefined,
  fallback?: {
    inventoryId?: number | null;
    quantity?: number | null;
    unitPrice?: string | number | null;
    title?: string | null;
  },
): LocalRegistrationItem[] {
  let rawItems: unknown[] = [];
  try {
    const parsed = JSON.parse(itemsJson ?? "[]");
    if (Array.isArray(parsed)) rawItems = parsed;
  } catch {
    rawItems = [];
  }

  if (rawItems.length === 0 && Number(fallback?.inventoryId) > 0) {
    rawItems = [{
      inventory_id: fallback?.inventoryId,
      quantity: fallback?.quantity ?? 1,
      unit_price: fallback?.unitPrice ?? 0,
      title: fallback?.title ?? "",
    }];
  }

  return rawItems.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const inventoryId = Number(item.inventory_id ?? item.inventoryId);
    const quantity = Number(item.quantity ?? 1);
    if (!Number.isInteger(inventoryId) || inventoryId <= 0) return [];
    if (!Number.isInteger(quantity) || quantity <= 0) return [];
    return [{
      inventoryId,
      quantity,
      unitPrice: String(item.unit_price ?? item.unitPrice ?? fallback?.unitPrice ?? "0"),
      title: String(item.title ?? fallback?.title ?? ""),
    }];
  });
}

/** その分類において stage が最終（完了）工程かどうか */
export function isFinalStage(inboundClass: InboundClass | null | undefined, stage: string | null | undefined): boolean {
  const stages = getStagesForClass(inboundClass);
  const current = String(stage ?? "").trim();
  return stages.length > 0 && stages[stages.length - 1] === current;
}

/** 完了（工程バー全チェック＝最終工程に到達済み）かどうか */
export function isInboundComplete(inboundClass: InboundClass | null | undefined, stage: string | null | undefined): boolean {
  // 分類が決まっていない未仕訳は「完了」扱いにしない
  if (!inboundClass) return false;
  return isFinalStage(inboundClass, stage);
}

/**
 * 次の工程を返す。最終工程またはstageが列に無い場合は null（＝これ以上進めない）。
 */
export function nextStage(
  inboundClass: InboundClass | null | undefined,
  stage: string | null | undefined,
): string | null {
  const stages = getStagesForClass(inboundClass);
  const current = String(stage ?? "").trim();
  const idx = stages.indexOf(current);
  if (idx < 0) {
    // 現stageが列に無い（分類変更直後など）→ 先頭工程から始める
    return stages[0] ?? null;
  }
  if (idx >= stages.length - 1) return null;
  return stages[idx + 1] ?? null;
}

/** stage の 0始まりインデックス（工程バー描画用）。列に無ければ 0 */
export function getStageIndex(
  inboundClass: InboundClass | null | undefined,
  stage: string | null | undefined,
): number {
  const stages = getStagesForClass(inboundClass);
  const idx = stages.indexOf(String(stage ?? "").trim());
  return idx < 0 ? 0 : idx;
}

// ============================================================
// 自動仕訳ロジック（純関数）
// ============================================================

/** 文字列を NFKC 正規化して小文字化（表記ゆれ吸収） */
function normalizeLoose(value: string | null | undefined): string {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

/**
 * オレゴン判定用の表記ゆれ語（ヒューリスティックはここ2語に留める。
 * ユーザー方針: これ以上分岐を増やさず、迷ったら未仕訳に落とす）。
 */
const OREGON_TOKENS = ["オレゴン", "oregon"];

/** place（保管場所/行き先）がオレゴンを指すか */
export function isOregonPlace(place: string | null | undefined): boolean {
  const normalized = String(place ?? "").normalize("NFKC").trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  return OREGON_TOKENS.some((token) => lower.includes(token.toLowerCase()));
}

/**
 * 管理番号の先頭が数字（インボイスNo）で始まるか、その数値プレフィックスを返す。
 * 例: "371_ルカ_..." → "371" / "E0403-12" → null
 */
export function extractInvoicePrefix(managementNo: string | null | undefined): string | null {
  const mn = extractManagementNo(managementNo);
  const match = mn.match(/^(\d{2,6})(?:$|[_\-\s])/);
  return match ? match[1] : null;
}

/**
 * 管理番号の「相手名」トークン候補を返す。
 * 例: "371_ルカ_商品名" → "ルカ" / "サミー_xxx" → "サミー" / "ルカ" → "ルカ"
 * 数値プレフィックスがある場合は2番目のトークン、無い場合は先頭トークンを相手名候補とする。
 */
export function extractPartnerToken(managementNo: string | null | undefined): string {
  const mn = extractManagementNo(managementNo);
  if (!mn) return "";
  const parts = mn.split(/[_\-]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  // 先頭が数値なら2番目、そうでなければ先頭
  if (/^\d{2,6}$/.test(parts[0])) {
    return parts[1] ?? "";
  }
  return parts[0];
}

/**
 * 管理番号が「直取の相手名リスト」に前方一致するか。
 * partnerNames は表示名の配列（初期値: サミー, ルカ, サイモン）。
 * 相手名トークン、または管理番号全体が、いずれかの相手名で前方一致すれば true。
 */
export function matchesDirectPartner(
  managementNo: string | null | undefined,
  partnerNames: readonly string[],
): boolean {
  const token = normalizeLoose(extractPartnerToken(managementNo));
  const whole = normalizeLoose(extractManagementNo(managementNo));
  if (!token && !whole) return false;
  for (const name of partnerNames) {
    const n = normalizeLoose(name);
    if (!n) continue;
    if (token && token.startsWith(n)) return true;
    // 数値プレフィックスが無い管理番号は全体前方一致でも拾う
    if (whole && whole.startsWith(n)) return true;
  }
  return false;
}

export type ClassifyInboundInput = {
  /** 管理番号（etcフィールドの先頭トークン等） */
  managementNo?: string | null;
  /** 行き先・保管場所（自由入力） */
  place?: string | null;
  /** 紐づく在庫の eBay 注文URL（あれば eBay 由来の強い証拠） */
  ebayOrderUrl?: string | null;
  /** 直取の相手名リスト（表示名。初期値: サミー, ルカ, サイモン。設定で追加可能） */
  directPartnerNames?: readonly string[];
  /** 管理番号の数値プレフィックスが、発行済みインボイス番号集合に含まれるか */
  hasLinkedInvoice?: boolean;
};

/**
 * 追跡番号到着時などに1件を自動仕訳する純関数。
 *
 * 優先順位（確定仕様 2026-07-03）:
 *   1. 管理番号が「E」始まり  → ebay
 *   2. 直取判定 = (a) 相手名リスト前方一致 OR (b) 発行済みインボイスに紐づく
 *      - eBay と直取が同時に成立する（=矛盾）行は安全側で未仕訳(null)へ
 *   3. 行き先がオレゴン        → oregon
 *   4. どれも該当なし          → null（未仕訳）
 *
 * ※ 国内(domestic) はシャフト分離操作で明示的に生成されるため、
 *    自動仕訳の出力には含めない（人間の操作起点）。
 *
 * classSource=manual の行はそもそも呼び出し側でスキップする想定。
 */
export function classifyInbound(input: ClassifyInboundInput): InboundClass | null {
  const managementNo = input.managementNo ?? "";
  const hasEbayUrl = Boolean(String(input.ebayOrderUrl ?? "").trim());
  const isEbay = hasEbayUrl || isEbayManagementNo(managementNo);

  const partnerNames = input.directPartnerNames ?? [];
  const matchesPartner = matchesDirectPartner(managementNo, partnerNames);
  const linkedInvoice = Boolean(input.hasLinkedInvoice);
  const isDirect = matchesPartner || linkedInvoice;

  // (a)(b)等の判定が矛盾する行は未仕訳へ（安全側）。
  // eBay の強い証拠と直取の証拠が両立する場合は人間に委ねる。
  if (isEbay && isDirect) return null;

  if (isEbay) return "ebay";
  if (isDirect) return "direct";

  if (isOregonPlace(input.place)) return "oregon";

  return null;
}

/** 分類が有効な InboundClass 値かどうか（入力バリデーション用） */
export function isInboundClass(value: unknown): value is InboundClass {
  return value === "ebay" || value === "oregon" || value === "direct" || value === "domestic";
}

/** 直取の相手名リストの初期値（設定未登録時のフォールバック） */
export const DEFAULT_DIRECT_PARTNER_NAMES: readonly string[] = ["サミー", "ルカ", "サイモン"] as const;

/** システム設定キー: 直取の相手名リスト（カンマ区切り保存） */
export const DIRECT_PARTNER_NAMES_SETTING_KEY = "inbound_direct_partner_names";
