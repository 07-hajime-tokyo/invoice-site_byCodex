import type { YahooClosedPrices } from "./yahooClosedPrices";

export const DEFECT_TAGS = [
  "通電せず",
  "起動しない",
  "画面不良",
  "バッテリー不良",
  "充電不可",
  "ボタン・スティック不良",
  "外装破損",
  "付属品欠品",
  "その他",
] as const;

export const DEFECT_PHOTO_KINDS = ["whole", "defect", "accessory"] as const;

/**
 * ヤフオクへ回す理由の区分。
 * - junk: 不良品。動作保証なしのジャンクとして出す
 * - surplus: 動作するが自社では不要になった在庫。ジャンク扱いにはしない
 */
export const LISTING_KINDS = ["junk", "surplus"] as const;

export type DefectTag = (typeof DEFECT_TAGS)[number];
export type DefectPhotoKind = (typeof DEFECT_PHOTO_KINDS)[number];
export type DefectPhoto = { url: string; key: string; kind: DefectPhotoKind };
export type ListingKind = (typeof LISTING_KINDS)[number];

/** 区分を持たない旧データはすべてジャンクとして扱う */
export function normalizeListingKind(
  value: string | null | undefined
): ListingKind {
  return value === "surplus" ? "surplus" : "junk";
}

export const LISTING_KIND_SHEET_LABELS: Record<ListingKind, string> = {
  junk: "ジャンク",
  surplus: "不要在庫",
};

const KNOWN_BRANDS = [
  "Microsoft",
  "Nintendo",
  "任天堂",
  "Sony",
  "SONY",
  "Apple",
  "Canon",
  "Nikon",
  "Panasonic",
  "Fujifilm",
  "FUJIFILM",
  "Olympus",
  "OLYMPUS",
  "Casio",
  "CASIO",
  "Sega",
  "SEGA",
  "Dell",
  "DELL",
  "HP",
  "Lenovo",
] as const;

const TITLE_PREFIX = "【ジャンク】";
const PHOTO_WARNING_PREFIX = "【写真未撮影】";
const TITLE_LIMIT = 65;
/** 動作品は不良タグを持たないので、タイトル末尾に状態を明示する */
const SURPLUS_TITLE_SUFFIX = "動作確認済";

const FIXED_SINGLE = `状態
・ジャンク品です
・中古品のため、スレや小傷があります
・写真に写っているものがすべてです

注意事項
・ジャンク品のため動作保証はありません。部品取り・修理前提でご検討ください
・記載した不良以外にも不具合がある可能性があります
・返品・交換・返金はお受けできません
・中古品のため神経質な方はご遠慮ください
・到着後の細かな状態差異はご容赦ください
・現状渡しとなりますので、ご理解いただける方のみ購入をお願いいたします`;

const FIXED_BUNDLE = `状態
・すべてジャンク品です。動作品は含まれません
・中古品のため、スレや小傷があります
・写真に写っているものがすべてです

注意事項
・ジャンク品のため動作保証はありません。部品取り・修理前提でご検討ください
・個体ごとの不良内容は上記のとおりです。記載以外の不具合がある可能性があります
・1点のみの販売・分割販売・お値引きはお受けできません
・返品・交換・返金はお受けできません
・中古品のため神経質な方はご遠慮ください
・到着後の細かな状態差異はご容赦ください
・現状渡しとなりますので、ご理解いただける方のみ購入をお願いいたします`;

const FIXED_SINGLE_WORKING = `状態
・動作確認済みです
・中古品のため、スレや小傷があります
・写真に写っているものがすべてです

注意事項
・中古品のため、経年による劣化やスレ・小傷があります
・記載・写真にない細かな傷が見つかる場合があります
・返品・交換・返金はお受けできません
・中古品のため神経質な方はご遠慮ください
・到着後の細かな状態差異はご容赦ください
・現状渡しとなりますので、ご理解いただける方のみ購入をお願いいたします`;

