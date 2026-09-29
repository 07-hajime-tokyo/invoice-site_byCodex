/** Test-only adapter: evaluate current pure screen declarations without loading the UI/API. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { hasAnyProductText } from "./productText";
import { buildStockItemViewsFromInventories } from "./stockViews";
import type { PurchaseItem, InventoryItem } from "./dataTypes";
import type { StockItemView } from "./viewTypes";

export type CurrentPageLabelRules = {
  actualProductTitle(item: PurchaseItem): string;
  buildStockItemViewsFromInventories(inventories: InventoryItem[]): StockItemView[];
};

export function loadCurrentPageLabelRules(): CurrentPageLabelRules {
  const source = readFileSync(new URL("../PurchaseRegistration.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("PurchaseRegistration.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["displayProductTitle", "actualProductTitle"];
  const nodes = tree.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ""));
  if (nodes.length !== names.length) throw new Error("Missing current screen label declarations");
  const code = ts.transpileModule(nodes.map((node) => node.getText(tree)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const dependencies = { parseEtc, hasAnyProductText, buildStockItemViewsFromInventories };
  return new Function(...Object.keys(dependencies), `${code}\nreturn { actualProductTitle, buildStockItemViewsFromInventories };`)(...Object.values(dependencies)) as CurrentPageLabelRules;
}
