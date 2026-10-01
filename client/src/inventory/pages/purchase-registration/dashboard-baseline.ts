/** Test-only actual 4037f50 screen declarations. No Git or live DOM required. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarDays, ExternalLink, Pencil, Truck, Printer, Loader2, Trash2, PackagePlus, PackageCheck, Boxes } from "lucide-react";
import { normalizeExternalUrl } from "@/inventory/lib/supplier";
import { getCarrierColor } from "@/inventory/lib/tracking";
import { actualProductTitle } from "./productTitles";
import { getItemLabels, sumQuantity, itemStockQuantity, itemQuantity } from "./purchaseItems";
import { getManagementNos, preferredManagementNo } from "./managementNumbers";
import { getSupplier } from "./supplier";
import { normalizedTrackingNumber, purchaseTrackingNumber, getPurchaseTrackingMeta, TRACKING_CARRIER_LABELS } from "./tracking";
import { buildLabelViews } from "./registrationLabelViews";
import { labelBadgeClass } from "./labelStatus";
import { statusClass, statusLabel, purchaseRowStatusKind } from "./rowStatus";
import { formatCurrency, formatDate, toNumber } from "./format";
import { getAllRowsFromGroup } from "./allocationGroups";
import { EBAY_GROUP_KEY, OTHER_INVOICE_KEY } from "./invoiceIdentity";
import { buildProductSummaries } from "./productSummaries";
import { buildForecastSummary } from "./stockForecast";
import { productDetailFilterLabel } from "./productDetailFilters";
import { StatCard } from "./StatCard";
import { ProductFulfillmentTableV2 } from "./ProductFulfillmentTable";
import { invoiceDisplayLabel } from "./shippingRules";
import { invoiceNoFromManagementNo } from "@shared/invoiceKey";
import { BoxItemInvoiceField } from "./OutboundBoxes";

export const DASHBOARD_BASELINE_COMMIT = "4037f50";
export const dashboardBaselineNames = ["openEcohaiTracking", "purchaseRowInventoryId", "PurchaseRegistrationCard", "StockDetailCard", "EmptyState", "OrderDashboard"] as const;
export function loadDashboardBaseline<T>(): T {
  const source = readFileSync(new URL("./dashboard-baseline-source.txt", import.meta.url), "utf8");
  const tree = ts.createSourceFile("baseline.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = tree.statements.filter(n => ts.isFunctionDeclaration(n) && dashboardBaselineNames.some(name => name === n.name?.text));
  if (nodes.length !== dashboardBaselineNames.length) throw new Error("Missing dashboard baseline declarations");
  const code = ts.transpileModule(nodes.map(n => n.getText(tree)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const deps = { React, useState, useEffect, cn, Button, Badge, Checkbox, CalendarDays, ExternalLink, Pencil, Truck, Printer, Loader2, Trash2, PackagePlus, PackageCheck, Boxes, normalizeExternalUrl, getCarrierColor, actualProductTitle, getItemLabels, sumQuantity, itemStockQuantity, itemQuantity, getManagementNos, preferredManagementNo, getSupplier, normalizedTrackingNumber, purchaseTrackingNumber, getPurchaseTrackingMeta, TRACKING_CARRIER_LABELS, buildLabelViews, labelBadgeClass, statusClass, statusLabel, purchaseRowStatusKind, formatCurrency, formatDate, toNumber, getAllRowsFromGroup, EBAY_GROUP_KEY, OTHER_INVOICE_KEY, buildProductSummaries, buildForecastSummary, productDetailFilterLabel, StatCard, ProductFulfillmentTableV2, invoiceDisplayLabel, invoiceNoFromManagementNo, BoxItemInvoiceField };
  return new Function(...Object.keys(deps), `${code}\nreturn {${dashboardBaselineNames.join(",")}};`)(...Object.values(deps)) as T;
}