const FIXED_BUNDLE_WORKING = `状態
・すべて動作確認済みです
・中古品のため、スレや小傷があります
・写真に写っているものがすべてです

注意事項
・中古品のため、経年による劣化やスレ・小傷があります
・記載・写真にない細かな傷が見つかる場合があります
・1点のみの販売・分割販売・お値引きはお受けできません
・返品・交換・返金はお受けできません
・中古品のため神経質な方はご遠慮ください
・到着後の細かな状態差異はご容赦ください
・現状渡しとなりますので、ご理解いただける方のみ購入をお願いいたします`;

function codePoints(value: string) {
  return Array.from(value);
}

function takeCodePoints(value: string, count: number) {
  return codePoints(value).slice(0, Math.max(0, count)).join("").trimEnd();
}

export function extractBrand(productName: string) {
  const normalized = productName.normalize("NFKC");
  return (
    KNOWN_BRANDS.find(brand =>
      new RegExp(`(^|\\s)${brand}(?=\\s|$)`, "i").test(normalized)
    ) ?? ""
  );
}

function productNameWithoutLeadingBrand(productName: string, brand: string) {
  if (!brand) return productName.normalize("NFKC").trim();
  return productName
    .normalize("NFKC")
    .replace(new RegExp(`^${brand}\\s*`, "i"), "")
    .trim();
}

export function generateYahooKeyword(
  productName: string,
  defectTags: readonly string[],
  listingKind: ListingKind = "junk"
) {
  const normalized = productName.normalize("NFKC").replace(/\s+/g, " ").trim();
  const brand = extractBrand(normalized);
  const tokens = normalized.split(" ").filter(Boolean);
  const modelTokens = tokens.filter(token =>
    /(?=.*\d)[A-Za-z0-9][A-Za-z0-9._/-]*/.test(token)
  );
  const fallbackTokens = tokens.filter(
    token => !/^(中古|美品|本体のみ|本体|動作未確認|ジャンク)$/u.test(token)
  );
  const core = Array.from(
    new Set(
      [brand, ...modelTokens, ...fallbackTokens.slice(0, 4)].filter(Boolean)
    )
  )
    .slice(0, 6)
    .join(" ");
  // 動作品はジャンク相場と混ざると中央値が下振れするので、状態語を足さずに引く
  const conditionWord =
    listingKind === "surplus" ? "" : defectTags[0] || "ジャンク";
  return [core || normalized, conditionWord].filter(Boolean).join(" ").trim();
}

export function generateDefectiveTitle(input: {
  productName: string;
  defectTags: readonly string[];
  photoCount: number;
  listingKind?: ListingKind;
}) {
  const listingKind = input.listingKind ?? "junk";
  const brand = extractBrand(input.productName);
  const productName = productNameWithoutLeadingBrand(input.productName, brand);
  const warning = input.photoCount === 0 ? PHOTO_WARNING_PREFIX : "";
  const suffix =
    listingKind === "surplus"
      ? ` ${SURPLUS_TITLE_SUFFIX}`
      : ` ${input.defectTags[0] || "その他"}`;
  // 動作品に【ジャンク】を付けると相場を自分から下げてしまう
  const kindPrefix = listingKind === "surplus" ? "" : TITLE_PREFIX;
  const fixed = `${warning}${kindPrefix}${brand ? `${brand} ` : ""}`;
  const available =
    TITLE_LIMIT - codePoints(fixed).length - codePoints(suffix).length;
  return `${fixed}${takeCodePoints(productName, available)}${suffix}`;
}

