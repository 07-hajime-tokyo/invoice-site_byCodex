import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { toast } from "sonner";
import { loadPdfReference } from "./pdfReference";
import { pdfCases, pdfClient, pdfSender, pdfForm, pngDataUrl } from "./pdfFixtures";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const subject = process.env.INVOICE_PDF_REFERENCE
  ? loadPdfReference()
  : { ...await import("./generateInvoicePdf"), ...await import("./pdfLogo"), ...await import("./pdfBlob") };
let blob: Blob;
let anchor: { href: string; download: string; click: ReturnType<typeof vi.fn> };
let events: string[];
beforeEach(() => {
  events = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(globalThis, "setTimeout");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network prohibited in invoice PDF tests"); }));
  anchor = { href: "", download: "", click: vi.fn(() => events.push("click")) };
  vi.stubGlobal("document", { createElement: vi.fn((tag: string) => { events.push(tag); return anchor; }) });
  vi.spyOn(URL, "createObjectURL").mockImplementation(value => { blob = value as Blob; events.push("url"); return "blob:fixed"; });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => { events.push("revoke"); });
  vi.mocked(toast.success).mockImplementation(() => { events.push("success"); return 1; });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function pageContract(value: Blob) {
  const doc = await PDFDocument.load(await value.arrayBuffer());
  const pages = doc.getPages();
  const action = doc.catalog.lookup(PDFName.of("OpenAction"), PDFArray);
  return {
    title: doc.getTitle(), subject: doc.getSubject(), creator: doc.getCreator(), type: value.type,
    openAction: [action.get(0).toString() === pages[0].ref.toString(), ...action.asArray().slice(1).map(x => x.toString())],
    pages: pages.map(page => {
      const contents = page.node.Contents();
      const streams = contents instanceof PDFArray ? contents.asArray().map(ref => {
        const stream = doc.context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) throw new Error("Unexpected PDF content stream");
        return stream;
      }) : [contents as PDFRawStream];
      const decoded = streams.map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")).join("\n");
      return { size: page.getSize(), contentSha256: createHash("sha256").update(decoded).digest("hex"), text: decoded.match(/\((?:\\.|[^\\)])*\) Tj/g), resources: page.node.Resources()?.toString() };
    }),
  };
}

describe("real PDF output against 0471a7f", () => {
  for (const [name, form] of pdfCases) it(name, async () => {
    const before = JSON.stringify(form);
    await subject.generateInvoicePdf(form, pdfClient, pdfSender);
    const contract = await pageContract(blob);
    expect(contract).toMatchSnapshot();
    expect(contract.pages.length).toBe(name === "multiple pages" ? 6 : 1);
    expect(JSON.stringify(form)).toBe(before);
    expect(anchor.download).toBe(name === "empty" ? "Invoice-CUSTOM.pdf" : "Invoice-0042.pdf");
    expect(anchor.href).toBe("blob:fixed");
    expect(events).toEqual(["url", "a", "click", "success"]);
    expect(toast.success).toHaveBeenCalledWith("PDFをダウンロードしました");
    expect(fetch).not.toHaveBeenCalled();
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 10000);
    vi.advanceTimersByTime(9999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixed");
  });
});

function installReader(mode: "success" | "error" | "nonstring" = "success") {
  vi.stubGlobal("FileReader", class {
    result: string | number = "";
    error = new Error("fixed read failure");
    onload = () => {};
    onerror = () => {};
    async readAsDataURL(value: Blob) {
      if (mode === "error") { this.onerror(); return; }
      this.result = mode === "nonstring" ? 123 : `data:${value.type};base64,${Buffer.from(await value.arrayBuffer()).toString("base64")}`;
      this.onload();
    }
  });
}

