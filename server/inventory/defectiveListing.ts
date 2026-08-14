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

export type DefectTag = (typeof DEFECT_TAGS)[number];
export type DefectPhotoKind = (typeof DEFECT_PHOTO_KINDS)[number];
export type DefectPhoto = { url: string; key: string; kind: DefectPhotoKind };

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
  defectTags: readonly string[]
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
  return [core || normalized, defectTags[0] || "ジャンク"]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function generateDefectiveTitle(input: {
  productName: string;
  defectTags: readonly string[];
  photoCount: number;
}) {
  const brand = extractBrand(input.productName);
  const productName = productNameWithoutLeadingBrand(input.productName, brand);
  const warning = input.photoCount === 0 ? PHOTO_WARNING_PREFIX : "";
  const suffix = ` ${input.defectTags[0] || "その他"}`;
  const fixed = `${warning}${TITLE_PREFIX}${brand ? `${brand} ` : ""}`;
  const available =
    TITLE_LIMIT - codePoints(fixed).length - codePoints(suffix).length;
  return `${fixed}${takeCodePoints(productName, available)}${suffix}`;
}

export function generateDefectiveDescription(input: {
  productName: string;
  defectTags: readonly string[];
  defectNote?: string | null;
  quantity?: number;
}) {
  const defects = [
    ...input.defectTags.map(tag => `・${tag}`),
    ...(input.defectNote?.trim() ? [`・${input.defectNote.trim()}`] : []),
  ].join("\n");
  const fixed = (input.quantity ?? 1) > 1 ? FIXED_BUNDLE : FIXED_SINGLE;
  return `商品説明
${input.productName.trim()} の出品です。

不良内容
${defects || "・その他"}

付属品
・写真に写っているものがすべてです

${fixed}`;
}

export type DefectiveSheetPayload = {
  secret?: string;
  action: "writeDefectiveRow";
  sheetName: "不良在庫";
  productId: string;
  inspectedAt: string;
  productName: string;
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
}): DefectiveSheetPayload {
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
    }),
    listingDescription: generateDefectiveDescription({
      productName: input.productName,
      defectTags: input.defectTags,
      defectNote: input.defectNote,
      quantity: input.quantity,
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
