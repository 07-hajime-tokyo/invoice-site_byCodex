/** Test-only original declarations from 5873dbe. Normal tests do not use Git. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { extractManagementHints, extractModel, extractPreferredModel, inventoryItemCanMatchCsvProduct, isInvoice407AnimalCrossingWhiteBaseMatch, suggestCsvProduct } from "@shared/productMatching";
import { compactProductText, productKey, hasAnyProductText } from "./productText";
import { unique } from "./stringValues";
import { toNumber } from "./format";
import { itemQuantity, itemStockQuantity } from "./purchaseItems";
import { isReceived, purchaseRowStatusKind } from "./rowStatus";

export const PRODUCT_BASELINE_COMMIT = "5873dbe";
export const productBaselineNames = [
  "LIMITED_EDITION_PRODUCT_KEYWORDS", "limitedEditionProductKey", "isRandomColorProductTitle", "limitedEditionKeysCompatible", "canMatchTargetProduct", "canMatchStockTargetProduct",
  "displayProductTitle", "actualProductTitle", "invoiceAlignedProductTitle",
  "suggestAnimalCrossingInvoiceProduct", "suggestInvoice407WhiteBaseProduct", "suggestInvoiceProductName", "suggestInvoiceProductNameFromHints",
  "purchaseItemMatchTexts", "purchaseItemMatchesProduct", "stockItemMatchesProduct", "stockItemMatchData", "findInvoiceProductNameForStockItem",
  "filterRowsByProductDetail", "filterStockItemsByProductDetail", "filterStockItemsByInvoiceProductDetail", "withInvoiceStockCountsFromItems", "productDetailFilterLabel",
  "buildProductSummaries", "buildInvoiceStockProductSummaries", "filterInvoiceStockItems", "withInvoiceProductCounts",
] as const;

export function loadProductBaseline<T>(): T {
  const source = readFileSync(new URL("./product-baseline-source.txt", import.meta.url), "utf8");
  const tree = ts.createSourceFile("PurchaseRegistration.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = new Map<string, string>();
  for (const node of tree.statements) {
    const name = ts.isFunctionDeclaration(node) ? node.name?.text
      : ts.isVariableStatement(node) && node.declarationList.declarations.length === 1
        ? node.declarationList.declarations[0].name.getText(tree) : undefined;
    if (name && productBaselineNames.some((target) => target === name)) selected.set(name, node.getText(tree));
  }
  for (const name of productBaselineNames) if (!selected.has(name)) throw new Error(`Missing baseline declaration: ${name}`);
  const code = ts.transpileModule([...selected.values()].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const dependencies = { parseEtc, extractManagementHints, extractModel, extractPreferredModel, inventoryItemCanMatchCsvProduct, isInvoice407AnimalCrossingWhiteBaseMatch, suggestCsvProduct, compactProductText, productKey, hasAnyProductText, unique, toNumber, itemQuantity, itemStockQuantity, isReceived, purchaseRowStatusKind };
  return new Function(...Object.keys(dependencies), `${code}\nreturn {${productBaselineNames.join(",")}};`)(...Object.values(dependencies)) as T;
}
