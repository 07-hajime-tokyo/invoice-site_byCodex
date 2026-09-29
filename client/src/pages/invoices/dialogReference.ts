import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as dialog from "@/components/ui/dialog";
import { Settings, Upload, RefreshCw, Users, Save, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

/** Executes the exact ef808dc component declarations using the same test adapters. */
export function loadDialogReference() {
  const source = readFileSync(new URL("./dialog-baseline-source.txt", import.meta.url), "utf8");
  const deps = { useState, useRef, trpc, Button, Input, Label, ...dialog, Settings, Upload, RefreshCw, Users, Save, Plus, Pencil, Trash2, toast };
  const code = ts.transpileModule(source + "\nexport { SenderSettingsDialog, ClientManagerDialog };", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function("deps", "require", "exports", `const { ${Object.keys(deps).join(",")} } = deps;\n${code}`)(deps, createRequire(import.meta.url), exports);
  return exports as typeof import("./SenderSettingsDialog") & typeof import("./ClientManagerDialog");
}
