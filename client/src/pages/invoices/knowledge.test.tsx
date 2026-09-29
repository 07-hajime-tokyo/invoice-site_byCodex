import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { loadKnowledge } from "./knowledgeReference";
const h = vi.hoisted(() => ({
  active: false,
  index: 0,
  slots: [] as any[],
  effects: [] as any[],
}));
const api = vi.hoisted(() => ({
  list: [] as any[],
  conversations: [] as any[],
  history: undefined as any,
  mutations: {} as Record<string, any>,
  events: [] as any[],
}));
vi.mock("react", async load => {
  const a = await load<typeof import("react")>();
  return {
    ...a,
    useState(initial: any) {
      if (!h.active) return a.useState(initial);
      const i = h.index++;
      if (!(i in h.slots)) h.slots[i] = initial;
      return [
        h.slots[i],
        (v: any) => (h.slots[i] = typeof v === "function" ? v(h.slots[i]) : v),
      ];
    },
    useRef(initial: any) {
      if (!h.active) return a.useRef(initial);
      const i = h.index++;
      return h.slots[i] ?? (h.slots[i] = { current: initial });
    },
    useEffect(effect: any, deps: any) {
      if (!h.active) return a.useEffect(effect, deps);
      h.effects.push(effect);
    },
    useCallback(fn: any, deps: any) {
      return h.active ? fn : a.useCallback(fn, deps);
    },
  };
});
const testTrpc = {
  knowledgeBase: new Proxy(
    {},
    {
      get: (_, name: string) => ({
        useQuery: () => ({
          data:
            name === "list"
              ? api.list
              : name === "listConversations"
                ? api.conversations
                : api.history,
          refetch: () => api.events.push(["refetch", name]),
        }),
        useMutation: (options: any) => {
          const m = (api.mutations[name] ??= { isPending: false });
          m.options = options;
          m.mutate = (p: any) => api.events.push([name, p]);
          return m;
        },
      }),
    }
  ),
};
vi.mock("sonner", () => ({
  toast: {
    success: (v: string) => api.events.push(["success", v]),
    error: (v: string) => api.events.push(["error", v]),
    info: (v: string) => api.events.push(["info", v]),
  },
}));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/textarea", () => ({ Textarea: "textarea" }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: "section",
  DialogContent: "article",
  DialogHeader: "header",
  DialogTitle: "h2",
  DialogDescription: "p",
}));
const current = process.env.INVOICE_KNOWLEDGE_REFERENCE
  ? {}
  : {
      ...(await import("./KnowledgeFilePicker")),
      ...(await import("./KnowledgePendingFiles")),
      ...(await import("./KnowledgeHistory")),
      ...(await import("./KnowledgeChat")),
    };
