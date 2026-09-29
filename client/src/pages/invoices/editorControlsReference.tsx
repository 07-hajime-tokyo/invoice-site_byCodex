import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import {Button} from "@/components/ui/button";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import * as dialog from "@/components/ui/dialog";
import * as select from "@/components/ui/select";
import {ChevronLeft,RefreshCw,Save,Eye,Download,Sparkles,AlertCircle,CheckCircle2} from "lucide-react";
export const controlsBaseline=JSON.parse(readFileSync(new URL("./editor-controls-baseline.json",import.meta.url),"utf8")) as Record<string,string>;
export function loadEditorControls(current:Record<string,unknown>={}){
 let blocks=controlsBaseline;
 if(Object.keys(current).length){
  const source=readFileSync(new URL("./InvoiceEditor.tsx",import.meta.url),"utf8"),ast=ts.createSourceFile("x.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function find(n:ts.Node,start:number):ts.Node|undefined {if((ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n))&&n.getStart(ast)>=start)return n;let result:ts.Node|undefined;ts.forEachChild(n,c=>{if(!result)result=find(c,start)});return result;}
  blocks={};for(const[name,marker]of Object.entries({toolbar:'{/* Toolbar */}',over:'{/* 100万円超過確認ダイアログ */}',split:'{/* 分割インボイスプレビューダイアログ */}',contact:'{/* Client selection */}'}))blocks[name]=find(ast,source.indexOf(marker)+marker.length)!.getText(ast);
  blocks.notes="";
 }
 const source=`export function Screen(props:any){const {isDirty,setShowBackConfirm,onCancel,showBackConfirm,handleSave,createMutation,updateMutation,showPreview,setShowPreview,handleSavePdf,isPdfLoading,handleOpenSplitDialog,isFetchingRate,showOverLimitConfirm,setShowOverLimitConfirm,overLimitJpy,pendingSavePayload,persistInvoice,setPendingSavePayload,onSaved,showSplitDialog,setShowSplitDialog,exchangeRateInfo,form,splitPreview,handleConfirmSplit,createSplitMutation,clients,selectedClient,handleClientChange,setForm}=props;
 return <>${blocks.toolbar}${blocks.over}${blocks.split}${blocks.contact}${blocks.notes}</>;}`;
 const deps={Button,Label,Textarea,...dialog,...select,ChevronLeft,RefreshCw,Save,Eye,Download,Sparkles,AlertCircle,CheckCircle2,...current},exports:any={};
 const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 new Function("deps","require","exports",`const {${Object.keys(deps).join(",")}}=deps;\n${code}`)(deps,createRequire(import.meta.url),exports);return exports.Screen;
}
