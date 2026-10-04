import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, afterEach } from "vitest";
import { referenceForm, referenceRules, loadListMarkup } from "./listReference";

vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/select", () => ({ Select: "div", SelectTrigger: "div", SelectValue: "span", SelectContent: "div", SelectItem: "option" }));
const baseline = Boolean(process.env.INVOICE_LIST_REFERENCE);
const current = baseline ? null : { ...await import("./storedInvoiceForm"), ...await import("./listRules"), ...await import("./InvoiceCard") };
const ListMarkup = loadListMarkup(current ?? undefined);
const input = { invoiceNumber: "INV-0042", clientId: 7, invoiceDate: "2026-09-30", dueDate: null, currency: "EUR", showAmounts: true, status: "draft" as const, notes: null, rawChat: null, accentColor: null,
 items: [{ description: "One", variant: "Blue", quantity: "2.5", unitPrice: "12.345", currency: null, sortOrder: null, tax: "8.5" }, { description: "Zero", quantity: "0", unitPrice: "", sortOrder: 0, tax: null }] };
const rows = [
 { id: 1, invoiceNumber: "0042", clientId: 7, invoiceDate: "2026-09-30", status: "draft", currency: "EUR", itemCount: 2, totalAmount: 6666.666 },
 { id: 2, invoiceNumber: "0043", clientId: 999, invoiceDate: null, status: "sent", currency: "USD", itemCount: 0, totalAmount: 0 },
 { id: 3, invoiceNumber: "0044", clientId: 0, invoiceDate: "", status: "paid", currency: "JPY", itemCount: null, totalAmount: 1000000 },
 { id: 4, invoiceNumber: "0045", clientId: null, invoiceDate: null, status: "unexpected", currency: "CAD", totalAmount: -1.25 },
 { id: 5, invoiceNumber: "0046", clientId: 7, invoiceDate: "2026-09-30", status: "draft", currency: "GBP", totalAmount: null },
];
const convert = (mode: "preview"|"pdf"|"edit", value: any) => baseline ? referenceForm(mode,value) : mode === "edit" ? current!.storedInvoiceToEditForm(value) : current!.storedInvoiceToForm(value);
afterEach(() => vi.unstubAllGlobals());
describe("saved form conversion contracts", () => {
 for (const mode of ["preview","pdf","edit"] as const) it(mode, () => {
  const cases = [input, {...input, items:null}, {...input,items:undefined,clientId:0,accentColor:"",notes:"",rawChat:""}, {...input, items:[{description:"Missing",quantity:null,unitPrice:undefined,tax:0,sortOrder:undefined}, {description:"Invalid",variant:"",quantity:"bad",unitPrice:"1.1",currency:"",tax:"bad",sortOrder:0}]}];
  const before=structuredClone(cases);
  expect(cases.map(value=>convert(mode,value))).toMatchSnapshot(); expect(cases).toEqual(before);
 });
 it("compares all three real legacy expressions across numeric and null boundaries", () => {
  for(const quantity of [null,undefined,"",0,1.5,"2.25","bad"]) for(const tax of [null,undefined,0,"10",8.5]) {
   const value={...input,items:[{description:"Fixed",quantity,unitPrice:"12.345",tax,sortOrder:null}]};
   for(const mode of ["preview","pdf","edit"] as const) expect(convert(mode,value)).toEqual(referenceForm(mode,value));
  }
 });
});
describe("list currency and amount rules", () => {
 it("preserves currencies, missing/zero rates, rounding and order", () => {
  const rateCases = [[undefined,undefined,undefined,undefined],[{rate:150},{rate:0},{rate:190.25},{rate:170}],[{rate:-2},null,null,null]];
  expect(rateCases.map(r=>{
   const old=referenceRules(rows,...r as [unknown,unknown,unknown,unknown]);
   const rateMap=baseline?old.rateMap:current!.buildInvoiceRateMap(...r as [any,any,any,any]);
   const currencies=baseline?old.currencies:current!.invoiceListCurrencies(rows);
   const amounts=rows.map(row=>baseline?old.calcJpy(row.totalAmount??0,row.currency):current!.invoiceAmountJpy(row.totalAmount??0,row.currency,rateMap));
   return {currencies,rateMap,amounts};
  })).toMatchSnapshot();
 });
});
function expand(node:any):any {
 if(Array.isArray(node))return node.map(expand);
 if(!React.isValidElement(node))return node;
 const element=node as React.ReactElement<any>;
 if(typeof element.type==="function")return expand((element.type as Function)(element.props));
 return React.cloneElement(element,undefined,React.Children.map(element.props.children,expand));
}
function elements(node:any):React.ReactElement<any>[] {
 if(Array.isArray(node))return node.flatMap(elements);
 if(!React.isValidElement(node))return [];
 const element=node as React.ReactElement<any>; return [element,...elements(element.props.children)];
}
function fixture(overrides:Record<string,unknown>={}) {
 const events:unknown[]=[];
 const rateMap={JPY:1,EUR:150,USD:145,GBP:190};
 const props={invoiceList:rows,isLoading:false,clientMap:new Map([[7,{name:"Fixed Client"}],[0,{name:"Zero client"}]]),rateMap,calcJpy:(n:number,c:string)=>referenceRules([],undefined,undefined,undefined,undefined).calcJpy(n,c),
 onNew:()=>events.push(["new"]),onEdit:(id:number)=>events.push(["edit",id]),handlePreviewOpen:(id:number)=>events.push(["preview",id]),handleListPdf:(id:number,n:string)=>events.push(["pdf",id,n]),
 updateStatusMutation:{mutate:(p:unknown)=>events.push(["status",p])},cloneMutation:{isPending:false,mutate:(p:unknown)=>events.push(["clone",p])},deleteMutation:{mutate:(p:unknown)=>events.push(["delete",p])},previewLoading:false,previewInvId:null,pdfLoadingId:null,...overrides};
 props.calcJpy=(n:number,c:string)=>{const r=(props.rateMap as Record<string,number>)[c];return r==null?null:Math.round(n*r)};
 return {events,tree:expand(<ListMarkup {...props}/>)};
}
describe("original list markup and event payloads",()=>{
 for(const [name,options] of Object.entries({mixed:{},empty:{invoiceList:[]},loading:{isLoading:true},pending:{previewLoading:true,previewInvId:1,pdfLoadingId:2,cloneMutation:{isPending:true,mutate:()=>{}}}})) it(name,()=>{
  expect(renderToStaticMarkup(fixture(options).tree)).toMatchSnapshot();
 });
 it("preserves callback payloads and delete cancellation",()=>{
  const {tree,events}=fixture({invoiceList:[rows[0]]});
  const nodes=elements(tree);
  for(const title of ["プレビュー","編集","PDF保存","クローン（最新番号+1で複製）"])nodes.find(e=>e.props.title===title)!.props.onClick();
  nodes.find(e=>e.props.onValueChange)!.props.onValueChange("paid");
  vi.stubGlobal("confirm",vi.fn(()=>false));nodes.find(e=>e.props.title==="削除")!.props.onClick();
  vi.mocked(confirm).mockReturnValue(true);nodes.find(e=>e.props.title==="削除")!.props.onClick();
  expect(confirm).toHaveBeenCalledWith("「0042」を削除しますか？");expect(events).toMatchSnapshot();
 });
 it("keeps the empty-state new invoice event",()=>{
  const {tree,events}=fixture({invoiceList:[]}); elements(tree).find(e=>e.type==="button")!.props.onClick(); expect(events).toEqual([["new"]]);
 });
});
