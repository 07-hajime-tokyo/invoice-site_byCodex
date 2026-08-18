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
/** 動作品の相場から外す状態語。これが混ざると中央値が下がる */
const SURPLUS_EXCLUSIONS = "-ジャンク -部品取り -故障 -訳あり -不動";

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

/**
 * 品名からヤフオクの検索語を決める表。
 *
 * 在庫の品名には仕入先や社内メモが入っている（「益子Switch対策済」「toy net Switch タブレット 対策済」）。
 * これをそのまま検索するとヤフオクの落札がほぼ0件になるので、機種の一般名へ寄せる。
 * 対策済・未対策は相場を分けない（村上さん指示・2026-08-18）。
 *
 * match は品名を NFKC 正規化して小文字にしたものへ当てる。上から順に最初に当たったものを使う。
 */
/**
 * ヤフオクの検索は部分一致なので「ニンテンドー3DS LL」は New 3DS LL の落札も拾う。
 * 実測で中央値が 19,800円 → 14,300円 とズレたため、旧機種側は -New で除外する。
 */
const MODEL_KEYWORDS: Array<{
  match: RegExp;
  /** ヤフオクの落札相場を引くための検索語 */
  keyword: string;
  /** 出品タイトルに使う日本語の一般名。社内の品名は使わない */
  titleJa: string;
  /** 海外バイヤー向けの英語表記。ヤフオクは海外からも見られる */
  titleEn: string;
}> = [
  { match: /switch\s*lite|スイッチ\s*ライト/u, keyword: "Nintendo Switch Lite 本体", titleJa: "ニンテンドースイッチ ライト 本体", titleEn: "Nintendo Switch Lite" },
  { match: /switch|スイッチ/u, keyword: "Nintendo Switch 本体のみ", titleJa: "ニンテンドースイッチ 本体のみ", titleEn: "Nintendo Switch" },
  { match: /new\s*3ds\s*ll|new\s*ニンテンドー\s*3ds\s*ll/u, keyword: "Newニンテンドー3DS LL 本体", titleJa: "Newニンテンドー3DS LL 本体", titleEn: "New Nintendo 3DS LL" },
  { match: /new\s*3ds/u, keyword: "Newニンテンドー3DS 本体", titleJa: "Newニンテンドー3DS 本体", titleEn: "New Nintendo 3DS" },
  { match: /3ds\s*ll/u, keyword: "ニンテンドー3DS LL 本体 -New", titleJa: "ニンテンドー3DS LL 本体", titleEn: "Nintendo 3DS LL" },
  { match: /3ds/u, keyword: "ニンテンドー3DS 本体 -New -LL", titleJa: "ニンテンドー3DS 本体", titleEn: "Nintendo 3DS" },
  { match: /new\s*2ds\s*ll/u, keyword: "Newニンテンドー2DS LL 本体", titleJa: "Newニンテンドー2DS LL 本体", titleEn: "New Nintendo 2DS LL" },
  { match: /2ds/u, keyword: "ニンテンドー2DS 本体 -New -LL", titleJa: "ニンテンドー2DS 本体", titleEn: "Nintendo 2DS" },
  { match: /ds\s*lite|dslite/u, keyword: "ニンテンドーDS Lite 本体", titleJa: "ニンテンドーDS Lite 本体", titleEn: "Nintendo DS Lite" },
  { match: /gba\s*sp|アドバンス\s*sp|advance\s*sp/u, keyword: "ゲームボーイアドバンスSP 本体", titleJa: "ゲームボーイアドバンスSP 本体", titleEn: "Game Boy Advance SP" },
  { match: /gba|ゲームボーイ\s*アドバンス|game\s*boy\s*advance/u, keyword: "ゲームボーイアドバンス 本体", titleJa: "ゲームボーイアドバンス 本体", titleEn: "Game Boy Advance" },
  { match: /ゲームボーイ\s*カラー|game\s*boy\s*color/u, keyword: "ゲームボーイカラー 本体", titleJa: "ゲームボーイカラー 本体", titleEn: "Game Boy Color" },
  { match: /psp\s*[-\s]?3000/u, keyword: "PSP-3000 本体", titleJa: "PSP-3000 本体", titleEn: "Sony PSP-3000" },
  { match: /psp\s*[-\s]?2000/u, keyword: "PSP-2000 本体", titleJa: "PSP-2000 本体", titleEn: "Sony PSP-2000" },
  { match: /psp\s*[-\s]?1000/u, keyword: "PSP-1000 本体", titleJa: "PSP-1000 本体", titleEn: "Sony PSP-1000" },
  { match: /vita\s*2000|pch\s*[-\s]?2000/u, keyword: "PS Vita PCH-2000 本体", titleJa: "PS Vita PCH-2000 本体", titleEn: "Sony PS Vita PCH-2000" },
  { match: /vita\s*1[01]00|pch\s*[-\s]?1[01]00|vita/u, keyword: "PS Vita PCH-1000 本体", titleJa: "PS Vita PCH-1000 本体", titleEn: "Sony PS Vita PCH-1000" },
];

