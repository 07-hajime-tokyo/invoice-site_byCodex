import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {InvoiceFormData} from "./types";
import {loadEditorUiReference} from "./editorUiReference";
const hooks=vi.hoisted(()=>({active:false,cursor:0,slots:[] as any[],effects:[] as (()=>void|(()=>void))[]}));
vi.mock("react",async(load)=>{const actual=await load<typeof import("react")>();return {...actual,
 useState(initial:any){if(!hooks.active)return actual.useState(initial);const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]=initial;return[hooks.slots[i],(value:any)=>{hooks.slots[i]=value}]},
 useRef(initial:any){if(!hooks.active)return actual.useRef(initial);const i=hooks.cursor++;return hooks.slots[i]??(hooks.slots[i]={current:initial})},
 useEffect(effect:any,deps:any){if(!hooks.active)return actual.useEffect(effect,deps);const i=hooks.cursor++;if(!(i in hooks.slots)){hooks.slots[i]=true;hooks.effects.push(effect)}},
}});
vi.mock("@/components/ui/button",()=>({Button:"button"}));
vi.mock("@/components/ui/input",()=>({Input:"input"}));
vi.mock("@/components/ui/label",()=>({Label:"label"}));
vi.mock("@/components/ui/switch",()=>({Switch:"span"}));
vi.mock("@/components/ui/select",()=>({Select:"div",SelectTrigger:"div",SelectValue:"span",SelectContent:"div",SelectItem:"option"}));
const subject=process.env.INVOICE_EDITOR_UI_REFERENCE?loadEditorUiReference():{...await import("./InvoiceMetadata"),...await import("./InvoiceItemsEditor"),...await import("./ScaledPreview")};
const form:InvoiceFormData={invoiceNumber:"INV-0042",clientId:null,invoiceDate:"2026-09-30",dueDate:"2026-12-31",currency:"EUR",showAmounts:true,notes:"",rawChat:"",status:"draft",accentColor:"",items:[{description:"One",subText:"Blue",quantity:2.5,unitPrice:1234.567,tax:10},{description:"Zero",quantity:0,unitPrice:0}]};
function nodes(node:any):React.ReactElement<any>[] {if(Array.isArray(node))return node.flatMap(nodes);if(!React.isValidElement(node))return[];const el=node as React.ReactElement<any>;return[el,...nodes(el.props.children)]}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});
beforeEach(()=>{hooks.active=false;hooks.cursor=0;hooks.slots=[];hooks.effects=[]});
describe("editor metadata and item JSX",()=>{
 it("captures metadata for default/color/status/currency cases",()=>{
  for(const currency of ["EUR","USD","JPY","GBP"])expect(renderToStaticMarkup(<subject.InvoiceMetadata form={{...form,currency}} setForm={()=>{}}/>)).toMatchSnapshot(currency);
 });
 it("preserves metadata input events and unconditional due-date recalculation",()=>{
  let current=form;const setForm:React.Dispatch<React.SetStateAction<InvoiceFormData>>=value=>{current=typeof value==="function"?value(current):value};
  const elements=nodes(subject.InvoiceMetadata({form,setForm}));
  elements.find(e=>e.props.placeholder==="INV-20260324-001")!.props.onChange({target:{value:" 0043 "}});
  const dates=elements.filter(e=>e.props.type==="date");dates[0].props.onChange({target:{value:"2026-01-31"}});expect(current.dueDate).toBe("2026-03-02");
  dates[1].props.onChange({target:{value:""}});
  elements.find(e=>e.props.value==="draft"&&e.props.onValueChange)!.props.onValueChange("paid");
  elements.find(e=>e.props.value==="EUR"&&e.props.onValueChange)!.props.onValueChange("JPY");
  elements.find(e=>e.props.id==="show-amounts")!.props.onCheckedChange(false);
  elements.find(e=>e.props.type==="color")!.props.onChange({target:{value:"#123456"}});
  expect(current).toMatchSnapshot();
 });
 for(const [name,value]of Object.entries({populated:form,hidden:{...form,showAmounts:false},empty:{...form,items:[]},usd:{...form,currency:"USD"},jpy:{...form,currency:"JPY"},gbp:{...form,currency:"GBP"}}))it(name,()=>{
  expect(renderToStaticMarkup(<subject.InvoiceItemsEditor form={value} addItem={()=>{}} updateItem={()=>{}} removeItem={()=>{}}/>)).toMatchSnapshot();
 });
 it("preserves index/field/value events, Number conversion and input selection",()=>{
  const events:unknown[]=[];const tree=subject.InvoiceItemsEditor({form,addItem:()=>events.push(["add"]),updateItem:(...args)=>events.push(["update",...args]),removeItem:i=>events.push(["remove",i])});const elements=nodes(tree);
  elements.find(e=>e.type==="button")!.props.onClick();
  elements.find(e=>e.props.placeholder==="商品名・説明")!.props.onChange({target:{value:" Edited "}});
  elements.find(e=>e.props.placeholder==="種類・カラー等（任意）")!.props.onChange({target:{value:""}});
  const numbers=elements.filter(e=>e.props.type==="number");numbers[0].props.onChange({target:{value:""}});numbers[1].props.onChange({target:{value:"12.345"}});
  const select=vi.fn();for(const input of numbers)input.props.onFocus({currentTarget:{select}});
  elements.filter(e=>e.type==="button").at(-1)!.props.onClick();expect(events).toMatchSnapshot();expect(select).toHaveBeenCalledTimes(4);
 });
});
describe("scaled previews with fixed ResizeObserver",()=>{
 for(const kind of ["ScaledPreview","ScaledPreviewFit"]as const)it(kind,()=>{
  let update!:()=>void;const observe=vi.fn(),disconnect=vi.fn();vi.stubGlobal("ResizeObserver",class{constructor(fn:()=>void){update=fn}observe=observe;disconnect=disconnect});
  const render=()=>{hooks.cursor=0;hooks.active=true;try{return subject[kind]({children:<p>Fixed preview</p>})}finally{hooks.active=false}};
  let tree=render();expect(renderToStaticMarkup(tree)).toMatchSnapshot("initial");
  const parent={clientWidth:397,clientHeight:280.75};(tree as React.ReactElement<any>).props.ref.current={parentElement:parent,clientWidth:200};
  const cleanup=hooks.effects[0]();tree=render();expect(observe).toHaveBeenCalledWith(parent);expect(renderToStaticMarkup(tree)).toMatchSnapshot("small parent");
  for(const [w,h]of [[1588,2246],[0,0],[794,561.5]]){parent.clientWidth=w;parent.clientHeight=h;update();expect(renderToStaticMarkup(render())).toMatchSnapshot(`${w}x${h}`)}
  if(typeof cleanup==="function")cleanup();expect(disconnect).toHaveBeenCalledTimes(1);
 });
 for(const kind of ["ScaledPreview","ScaledPreviewFit"]as const)it(`${kind} missing parent`,()=>{
  let observed=0;vi.stubGlobal("ResizeObserver",class{observe(){observed++}disconnect(){}});
  const render=()=>{hooks.cursor=0;hooks.active=true;try{return subject[kind]({children:"fixed"})}finally{hooks.active=false}};
  const tree=render();(tree as React.ReactElement<any>).props.ref.current={parentElement:null,clientWidth:397};hooks.effects[0]();expect(renderToStaticMarkup(render())).toMatchSnapshot();expect(observed).toBe(0);
 });
});
