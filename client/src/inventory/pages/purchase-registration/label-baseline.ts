/** Test-only declarations captured verbatim from ef808dc; no Git needed at test time. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { extractManagementNo as getInventoryManagementNo } from "@shared/ebayInventory";
import { preferredManagementNo } from "./managementNumbers";
import { parseInvoiceFromManagementNo, getInvoiceInfo, OTHER_INVOICE_KEY, EBAY_GROUP_KEY } from "./invoiceIdentity";
import { getSupplier } from "./supplier";
import { toNumber } from "./format";
import { itemStockQuantity } from "./purchaseItems";
import { normalizedLabelStatus } from "./rowStatus";
import { displayStockCategory, UNCATEGORIZED_STOCK_CATEGORY } from "./productPresentation";

export const LABEL_BASELINE_COMMIT = "ef808dc";
export const labelBaselineNames = [
  "compactProductText", "hasAnyProductText", "displayProductTitle", "actualProductTitle", "getInventoryCategory", "stockModelName", "STOCK_MODEL_ORDER",
  "labelStatusLabel", "labelBadgeClass", "labelAllocationLabel", "labelOrderTitleFromManagementNo", "formatLabelOrderTitle", "formatLabelPrintTitleLegacy", "replaceAllText", "formatLabelPrintTitle",
  "emptyLabelTitleOverrides", "sanitizeStringRecord", "normalizeLabelTitleKey", "applyLabelTitleOverride",
  "LABELS_PER_SHEET", "clampLabelStartPosition", "nextLabelStartPosition", "chunkArray", "isWithinLabelScope", "buildLabelPrintGroups", "buildChecklistRows",
  "buildStockItemViewsFromInventories", "buildLabelViews", "isInventoryPrintableLabel", "buildInventoryLabelViews", "buildClosedInvoiceInventoryLabelViews",
  "initQrTables", "QR_TABLES", "qrMultiply", "qrGeneratorPolynomial", "qrEncodeBytes", "createQrMatrix", "QR_QUIET_ZONE", "buildQrPath",
] as const;

export function loadLabelBaseline<T>(): T {
  const source = readFileSync(new URL("./label-baseline-source.txt", import.meta.url), "utf8");
  const tree = ts.createSourceFile("PurchaseRegistration.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = new Map<string, string>();
  for (const node of tree.statements) {
    const name = ts.isFunctionDeclaration(node) ? node.name?.text
      : ts.isVariableStatement(node) && node.declarationList.declarations.length === 1
        ? node.declarationList.declarations[0].name.getText(tree) : undefined;
    if (name && labelBaselineNames.some((target) => target === name)) selected.set(name, node.getText(tree));
  }
  for (const name of labelBaselineNames) if (!selected.has(name)) throw new Error(`Missing baseline declaration: ${name}`);
  const code = ts.transpileModule([...selected.values()].join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const dependencies = { parseEtc, getInventoryManagementNo, preferredManagementNo, parseInvoiceFromManagementNo, getInvoiceInfo, OTHER_INVOICE_KEY, EBAY_GROUP_KEY, getSupplier, toNumber, itemStockQuantity, normalizedLabelStatus, displayStockCategory, UNCATEGORIZED_STOCK_CATEGORY };
  return new Function(...Object.keys(dependencies), `${code}\nreturn {${labelBaselineNames.join(",")}};`)(...Object.values(dependencies)) as T;
}