const Component = loadKnowledge(current, testTrpc);
function expand(n: any): any {
  if (Array.isArray(n)) return n.map(expand);
  if (!React.isValidElement(n)) return n;
  const e = n as React.ReactElement<any>;
  if (typeof e.type === "function")
    return expand((e.type as Function)(e.props));
  return React.cloneElement(
    e,
    undefined,
    React.Children.map(e.props.children, expand)
  );
}
function nodes(n: any): React.ReactElement<any>[] {
  if (Array.isArray(n)) return n.flatMap(nodes);
  if (!React.isValidElement(n)) return [];
  const e = n as React.ReactElement<any>;
  return [e, ...nodes(e.props.children)];
}
function text(n: any): string {
  if (Array.isArray(n)) return n.map(text).join("");
  if (React.isValidElement(n))
    return text((n as React.ReactElement<any>).props.children);
  return typeof n === "string" || typeof n === "number" ? String(n) : "";
}
function mount(open = true) {
  let tree: any;
  const render = () => {
    h.index = 0;
    h.effects = [];
    h.active = true;
    try {
      tree = expand(
        Component({
          open,
          onClose: () => api.events.push(["close"]),
          onNewWithNumber: (v: string) => api.events.push(["new", v]),
        })
      );
    } finally {
      h.active = false;
    }
    return tree;
  };
  render();
  return {
    render,
    tree: () => tree,
    html: () => renderToStaticMarkup(tree),
    find: (fn: (e: React.ReactElement<any>) => boolean) => {
      const e = nodes(tree).find(fn);
      if (!e) throw Error("missing element");
      return e;
    },
    button: (label: string) => {
      const e = nodes(tree).find(
        e => e.type === "button" && text(e.props.children).trim() === label
      );
      if (!e) throw Error(`missing ${label}`);
      return e;
    },
  };
}
const files = [
  { name: "screen.png", type: "image/png", size: 1025 },
  { name: "notes.txt", type: "", size: 512 },
  { name: "max.pdf", type: "application/pdf", size: 10 * 1024 * 1024 },
  { name: "large.png", type: "image/png", size: 10 * 1024 * 1024 + 1 },
  { name: "bad.txt", type: "text/plain", size: 1 },
];
beforeEach(() => {
  h.slots = [];
  h.effects = [];
  h.active = false;
  api.list = [];
  api.conversations = [];
  api.history = undefined;
  api.mutations = {};
  api.events = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:34:56Z"));
  vi.stubGlobal("fetch", () => {
    throw Error("network prohibited");
  });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true)
  );
  vi.stubGlobal(
    "FileReader",
    class {
      onload: any;
      onerror: any;
      readAsDataURL(file: any) {
        api.events.push(["read", file.name]);
        if (file.name === "bad.txt") this.onerror(Error("fixed read failure"));
        else this.onload({ target: { result: "data:fixed;base64,QUJD" } });
      }
    }
  );
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("knowledge file and history contracts", () => {
  it("captures empty and loaded history HTML", () => {
    const v = mount();
    expect(v.html()).toMatchSnapshot("empty");
    api.list = [
      {
        id: 1,
        sourceType: "chat_text",
        sourceLabel: "Text",
        createdAt: "2026-09-01",
      },
      {
        id: 2,
        sourceType: "screenshot",
        sourceLabel: null,
        createdAt: "2026-09-02",
      },
      {
        id: 3,
        sourceType: "invoice",
        sourceLabel: "",
        createdAt: "2026-09-03",
      },
    ];
    v.render();
    expect(v.html()).toMatchSnapshot("history");
  });
  it("reads files in order, enforces only select size limit, sets date/mime/size and sends exact payload", async () => {
    const v = mount();
    await v
      .find(e => e.props.type === "file")
      .props.onChange({ target: { files } });
    v.render();
    expect(v.html()).toMatchSnapshot("pending");
    v.button("知識ベースに追加 (3件)").props.onClick();
    expect(api.events).toMatchSnapshot();
    api.mutations.upload.options.onSuccess({
      results: [{ status: "ok" }, { status: "error" }],
    });
    v.render();
    expect(api.events.slice(-3)).toMatchSnapshot("upload complete");
  });
  it("renames on Enter, cancels Escape, edits screenshot date and removes pending file", async () => {
    const v = mount();
    await v
      .find(e => e.props.type === "file")
      .props.onChange({ target: { files: files.slice(0, 2) } });
    v.render();
    v.find(e => e.props.title === "クリックして名前を変更").props.onClick();
    v.render();
    v.find(e => e.props.autoFocus).props.onChange({
      target: { value: " Renamed " },
    });
    v.render();
    v.find(e => e.props.autoFocus).props.onKeyDown({ key: "Enter" });
    v.render();
    v.find(e => e.props.type === "date").props.onChange({
      target: { value: "2020-01-02" },
    });
    v.render();
    v.button("知識ベースに追加 (2件)").props.onClick();
    expect(api.events.at(-1)).toMatchSnapshot();
    v.find(e => e.props.title === "クリックして名前を変更").props.onClick();
    v.render();
    v.find(e => e.props.autoFocus).props.onKeyDown({ key: "Escape" });
    v.render();
    const remove = nodes(v.tree()).find(
      e => e.type === "button" && !text(e.props.children) && e.props.onClick
    )!;
    remove.props.onClick();
    v.render();
    expect(v.html()).toMatchSnapshot("removed");
  });
  it("preserves paste without size gate, listener cleanup and upload tab switch", async () => {
    const v = mount();
    const cleanup = h.effects[2]();
    const paste = vi.mocked(window.addEventListener).mock
      .calls[0][1] as Function;
    const preventDefault = vi.fn();
    await paste({
      preventDefault,
      clipboardData: {
        items: [
          { type: "image/png", getAsFile: () => files[3] },
          { type: "text/plain", getAsFile: () => files[1] },
          { type: "image/png", getAsFile: () => null },
        ],
      },
    });
    v.render();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(v.html()).toMatchSnapshot("pasted");
    expect(api.events).toMatchSnapshot();
    cleanup();
    expect(window.removeEventListener).toHaveBeenCalledWith("paste", paste);
  });
  it("drag/drop and file chooser preserve actions", async () => {
    const v = mount();
    const click = vi.fn();
    v.find(e => e.props.type === "file").props.ref.current = { click };
    const drop = v.find(e => e.props.onDrop),
      preventDefault = vi.fn();
    drop.props.onClick();
    drop.props.onDragOver({ preventDefault });
    v.render();
    expect(v.find(e => e.props.onDrop).props.className).toContain(
      "bg-[#075E54]/5"
    );
    await drop.props.onDrop({ preventDefault, dataTransfer: { files: [] } });
    v.render();
    expect(click).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });
  it("deletes knowledge only after confirmation, preserving id and refetch/notifications", () => {
    api.list = [
      {
        id: 9,
        sourceType: "chat_text",
        sourceLabel: "Fixed",
        createdAt: "2026-09-30",
      },
    ];
    const v = mount(),
      remove = v.find(e => e.type === "button" && !text(e.props.children));
    vi.mocked(confirm).mockReturnValue(false);
    remove.props.onClick();
    expect(api.events).toEqual([]);
    vi.mocked(confirm).mockReturnValue(true);
    remove.props.onClick();
    api.mutations.delete.options.onSuccess();
    api.mutations.delete.options.onError(Error("fixed"));
    expect(api.events).toMatchSnapshot();
  });
});
describe("knowledge chat contracts", () => {
  it("captures unselected, selected empty, messages and pending HTML", () => {
    const v = mount();
    v.button("AIチャット").props.onClick();
    v.render();
    expect(v.html()).toMatchSnapshot("no conversation");
    api.mutations.createConversation.options.onSuccess({ id: 7 });
    v.render();
    expect(v.html()).toMatchSnapshot("empty chat");
    api.history = [
      { role: "user", content: "Hello\nworld" },
      { role: "assistant", content: "Fixed reply" },
    ];
    v.render();
    h.effects[0]();
    v.render();
    api.mutations.chat.isPending = true;
    v.render();
    expect(v.html()).toMatchSnapshot("messages pending");
  });
  it("sends trimmed input with preceding ten messages, clears input before success/failure", () => {
    api.history = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `Message ${i}`,
    }));
    const v = mount();
    api.mutations.createConversation.options.onSuccess({ id: 7 });
    v.render();
    h.effects[0]();
    v.render();
    v.find(e => e.type === "textarea").props.onChange({
      target: { value: " New question " },
    });
    v.render();
    const preventDefault = vi.fn();
    v.find(e => e.type === "textarea").props.onKeyDown({
      key: "Enter",
      shiftKey: false,
      preventDefault,
    });
    v.render();
    expect(v.find(e => e.type === "textarea").props.value).toBe("");
    expect(api.events).toMatchSnapshot("send");
    api.mutations.chat.options.onSuccess({ reply: "Answer" });
    api.mutations.chat.options.onError(Error("failed"));
    v.render();
    expect(v.html()).toMatchSnapshot("responses");
    expect(api.events.slice(-2)).toMatchSnapshot("response events");
  });
  it("suggestions only fill input, Shift+Enter does not send, pending prevents send", () => {
    const v = mount();
    api.mutations.createConversation.options.onSuccess({ id: 7 });
    v.render();
    v.button("未払いのインボイスはありますか？").props.onClick();
    v.render();
    const input = v.find(e => e.type === "textarea"),
      preventDefault = vi.fn();
    input.props.onKeyDown({ key: "Enter", shiftKey: true, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    api.mutations.chat.isPending = true;
    v.render();
    v.find(e => e.type === "textarea").props.onKeyDown({
      key: "Enter",
      shiftKey: false,
      preventDefault,
    });
    expect(api.events.some(e => e[0] === "chat")).toBe(false);
  });
  it("retains mutation failure notifications and no outgoing real services", () => {
    mount();
    for (const name of [
      "upload",
      "createConversation",
      "deleteConversation",
      "getLatestInvoiceNumber",
    ])
      api.mutations[name].options.onError(Error("fixed"));
    expect(api.events).toMatchSnapshot();
  });
});
