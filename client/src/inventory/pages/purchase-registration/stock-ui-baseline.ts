/** Test-only actual b04b91d screen declarations. Tests require no Git history. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Boxes, ChevronDown, PackageCheck, Pencil, Tag } from "lucide-react";
import { normalizeExternalUrl } from "@/inventory/lib/supplier";
import { formatCurrency, formatDate } from "./format";
import { proposalAveragePrice, stockProposalPriceLabel, stockProposalManagementLabel } from "./stockProposalDisplay";
import { EmptyState } from "./EmptyState";
import { buildStockItemViewsFromInventories, buildStockItemGroups, stockItemStatusBadgeClass } from "./stockViews";
import { createZeroStockPurchaseBuilder } from "./stockWaiting";
import { createStockProposalBuilder } from "./stockProposalGroups";
import { actualProductTitle } from "./productTitles";
import { buildStockSearchText } from "./search";
import { invoiceDisplayLabel } from "./shippingRules";
import { BoxItemInvoiceField } from "./OutboundBoxes";

export const STOCK_UI_BASELINE_COMMIT = "b04b91d";
export const stockUiBaselineNames = ["fieldClass", "buildZeroStockPurchaseItemViewsFromRows", "buildStockProposalGroups", "StockProposalPanel", "StockProposalGroupCard", "StockProposalProductRow", "StockProposalProductMobile", "StockPanel"] as const;
export function loadStockUiBaseline<T>(): T {
  const source = readFileSync(new URL("./stock-ui-baseline-source.txt", import.meta.url), "utf8");
  const tree = ts.createSourceFile("baseline.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = tree.statements.filter(n => {
    const name = ts.isFunctionDeclaration(n) ? n.name?.text : ts.isVariableStatement(n) && n.declarationList.declarations.length === 1 ? n.declarationList.declarations[0].name.getText(tree) : undefined;
    return stockUiBaselineNames.some(target => name === target);
  });
  if (nodes.length !== stockUiBaselineNames.length) throw new Error("Missing stock UI baseline declaration");
  const code = ts.transpileModule(nodes.map(n => n.getText(tree)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const deps = { React, Fragment, useState, cn, Button, Badge, Collapsible, CollapsibleTrigger, CollapsibleContent, Boxes, ChevronDown, PackageCheck, Pencil, Tag, normalizeExternalUrl, formatCurrency, formatDate, proposalAveragePrice, stockProposalPriceLabel, stockProposalManagementLabel, EmptyState, buildStockItemViewsFromInventories, buildStockItemGroups, stockItemStatusBadgeClass, createZeroStockPurchaseBuilder, createStockProposalBuilder, actualProductTitle, buildStockSearchText, invoiceDisplayLabel, BoxItemInvoiceField };
  return new Function(...Object.keys(deps), `${code}\nreturn {${stockUiBaselineNames.join(",")}};`)(...Object.values(deps)) as T;
}
