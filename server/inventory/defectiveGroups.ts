import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  defectiveListingGroups,
  inventoryItemLabels,
  localInventories,
  outboundBoxes,
} from "../../drizzle/schema";
import {
  buildDefectiveSheetPayload,
  normalizeListingKind,
  type DefectPhoto,
  type ListingKind,
} from "./defectiveListing";
import { getDb } from "./db";
import { writeYahooListingRow } from "./yahooListingSheet";
import type { YahooClosedPrices } from "./yahooClosedPrices";

function parseArray<T>(value: string | null | undefined): T[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed as T[] : [];
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

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

async function loadDefectiveMembers(labelIds: string[]) {
  const db = await requireDb();
  const members = [];
  for (const labelId of labelIds) {
    const [label] = await db.select().from(inventoryItemLabels)
      .where(eq(inventoryItemLabels.labelId, labelId)).limit(1);
    if (!label?.defectRecordedAt) throw new Error(`${labelId} は不良在庫として登録されていません`);
    if (label.status !== "stocked") throw new Error(`${labelId} は在庫中ではありません`);
    const [box] = label.outboundBoxId
      ? await db.select().from(outboundBoxes).where(eq(outboundBoxes.id, label.outboundBoxId)).limit(1)
      : [];
    if (box) throw new Error(`${labelId} は箱 ${box.boxCode} に入っています。箱から出してからグループ化してください`);
    const [inventory] = label.localInventoryId
      ? await db.select().from(localInventories).where(eq(localInventories.id, label.localInventoryId)).limit(1)
      : [];
    members.push({ label, inventory: inventory ?? null });
  }
  return members;
}

function groupCode() {
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DG-${stamp}-${suffix}`;
}

export function estimateGroupMarketMedian(medians: number[], memberCount: number): number | null {
  if (medians.length !== memberCount || memberCount < 1) return null;
  const sorted = [...medians].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const unitMedian = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(unitMedian * memberCount);
}

function aggregatedMarket(members: Awaited<ReturnType<typeof loadDefectiveMembers>>): YahooClosedPrices {
  const markets = members.map(member => parseMarket(member.label.yahooClosedPricesJson)).filter(Boolean) as YahooClosedPrices[];
  const medians = markets.map(market => market.adopted.median).filter((value): value is number => value != null);
  const mins = markets.map(market => market.adopted.min).filter((value): value is number => value != null);
  const maxes = markets.map(market => market.adopted.max).filter((value): value is number => value != null);
  const latest = markets.map(market => Date.parse(market.fetchedAt)).filter(Number.isFinite).sort((a, b) => b - a)[0] ?? Date.now();
  const first = markets[0];
  return {
    keyword: first?.keyword ?? members[0]?.label.title ?? "ジャンク",
    fetchedAt: new Date(latest).toISOString(),
    summaryWindow: {
      days: first?.summaryWindow.days ?? 0,
      min: mins.reduce((sum, value) => sum + value, 0),
      avg: 0,
      max: maxes.reduce((sum, value) => sum + value, 0),
      count: markets.reduce((sum, market) => sum + market.summaryWindow.count, 0),
    },
    adopted: {
      count: markets.reduce((sum, market) => sum + market.adopted.count, 0),
      median: estimateGroupMarketMedian(medians, members.length),
      min: mins.length === members.length ? mins.reduce((sum, value) => sum + value, 0) : null,
      max: maxes.length === members.length ? maxes.reduce((sum, value) => sum + value, 0) : null,
    },
    samples: first?.samples ?? [],
  };
}

async function buildGroupPayload(group: typeof defectiveListingGroups.$inferSelect, dissolved = false) {
  const labelIds = parseArray<string>(group.memberLabelIdsJson);
  const members = await loadDefectiveMembers(labelIds);
  const listingKind = normalizeListingKind(group.listingKind);
  const photos = members.flatMap(member => parseArray<DefectPhoto>(member.label.defectPhotosJson));
  const defectTags = Array.from(new Set(members.flatMap(member => String(member.label.defectTags ?? "").split(",").map(tag => tag.trim()).filter(Boolean))));
  const fallbackName = listingKind === "surplus" ? "不要在庫" : "不良在庫";
  const productName = `${members[0]?.label.title ?? fallbackName} ほか ${members.length}台`;
  const memberNotes = members
    .map(member => {
      const detail = member.label.defectNote
        ?? member.label.defectTags
        ?? (listingKind === "surplus" ? "動作確認済" : "その他");
      return `${member.label.labelId}: ${detail}`;
    })
    .join(" / ");
  const payload = buildDefectiveSheetPayload({
    productId: group.groupCode,
    inspectedAt: new Date(Math.min(...members.map(member => member.label.defectRecordedAt!.getTime()))),
    productName: dissolved ? `【グループ解除済み】${productName}` : productName,
    defectTags,
    defectNote: memberNotes,
    photos,
    unitPrice: members.reduce((sum, member) => sum + Number(member.inventory?.unitPrice ?? 0), 0),
    market: aggregatedMarket(members),
    quantity: members.length,
    listingKind,
  });
  if (dissolved) {
    payload.listingTitle = `【グループ解除済み】${group.groupCode}`;
    payload.listingDescription = `このまとめ出品グループは解除済みです。個体: ${labelIds.join(", ")}`;
  }
  return { payload, members };
}

export async function listDefectiveGroups() {
  const db = await requireDb();
  const groups = await db.select().from(defectiveListingGroups).orderBy(desc(defectiveListingGroups.createdAt));
  const defectiveLabels = await db.select().from(inventoryItemLabels)
    .where(eq(inventoryItemLabels.status, "stocked"));
  const activeMemberIds = new Set(groups
    .filter(group => group.status === "active")
    .flatMap(group => parseArray<string>(group.memberLabelIdsJson)));
  return {
    groups: groups.map(group => ({ ...group, memberLabelIds: parseArray<string>(group.memberLabelIdsJson) })),
    candidates: defectiveLabels
      .filter(label => label.defectRecordedAt && !label.outboundBoxId && !activeMemberIds.has(label.labelId))
      .map(label => ({
        labelId: label.labelId,
        title: label.title,
        listingKind: normalizeListingKind(label.listingKind),
        defectTags: String(label.defectTags ?? "").split(",").filter(Boolean),
        marketMedian: parseMarket(label.yahooClosedPricesJson)?.adopted.median ?? null,
      })),
  };
}

/**
 * ヤフオク出品待ちの全件。荷受けの当日分に限らず、いま出品できるものをすべて返す。
 * スマホの出品画面（/inventory/yahoo-listings）が読む。
 */
export async function listYahooListingQueue() {
  const db = await requireDb();
  const [labels, groups] = await Promise.all([
    db.select().from(inventoryItemLabels).where(eq(inventoryItemLabels.status, "stocked")),
    db.select().from(defectiveListingGroups).orderBy(desc(defectiveListingGroups.createdAt)),
  ]);
  const activeGroups = groups.filter(group => group.status === "active");
  const groupByLabelId = new Map<string, string>();
  for (const group of activeGroups) {
    for (const labelId of parseArray<string>(group.memberLabelIdsJson)) {
      groupByLabelId.set(labelId, group.groupCode);
    }
  }
  const queued = labels.filter(label => label.defectRecordedAt && !label.outboundBoxId);
  const inventoryIds = Array.from(
    new Set(queued.map(label => label.localInventoryId).filter((id): id is number => typeof id === "number"))
  );
  const inventories = inventoryIds.length
    ? await db.select().from(localInventories).where(inArray(localInventories.id, inventoryIds))
    : [];
  const inventoryById = new Map(inventories.map(inventory => [inventory.id, inventory]));
  return {
    items: queued
      .map(label => {
        const market = parseMarket(label.yahooClosedPricesJson);
        const inventory = label.localInventoryId ? inventoryById.get(label.localInventoryId) : undefined;
        return {
          labelId: label.labelId,
          title: label.title,
          listingKind: normalizeListingKind(label.listingKind),
          defectTags: String(label.defectTags ?? "").split(",").map(tag => tag.trim()).filter(Boolean),
          defectNote: label.defectNote,
          photos: parseArray<DefectPhoto>(label.defectPhotosJson),
          keyword: market?.keyword ?? null,
          marketMedian: market?.adopted.median ?? null,
          marketCount: market?.adopted.count ?? 0,
          priceFetchedAt: label.yahooPriceFetchedAt?.toISOString() ?? null,
          sheetSyncedAt: label.defectiveSheetSyncedAt?.toISOString() ?? null,
          recordedAt: label.defectRecordedAt?.toISOString() ?? null,
          unitPrice: inventory?.unitPrice ?? null,
          groupCode: groupByLabelId.get(label.labelId) ?? null,
        };
      })
      .sort((left, right) => (right.recordedAt ?? "").localeCompare(left.recordedAt ?? "")),
    groups: groups.map(group => ({
      id: group.id,
      groupCode: group.groupCode,
      status: group.status,
      listingKind: normalizeListingKind(group.listingKind),
      memberLabelIds: parseArray<string>(group.memberLabelIdsJson),
      sheetSyncedAt: group.sheetSyncedAt?.toISOString() ?? null,
      createdAt: group.createdAt.toISOString(),
    })),
  };
}

/**
 * まだ出品待ちに入れていない在庫個体を、商品名で探す。
 * スイッチのタブレットのように同じ名前が数十台あるものをまとめて選ぶために使う。
 */
export async function searchStockForListing(query: string, limit = 200) {
  const db = await requireDb();
  const keyword = query.normalize("NFKC").trim();
  const labels = await db.select().from(inventoryItemLabels)
    .where(and(
      eq(inventoryItemLabels.status, "stocked"),
      isNull(inventoryItemLabels.defectRecordedAt),
      isNull(inventoryItemLabels.outboundBoxId),
    ));
  const matched = keyword
    ? labels.filter(label => {
        const haystack = `${label.title ?? ""} ${label.labelId} ${label.legacyManagementNo ?? ""}`.normalize("NFKC");
        return haystack.toLowerCase().includes(keyword.toLowerCase());
      })
    : labels;
  const groupedByTitle = new Map<string, Array<{ labelId: string; legacyManagementNo: string | null }>>();
  for (const label of matched.slice(0, limit)) {
    const title = label.title ?? "(名称なし)";
    const bucket = groupedByTitle.get(title) ?? [];
    bucket.push({ labelId: label.labelId, legacyManagementNo: label.legacyManagementNo ?? null });
    groupedByTitle.set(title, bucket);
  }
  return {
    total: matched.length,
    truncated: matched.length > limit,
    titles: Array.from(groupedByTitle.entries())
      .map(([title, members]) => ({ title, count: members.length, members }))
      .sort((left, right) => right.count - left.count),
  };
}

export async function createDefectiveGroup(labelIds: string[], createdBy: string) {
  const normalizedIds = Array.from(new Set(labelIds.map(value => value.trim().toUpperCase()).filter(Boolean)));
  if (normalizedIds.length < 2) throw new Error("まとめ出品には2個体以上を選んでください");
  const db = await requireDb();
  const existing = await db.select().from(defectiveListingGroups)
    .where(eq(defectiveListingGroups.status, "active"));
  const alreadyGrouped = new Set(existing.flatMap(group => parseArray<string>(group.memberLabelIdsJson)));
  const duplicate = normalizedIds.find(labelId => alreadyGrouped.has(labelId));
  if (duplicate) throw new Error(`${duplicate} は既に別の出品グループに入っています`);
  const members = await loadDefectiveMembers(normalizedIds);
  // ジャンクと動作品は相場も文面も別物。1出品に混ぜると説明文が嘘になる
  const kinds = new Set<ListingKind>(
    members.map(member => normalizeListingKind(member.label.listingKind))
  );
  if (kinds.size > 1) {
    throw new Error("ジャンクと不要在庫（動作品）は同じまとめ出品にできません");
  }
  const listingKind: ListingKind = kinds.values().next().value ?? "junk";
  const code = groupCode();
  const [result] = await db.insert(defectiveListingGroups).values({
    groupCode: code,
    listingKind,
    memberLabelIdsJson: JSON.stringify(normalizedIds),
    createdBy,
  });
  const id = Number((result as { insertId?: number }).insertId ?? 0);
  const [group] = await db.select().from(defectiveListingGroups).where(eq(defectiveListingGroups.id, id)).limit(1);
  if (!group) throw new Error("出品グループを作成できませんでした");
  const { payload, sheet } = await syncDefectiveGroup(group.id);
  return { group: { ...group, memberLabelIds: normalizedIds }, payload, sheet };
}

export async function syncDefectiveGroup(id: number) {
  const db = await requireDb();
  const [group] = await db.select().from(defectiveListingGroups)
    .where(and(eq(defectiveListingGroups.id, id), eq(defectiveListingGroups.status, "active"))).limit(1);
  if (!group) throw new Error("有効な出品グループが見つかりません");
  const { payload } = await buildGroupPayload(group);
  const sheet = await writeYahooListingRow(payload);
  if (sheet.success) {
    await db.update(defectiveListingGroups).set({ sheetSyncedAt: new Date() }).where(eq(defectiveListingGroups.id, group.id));
  }
  return { groupCode: group.groupCode, payload, sheet };
}

export async function dissolveDefectiveGroup(id: number) {
  const db = await requireDb();
  const [group] = await db.select().from(defectiveListingGroups)
    .where(and(eq(defectiveListingGroups.id, id), eq(defectiveListingGroups.status, "active"))).limit(1);
  if (!group) throw new Error("有効な出品グループが見つかりません");
  const { payload } = await buildGroupPayload(group, true);
  const sheet = await writeYahooListingRow(payload);
  if (!sheet.success) throw new Error(`グループ行を解除済みに更新できませんでした: ${sheet.message ?? "要確認"}`);
  const now = new Date();
  await db.update(defectiveListingGroups).set({
    status: "dissolved",
    dissolvedAt: now,
    sheetSyncedAt: now,
  }).where(and(eq(defectiveListingGroups.id, id), eq(defectiveListingGroups.status, "active")));
  return { success: true, groupCode: group.groupCode, sheet };
}
