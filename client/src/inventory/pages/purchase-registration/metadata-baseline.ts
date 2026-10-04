/** Test-only adapter for R05 declarations captured verbatim from 0471a7f. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { extractManagementHints } from "@shared/productMatching";
import { getItemLabels } from "./purchaseItems";
import type { PurchaseItem, PurchaseRow } from "./dataTypes";
import type { StockItemView, SupplierView } from "./viewTypes";

export const METADATA_BASELINE_COMMIT = "0471a7f";
export const metadataBaselineNames = [
  "cleanLegacyManagementNo", "buildEtcWithManagementNo", "parseEtc", "getInventoryManagementNo",
  "normalizeManagementNoForDisplay", "isStockManagementNoSuffixAlias", "uniqueManagementNos", "preferredManagementNo", "getManagementNos",
  "parseInvoiceFromManagementNo", "isEbayManagementNo", "getInvoiceInfo", "invoiceNoFromGroupKey",
  "getSupplier", "buildSearchText", "buildStockSearchText", "OTHER_INVOICE_KEY", "EBAY_GROUP_KEY", "EBAY_GROUP_LABEL",
] as const;

export interface MetadataBaseline {
  cleanLegacyManagementNo(value?: string | null): string;
  buildEtcWithManagementNo(managementNo: string, currentEtc?: string | null, supplierName?: string | null): string;
  parseEtc(etc?: string | null): { managementNo: string; supplierSite: string };
  getInventoryManagementNo(etc?: string | null): string;
  normalizeManagementNoForDisplay(value: string): string;
  isStockManagementNoSuffixAlias(value: string, candidates: string[]): boolean;
  uniqueManagementNos(values: string[]): string[];
  preferredManagementNo(currentManagementNo?: string | null, labelManagementNo?: string | null, fallback?: string): string;
  getManagementNos(items: PurchaseItem[]): string[];
  parseInvoiceFromManagementNo(managementNo: string): { invoiceNo: string; partner: string } | null;
  isEbayManagementNo(managementNo: string | null | undefined): boolean;
  getInvoiceInfo(row: PurchaseRow): { key: string; invoiceNo: string; partner: string };
  invoiceNoFromGroupKey(key?: string | null): string | null;
  getSupplier(row: PurchaseRow): SupplierView;
  buildSearchText(row: PurchaseRow): string;
  buildStockSearchText(item: StockItemView): string;
}

export function loadMetadataBaseline(): MetadataBaseline {
  const source = readFileSync(new URL("./metadata-baseline-source.txt", import.meta.url), "utf8");
  const tree = ts.createSourceFile("PurchaseRegistration.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = new Map<string, string>();
  for (const node of tree.statements) {
    const name = ts.isFunctionDeclaration(node) ? node.name?.text
      : ts.isVariableStatement(node) && node.declarationList.declarations.length === 1
        ? node.declarationList.declarations[0].name.getText(tree) : undefined;
    if (name && metadataBaselineNames.some((target) => target === name)) selected.set(name, node.getText(tree));
  }
  for (const name of metadataBaselineNames) if (!selected.has(name)) throw new Error(`Missing baseline declaration: ${name}`);
  const code = ts.transpileModule([...selected.values()].join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function("extractManagementHints", "getItemLabels", `${code}\nreturn {${metadataBaselineNames.join(",")}};`)(extractManagementHints, getItemLabels) as MetadataBaseline;
}
