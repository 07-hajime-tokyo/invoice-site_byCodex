import { and, desc, eq } from "drizzle-orm";
import {
  defectiveListingGroups,
  inventoryItemLabels,
  localInventories,
  outboundBoxes,
} from "../../drizzle/schema";
import { buildDefectiveSheetPayload, type DefectPhoto } from "./defectiveListing";
import { getDb } from "./db";
import { postGasAction } from "./gasClient";
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
  const photos = members.flatMap(member => parseArray<DefectPhoto>(member.label.defectPhotosJson));
  const defectTags = Array.from(new Set(members.flatMap(member => String(member.label.defectTags ?? "").split(",").map(tag => tag.trim()).filter(Boolean))));
  const productName = `${members[0]?.label.title ?? "不良在庫"} ほか ${members.length}台`;
  const payload = buildDefectiveSheetPayload({
    productId: group.groupCode,
    inspectedAt: new Date(Math.min(...members.map(member => member.label.defectRecordedAt!.getTime()))),
    productName: dissolved ? `【グループ解除済み】${productName}` : productName,
    defectTags,
    defectNote: members.map(member => `${member.label.labelId}: ${member.label.defectNote ?? member.label.defectTags ?? "その他"}`).join(" / "),
    photos,
    unitPrice: members.reduce((sum, member) => sum + Number(member.inventory?.unitPrice ?? 0), 0),
    market: aggregatedMarket(members),
    quantity: members.length,
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
        defectTags: String(label.defectTags ?? "").split(",").filter(Boolean),
        marketMedian: parseMarket(label.yahooClosedPricesJson)?.adopted.median ?? null,
      })),
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
  await loadDefectiveMembers(normalizedIds);
  const code = groupCode();
  const [result] = await db.insert(defectiveListingGroups).values({
    groupCode: code,
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
  const sheet = await postGasAction(payload);
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
  const sheet = await postGasAction(payload);
  if (!sheet.success) throw new Error(`グループ行を解除済みに更新できませんでした: ${sheet.message ?? "要確認"}`);
  const now = new Date();
  await db.update(defectiveListingGroups).set({
    status: "dissolved",
    dissolvedAt: now,
    sheetSyncedAt: now,
  }).where(and(eq(defectiveListingGroups.id, id), eq(defectiveListingGroups.status, "active")));
  return { success: true, groupCode: group.groupCode, sheet };
}