export function generateDefectiveDescription(input: {
  productName: string;
  defectTags: readonly string[];
  defectNote?: string | null;
  quantity?: number;
  listingKind?: ListingKind;
}) {
  const listingKind = input.listingKind ?? "junk";
  const bundle = (input.quantity ?? 1) > 1;
  const note = input.defectNote?.trim();
  if (listingKind === "surplus") {
    const condition = [
      bundle ? "・すべて動作確認済みです" : "・動作確認済みです",
      ...(note ? [`・${note}`] : []),
    ].join("\n");
    return `商品説明
${input.productName.trim()} の出品です。

商品の状態
${condition}

付属品
・写真に写っているものがすべてです

${bundle ? FIXED_BUNDLE_WORKING : FIXED_SINGLE_WORKING}`;
  }
  const defects = [
    ...input.defectTags.map(tag => `・${tag}`),
    ...(note ? [`・${note}`] : []),
  ].join("\n");
  return `商品説明
${input.productName.trim()} の出品です。

不良内容
${defects || "・その他"}

付属品
・写真に写っているものがすべてです

${bundle ? FIXED_BUNDLE : FIXED_SINGLE}`;
}

export type DefectiveSheetPayload = {
  secret?: string;
  action: "writeDefectiveRow";
  sheetName: "不良在庫";
  productId: string;
  inspectedAt: string;
  productName: string;
  listingKind: string;
  defectTags: string;
  defectNote: string;
  photos: string[];
  photoCount: number | "写真なし";
  unitPrice: number | null;
  keyword: string;
  adoptedCount: number;
  median: number | "該当なし";
  marketMin: number | "該当なし";
  marketMax: number | "該当なし";
  samples: YahooClosedPrices["samples"];
  fetchedAt: string;
  listingTitle: string;
  listingDescription: string;
};

export function buildDefectiveSheetPayload(input: {
  productId: string;
  inspectedAt: Date;
  productName: string;
  defectTags: readonly string[];
  defectNote?: string | null;
  photos: readonly DefectPhoto[];
  unitPrice?: string | number | null;
  market: YahooClosedPrices;
  quantity?: number;
  listingKind?: ListingKind;
}): DefectiveSheetPayload {
  const listingKind = input.listingKind ?? "junk";
  const noMarket = input.market.adopted.count === 0;
  const numericUnitPrice =
    input.unitPrice == null || input.unitPrice === ""
      ? null
      : Number(input.unitPrice);
  return {
    action: "writeDefectiveRow",
    sheetName: "不良在庫",
    productId: input.productId,
    inspectedAt: input.inspectedAt.toISOString(),
    productName: input.productName,
    listingKind: LISTING_KIND_SHEET_LABELS[listingKind],
    defectTags: input.defectTags.join(","),
    defectNote: input.defectNote?.trim() ?? "",
    photos: input.photos.map(photo => photo.url),
    photoCount: input.photos.length === 0 ? "写真なし" : input.photos.length,
    unitPrice: Number.isFinite(numericUnitPrice) ? numericUnitPrice : null,
    keyword: input.market.keyword,
    adoptedCount: input.market.adopted.count,
    median: noMarket ? "該当なし" : (input.market.adopted.median ?? "該当なし"),
    marketMin: noMarket ? "該当なし" : (input.market.adopted.min ?? "該当なし"),
    marketMax: noMarket ? "該当なし" : (input.market.adopted.max ?? "該当なし"),
    samples: input.market.samples,
    fetchedAt: input.market.fetchedAt,
    listingTitle: generateDefectiveTitle({
      productName: input.productName,
      defectTags: input.defectTags,
      photoCount: input.photos.length,
      listingKind,
    }),
    listingDescription: generateDefectiveDescription({
      productName: input.productName,
      defectTags: input.defectTags,
      defectNote: input.defectNote,
      quantity: input.quantity,
      listingKind,
    }),
  };
}

export function mergeSiteCellsWithoutHumanColumns(
  existing: Record<string, unknown>,
  siteCells: Record<string, unknown>
) {
  const humanColumns = new Set([
    "開始価格",
    "出品ステータス",
    "出品URL",
    "落札額",
  ]);
  return Object.fromEntries([
    ...Object.entries(existing),
    ...Object.entries(siteCells).filter(
      ([column]) => !humanColumns.has(column)
    ),
  ]);
}
