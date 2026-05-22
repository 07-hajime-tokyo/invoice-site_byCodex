/**
 * 仕入先文字列に販売サイト名を付与するユーティリティ
 *
 * 駿河屋（店舗名が含まれる）はそのまま表示。
 * それ以外は「販売サイト名 出品者名」の形式に整形する。
 *
 * 判定ルール:
 * - 「駿河屋」を含む → そのまま返す
 * - 「ヤフオク」「Yahoo!オークション」を含む → "ヤフオク ◯◯"
 * - 「ペイペイフリマ」「PayPayフリマ」を含む → "ペイペイフリマ ◯◯"
 * - 「メルカリ」を含む → "メルカリ ◯◯"
 * - 「Amazon」「アマゾン」を含む → "Amazon ◯◯"
 * - 「ラクマ」を含む → "ラクマ ◯◯"
 * - 「ジモティー」を含む → "ジモティー ◯◯"
 * - 「フリル」を含む → "フリル ◯◯"
 * - 「eBay」「ebay」を含む → "eBay ◯◯"
 * - 上記に該当しない → そのまま返す（不明なサイト or 既にサイト名込み）
 */

type SiteRule = {
  keywords: string[];
  label: string;
};

const SITE_RULES: SiteRule[] = [
  { keywords: ["駿河屋"], label: "" },           // 駿河屋はそのまま
  { keywords: ["ヤフオク", "Yahoo!オークション", "yahoo!オークション", "ヤフーオークション"], label: "ヤフオク" },
  { keywords: ["ペイペイフリマ", "PayPayフリマ", "paypayフリマ", "ペイペイ フリマ"], label: "ペイペイフリマ" },
  { keywords: ["メルカリ", "Mercari", "mercari"], label: "メルカリ" },
  { keywords: ["Amazon", "amazon", "アマゾン"], label: "Amazon" },
  { keywords: ["ラクマ", "Rakuma", "rakuma"], label: "ラクマ" },
  { keywords: ["ジモティー", "Jmty", "jmty"], label: "ジモティー" },
  { keywords: ["フリル", "Fril", "fril"], label: "フリル" },
  { keywords: ["eBay", "ebay", "イーベイ"], label: "eBay" },
];

/**
 * URLからサイト名を取得する。
 * - paypay フリマ系 → "ペイペイフリマ"
 * - mercari → "メルカリ"
 * - yahoo auctions → "ヤフオク"
 * - amazon → "Amazon"
 * - surugaya → "駿河屋"
 * - その他 → ホスト名
 */
const URL_SITE_RULES: { pattern: RegExp; label: string }[] = [
  { pattern: /paypayfleamarket|paypay.*flea|paypay-flea/i, label: "ペイペイフリマ" },
  { pattern: /mercari\.com|mercari\.jp/i, label: "メルカリ" },
  { pattern: /auctions\.yahoo|aucfan\.com/i, label: "ヤフオク" },
  { pattern: /amazon\.co\.jp|amazon\.com/i, label: "Amazon" },
  { pattern: /surugaya\.co\.jp|suruga-ya\.jp/i, label: "駿河屋" },
  { pattern: /rakuten\.co\.jp/i, label: "楽天" },
  { pattern: /bookoff\.co\.jp/i, label: "ブックオフ" },
  { pattern: /hardoff\.co\.jp/i, label: "ハードオフ" },
  { pattern: /netoff\.co\.jp/i, label: "ネットオフ" },
  { pattern: /2ndstreet\.jp/i, label: "セカンドストリート" },
  { pattern: /geo\.ne\.jp/i, label: "ゲオ" },
  { pattern: /janpara\.co\.jp/i, label: "じゃんぱら" },
  { pattern: /sofmap\.com/i, label: "ソフマップ" },
  { pattern: /yodobashi\.com/i, label: "ヨドバシカメラ" },
  { pattern: /bic\.camera/i, label: "ビックカメラ" },
  { pattern: /joshin\.co\.jp/i, label: "ジョーシン" },
  { pattern: /kojima\.net/i, label: "コジマ" },
  { pattern: /nojima\.co\.jp/i, label: "ノジマ" },
  { pattern: /shopping\.yahoo\.co\.jp/i, label: "Yahoo!ショッピング" },
  { pattern: /qoo10\.jp/i, label: "Qoo10" },
  { pattern: /ebay\.com/i, label: "eBay" },
  { pattern: /aliexpress\.com/i, label: "AliExpress" },
  { pattern: /buyee\.jp/i, label: "Buyee" },
  { pattern: /fril\.jp/i, label: "フリル" },
  { pattern: /mbok\.jp/i, label: "モバオク" },
  { pattern: /jmty\.jp/i, label: "ジモティー" },
];

