import React from "react";import{renderToStaticMarkup}from"react-dom/server";import{describe,it,expect,vi}from"vitest";
import{loadEditorControls}from"./editorControlsReference";
vi.mock("@/components/ui/button",()=>({Button:"button"}));vi.mock("@/components/ui/label",()=>({Label:"label"}));vi.mock("@/components/ui/textarea",()=>({Textarea:"textarea"}));
vi.mock("@/components/ui/dialog",()=>({Dialog:"section",DialogContent:"article",DialogHeader:"header",DialogTitle:"h2",DialogDescription:"p",DialogFooter:"footer"}));
vi.mock("@/components/ui/select",()=>({Select:"div",SelectTrigger:"div",SelectValue:"span",SelectContent:"div",SelectItem:"option"}));
const current=process.env.INVOICE_CONTROLS_REFERENCE?{}:{...await import("./EditorToolbar"),...await import("./BackConfirmDialog"),...await import("./OverLimitDialog"),...await import("./SplitPreviewDialog"),...await import("./InvoiceContacts")};
const Screen=loadEditorControls(current);
function expand(n:any):any{if(Array.isArray(n))return n.map(expand);if(!React.isValidElement(n))return n;const e=n as React.ReactElement<any>;if(typeof e.type==="function")return expand((e.type as Function)(e.props));return React.cloneElement(e,undefined,React.Children.map(e.props.children,expand))}
function nodes(n:any):React.ReactElement<any>[]{if(Array.isArray(n))return n.flatMap(nodes);if(!React.isValidElement(n))return[];const e=n as React.ReactElement<any>;return[e,...nodes(e.props.children)]}
function text(n:any):string{if(Array.isArray(n))return n.map(text).join("");if(React.isValidElement(n))return text((n as React.ReactElement<any>).props.children);return typeof n==="string"||typeof n==="number"?String(n):""}
const single=[{invoiceNumber:"0042",totalJpy:1200000,items:[{description:"Fixed",subText:"Blue",quantity:2,unitPrice:600000}]}];
function fixture(extra:Record<string,any>={}){const events:any[]=[];let form={clientId:7,notes:"Fixed notes",currency:"JPY",extra:"preserve"};const p={
 isDirty:true,showBackConfirm:true,showOverLimitConfirm:true,showSplitDialog:true,showPreview:false,isPdfLoading:false,isFetchingRate:false,overLimitJpy:1200000,pendingSavePayload:{fixed:"payload"},exchangeRateInfo:{rate:1,date:"2026-09-30"},splitPreview:single,
 createMutation:{isPending:false},updateMutation:{isPending:false},createSplitMutation:{isPending:false},form,clients:[{id:7,name:"Client",company:"Company"},{id:8,name:"Other"}],selectedClient:{name:"Client",address:"Road",city:"City",country:"JP",email:"x@example.invalid",phone:"123"},
 setShowBackConfirm:(v:boolean)=>events.push(["backOpen",v]),setShowOverLimitConfirm:(v:boolean)=>events.push(["overOpen",v]),setShowSplitDialog:(v:boolean)=>events.push(["splitOpen",v]),setShowPreview:(v:boolean)=>events.push(["preview",v]),setPendingSavePayload:(v:any)=>events.push(["payload",v]),
 onCancel:()=>events.push(["cancel"]),onSaved:()=>events.push(["saved"]),handleSave:()=>events.push(["save"]),handleSavePdf:()=>events.push(["pdf"]),handleOpenSplitDialog:()=>events.push(["openSplit"]),handleConfirmSplit:()=>events.push(["confirmSplit"]),persistInvoice:async(v:any)=>{events.push(["persist",v])},handleClientChange:(v:string)=>events.push(["client",v]),setForm:(fn:any)=>{form=fn(form)},...extra};
 const tree=expand(<Screen {...p}/>);return{events,p,tree,form:()=>form,button:(label:string)=>{const found=nodes(tree).find(e=>e.type==="button"&&text(e.props.children).trim()===label);if(!found)throw Error(`Missing ${label}`);return found}};
}
describe("original editor controls JSX",()=>{
 for(const[name,extra]of Object.entries({normal:{},pending:{createMutation:{isPending:true},updateMutation:{isPending:true},createSplitMutation:{isPending:true},isPdfLoading:true,isFetchingRate:true},preview:{showPreview:true},multiple:{splitPreview:[...single,{...single[0],invoiceNumber:"0043",totalJpy:0.5}]},empty:{splitPreview:[],exchangeRateInfo:null,clients:[],selectedClient:null},closed:{showBackConfirm:false,showOverLimitConfirm:false,showSplitDialog:false}}))it(name,()=>expect(renderToStaticMarkup(fixture(extra).tree)).toMatchSnapshot());
 it("retains the single 120万円 contradiction",()=>{const html=renderToStaticMarkup(fixture().tree);expect(html).toContain("分割不要です");expect(html).toContain("1,200,000");expect(html).toContain("円で100万円以下です")});
});
describe("parent events and order",()=>{
 it("back, discard, save, preview, PDF and split toolbar events",()=>{const f=fixture();for(const label of["一覧に戻る","保存せず戻る","保存して戻る","プレビュー","PDFで保存","分割して保存","保存"])f.button(label).props.onClick();expect(f.events).toMatchSnapshot();expect(f.form().extra).toBe("preserve")});
 it("clean back bypasses confirmation",()=>{const f=fixture({isDirty:false});f.button("一覧に戻る").props.onClick();expect(f.events).toEqual([["cancel"]])});
 it("over-limit save closes before awaiting and clears payload only after success",async()=>{
  let done!:()=>void;const f=fixture();f.p.persistInvoice=async(v:any)=>{f.events.push(["persist",v]);await new Promise<void>(resolve=>done=resolve)};
  // Render with the updated fixed dependency.
  const tree=expand(<Screen {...f.p}/>),button=nodes(tree).find(e=>e.type==="button"&&text(e.props.children).trim()==="そのまま保存")!;
  const pending=button.props.onClick();expect(f.events).toEqual([["overOpen",false],["persist",{fixed:"payload"}]]);done();await pending;expect(f.events).toMatchSnapshot();
 });
 for(const[name,payload,reject]of[["missing",null,false],["failure",{fixed:1},true]]as const)it(`over-limit ${name}`,async()=>{const f=fixture({pendingSavePayload:payload,persistInvoice:async()=>{throw Error("fixed")}});await f.button("そのまま保存").props.onClick();expect(f.events).toEqual([["overOpen",false]]);expect(f.p.pendingSavePayload).toBe(payload)});
 it("choosing split clears pending payload before opening split",()=>{const f=fixture();f.button("分割する").props.onClick();expect(f.events).toEqual([["overOpen",false],["payload",null],["openSplit"]])});
 it("single split save and cancel preserve call order",()=>{const f=fixture();const buttons=nodes(f.tree).filter(e=>e.type==="button"&&text(e.props.children).trim()==="そのまま保存");buttons[1].props.onClick();f.button("キャンセル").props.onClick();expect(f.events).toEqual([["splitOpen",false],["save"],["splitOpen",false]])});
 it("multi split confirm delegates unchanged",()=>{const f=fixture({splitPreview:[...single,single[0]]});f.button("2枚に分割して保存").props.onClick();expect(f.events).toEqual([["confirmSplit"]])});
 it("open-change callbacks, client selection and notes retain form",()=>{const f=fixture();for(const section of nodes(f.tree).filter(e=>e.type==="section"))section.props.onOpenChange(false);nodes(f.tree).find(e=>e.props.onValueChange)!.props.onValueChange("__none__");nodes(f.tree).find(e=>e.type==="textarea")!.props.onChange({target:{value:" changed\nnotes "}});expect(f.events).toMatchSnapshot();expect(f.form()).toEqual({clientId:7,notes:" changed\nnotes ",currency:"JPY",extra:"preserve"})});
 it("pending flags remain separate for normal and single/multi split saves",()=>{const f=fixture({updateMutation:{isPending:true}});expect(f.button("保存").props.disabled).toBe(true);expect(f.button("保存して戻る").props.disabled).toBe(true);const saves=nodes(f.tree).filter(e=>e.type==="button"&&text(e.props.children).trim()==="そのまま保存");expect(saves[0].props.disabled).toBeUndefined();expect(saves[1].props.disabled).toBe(false)});
});
