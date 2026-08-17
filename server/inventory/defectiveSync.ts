import { eq } from "drizzle-orm";
import { inventoryItemLabels, localInventories } from "../../drizzle/schema";
import {
  buildDefectiveSheetPayload,
  generateYahooKeyword,
  normalizeListingKind,
  type DefectPhoto,
} from "./defectiveListing";
import { postGasAction } from "./gasClient";
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
      : await fetchYahooClosedPrices(keyword);
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

  const gasResult = await postGasAction(payload);
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
