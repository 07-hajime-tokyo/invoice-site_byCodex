import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import {useState,useRef,useEffect} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Switch} from "@/components/ui/switch";
import * as select from "@/components/ui/select";
import {Plus,X} from "lucide-react";
import {calcDueDate} from "./dates";
export const editorUiBaseline=JSON.parse(readFileSync(new URL("./editor-ui-baseline.json",import.meta.url),"utf8")) as Record<string,string>;
export function loadEditorUiReference(){
 const source=`export function InvoiceMetadata({form,setForm}:any){return (${editorUiBaseline.metadata})}\nexport function InvoiceItemsEditor({form,addItem,updateItem,removeItem}:any){return (${editorUiBaseline.items})}\nexport ${editorUiBaseline.ScaledPreview}\nexport ${editorUiBaseline.ScaledPreviewFit}`;
 const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const deps={useState,useRef,useEffect,Button,Input,Label,Switch,...select,Plus,X,calcDueDate},exports={};
 new Function("deps","require","exports",`const {${Object.keys(deps).join(",")}}=deps;\n${code}`)(deps,createRequire(import.meta.url),exports);
 return exports as typeof import("./InvoiceMetadata") & typeof import("./InvoiceItemsEditor") & typeof import("./ScaledPreview");
}
