import {
  classifyInbound,
  extractInvoicePrefix,
  DEFAULT_DIRECT_PARTNER_NAMES,
  DIRECT_PARTNER_NAMES_SETTING_KEY,
  type InboundClass,
} from "@shared/inboundPipeline";
import {
  getSystemSetting,
  getPublishedInvoiceNumberSet,
  setLocalPurchaseInboundClass,
  type LocalPurchaseWithLabels as LocalPurchaseRow,
  type LocalInventoryWithLabels as LocalInventoryRow,
} from "../db";
import { getInventoryManagementNo } from "../managementNo";
import type { InboundInfo } from "./localRows";

// 手動分類を保護し、自動分類の表示結果を保存する。保存失敗時も既存どおり表示は計算値を使う。
export async function getDirectPartnerNames(): Promise<string[]> {
  try {
    const raw = await getSystemSetting(DIRECT_PARTNER_NAMES_SETTING_KEY);
    if (!raw) return [...DEFAULT_DIRECT_PARTNER_NAMES];
    const names = raw
      .split(/[,、\n]/)
      .map(s => s.trim())
      .filter(Boolean);
    if (names.length === 0) return [...DEFAULT_DIRECT_PARTNER_NAMES];
    return Array.from(new Set([...DEFAULT_DIRECT_PARTNER_NAMES, ...names]));
  } catch {
    return [...DEFAULT_DIRECT_PARTNER_NAMES];
  }
}

export async function resolveInboundInfoMap(
  localPurchaseRows: LocalPurchaseRow[],
  localInventoryRows: LocalInventoryRow[]
): Promise<Map<number, InboundInfo>> {
  const map = new Map<number, InboundInfo>();
  if (localPurchaseRows.length === 0) return map;

  const invById = new Map<number, LocalInventoryRow>();
  for (const inv of localInventoryRows) invById.set(inv.id, inv);

  const [partnerNames, invoiceNumberSet] = await Promise.all([
    getDirectPartnerNames(),
    getPublishedInvoiceNumberSet().catch(() => new Set<number>()),
  ]);

  for (const p of localPurchaseRows) {
    const storedClass = (p.inboundClass ?? null) as InboundClass | null;
    const storedSource = (p.classSource === "manual" ? "manual" : "auto") as
      | "auto"
      | "manual";
    const stage = p.stage ?? "received";
    const stageUpdatedBy = p.stageUpdatedBy ?? null;
    const shaftParentPurchaseId = p.shaftParentPurchaseId ?? null;

    // manual は保存値をそのまま採用（domestic のシャフト分離行も manual 固定なので保護される）
    if (storedSource === "manual") {
      map.set(p.id, {
        inboundClass: storedClass,
        classSource: "manual",
        stage,
        stageUpdatedBy,
        shaftParentPurchaseId,
      });
      continue;
    }

    // auto: 判定材料を集めて再分類
    const inv =
      p.localInventoryId != null ? invById.get(p.localInventoryId) : undefined;
    const managementNo = p.managementNo ?? getInventoryManagementNo(inv?.etc);
    const place = inv?.place ?? null;
    const ebayOrderUrl = inv?.ebayOrderUrl ?? null;
    const invoicePrefix = extractInvoicePrefix(managementNo);
    const hasLinkedInvoice =
      invoicePrefix != null && invoiceNumberSet.has(Number(invoicePrefix));

    const computed = classifyInbound({
      managementNo,
      place,
      ebayOrderUrl,
      directPartnerNames: partnerNames,
      hasLinkedInvoice,
    });

    // 保存値と異なればバックフィル（auto のまま更新）。DBが無い場合はスキップ。
    if (computed !== storedClass) {
      try {
        await setLocalPurchaseInboundClass(p.id, computed, "auto");
      } catch {
        // DB未接続やダンプ経路では保存できないが、表示は computed を使う
      }
    }

    map.set(p.id, {
      inboundClass: computed,
      classSource: "auto",
      stage,
      stageUpdatedBy,
      shaftParentPurchaseId,
    });
  }

  return map;
}
