// AddTradeDialog から抽出した型・定数・純粋関数（逐語移動）

export interface FormState {
  month: string;
  partner: string;
  invoiceNo: string;
  paymentDate: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  currency: "ユーロ" | "ドル";
  status: string;
  eurRate: string;
  usdRate: string;
  shippingCost: string; // 送料（550×注文数で自動計算、手動編集可）
}

export interface InvoiceApplyPreview {
  invoiceNo: string;
  partner: string;
  month: number;
  paymentDate: string;
  currency: FormState["currency"];
  eurRate: number;
  usdRate: number;
  rows: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
  }>;
}

export const DEFAULT_TRADE_PARTNERS = ["ルカ", "サミー", "デボン", "サイモン", "マキシム", "ネレ"] as const;

export function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createInitialForm(): FormState {
  const today = getTodayDateString();
  return {
    month: String(new Date(`${today}T00:00:00`).getMonth() + 1),
    partner: "",
    invoiceNo: "",
    paymentDate: today,
    productName: "",
    quantity: "",
    unitPrice: "",
    currency: "ユーロ",
    status: "",
    eurRate: "",
    usdRate: "",
    shippingCost: "",
  };
}

export function getCurrencyForPartner(partner: string): FormState["currency"] {
  const normalized = partner.trim().toLowerCase();
  if (
    normalized.includes("ルカ") ||
    normalized.includes("luca") ||
    normalized.includes("サイモン") ||
    normalized.includes("simon") ||
    normalized.includes("マキシム") ||
    normalized.includes("maxim") ||
    normalized.includes("ネレ") ||
    normalized.includes("nele")
  ) return "ユーロ";
  return "ドル";
}

export function isHiddenTradePartner(name: string | null | undefined) {
  const normalized = String(name ?? "").normalize("NFKC").trim().toLowerCase();
  return normalized === "hennes kamusien";
}

// 取引相手名の英語→日本語マッピング
export const PARTNER_MAP: Record<string, string> = {
  "luca": "ルカ",
  "luca neumann": "ルカ",
  "samee": "サミー",
  "sami": "サミー",
  "sammy": "サミー",
  "devon": "デボン",
  "devon brako": "デボン",
  "simon": "サイモン",
  "hennes kamusien": "サイモン",
  "maxim": "マキシム",
  "nele": "ネレ",
};

// 商品名・フレーズの英語→日本語変換マッピング（部分一致・置換）
export const PRODUCT_WORD_MAP: Array<[RegExp, string]> = [
  [/random\s*color/gi, "ランダムカラー"],
  [/turquoise/gi, "ターコイズ"],
  [/white\s*base/gi, "ホワイトベース"],
  [/black/gi, "ブラック"],
  [/white/gi, "ホワイト"],
  [/red/gi, "レッド"],
  [/blue/gi, "ブルー"],
  [/yellow/gi, "イエロー"],
  [/green/gi, "グリーン"],
  [/pink/gi, "ピンク"],
  [/purple/gi, "パープル"],
  [/silver/gi, "シルバー"],
  [/gold/gi, "ゴールド"],
  [/coral\s*pink/gi, "コーラルピンク"],
  [/mint/gi, "ミント"],
  [/orange/gi, "オレンジ"],
];

// 部分一致マッピング（先頭の単語で判定）
export const PARTNER_PREFIX_MAP: Array<[RegExp, string]> = [
  [/^luca\b/i, "ルカ"],
  [/^samee\b/i, "サミー"],
  [/^sami\b/i, "サミー"],
  [/^sammy\b/i, "サミー"],
  [/^devon\b/i, "デボン"],
  [/^simon\b/i, "サイモン"],
  [/^maxim\b/i, "マキシム"],
  [/^nele\b/i, "ネレ"],
];

export function toJapanesePartner(name: string): string {
  const trimmed = name.trim();
  const key = trimmed.toLowerCase();
  // 完全一致を優先
  if (PARTNER_MAP[key]) return PARTNER_MAP[key];
  // 前方部分一致（フルネーム対応）
  for (const [pattern, japanese] of PARTNER_PREFIX_MAP) {
    if (pattern.test(trimmed)) return japanese;
  }
  return trimmed;
}

export function toJapaneseProductName(name: string): string {
  let result = name;
  for (const [pattern, replacement] of PRODUCT_WORD_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
