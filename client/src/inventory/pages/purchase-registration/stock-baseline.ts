/** Test-only original declarations from 608f1ea. Normal tests do not use Git. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { cleanLegacyManagementNo, parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { extractManagementNo as getInventoryManagementNo } from "@shared/ebayInventory";
import { preferredManagementNo, getManagementNos } from "./managementNumbers";
import { parseInvoiceFromManagementNo } from "./invoiceIdentity";
import { getSupplier } from "./supplier";
import { toNumber, formatCurrency, formatTradePrice, normalizeCurrencyLabel } from "./format";
import { itemStockQuantity, itemQuantity, getItemLabels } from "./purchaseItems";
import { purchaseRowStatusKind, statusLabel, normalizedLabelStatus } from "./rowStatus";
import { compactProductText } from "./productText";
import { getInventoryCategory, displayStockCategory, stockModelName, STOCK_MODEL_ORDER } from "./productPresentation";
import { labelStatusLabel } from "./labelStatus";
import { labelAllocationLabel } from "./labelTitles";
import { isInventoryPrintableLabel } from "./inventoryLabelViews";

export const STOCK_BASELINE_COMMIT = "608f1ea";
export const stockBaselineNames = [
  "buildForecastSummary", "unique", "productKey", "hasAnyProductText", "displayProductTitle", "actualProductTitle",
  "buildStockItemViewsFromInventories", "buildZeroStockPurchaseItemViewsFromRows", "buildStockItemGroups",
  "isInventoryDeleted", "buildActiveInventoryMap", "zeroStockPurchaseStatusForItem",
  "normalizeStockProposalTitle", "stockProposalModelName", "STOCK_PROPOSAL_EXCLUDED_MANAGEMENT_PREFIXES", "STOCK_PROPOSAL_ACCESSORY_KEYWORDS", "STOCK_BODY_KEYWORDS",
  "isExcludedStockProposalManagementNo", "isUnfinishedInvoiceManagementNo", "isStockProposalAccessory", "isFulfillmentStockItem", "isStockWaitingPurchaseRow",
  "addStockProposalPrice", "appendStockProposalDetail", "getOrCreateStockProposalProduct", "buildStockProposalGroups",
  "proposalAveragePrice", "stockProposalPriceLabel", "stockProposalManagementLabel",
] as const;

export function loadStockBaseline<T>(): T {
  const source = readFileSync(new URL("./stock-baseline-source.txt", import.meta.url), "utf8");
  const tree = ts.createSourceFile("PurchaseRegistration.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = new Map<string, string>();
  for (const node of tree.statements) {
    const name = ts.isFunctionDeclaration(node) ? node.name?.text
      : ts.isVariableStatement(node) && node.declarationList.declarations.length === 1
        ? node.declarationList.declarations[0].name.getText(tree) : undefined;
    if (name && stockBaselineNames.some((target) => target === name)) selected.set(name, node.getText(tree));
  }
  for (const name of stockBaselineNames) if (!selected.has(name)) throw new Error(`Missing baseline declaration: ${name}`);
  const code = ts.transpileModule([...selected.values()].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const dependencies = { cleanLegacyManagementNo, parseEtc, getInventoryManagementNo, preferredManagementNo, getManagementNos, parseInvoiceFromManagementNo, getSupplier, toNumber, formatCurrency, formatTradePrice, normalizeCurrencyLabel, itemStockQuantity, itemQuantity, getItemLabels, purchaseRowStatusKind, statusLabel, normalizedLabelStatus, compactProductText, getInventoryCategory, displayStockCategory, stockModelName, STOCK_MODEL_ORDER, labelStatusLabel, labelAllocationLabel, isInventoryPrintableLabel };
  return new Function(...Object.keys(dependencies), `${code}\nreturn {${stockBaselineNames.join(",")}};`)(...Object.values(dependencies)) as T;
}