export function getSiteNameFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  for (const rule of URL_SITE_RULES) {
    if (rule.pattern.test(trimmed)) return rule.label;
  }
  try {
    const host = new URL(trimmed).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return "";
  }
}

/**
 * 在庫一覧・入庫履歴用の仕入先表示文字列を生成する。
 *
 * 優先順位:
 * 1. supplierUrl がある場合 → URLからサイト名を判別して「サイト名 出品者名」形式に整形
 *    - 駿河屋の場合は supplierName をそのまま返す（店舗名が既に含まれているため）
 *    - 出品者名（supplierName）がない場合はサイト名のみ返す
 * 2. supplierUrl がない場合 → supplierName をそのまま返す
 * 3. どちらもない場合 → fallback を返す
 *
 * @param supplierUrl inventory_extras.supplierUrl
 * @param supplierName inventory_extras.supplierName
 * @param fallback フォールバック用の文字列（supplier フィールド等）
 */
export function buildSupplierDisplay(
  supplierUrl: string | null | undefined,
  supplierName: string | null | undefined,
  fallback?: string | null
): string {
  const url = (supplierUrl ?? "").trim();
  const name = (supplierName ?? "").trim();
  const fb = (fallback ?? "").trim();

  if (url) {
    const siteName = getSiteNameFromUrl(url);
    // 駿河屋はそのまま（店舗名が既に含まれている）
    if (siteName === "駿河屋") return name || siteName;
    if (siteName && name) {
      // nameが既にsiteNameで始まっている場合は重複を避ける
      // 例: siteName="Amazon", name="Amazon モノモロストア" → "Amazon モノモロストア"
      if (name.startsWith(siteName)) return name;
      return `${siteName} ${name}`;
    }
    if (siteName) return siteName;
    if (name) return name;
  }

  if (name) return name;
  return fb;
}

/**
 * 販売サイト名（supplierSite）と出品者名（csvSupplierName）を結合して表示用文字列を生成する。
 *
 * - supplierSite と csvSupplierName の両方がある場合: "ペイペイフリマ 星川みつき"
 * - supplierSite のみ: "ペイペイフリマ"
 * - csvSupplierName のみ: そのまま返す（サイト名不明）
 * - どちらもない場合: customer_name を返す
 *
 * @param supplierSite etc[2] から取得した販売サイト名
 * @param csvSupplierName CSV N列から取得した出品者名
 * @param customerName フォールバック用の取引先名
 */
export function combineSupplierInfo(
  supplierSite: string,
  csvSupplierName: string | null | undefined,
  customerName?: string | null
): string {
  const site = supplierSite.trim();
  const seller = (csvSupplierName ?? "").trim();
  const fallback = (customerName ?? "").trim();

  if (site && seller) {
    // 駿河屋の場合は出品者名（店舗名）をそのまま使う
    if (site.includes("駿河屋")) return site;
    // sellerが既にsiteで始まっている場合は重複を避けてsellerをそのまま返す
    // 例: site="Amazon", seller="Amazon モノモロストア" → "Amazon モノモロストア"
    if (seller.startsWith(site)) return seller;
    return `${site} ${seller}`;
  }
  if (site) return site;
  if (seller) return seller;
  return fallback;
}

/**
 * 仕入先文字列を「サイト名 出品者名」形式に整形する。
 * 駿河屋の場合はそのまま返す。
 * サイト名が判定できない場合はそのまま返す。
 *
 * @param supplier etc フィールドの3番目（仕入先）
 * @returns 整形後の仕入先文字列
 */
export function formatSupplier(supplier: string): string {
  if (!supplier) return supplier;

  for (const rule of SITE_RULES) {
    const matched = rule.keywords.some((kw) => supplier.includes(kw));
    if (!matched) continue;

    // 駿河屋はそのまま返す
    if (rule.label === "") return supplier;

    // 既にサイト名で始まっている場合はそのまま返す
    if (supplier.startsWith(rule.label)) return supplier;

    // 出品者名 = サイト名キーワードを除去した残り
    let sellerName = supplier;
    for (const kw of rule.keywords) {
      sellerName = sellerName.replace(kw, "").trim();
    }
    // 区切り文字（スペース、「の」、「：」、「:」）を除去
    sellerName = sellerName.replace(/^[\s　の：:・_\-]+/, "").trim();

    if (sellerName) {
      return `${rule.label} ${sellerName}`;
    } else {
      return rule.label;
    }
  }

  // 判定できなかった場合はそのまま
  return supplier;
}
