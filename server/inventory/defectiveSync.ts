import { eq } from "drizzle-orm";
import { inventoryItemLabels, localInventories } from "../../drizzle/schema";
import {
  buildDefectiveSheetPayload,
  generateYahooKeyword,
  normalizeListingKind,
  shouldTreatAsJunk,
  type DefectPhoto,
} from "./defectiveListing";
import { writeYahooListingRow } from "./yahooListingSheet";
import { getDb } from "./db";
import {
  fetchYahooClosedPrices,
  type YahooClosedPrices,
} from "./yahooClosedPrices";

function parsePhotos(value: string | null): DefectPhoto[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as DefectPhoto[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseMarket(value: string | null): YahooClosedPrices | null {
  try {
    const parsed = JSON.parse(value ?? "null") as YahooClosedPrices | null;
    return parsed?.keyword ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 落札実績の並べ方。
 * - ジャンクとして出すもの（区分がジャンク／タイトルに「ジャンク」）は、5件ともジャンクの落札
 * - それ以外は 1〜4件目を普通の状態の落札にし、5件目だけジャンクの落札を1件添える
 *
 * 中央値・最安・最高は「普通の状態」側の数字を採る。ジャンクを1件だけ並べるのは、
 * 状態でいくら差が出るかを1行で見えるようにするため（村上さん指示・2026-08-18）。
 */
async function withJunkReference(keyword: string, treatAsJunk: boolean) {
  if (treatAsJunk) return fetchYahooClosedPrices(keyword);
  const normal = await fetchYahooClosedPrices(keyword);
  const junk = await fetchYahooClosedPrices(`${keyword} ジャンク`);
  return {
    ...normal,
    samples: [...normal.samples.slice(0, 4), junk.samples[0]].filter(
      (sample): sample is (typeof normal.samples)[number] => Boolean(sample)
    ),
  };
}

export async function syncDefectiveListingByLabelId(
  labelId: string,
  options: { keyword?: string; reuseFreshMarket?: boolean } = {}
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalizedId = labelId.trim().toUpperCase();
  const [label] = await db
    .select()
    .from(inventoryItemLabels)
    .where(eq(inventoryItemLabels.labelId, normalizedId))
    .limit(1);
  if (!label?.defectRecordedAt)
    throw new Error(`${normalizedId} has no defect record`);
  const [inventory] = label.localInventoryId
    ? await db
        .select()
        .from(localInventories)
        .where(eq(localInventories.id, label.localInventoryId))
        .limit(1)
    : [];

  const defectTags = String(label.defectTags ?? "")
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);
  const listingKind = normalizeListingKind(label.listingKind);
  const keyword =
    options.keyword?.normalize("NFKC").trim() ||
    generateYahooKeyword(label.title, defectTags, listingKind);
  const existingMarket = parseMarket(label.yahooClosedPricesJson);
  const market =
    options.reuseFreshMarket && existingMarket?.keyword === keyword
      ? existingMarket
      : await withJunkReference(
          keyword,
          shouldTreatAsJunk({ productName: label.title, listingKind })
        );
  const photos = parsePhotos(label.defectPhotosJson);
  const payload = buildDefectiveSheetPayload({
    productId: normalizedId,
    inspectedAt: label.defectRecordedAt,
    productName: label.title,
    defectTags,
    defectNote: label.defectNote,
    photos,
    unitPrice: inventory?.unitPrice ?? null,
    market,
    quantity: inventory?.quantity ?? 1,
    listingKind,
  });

  await db
    .update(inventoryItemLabels)
    .set({
      yahooClosedPricesJson: JSON.stringify(market),
      yahooPriceFetchedAt: new Date(market.fetchedAt),
    })
    .where(eq(inventoryItemLabels.id, label.id));

  const gasResult = await writeYahooListingRow(payload);
  if (gasResult.success) {
    await db
      .update(inventoryItemLabels)
      .set({ defectiveSheetSyncedAt: new Date() })
      .where(eq(inventoryItemLabels.id, label.id));
  } else {
    console.warn("[defective-sheet] sync failed", {
      labelId: normalizedId,
      message: gasResult.message,
    });
  }
  return { market, payload, sheet: gasResult };
}

export async function refreshStaleDefectiveListings(now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const labels = await db.select().from(inventoryItemLabels);
  const staleBefore = now.getTime() - 30 * 24 * 60 * 60 * 1_000;
  const targets = labels
    .filter(label => label.defectRecordedAt)
    .filter(
      label =>
        !label.yahooPriceFetchedAt ||
        label.yahooPriceFetchedAt.getTime() < staleBefore ||
        !label.defectiveSheetSyncedAt
    )
    .sort(
      (a, b) =>
        (a.yahooPriceFetchedAt?.getTime() ?? 0) -
        (b.yahooPriceFetchedAt?.getTime() ?? 0)
    );
  const results: Array<{
    labelId: string;
    success: boolean;
    message?: string;
  }> = [];
  for (const label of targets) {
    try {
      const freshMarket = Boolean(
        label.yahooPriceFetchedAt &&
          label.yahooPriceFetchedAt.getTime() >= staleBefore
      );
      const result = await syncDefectiveListingByLabelId(label.labelId, {
        reuseFreshMarket: freshMarket,
      });
      results.push({
        labelId: label.labelId,
        success: result.sheet.success,
        message: result.sheet.message,
      });
    } catch (error) {
      results.push({
        labelId: label.labelId,
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { checked: targets.length, results };
}
