/**
 * PDF Generator using PDFKit (Node.js native)
 * Generates invoice PDFs directly in Node.js without any Python dependency.
 * Works in both development (sandbox) and production (deployed) environments.
 */
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { join } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

import { tmpdir } from "os";
import https from "https";
import http from "http";

// Font CDN URLs (uploaded to Manus CDN for production use)
const FONT_REGULAR_CDN = "https://d2xsxph8kpxj0f.cloudfront.net/310519663302463978/YRDUeX7pwHASZfWQdk8vrK/NotoSansJP-Regular_e0324c78.ttf";
const FONT_BOLD_CDN = "https://d2xsxph8kpxj0f.cloudfront.net/310519663302463978/YRDUeX7pwHASZfWQdk8vrK/NotoSansJP-Bold_127d64bd.ttf";

// Local font paths (available in sandbox/development)
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FONT_REGULAR_LOCAL = join(__dirname, "fonts", "NotoSansJP-Regular.ttf");
const FONT_BOLD_LOCAL = join(__dirname, "fonts", "NotoSansJP-Bold.ttf");

// Cache for downloaded fonts
let fontRegularPath: string | null = null;
let fontBoldPath: string | null = null;

function downloadFont(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = require("fs").createWriteStream(dest);
    const protocol = url.startsWith("https") ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        downloadFont(res.headers.location!, dest).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    }).on("error", (err) => {
      require("fs").unlink(dest, () => {});
      reject(err);
    });
  });
}

async function getFontPaths(): Promise<{ regular: string; bold: string }> {
  // Use local fonts if available (development/sandbox)
  if (existsSync(FONT_REGULAR_LOCAL) && existsSync(FONT_BOLD_LOCAL)) {
    return { regular: FONT_REGULAR_LOCAL, bold: FONT_BOLD_LOCAL };
  }

  // Download from CDN if not cached
  if (!fontRegularPath || !existsSync(fontRegularPath)) {
    const dest = join(tmpdir(), "NotoSansJP-Regular.ttf");
    if (!existsSync(dest)) {
      await downloadFont(FONT_REGULAR_CDN, dest);
    }
    fontRegularPath = dest;
  }
  if (!fontBoldPath || !existsSync(fontBoldPath)) {
    const dest = join(tmpdir(), "NotoSansJP-Bold.ttf");
    if (!existsSync(dest)) {
      await downloadFont(FONT_BOLD_CDN, dest);
    }
    fontBoldPath = dest;
  }

  return { regular: fontRegularPath, bold: fontBoldPath };
}

// Colors
const BLUE = "#1a56db";
const DARK = "#111111";
const GRAY = "#666666";
const LIGHT_GRAY = "#f0f0f0";
const ALT_ROW = "#f9f9f9";
const DIVIDER = "#dddddd";
const BORDER_BLUE = "#1a56db";

// Page layout
const PAGE_MARGIN = 45;

function esc(s: string | null | undefined): string {
  return s ?? "";
}

