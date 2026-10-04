import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { loadDialogReference } from "./dialogReference";

// Deterministic state/event adapter, NOT a replacement for React DOM lifecycle QA.
const state = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, dirty: false, active: false }));
const api = vi.hoisted(() => ({
  settings: undefined as any, clients: [] as any[], loading: false,
  mutations: {} as Record<string, any>, events: [] as any[],
  upload: async (_payload: unknown) => ({ url: "data:fixed", key: "fixed-key" }),
}));
vi.mock("react", async (load) => {
  const actual = await load<typeof import("react")>();
  return { ...actual,
    useState(initial: any) {
      if (!state.active) return actual.useState(initial);
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial;
      return [state.slots[index], (value: any) => {
        const next = typeof value === "function" ? value(state.slots[index]) : value;
        if (!Object.is(next, state.slots[index])) { state.slots[index] = next; state.dirty = true; }
      }];
    },
    useRef(initial: any) {
      if (!state.active) return actual.useRef(initial);
      const index = state.cursor++;
      return state.slots[index] ?? (state.slots[index] = { current: initial });
    },
  };
});
vi.mock("@/lib/trpc", () => {
  const route = (name: string) => ({
    useMutation(options?: any) {
      const mutation = api.mutations[name] ??= { isPending: false };
      mutation.options = options;
      mutation.mutate = (payload: unknown) => api.events.push([name, payload]);
      mutation.mutateAsync = async (payload: unknown) => { api.events.push([name, payload]); return api.upload(payload); };
      return mutation;
    },
  });
  return { trpc: {
    useUtils: () => ({ invoiceSettings: { get: { invalidate: () => api.events.push(["settings.invalidate"]) } }, invoiceClients: { list: { invalidate: () => api.events.push(["clients.invalidate"]) } } }),
    invoiceSettings: { get: { useQuery: () => ({ data: api.settings }) }, save: route("settings.save"), uploadLogo: route("logo.upload") },
    invoiceClients: { list: { useQuery: () => ({ data: api.clients, isLoading: api.loading }) }, create: route("clients.create"), update: route("clients.update"), delete: route("clients.delete") },
  } };
});
vi.mock("sonner", () => ({ toast: { success: (s: string) => api.events.push(["success", s]), error: (s: string) => api.events.push(["error", s]) } }));
// Preserve application JSX/content; replace portal/layout primitives, not business handlers.
vi.mock("@/components/ui/dialog", () => ({ Dialog: "section", DialogContent: "article", DialogHeader: "header", DialogTitle: "h2", DialogDescription: "p", DialogFooter: "footer" }));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/input", () => ({ Input: "input" }));
vi.mock("@/components/ui/label", () => ({ Label: "label" }));
const subject = process.env.INVOICE_DIALOG_REFERENCE ? loadDialogReference() : {
  ...await import("./SenderSettingsDialog"), ...await import("./ClientManagerDialog"),
};
type Element = React.ReactElement<any>;
function nodes(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  if (typeof element.type === "function" && element.type.name === "ClientForm") return nodes((element.type as Function)(element.props));
  return [element, ...nodes(element.props.children)];
}
function text(node: React.ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement(node)) return text((node as Element).props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function mount(kind: "sender" | "client", initialOpen = true) {
  let open = initialOpen;
  let tree: Element;
  const close = () => { api.events.push(["close"]); };
  const render = () => {
    let passes = 0;
    do {
      state.dirty = false; state.cursor = 0; state.active = true;
      try { tree = (kind === "sender" ? subject.SenderSettingsDialog : subject.ClientManagerDialog)({ open, onClose: close }); }
      finally { state.active = false; }
      if (++passes > 20) throw new Error("Render did not settle");
    } while (state.dirty);
    return tree!;
  };
  render();
  const find = (predicate: (element: Element) => boolean) => {
    const result = nodes(tree).find(predicate);
    if (!result) throw new Error("Element missing");
    return result;
  };
  return {
    render,
    button: (label: string) => find(e => e.type === "button" && text(e.props.children).trim() === label),
    input: (placeholder: string) => find(e => e.props.placeholder === placeholder),
    find,
    change(placeholder: string, value: string) { find(e => e.props.placeholder === placeholder).props.onChange({ target: { value } }); render(); },
    setOpen(value: boolean) { open = value; render(); },
    tree: () => tree,
    html: () => renderToStaticMarkup(tree),
  };
}
const client = { id: 7, name: "Saved Client", company: null, email: "client@example.invalid", phone: null, address: "Road", city: "City", country: "JP", notes: "invisible note", extraInfo: null };
beforeEach(() => {
  state.slots = []; state.cursor = 0; state.active = false;
  api.settings = undefined; api.clients = []; api.loading = false; api.mutations = {}; api.events = [];
  api.upload = async () => ({ url: "data:fixed", key: "fixed-key" });
  vi.stubGlobal("fetch", () => { throw new Error("No network allowed"); });
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("client manager original contracts", () => {
  it("captures empty, loading, list and create HTML", () => {
    const view = mount("client"); expect(view.html()).toMatchSnapshot("empty");
    api.loading = true; view.render(); expect(view.html()).toMatchSnapshot("loading");
    api.loading = false; api.clients = [client]; view.render(); expect(view.html()).toMatchSnapshot("list");
    view.button("新規宛先を追加").props.onClick(); view.render(); expect(view.html()).toMatchSnapshot("create");
  });
  it("validates then saves all entered fields, keeps whitespace and handles success", () => {
    const view = mount("client"); view.button("新規宛先を追加").props.onClick(); view.render();
    view.change("例: Luca", "   "); view.button("保存").props.onClick();
    view.change("例: Luca", " New Client ");
    for (const [placeholder, value] of [["例: ABC GmbH", "Company"], ["example@email.com", "a@example.invalid"], ["+49 177 ...", "123"], ["Street, Number", "Road"], ["Berlin", "City"], ["Germany", "Country"], ["例: EORI: DE123456789\n税関登録番号: ...", "Extra\nLine"]]) view.change(placeholder, value);
    view.button("保存").props.onClick(); api.mutations["clients.create"].options.onSuccess(); view.render();
    expect(api.events).toMatchSnapshot(); expect(view.html()).toMatchSnapshot("after creation");
    view.button("新規宛先を追加").props.onClick(); view.render(); expect(view.input("例: Luca").props.value).toBe("");
  });
  it("edits nullable fields while preserving invisible notes and keeps draft on error", () => {
    api.clients = [client]; const view = mount("client");
    view.find(e => e.type === "button" && e.props.size === "icon" && !e.props.className.includes("destructive")).props.onClick(); view.render();
    expect(view.html()).toMatchSnapshot("editing"); view.change("例: Luca", "Changed"); view.button("保存").props.onClick();
    api.mutations["clients.update"].options.onError(new Error("update failed")); view.render(); expect(view.input("例: Luca").props.value).toBe("Changed");
    api.mutations["clients.update"].options.onSuccess(); view.render(); expect(api.events).toMatchSnapshot();
  });
  it("preserves create/edit mode across outer close, but cancels form mode", () => {
    const view = mount("client"); view.button("新規宛先を追加").props.onClick(); view.render(); view.change("例: Luca", "Draft");
    view.tree().props.onOpenChange(false); view.setOpen(false); view.setOpen(true);
    expect(view.input("例: Luca").props.value).toBe("Draft"); view.button("キャンセル").props.onClick(); view.render();
    expect(view.button("新規宛先を追加")).toBeDefined(); expect(api.events).toEqual([["close"]]);
  });
  it("honors delete confirmation, success/error notifications and invalidation", () => {
    api.clients = [client]; const view = mount("client");
    const remove = () => view.find(e => e.type === "button" && e.props.className.includes("destructive")).props.onClick();
    vi.mocked(confirm).mockReturnValue(false); remove(); expect(api.events).toEqual([]);
    vi.mocked(confirm).mockReturnValue(true); remove(); api.mutations["clients.delete"].options.onError(new Error("delete failed"));
    api.mutations["clients.delete"].options.onSuccess(); expect(confirm).toHaveBeenCalledWith("「Saved Client」を削除しますか？"); expect(api.events).toMatchSnapshot();
  });
  it("shows pending save, create error and allows cancellation", () => {
    const view = mount("client"); view.button("新規宛先を追加").props.onClick(); view.render();
    api.mutations["clients.create"].isPending = true; view.render(); expect(view.button("保存").props.disabled).toBe(true);
    api.mutations["clients.create"].options.onError(new Error("create failed")); view.button("キャンセル").props.onClick(); view.render(); expect(api.events).toEqual([["error", "create failed"]]);
  });
});

const settings = { senderName: "Saved Sender", senderCompany: null, senderEmail: "sender@example.invalid", senderPhone: null, senderAddress: "Road", senderCity: "Tokyo", senderCountry: "JP", senderExtraInfo: null, logoUrl: "data:image/png;base64,AA==" };
function logoReader() {
  let reader: any;
  vi.stubGlobal("FileReader", class {
    onload: any;
    readAsDataURL(file: any) { api.events.push(["read", file.name]); reader = this; }
  });
  return () => reader.onload({ target: { result: "data:image/png;base64,FIXED" } });
}
function selectLogo(view: ReturnType<typeof mount>, size = 2 * 1024 * 1024) {
  view.find(e => e.type === "input" && e.props.type === "file").props.onChange({ target: { files: [{ name: "fixed.png", type: "image/png", size }] } });
}
describe("sender settings original contracts", () => {
  it("captures defaults, asynchronous initialization and does not overwrite edits on refetch", () => {
    const view = mount("sender"); expect(view.html()).toMatchSnapshot("default sender");
    api.settings = settings; view.render(); expect(view.html()).toMatchSnapshot("initialized sender");
    view.change("例: 村上 肥", "Local edit"); api.settings = { ...settings, senderName: "Refetched" }; view.render();
    expect(view.input("例: 村上 肥").props.value).toBe("Local edit");
    view.setOpen(false); view.setOpen(true); expect(view.input("例: 村上 肥").props.value).toBe("Refetched");
  });
  it("keeps the previous logo preview when reopened settings have no logo", () => {
    api.settings = settings; const view = mount("sender"); view.setOpen(false);
    api.settings = { ...settings, logoUrl: null }; view.setOpen(true);
    expect(view.find(e => e.type === "img").props.src).toBe(settings.logoUrl);
  });
  it("saves all input fields without logo keys, preserves whitespace and closes on success", async () => {
    const view = mount("sender");
    for (const [placeholder, value] of [["例: 村上 肥", " Sender "], ["例: Murakami Trading", "Company"], ["example@email.com", "s@example.invalid"], ["+81 ...", "123"], ["Street, Number", "Road"], ["Tokyo", "City"], ["Japan", "Country"], ["例: 税関登録番号: EORI-12345\n消費税登録番号: JP-67890", "Extra\nLine"]]) view.change(placeholder, value);
    await view.button("保存する").props.onClick(); api.mutations["settings.save"].options.onSuccess(); view.render();
    expect(api.events).toMatchSnapshot();
  });
  it("keeps save errors separate from upload errors and preserves draft", async () => {
    const view = mount("sender"); view.change("例: 村上 肥", "Draft"); await view.button("保存する").props.onClick();
    api.mutations["settings.save"].options.onError(new Error("save failed")); view.render();
    expect(view.input("例: 村上 肥").props.value).toBe("Draft"); expect(api.events).toMatchSnapshot();
  });
  it("limits logo size but accepts exactly 2MiB and defers payload until FileReader completes", async () => {
    const finish = logoReader(); const view = mount("sender");
    view.find(e => e.type === "input" && e.props.type === "file").props.onChange({ target: { files: [] } });
    selectLogo(view, 2 * 1024 * 1024 + 1); selectLogo(view); finish(); view.render();
    expect(view.find(e => e.type === "img").props.src).toBe("data:image/png;base64,FIXED");
    await view.button("保存する").props.onClick(); view.render(); expect(api.events).toMatchSnapshot();
  });
  it("disables save during upload, then includes logo URL/key only after upload succeeds", async () => {
    let resolve!: (result: { url: string; key: string }) => void;
    api.upload = () => new Promise(done => { resolve = done; });
    const finish = logoReader(); const view = mount("sender"); selectLogo(view); finish(); view.render();
    const pending = view.button("保存する").props.onClick(); view.render(); expect(view.button("保存する").props.disabled).toBe(true);
    expect(api.events.some(event => event[0] === "settings.save")).toBe(false);
    resolve({ url: "data:uploaded", key: "uploaded-key" }); await pending; view.render();
    expect(view.button("保存する").props.disabled).toBe(false); expect(api.events).toMatchSnapshot();
    api.mutations["settings.save"].isPending = true; view.render(); expect(view.button("保存する").props.disabled).toBe(true);
  });
  it("does not save on upload rejection and releases uploading state", async () => {
    api.upload = async () => { throw new Error("upload failed"); };
    const finish = logoReader(); const view = mount("sender"); selectLogo(view); finish(); view.render();
    await view.button("保存する").props.onClick(); view.render();
    expect(view.button("保存する").props.disabled).toBe(false); expect(api.events).toMatchSnapshot();
  });
  it("omits logo fields if upload returns an empty URL", async () => {
    api.upload = async () => ({ url: "", key: "unused" });
    const finish = logoReader(); const view = mount("sender"); selectLogo(view); finish(); view.render();
    await view.button("保存する").props.onClick(); expect(api.events).toMatchSnapshot();
  });
  it("removes selected preview/file locally without sending a delete logo payload", async () => {
    const finish = logoReader(); api.settings = settings; const view = mount("sender"); selectLogo(view); finish(); view.render();
    view.button("削除").props.onClick(); view.render(); await view.button("保存する").props.onClick();
    expect(api.events).toMatchSnapshot();
  });
  it("clears selected file after close and triggers file input through its ref", async () => {
    const finish = logoReader(); const view = mount("sender"); const click = vi.fn();
    view.find(e => e.type === "input" && e.props.type === "file").props.ref.current = { click };
    view.button("画像を選択").props.onClick(); expect(click).toHaveBeenCalledTimes(1);
    selectLogo(view); finish(); view.render(); view.button("キャンセル").props.onClick();
    // Clearing the file is conditional on initialization; supply settings before close.
    api.settings = settings; view.render(); view.setOpen(false); view.setOpen(true);
    await view.button("保存する").props.onClick(); expect(api.events).toMatchSnapshot();
    view.tree().props.onOpenChange(true); view.tree().props.onOpenChange(false);
    expect(api.events.filter(event => event[0] === "close")).toHaveLength(2);
  });
});

describe("initialization and cancellation boundaries", () => {
  it("retains the selected logo across close when settings never initialized", async () => {
    const finish = logoReader(); const view = mount("sender"); selectLogo(view); finish(); view.render();
    view.setOpen(false); view.setOpen(true); await view.button("保存する").props.onClick();
    expect(api.events).toMatchSnapshot();
  });
  it("cancels an edit and starts a fresh form, with update pending disabling save", () => {
    api.clients = [client]; const view = mount("client");
    view.find(e => e.type === "button" && e.props.size === "icon" && !e.props.className.includes("destructive")).props.onClick(); view.render();
    view.change("例: Luca", "Discard this"); api.mutations["clients.update"].isPending = true; view.render();
    expect(view.button("保存").props.disabled).toBe(true); view.button("キャンセル").props.onClick(); view.render();
    api.mutations["clients.update"].isPending = false; view.button("新規宛先を追加").props.onClick(); view.render();
    expect(view.input("例: Luca").props.value).toBe(""); view.change("例: Luca", "Fresh"); view.button("保存").props.onClick();
    expect(api.events).toMatchSnapshot();
  });
});
