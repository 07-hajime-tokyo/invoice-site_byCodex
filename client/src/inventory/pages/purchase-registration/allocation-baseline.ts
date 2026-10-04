/** Test-only original declarations from 7db6054, including the unchanged dashboard boundary. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatTradePrice, toNumber } from "./format";
import { getInvoiceInfo, OTHER_INVOICE_KEY, EBAY_GROUP_KEY, EBAY_GROUP_LABEL } from "./invoiceIdentity";
import { getSupplier } from "./supplier";
import { buildProductSummaries } from "./productSummaries";
import { createPurchaseLabelBuilders } from "./purchaseLabelViews";
import { actualProductTitle } from "./productTitles";
import { itemQuantity } from "./purchaseItems";
import { unique } from "./stringValues";

export const ALLOCATION_BASELINE_COMMIT = "7db6054";
export const allocationBaselineNames = ["isShippableLabelStatus", "mergeLabelViewsById", "hasOpenInvoiceQuantity", "buildAllocationGroups", "mergeAllocationGroupsByKey", "getAllRowsFromGroup", "StatCard", "ProductFulfillmentTable", "ProductFulfillmentTableV2"] as const;

export function loadAllocationBaseline<T>(): T {
  const source = readFileSync(new URL("./allocation-baseline-source.txt", import.meta.url), "utf8");
  const tree = ts.createSourceFile("baseline.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = tree.statements.filter(n => ts.isFunctionDeclaration(n) && allocationBaselineNames.some(name => name === n.name?.text));
  if (selected.length !== allocationBaselineNames.length) throw new Error("Missing allocation baseline declarations");
  const code = ts.transpileModule(selected.map(n => n.getText(tree)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const { buildLabelViews } = createPurchaseLabelBuilders(actualProductTitle);
  const dependencies = { React, cn, formatCurrency, formatTradePrice, toNumber, getInvoiceInfo, OTHER_INVOICE_KEY, EBAY_GROUP_KEY, EBAY_GROUP_LABEL, getSupplier, buildProductSummaries, buildLabelViews, itemQuantity, unique };
  return new Function(...Object.keys(dependencies), `${code}\nreturn {${allocationBaselineNames.join(",")}};`)(...Object.values(dependencies)) as T;
}
