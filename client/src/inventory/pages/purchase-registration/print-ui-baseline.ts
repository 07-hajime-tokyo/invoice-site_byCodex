/** Test-only 8cfcd9d print declarations. LabelPrintPanel is retained for source comparison only. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import { Fragment, useMemo } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { OUTBOUND_BOX_CODE_PATTERN } from "@shared/outboundBoxes";
import { createQrMatrix, buildQrPath, QR_QUIET_ZONE } from "./qr";
import { buildChecklistRows, clampLabelStartPosition, chunkArray, LABELS_PER_SHEET } from "./labelPrintLayout";

export const PRINT_UI_BASELINE_COMMIT = "8cfcd9d";
export const printUiBaselineNames = ["ProductQrCode", "LabelPrintStyles", "PrintableLabelSheet", "LabelChecklistView", "PrintableChecklistSheet"] as const;
export function loadPrintUiBaseline<T>(): T {
  const source = readFileSync(new URL("./print-ui-baseline-source.txt", import.meta.url), "utf8");
  const tree = ts.createSourceFile("baseline.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = tree.statements.filter(n => ts.isFunctionDeclaration(n) && printUiBaselineNames.some(name => name === n.name?.text));
  if (nodes.length !== printUiBaselineNames.length) throw new Error("Missing print baseline declaration");
  const code = ts.transpileModule(nodes.map(n => n.getText(tree)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const deps = { React, Fragment, useMemo, createPortal, cn, OUTBOUND_BOX_CODE_PATTERN, createQrMatrix, buildQrPath, QR_QUIET_ZONE, buildChecklistRows, clampLabelStartPosition, chunkArray, LABELS_PER_SHEET };
  return new Function(...Object.keys(deps), `${code}\nreturn {${printUiBaselineNames.join(",")}};`)(...Object.values(deps)) as T;
}
