import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jspdf from "jspdf";
import autoTable from "jspdf-autotable";
import * as pdfLib from "pdf-lib";
import { toast } from "sonner";

/** Frozen, unedited PDF declarations from 0471a7f; no Git history required in tests. */
export function loadPdfReference() {
  const source = readFileSync(new URL("./pdf-baseline-source.txt", import.meta.url), "utf8");
  const names = ["detectPdfLogoFormat", "blobToDataUrl", "loadPdfLogoImage", "createDownloadablePdfBlob", "generateInvoicePdf"];
  const compiled = ts.transpileModule(source + `\nexport { ${names.join(", ")} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const dependencies: Record<string, unknown> = { jspdf, "jspdf-autotable": { default: autoTable }, "pdf-lib": pdfLib };
  const exports = {};
  new Function("require", "exports", "toast", compiled.outputText)((id: string) => {
    if (!(id in dependencies)) throw new Error(`Unexpected baseline dependency: ${id}`);
    return dependencies[id];
  }, exports, toast);
  return exports as typeof import("./pdfLogo") & typeof import("./pdfBlob") & typeof import("./generateInvoicePdf");
}
