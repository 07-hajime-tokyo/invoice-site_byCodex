import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import * as dialog from "@/components/ui/dialog";
import {
  MessageSquare,
  Upload,
  FileText,
  Pencil,
  X,
  RefreshCw,
  Download,
  Plus,
  Trash2,
  Send,
} from "lucide-react";
export function loadKnowledge(
  current: Record<string, unknown> = {},
  trpc: unknown
) {
  let source = readFileSync(
    new URL("./knowledge-baseline.txt", import.meta.url),
    "utf8"
  );
  if (Object.keys(current).length) {
    const all = readFileSync(
        new URL("../InvoicePage.tsx", import.meta.url),
        "utf8"
      ),
      ast = ts.createSourceFile(
        "x.tsx",
        all,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
    source = ast.statements
      .find(
        n =>
          ts.isFunctionDeclaration(n) && n.name?.text === "KnowledgeBaseDialog"
      )!
      .getText(ast);
  }
  const code = ts.transpileModule(
    `const getTodayStr=()=>new Date().toISOString().slice(0,10);\nexport ${source}`,
    {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }
  ).outputText;
  const deps = {
      useState,
      useRef,
      useEffect,
      useCallback,
      trpc,
      toast,
      Button,
      Textarea,
      ...dialog,
      MessageSquare,
      Upload,
      FileText,
      Pencil,
      X,
      RefreshCw,
      Download,
      Plus,
      Trash2,
      Send,
      ...current,
    },
    exports: any = {};
  new Function(
    "deps",
    "require",
    "exports",
    `const {${Object.keys(deps).join(",")}}=deps;\n${code}`
  )(deps, createRequire(import.meta.url), exports);
  return exports.KnowledgeBaseDialog;
}
