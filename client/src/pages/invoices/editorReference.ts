import { readFileSync } from "node:fs";
import ts from "typescript";
import { getDefaultCurrencyForClient } from "./clientRules";
import type { InvoiceFormData, InvoiceItem } from "./types";
export const editorBaseline = JSON.parse(readFileSync(new URL("./editor-baseline.json", import.meta.url), "utf8")) as Record<string,string>;
const compiled = ts.transpileModule(`export function create(form:any,clients:any,exchangeRateInfo:any,splitPreview:any,getDefaultCurrencyForClient:any) {
 const useCallback=(fn:any)=>fn;
 const setForm=(fn:any)=>{form=fn(form)};
 let saved:any;
 const createSplitMutation={mutate:(payload:any)=>{saved=payload}};
 ${Object.entries(editorBaseline).map(([name,expr])=>`const ${name}=${expr};`).join("\n")}
 return {
 split:(items:any,rate:any,limit:any)=>computeSplits(items,rate,limit),
 save:()=>buildSavePayload(),
 splitSave:()=>{handleConfirmSplit();return saved},
 add:()=>{addItem();return form},update:(...args:any[])=>{updateItem(...args);return form},remove:(idx:any)=>{removeItem(idx);return form},client:(value:any)=>{handleClientChange(value);return form}
 };
}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const exports: any={};new Function("exports",compiled)(exports);
export function editorReference(form:InvoiceFormData,clients:unknown[]=[],exchangeRateInfo:unknown=null,splitPreview:unknown[]=[]) {
 return exports.create(form,clients,exchangeRateInfo,splitPreview,getDefaultCurrencyForClient) as {
 split:(items:InvoiceItem[],rate:number,limit?:number)=>Array<{invoiceNumber:string;items:InvoiceItem[];totalJpy:number}>;
 save:()=>unknown;splitSave:()=>unknown;add:()=>InvoiceFormData;update:(idx:number,field:keyof InvoiceItem,value:string|number)=>InvoiceFormData;remove:(idx:number)=>InvoiceFormData;client:(value:string)=>InvoiceFormData;
 };
}
