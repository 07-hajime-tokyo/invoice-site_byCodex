import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { Button } from "@/components/ui/button";
import * as select from "@/components/ui/select";
import { RefreshCw, FileText, Plus, AlertCircle, Loader2, Eye, Pencil, FileDown, Copy, Trash2 } from "lucide-react";
import type { InvoiceFormData } from "./types";

export const listBaseline = JSON.parse(readFileSync(new URL("./list-baseline.json", import.meta.url), "utf8")) as Record<string, string>;
function evaluate(code: string, dependencies: Record<string, unknown> = {}) {
  const compiled = ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: any = {};
  new Function("deps", "require", "exports", `const { ${Object.keys(dependencies).join(",")} } = deps;\n${compiled}`)(dependencies, createRequire(import.meta.url), exports);
  return exports;
}
export function referenceForm(mode: "preview" | "pdf" | "edit", input: unknown): InvoiceFormData {
  return evaluate(`export function run(inv:any) { const editInvoice=inv; return ${listBaseline[mode]}; }`).run(input);
}
export function referenceRules(invoiceList: unknown[], eurRate: unknown, usdRate: unknown, gbpRate: unknown, chfRate: unknown) {
  return evaluate(`export function run(invoiceList:any,eurRate:any,usdRate:any,gbpRate:any,chfRate:any) {
    const currencies = (${listBaseline.currencies})(); const rateMap = (${listBaseline.rates})();
    return { currencies, rateMap, calcJpy: ${listBaseline.jpy} };
  }`).run(invoiceList,eurRate,usdRate,gbpRate,chfRate);
}
export function loadListMarkup(current?: { InvoiceCard: unknown }) {
  let markup = listBaseline.list;
  if (current) {
    const source = readFileSync(new URL("../InvoicePage.tsx", import.meta.url), "utf8");
    markup = source.slice(source.indexOf('      {/* List */}') + '      {/* List */}'.length, source.indexOf('      <ClientManagerDialog open={showClientManager}')).trim();
  }
  return evaluate(`${listBaseline.badge}\nexport function ListMarkup(props:any) {
    const { invoiceList, isLoading, clientMap, rateMap, calcJpy, onNew, updateStatusMutation, handlePreviewOpen, previewLoading, previewInvId, onEdit, handleListPdf, pdfLoadingId, cloneMutation, deleteMutation }=props;
    return <>${markup}</>;
  }`, { Button, ...select, RefreshCw, FileText, Plus, AlertCircle, Loader2, Eye, Pencil, FileDown, Copy, Trash2, ...current }).ListMarkup;
}
