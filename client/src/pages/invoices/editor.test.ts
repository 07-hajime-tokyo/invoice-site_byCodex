import { describe,it,expect } from "vitest";
import { editorReference } from "./editorReference";
import type { InvoiceFormData,InvoiceItem } from "./types";
const baseline=Boolean(process.env.INVOICE_EDITOR_REFERENCE);
const current=baseline?null:{...await import("./editorItems"),...await import("./editorPayload"),...await import("./splitInvoices")};
const form:InvoiceFormData={invoiceNumber:"INV-0099",clientId:7,invoiceDate:"2026-09-30",dueDate:"",currency:"EUR",showAmounts:true,notes:" note ",rawChat:"",status:"draft",accentColor:"#db8b1a",items:[{description:"One",subText:"Blue",quantity:2,unitPrice:250000,tax:10,sortOrder:8,currency:"EUR"},{description:"Two",subText:"",quantity:1,unitPrice:0.125,tax:8.5,sortOrder:3,currency:"USD"},{description:"Three",quantity:1,unitPrice:500000,sortOrder:1}]};
const clients=[{id:7,name:"Luca",company:null,email:"fixed@example.invalid",extraInfo:"keep",extraField:42},{id:8,name:"Unknown",company:"New Co"},{id:0,name:"Zero"}];
function subject(f=form,c=clients){const old=editorReference(f,c);return baseline?{add:()=>editorReference(f,c).add(),update:(i:number,k:keyof InvoiceItem,v:string|number)=>editorReference(f,c).update(i,k,v),remove:(i:number)=>editorReference(f,c).remove(i),client:(v:string)=>editorReference(f,c).client(v),save:()=>old.save(),split:old.split}:{
 add:()=>current!.addInvoiceItem(f),update:(i:number,k:keyof InvoiceItem,v:string|number)=>current!.updateInvoiceItem(f,i,k,v),remove:(i:number)=>current!.removeInvoiceItem(f,i),client:(v:string)=>current!.applyInvoiceClient(f,current!.resolveInvoiceClient(c,v)),save:()=>current!.buildInvoiceSavePayload(f,c),split:(items:InvoiceItem[],rate:number,limit?:number)=>current!.computeInvoiceSplits(f.invoiceNumber,items,rate,limit),
};}
describe("editor item and client rules",()=>{
 it("captures addition, out-of-range updates/removals, order and field values",()=>{
  const s=subject();expect([s.add(),s.update(0,"unitPrice",0),s.update(1,"tax",12.5),s.update(-1,"description","ignored"),s.update(99,"quantity",7),s.remove(0),s.remove(99)]).toMatchSnapshot();
 });
 it("preserves currency selection rules including zero/missing clients and mixed item currencies",()=>{
  expect(["7","8","0","__none__","bad","", "999"].map(v=>subject().client(v))).toMatchSnapshot();
 });
 it("preserves unaffected item identity and does not renumber remaining items",()=>{
  const s=subject();const edited=s.update(0,"description","Changed");expect(edited.items[1]).toBe(form.items[1]);expect(edited.items[0]).not.toBe(form.items[0]);
  const removed=subject().remove(0);expect(removed.items[0]).toBe(form.items[1]);expect(removed.items[0].sortOrder).toBe(3);
  expect(subject().client("8").items[1]).toBe(form.items[1]);
 });
});
describe("save payload contracts",()=>{
 it("captures complete client snapshots, variants, tax, empty and nullish values",()=>{
  const variants=[form,{...form,clientId:999},{...form,clientId:0},{...form,items:[]},{...form,items:[{description:"Null",subText:null,quantity:0,unitPrice:0,tax:null}]}] as InvoiceFormData[];
  expect(variants.map(f=>subject(f).save())).toMatchSnapshot();
 });
 it("preserves client identity and makes fresh item payloads without changing input",()=>{
  const before=structuredClone(form);const payload=subject().save() as any;
  expect(payload.clientSnapshot).toBe(clients[0]);expect(payload.items[0]).not.toBe(form.items[0]);expect(form).toEqual(before);
 });
 it("captures split payload and its guard conditions",()=>{
  const splits=editorReference(form).split(form.items,1);
  const cases=[null,{rate:0,date:"fixed"},{rate:1.25,date:"fixed"}];
  expect(cases.flatMap(rate=>[[],splits].map(groups=>baseline?editorReference(form,clients,rate,groups).splitSave():current!.buildInvoiceSplitPayload(form,clients,rate,groups)))).toMatchSnapshot();
 });
});
describe("original split rules",()=>{
 it("captures exact limit, over-limit single items, zero, negative, tax and numbering",()=>{
  const sets=[[],form.items,[{description:"Over",quantity:2,unitPrice:1000000,tax:99}],[{description:"Exact",quantity:1,unitPrice:1000000},{description:"Next",quantity:1,unitPrice:0.001}],[{description:"Negative",quantity:1,unitPrice:-1},{description:"Zero",quantity:0,unitPrice:100}]];
  expect([" INV-0099 ","12345","No digits","","0000"].map(invoiceNumber=>sets.map(items=>subject({...form,invoiceNumber}).split(items,1)))).toMatchSnapshot();
 });
 it("compares real legacy calculation with rates and limits without mutation or copying items",()=>{
  const before=structuredClone(form);
  for(const rate of [0,1,1.234,-1,150])for(const limit of [0,1,1000000]){
   const actual=subject().split(form.items,rate,limit);expect(actual).toEqual(editorReference(form).split(form.items,rate,limit));
   expect(actual.flatMap(g=>g.items)).toEqual(form.items);expect(actual[0].items[0]).toBe(form.items[0]);
  }
  expect(form).toEqual(before);
 });
});