function fmt(n: number, currency: string): string {
  if (currency === "JPY") return `¥${Math.round(n).toLocaleString("ja-JP")}`;
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency + " ";
  return `${sym}${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export interface InvoicePdfParams {
  invoiceNumber: string;
  invoiceDate?: string;
  dueDate?: string;
  currency: string;
  showAmounts: boolean;
  notes?: string;
  items: Array<{
    description: string;
    subText?: string;
    quantity: number;
    unitPrice: number;
    tax?: number;
    currency?: string;
  }>;
  clientData?: {
    name?: string;
    company?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
    notes?: string;
    extraInfo?: string;
  } | null;
  senderSettings?: {
    senderName?: string;
    senderCompany?: string;
    senderEmail?: string;
    senderPhone?: string;
    senderAddress?: string;
    senderCity?: string;
    senderCountry?: string;
    logoUrl?: string;
    taxRate?: string;
    senderExtraInfo?: string;
  } | null;
}

export async function generateInvoicePdf(params: InvoicePdfParams): Promise<Buffer> {
  // Get font paths (local or download from CDN)
  const fonts = await getFontPaths();

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: PAGE_MARGIN,
        info: { Title: `Invoice ${params.invoiceNumber}` },
        autoFirstPage: true,
      });

      // Register fonts
      doc.registerFont("Regular", fonts.regular);
      doc.registerFont("Bold", fonts.bold);

      const chunks: Buffer[] = [];
      const stream = new PassThrough();
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
      doc.pipe(stream);

      drawInvoice(doc, params);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawInvoice(doc: PDFKit.PDFDocument, params: InvoicePdfParams) {
  const {
    invoiceNumber,
    invoiceDate,
    dueDate,
    currency,
    showAmounts,
    notes,
    items,
    clientData,
    senderSettings,
  } = params;

  const PAGE_W = doc.page.width;
  const CONTENT_W = PAGE_W - PAGE_MARGIN * 2;
  const LEFT = PAGE_MARGIN;

  // ── Blue top bar ──────────────────────────────────────────────
  doc.rect(0, 0, PAGE_W, 8).fill(BLUE);

  let y = 28;

  // ── Header: Sender name (left) + Invoice number (right) ──────
  const senderDisplay = senderSettings?.senderCompany || senderSettings?.senderName || "";
  if (senderDisplay) {
    doc.font("Bold").fontSize(17).fillColor(DARK).text(esc(senderDisplay), LEFT, y, {
      width: CONTENT_W * 0.55,
      lineBreak: false,
    });
  }

  // Invoice number (right-aligned)
  const invoiceLabel = `Invoice: ${invoiceNumber}`;
  doc.font("Bold").fontSize(20).fillColor(BLUE).text(invoiceLabel, LEFT + CONTENT_W * 0.5, y, {
    width: CONTENT_W * 0.5,
    align: "right",
    lineBreak: false,
  });

  y += 28;

  // Dates (right-aligned)
  doc.font("Regular").fontSize(9).fillColor(GRAY);
  if (invoiceDate) {
    doc.text(`Issued on: ${invoiceDate}`, LEFT + CONTENT_W * 0.5, y, {
      width: CONTENT_W * 0.5,
      align: "right",
      lineBreak: false,
    });
    y += 13;
  }
  if (dueDate) {
    doc.text(`Due by: ${dueDate}`, LEFT + CONTENT_W * 0.5, y, {
      width: CONTENT_W * 0.5,
      align: "right",
      lineBreak: false,
    });
    y += 13;
  }

  y += 10;

  // ── Blue divider ──────────────────────────────────────────────
  doc.moveTo(LEFT, y).lineTo(PAGE_W - PAGE_MARGIN, y).lineWidth(2).stroke(BLUE);
  y += 16;

  // ── FROM / TO ─────────────────────────────────────────────────
  const colW = CONTENT_W / 2 - 10;

  // FROM label
  doc.font("Bold").fontSize(8).fillColor(BLUE).text("FROM", LEFT, y);
  // TO label
  doc.font("Bold").fontSize(8).fillColor(BLUE).text("TO", LEFT + CONTENT_W / 2, y);

  y += 14;

  const formatContactLine = (line: string) => esc(line).trim().replace(/([:：])(?=\S)/g, "$1 ");
  const drawContactLine = (
    line: string | null | undefined,
    x: number,
    currentY: number,
    options: { font?: "Regular" | "Bold"; size?: number; color?: string; minHeight?: number } = {},
  ) => {
    const value = formatContactLine(line ?? "");
    if (!value) return currentY;
    const fontName = options.font ?? "Regular";
    const fontSize = options.size ?? 9;
    const color = options.color ?? GRAY;
    const minHeight = options.minHeight ?? 12;
    doc.font(fontName).fontSize(fontSize).fillColor(color);
    doc.text(value, x, currentY, { width: colW, lineBreak: true });
    const textHeight = doc.heightOfString(value, { width: colW });
    return currentY + Math.max(minHeight, textHeight + 3);
  };

  // FROM content
  let fromY = y;
  if (senderSettings) {
    const s = senderSettings;
    if (s.senderCompany) {
      fromY = drawContactLine(s.senderCompany, LEFT, fromY, { font: "Bold", size: 11, color: DARK, minHeight: 15 });
    }
    if (s.senderName) {
      fromY = drawContactLine(s.senderName, LEFT, fromY, { size: 10, color: "#333333", minHeight: 13 });
    }
    if (s.senderEmail) {
      fromY = drawContactLine(s.senderEmail, LEFT, fromY);
    }
    if (s.senderPhone) {
      fromY = drawContactLine(s.senderPhone, LEFT, fromY);
    }
    if (s.senderAddress) {
      fromY = drawContactLine(s.senderAddress, LEFT, fromY);
    }
    if (s.senderCity || s.senderCountry) {
      const cityCountry = [s.senderCity, s.senderCountry].filter(Boolean).join(", ");
      fromY = drawContactLine(cityCountry, LEFT, fromY);
    }
    if (s.senderExtraInfo) {
      s.senderExtraInfo.split("\n").forEach((line) => {
        fromY = drawContactLine(line, LEFT, fromY);
      });
    }
  }

  // TO content
  let toY = y;
  const toX = LEFT + CONTENT_W / 2;
  if (clientData) {
    const c = clientData;
    if (c.company) {
      toY = drawContactLine(c.company, toX, toY, { font: "Bold", size: 11, color: DARK, minHeight: 15 });
    }
    if (c.name) {
      toY = drawContactLine(c.name, toX, toY, { size: 10, color: "#333333", minHeight: 13 });
    }
    if (c.email) {
      toY = drawContactLine(c.email, toX, toY);
    }
    if (c.phone) {
      toY = drawContactLine(c.phone, toX, toY);
    }
    if (c.address) {
      toY = drawContactLine(c.address, toX, toY);
    }
    if (c.city || c.country) {
      const cityCountry = [c.city, c.country].filter(Boolean).join(", ");
      toY = drawContactLine(cityCountry, toX, toY);
    }
    if (c.notes) {
      toY = drawContactLine(c.notes, toX, toY);
    }
    if (c.extraInfo) {
      c.extraInfo.split("\n").forEach((line) => {
        toY = drawContactLine(line, toX, toY);
      });
    }
  }

  y = Math.max(fromY, toY) + 20;

  // ── Items table ───────────────────────────────────────────────
  // Determine font size based on item count
  const itemCount = items.length;
  const baseFontSize = itemCount > 15 ? 8 : itemCount > 10 ? 9 : 10;
  const rowH = baseFontSize + 12;
  const subTextH = baseFontSize - 1 + 6;

  // Table header
  const COL_PRODUCT = LEFT;
  const COL_QTY = LEFT + CONTENT_W * 0.58;
  const COL_UNIT = LEFT + CONTENT_W * 0.68;
  const COL_TAX = LEFT + CONTENT_W * 0.80;
  const COL_TOTAL = LEFT + CONTENT_W * 0.88;
  const HEADER_H = rowH + 2;

  doc.rect(LEFT, y, CONTENT_W, HEADER_H).fill(LIGHT_GRAY);
  doc.font("Bold").fontSize(baseFontSize).fillColor("#333333");
  doc.text("Product", COL_PRODUCT + 6, y + 6, { width: CONTENT_W * 0.55, lineBreak: false });
  doc.text("Qty", COL_QTY, y + 6, { width: 50, align: "center", lineBreak: false });
  if (showAmounts) {
    doc.text("Unit Price", COL_UNIT, y + 6, { width: 80, align: "right", lineBreak: false });
    doc.text("Total", COL_TOTAL, y + 6, { width: PAGE_W - PAGE_MARGIN - COL_TOTAL, align: "right", lineBreak: false });
  }

  y += HEADER_H + 2;

  // Item rows
  const subtotal = items.reduce((s, item) => s + item.quantity * item.unitPrice, 0);
  const taxTotal = items.reduce((s, item) => {
    const rate = (item.tax ?? 0) / 100;
    return s + item.quantity * item.unitPrice * rate;
  }, 0);
  const grandTotal = subtotal + taxTotal;

  items.forEach((item, i) => {
    const hasSubText = !!item.subText;
    const thisRowH = hasSubText ? rowH + subTextH : rowH;

    // Alternating row background
    if (i % 2 === 1) {
      doc.rect(LEFT, y, CONTENT_W, thisRowH).fill(ALT_ROW);
    }

    // Product name
    doc.font("Bold").fontSize(baseFontSize).fillColor(DARK).text(
      esc(item.description),
      COL_PRODUCT + 6,
      y + 5,
      { width: CONTENT_W * 0.55, lineBreak: false }
    );

    // Sub text (color/variant)
    if (hasSubText) {
      doc.font("Regular").fontSize(baseFontSize - 1).fillColor("#888888").text(
        esc(item.subText),
        COL_PRODUCT + 6,
        y + 5 + rowH - 4,
        { width: CONTENT_W * 0.55, lineBreak: false }
      );
    }

    // Quantity
    doc.font("Regular").fontSize(baseFontSize).fillColor("#333333").text(
      String(item.quantity),
      COL_QTY,
      y + 5,
      { width: 50, align: "center", lineBreak: false }
    );

    if (showAmounts) {
      const itemCurrency = item.currency || currency;
      const unitPrice = fmt(item.unitPrice, itemCurrency);
      const total = fmt(item.quantity * item.unitPrice, itemCurrency);

      doc.text(unitPrice, COL_UNIT, y + 5, { width: 80, align: "right", lineBreak: false });
      doc.text(total, COL_TOTAL, y + 5, { width: PAGE_W - PAGE_MARGIN - COL_TOTAL, align: "right", lineBreak: false });
    }

    y += thisRowH;
  });

  // ── Summary ───────────────────────────────────────────────────
  if (showAmounts) {
    y += 8;
    doc.moveTo(LEFT, y).lineTo(PAGE_W - PAGE_MARGIN, y).lineWidth(0.5).stroke(DIVIDER);
    y += 10;

    const summaryX = LEFT + CONTENT_W * 0.6;
    const summaryW = CONTENT_W * 0.4;

    // Subtotal
    if (taxTotal > 0) {
      doc.font("Regular").fontSize(10).fillColor(GRAY).text("Subtotal:", summaryX, y, { width: summaryW * 0.5, lineBreak: false });
      doc.text(fmt(subtotal, currency), summaryX + summaryW * 0.5, y, { width: summaryW * 0.5, align: "right", lineBreak: false });
      y += 16;

      // Tax
      const taxRate = senderSettings?.taxRate ? parseFloat(senderSettings.taxRate) : null;
      const taxLabel = taxRate ? `Tax (${taxRate}%):` : "Tax:";
      doc.font("Regular").fontSize(10).fillColor(GRAY).text(taxLabel, summaryX, y, { width: summaryW * 0.5, lineBreak: false });
      doc.text(fmt(taxTotal, currency), summaryX + summaryW * 0.5, y, { width: summaryW * 0.5, align: "right", lineBreak: false });
      y += 16;

      // Divider
      doc.moveTo(summaryX, y).lineTo(PAGE_W - PAGE_MARGIN, y).lineWidth(0.5).stroke(DIVIDER);
      y += 8;
    }

    // Grand total
    doc.font("Bold").fontSize(13).fillColor(BLUE).text("Total:", summaryX, y, { width: summaryW * 0.5, lineBreak: false });
    doc.font("Bold").fontSize(13).fillColor(BLUE).text(fmt(grandTotal, currency), summaryX + summaryW * 0.5, y, {
      width: summaryW * 0.5,
      align: "right",
      lineBreak: false,
    });
    y += 24;
  }

  // ── Notes ─────────────────────────────────────────────────────
  if (notes) {
    y += 10;
    doc.rect(LEFT, y, CONTENT_W, 16).fill(LIGHT_GRAY);
    doc.font("Bold").fontSize(9).fillColor("#333333").text("Notes", LEFT + 6, y + 4, { lineBreak: false });
    y += 20;
    doc.font("Regular").fontSize(9).fillColor("#555555").text(esc(notes), LEFT + 6, y, { width: CONTENT_W - 12 });
  }
}

// Keep buildInvoiceHtml for backward compatibility (no longer used but exported)
export function buildInvoiceHtml(_params: InvoicePdfParams): string {
  return "";
}
