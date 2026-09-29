/** Test-only adapter for declarations captured verbatim from the pre-refactor commit. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { detectCarrier } from "@/inventory/lib/tracking";
import { isInboundComplete } from "@shared/inboundPipeline";

export const BASELINE_COMMIT = "959014b";
export const baselineNames = [
  "toNumber", "formatCurrency", "formatEuro", "formatTradePrice", "normalizeCurrencyLabel", "formatDate",
  "normalizedTrackingNumber", "normalizeCarrierKey", "getTrackingUrlForCarrier", "getPurchaseTrackingMeta",
  "purchaseTrackingNumber", "hasPurchaseTracking", "TRACKING_CARRIER_OPTIONS", "TRACKING_CARRIER_KEYS", "TRACKING_CARRIER_LABELS",
  "itemQuantity", "itemStockQuantity", "sumQuantity", "getItemLabels", "isReceived", "normalizedLabelStatus",
  "purchaseRowStatusKind", "statusLabel", "statusClass", "matchesStatus", "countPurchaseRows",
  "visiblePurchaseItems", "withVisiblePurchaseItems", "normalizePurchaseRegistrationDate", "isPurchaseRegistrationCutoffVisible",
  "isPurchaseRegistrationRowComplete", "normalizePurchaseRegistrationRows", "purchaseRegistrationOrderValue", "comparePurchaseRegistrationOrder",
  "PURCHASE_REGISTRATION_CUTOFF_DATE",
] as const;

export function loadLegacyBaseline<T>() {
  const source = readFileSync(new URL("./baseline-source.txt", import.meta.url), "utf8");
  const tree = ts.createSourceFile("PurchaseRegistration.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = new Map<string, string>();
  for (const node of tree.statements) {
    const name = ts.isFunctionDeclaration(node) ? node.name?.text
      : ts.isVariableStatement(node) && node.declarationList.declarations.length === 1
        ? node.declarationList.declarations[0].name.getText(tree) : undefined;
    if (name && baselineNames.some((target) => target === name)) selected.set(name, node.getText(tree));
  }
  for (const name of baselineNames) if (!selected.has(name)) throw new Error(`Missing baseline declaration: ${name}`);
  const code = ts.transpileModule([...selected.values()].join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  // Only repository declarations named above execute; no component imports, browser effects or API calls.
  return new Function("detectCarrier", "isInboundComplete", `${code}\nreturn {${baselineNames.join(",")}};`)(detectCarrier, isInboundComplete) as T;
}