/**
 * 出品タイトルから外す社内語。仕入先・状態メモ・在庫管理用の言葉は買い手に意味がない。
 * 色などの特徴語だけを残したいので、機種名そのものは match 側で落とす。
 */
const TITLE_NOISE = [
  "益子", "toy net", "toynet", "Toynet", "デボン", "サミー", "サイモン", "like",
  "返品", "対策済み", "対策済", "未対策", "登録漏れ", "在庫", "傷あり",
  "本体のみ", "本体", "タブレット", "ジャンク", "中古", "美品", "動作未確認",
  "ニンテンドー", "Nintendo", "nintendo", "任天堂",
];

function matchModelEntry(productName: string) {
  const normalized = productName.normalize("NFKC").toLowerCase();
  return MODEL_KEYWORDS.find(entry => entry.match.test(normalized)) ?? null;
}

/** 機種名と社内語を落として、色などの特徴語だけを残す */
export function residualDescriptor(productName: string, entry: { match: RegExp } | null) {
  let text = productName.normalize("NFKC");
  if (entry) {
    // 表の正規表現は小文字前提なので、消すときだけ i と g を足す
    text = text.replace(new RegExp(entry.match.source, "giu"), " ");
  }
  for (const word of TITLE_NOISE) text = text.split(word).join(" ");
  return text.replace(/[s　]+/gu, " ").replace(/[・/,、]+/gu, " ").trim();
}

/** 品名に当たる機種があればその一般名を返す。無ければ null */
export function matchModelKeyword(productName: string) {
  return matchModelEntry(productName)?.keyword ?? null;
}

/** 出品タイトルの頭。日本語の一般名と英語表記を並べる。表に無ければ null */
export function modelTitleParts(productName: string) {
  const entry = matchModelEntry(productName);
  if (!entry) return null;
  return {
    titleJa: entry.titleJa,
    titleEn: entry.titleEn,
    descriptor: residualDescriptor(productName, entry),
  };
}

/** タイトルか区分がジャンクなら、相場もジャンクだけを見る */
export function shouldTreatAsJunk(input: {
  productName: string;
  listingKind: ListingKind;
}) {
  return input.listingKind === "junk" || /ジャンク/u.test(input.productName);
}

export function generateYahooKeyword(
  productName: string,
  defectTags: readonly string[],
  listingKind: ListingKind = "junk"
) {
  const normalized = productName.normalize("NFKC").replace(/\s+/g, " ").trim();
  // 機種が分かるものは一般名で引く。仕入先や「対策済」が混ざった社内名では落札を拾えない
  const model = matchModelKeyword(normalized);
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
  // 動作品の相場にジャンク出品が混ざると中央値が下振れする。
  // Switch Lite の実測で 13,000円 → 14,200円 と1,200円ぶん違った（2026-08-18）
  const conditionWord =
    listingKind === "surplus"
      ? SURPLUS_EXCLUSIONS
      : defectTags[0] || "ジャンク";
  return [model ?? core ?? normalized, conditionWord].filter(Boolean).join(" ").trim();
}

export function generateDefectiveTitle(input: {
  productName: string;
  defectTags: readonly string[];
  photoCount: number;
  listingKind?: ListingKind;
}) {
  const listingKind = input.listingKind ?? "junk";
  const warning = input.photoCount === 0 ? PHOTO_WARNING_PREFIX : "";
  const kindPrefixHead = listingKind === "surplus" ? "" : TITLE_PREFIX;
  const suffixHead =
    listingKind === "surplus"
      ? ` ${SURPLUS_TITLE_SUFFIX}`
      : ` ${input.defectTags[0] || "その他"}`;

  // 機種が分かるものは社内の品名を出さない。買い手が探す一般名＋英語表記にする。
  // ヤフオクは海外バイヤーも見るので Nintendo Switch のような表記を必ず入れる
  const model = modelTitleParts(input.productName);
  if (model) {
    const head = `${warning}${kindPrefixHead}${model.titleJa} ${model.titleEn}`;
    const available =
      TITLE_LIMIT - codePoints(head).length - codePoints(suffixHead).length;
    const descriptor = model.descriptor
      ? ` ${takeCodePoints(model.descriptor, Math.max(0, available - 1))}`
      : "";
    return `${head}${descriptor}${suffixHead}`;
  }

  const brand = extractBrand(input.productName);
  const productName = productNameWithoutLeadingBrand(input.productName, brand);
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
  shipmentStatus: string;
  shippedOn: string;
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
  shipmentStatus?: string;
  shippedOn?: string | null;
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
    shipmentStatus: input.shipmentStatus ?? "出品準備",
    shippedOn: input.shippedOn ?? "",
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
