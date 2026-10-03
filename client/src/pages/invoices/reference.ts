/** Optional reference runner: execute declarations from the untouched commit, not rewritten rules. */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

export function loadInvoiceReference(ref: string) {
  const source = execFileSync("git", ["show", `${ref}:client/src/pages/InvoicePage.tsx`], { encoding: "utf8" });
  const ast = ts.createSourceFile("InvoicePage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["calcDueDate", "getDefaultCurrencyForClient", "normalizeClientLookupText", "phoneDigits", "findClientByDetectedSender", "InvoicePreview"];
  const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text));
  if (declarations.length !== names.length) throw new Error("Reference declarations are missing");
  const code = declarations.map(node => node.getText(ast)).join("\n") + `\nexport { ${names.join(", ")} };`;
  const compiled = ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, require: createRequire(import.meta.url), Date, String, Boolean });
  return exports as typeof import("./clientRules") & typeof import("./dates") & typeof import("./InvoicePreview");
}
