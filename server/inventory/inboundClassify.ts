/**
 * 入庫自動仕訳バッチ（T22）
 *
 * 未仕訳/自動判定（classSource=auto）の発注行を再判定し、分類を更新する。
 * fedexMissingTasks と同型で、cron から呼ばれる想定（毎朝の相乗り）。
 *
 * classSource=manual の行は人間の判断を尊重し、絶対に上書きしない。
 * 判定は shared/inboundPipeline の純関数 classifyInbound() に集約している。
 */

import {
  classifyInbound,
  extractInvoicePrefix,
  DEFAULT_DIRECT_PARTNER_NAMES,
  DIRECT_PARTNER_NAMES_SETTING_KEY,
  type InboundClass,
} from "@shared/inboundPipeline";
import {
  getLocalPurchases,
  getLocalInventories,
  setLocalPurchaseInboundClass,
  getPublishedInvoiceNumberSet,
  getSystemSetting,
} from "./db";

function getInventoryManagementNo(etc: string | null | undefined) {
  return String(etc ?? "").split(",")[0]?.trim() ?? "";
}

async function getDirectPartnerNames(): Promise<string[]> {
  try {
    const raw = await getSystemSetting(DIRECT_PARTNER_NAMES_SETTING_KEY);
    if (!raw) return [...DEFAULT_DIRECT_PARTNER_NAMES];
    const names = raw
      .split(/[,、\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_DIRECT_PARTNER_NAMES];
  } catch {
    return [...DEFAULT_DIRECT_PARTNER_NAMES];
  }
}

export async function reclassifyInboundAuto() {
  const [purchases, inventories, partnerNames, invoiceNumberSet] = await Promise.all([
    getLocalPurchases(),
    getLocalInventories(),
    getDirectPartnerNames(),
    getPublishedInvoiceNumberSet().catch(() => new Set<number>()),
  ]);

  const invById = new Map<number, (typeof inventories)[number]>();
  for (const inv of inventories) invById.set(inv.id, inv);

  let scanned = 0;
  let updated = 0;
  let skippedManual = 0;
  let unchanged = 0;

  for (const p of purchases) {
    scanned += 1;
    // manual は保護
    if (p.classSource === "manual") {
      skippedManual += 1;
      continue;
    }
    const inv = p.localInventoryId != null ? invById.get(p.localInventoryId) : undefined;
    const managementNo = p.managementNo ?? getInventoryManagementNo(inv?.etc);
    const place = inv?.place ?? null;
    const ebayOrderUrl = inv?.ebayOrderUrl ?? null;
    const invoicePrefix = extractInvoicePrefix(managementNo);
    const hasLinkedInvoice = invoicePrefix != null && invoiceNumberSet.has(Number(invoicePrefix));

    const computed: InboundClass | null = classifyInbound({
      managementNo,
      place,
      ebayOrderUrl,
      directPartnerNames: partnerNames,
      hasLinkedInvoice,
    });

    const stored = (p.inboundClass ?? null) as InboundClass | null;
    if (computed === stored) {
      unchanged += 1;
      continue;
    }
    try {
      await setLocalPurchaseInboundClass(p.id, computed, "auto");
      updated += 1;
    } catch (error) {
      console.warn("[inbound-classify] failed to update", {
        id: p.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ok: true, scanned, updated, unchanged, skippedManual };
}