describe("logo contracts", () => {
  it("keeps MIME precedence, extension fallback and unsupported formats", () => {
    expect([
      [" IMAGE/PNG ; charset=x", "logo.jpg"], ["image/jpeg", "logo.png"], ["image/jpg", "x"],
      ["", "LOGO.PNG?v=1"], ["", "logo.JPEG"], ["image/svg+xml", "logo.png"],
      ["image/svg+xml", "logo.svg"], ["image/webp", "logo.webp"], ["", "logo.png#fragment"], ["", ""],
    ].map(([mime, url]) => subject.detectPdfLogoFormat(mime, url))).toMatchSnapshot();
  });
  it("skips missing/blank logos without requesting them", async () => {
    for (const url of [undefined, null, "", "  "]) expect(await subject.loadPdfLogoImage(url)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reads a successful logo and keeps the original request URL", async () => {
    installReader();
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
    expect(await subject.loadPdfLogoImage("  fixed.png  ")).toEqual({ dataUrl: "data:image/png;base64,AQID", format: "PNG" });
    expect(fetch).toHaveBeenCalledWith("  fixed.png  ");
  });
  it("returns null on HTTP failure without reading the body", async () => {
    const read = vi.fn();
    vi.mocked(fetch).mockResolvedValue({ ok: false, blob: read } as unknown as Response);
    expect(await subject.loadPdfLogoImage("fixed.png")).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it("warns and returns null for unsupported image data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(new Response("fixed", { headers: { "content-type": "image/svg+xml" } }));
    expect(await subject.loadPdfLogoImage("fixed.svg")).toBeNull();
    expect(warn).toHaveBeenCalledWith("Skipping unsupported invoice logo format", { mimeType: "image/svg+xml", logoUrl: "fixed.svg" });
  });
  for (const failure of ["fetch", "body", "reader error", "reader result"] as const) it(`continues after ${failure} failure`, async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installReader(failure === "reader error" ? "error" : failure === "reader result" ? "nonstring" : "success");
    if (failure === "fetch") vi.mocked(fetch).mockRejectedValue(new Error("fixed request failure"));
    else if (failure === "body") vi.mocked(fetch).mockResolvedValue({ ok: true, blob: () => Promise.reject(new Error("fixed body failure")) } as unknown as Response);
    else vi.mocked(fetch).mockResolvedValue(new Response("fixed", { headers: { "content-type": "image/png" } }));
    expect(await subject.loadPdfLogoImage("fixed.png")).toBeNull();
    expect(warn).toHaveBeenCalledWith("Skipping invoice logo because it could not be loaded", expect.any(Error));
  });
  for (const valid of [true, false]) it(`real PDF embeds or skips fixed logo: ${valid}`, async () => {
    installReader();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bytes = valid ? Buffer.from(pngDataUrl.split(",")[1], "base64") : Buffer.from("broken PNG");
    vi.mocked(fetch).mockResolvedValue(new Response(bytes, { headers: { "content-type": "image/png" } }));
    await subject.generateInvoicePdf(pdfForm, pdfClient, { ...pdfSender, logoUrl: "fixed.png" });
    const contract = await pageContract(blob);
    expect(contract).toMatchSnapshot();
    if (valid) expect(warn).not.toHaveBeenCalled();
    else expect(warn).toHaveBeenCalledWith("Skipping invoice logo because jsPDF could not embed it", expect.anything());
    expect(anchor.click).toHaveBeenCalledTimes(1);
  });
});

describe("post-processing and download failures", () => {
  it("falls back to the original bytes on parse failure", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const output = vi.fn(() => bytes);
    const result = await subject.createDownloadablePdfBlob({ output } as unknown as import("jspdf").jsPDF);
    expect(output).toHaveBeenCalledWith("arraybuffer");
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(result.type).toBe("application/pdf");
    expect(warn).toHaveBeenCalledWith("PDF post-processing failed; downloading the base PDF instead", expect.any(Error));
  });
  it("falls back on post-processing save failure", async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF();
    const bytes = pdf.output("arraybuffer");
    const source = { output: () => bytes } as unknown as import("jspdf").jsPDF;
    vi.spyOn(PDFDocument.prototype, "save").mockRejectedValue(new Error("fixed save failure"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(new Uint8Array(await (await subject.createDownloadablePdfBlob(source)).arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it("does not catch an initial jsPDF output failure", async () => {
    const error = new Error("fixed output failure");
    await expect(subject.createDownloadablePdfBlob({ output: () => { throw error; } } as unknown as import("jspdf").jsPDF)).rejects.toBe(error);
  });
  it("keeps a zero-page PDF without OpenAction", async () => {
    const doc = await PDFDocument.create();
    const bytes = await doc.save({ addDefaultPage: false });
    const result = await subject.createDownloadablePdfBlob({ output: () => bytes } as unknown as import("jspdf").jsPDF);
    const parsed = await PDFDocument.load(await result.arrayBuffer());
    expect(parsed.catalog.has(PDFName.of("OpenAction"))).toBe(false);
  });
  it("propagates click failure without success toast or scheduled URL cleanup", async () => {
    anchor.click.mockImplementation(() => { throw new Error("fixed click failure"); });
    await expect(subject.generateInvoicePdf(pdfForm, null, null)).rejects.toThrow("fixed click failure");
    expect(toast.success).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});


describe("download allocation and post-processing fallback integration", () => {
  it("propagates blob URL creation failure before touching the DOM", async () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => { throw new Error("fixed URL failure"); });
    await expect(subject.generateInvoicePdf(pdfForm, null, null)).rejects.toThrow("fixed URL failure");
    expect(document.createElement).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
  });
  it("downloads a usable base PDF when post-processing fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi.spyOn(PDFDocument, "load").mockRejectedValue(new Error("fixed parse failure"));
    await subject.generateInvoicePdf(pdfForm, pdfClient, pdfSender);
    load.mockRestore();
    const parsed = await PDFDocument.load(await blob.arrayBuffer());
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toBe("Invoice-0042");
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("PDF post-processing failed; downloading the base PDF instead", expect.any(Error));
  });
});
