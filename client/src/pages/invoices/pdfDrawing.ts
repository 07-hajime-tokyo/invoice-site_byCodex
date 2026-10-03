import { calculateInvoiceTotals } from "@shared/invoiceAmounts";
import { invoiceCurrencySymbol, formatInvoiceAmount } from "./amountFormat";
import type { InvoiceFormData, InvoiceItem } from "./types";
import type { InvoicePdfClient, SenderSettingsData } from "./pdfTypes";
import { loadPdfLogoImage } from "./pdfLogo";

export async function drawInvoicePdf(
  form: InvoiceFormData,
  selectedClient: InvoicePdfClient,
  senderSettings: SenderSettingsData
) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const currencySymbol = invoiceCurrencySymbol(form.currency);
  const fmt = (n: number) => formatInvoiceAmount(n, form.currency);

  const { subtotal, taxTotal, total } = calculateInvoiceTotals(form.items);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  const hexToRgb = (hex: string): [number, number, number] => {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return [isNaN(r) ? 26 : r, isNaN(g) ? 86 : g, isNaN(b) ? 219 : b];
  };
  const accentRgb = hexToRgb(form.accentColor || "#db8b1a");

  const logoImage = await loadPdfLogoImage(senderSettings?.logoUrl);

  pdf.setFillColor(...accentRgb);
  pdf.rect(0, 0, pageW, 6, "F");
  y = 16;

  const logoSize = 18;
  const logoX = margin;
  const logoTopY = y - 2;
  let logoRendered = false;
  if (logoImage) {
    try {
      pdf.addImage(logoImage.dataUrl, logoImage.format, logoX, logoTopY, logoSize, logoSize);
      logoRendered = true;
    } catch (error) {
      console.warn("Skipping invoice logo because jsPDF could not embed it", error);
    }
  }
  const companyX = logoRendered ? logoX + logoSize + 4 : margin;
  const companyName = senderSettings?.senderCompany || senderSettings?.senderName || "";
  if (companyName) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(30, 30, 30);
    const fontHeightMm = 13 * 0.352778 * 0.7;
    const companyCenterY = logoTopY + logoSize / 2 + fontHeightMm / 2;
    pdf.text(companyName, companyX, companyCenterY);
  }

  const invoiceNumDisplay = form.invoiceNumber.replace(/^INV-\d{8}-/, "") || form.invoiceNumber;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(26);
  pdf.setTextColor(...accentRgb);
  pdf.text(`Invoice: ${invoiceNumDisplay}`, pageW - margin, y + 6, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(100, 100, 100);
  if (form.invoiceDate) pdf.text(`Issued on: ${form.invoiceDate}`, pageW - margin, y + 13, { align: "right" });
  if (form.dueDate) pdf.text(`Due by: ${form.dueDate}`, pageW - margin, y + 18, { align: "right" });

  y += Math.max(logoSize + 4, 22);

  pdf.setDrawColor(...accentRgb);
  pdf.setLineWidth(0.5);
  pdf.line(margin, y, pageW - margin, y);
  y += 8;

  const colW = (pageW - margin * 2 - 10) / 2;
  const fromX = margin;
  const toX = margin + colW + 10;
  const fromToY = y;
  const formatAddressLine = (line: string) => line.trim().replace(/([:：])(?=\S)/g, "$1 ");
  const drawAddressLines = (lines: string[], x: number, startY: number) => {
    const lineHeight = 5.2;
    let currentY = startY;
    lines.forEach((rawLine) => {
      const line = formatAddressLine(rawLine);
      if (!line) return;
      const wrapped = pdf.splitTextToSize(line, colW);
      pdf.text(wrapped, x, currentY, { maxWidth: colW, lineHeightFactor: 1.25 });
      currentY += Math.max(lineHeight, wrapped.length * lineHeight);
    });
    return currentY;
  };

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(...accentRgb);
  pdf.text("FROM", fromX, fromToY);
  pdf.setDrawColor(...accentRgb);
  pdf.setLineWidth(0.4);
  pdf.line(fromX, fromToY + 1, fromX + 14, fromToY + 1);
  pdf.text("TO", toX, fromToY);
  pdf.line(toX, fromToY + 1, toX + 8, fromToY + 1);

  let fromY = fromToY + 6;
  let toY = fromToY + 6;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(40, 40, 40);
  const fromLines: string[] = [];
  if (senderSettings?.senderCompany) fromLines.push(senderSettings.senderCompany);
  if (senderSettings?.senderName) fromLines.push(senderSettings.senderName);
  if (senderSettings?.senderAddress) fromLines.push(senderSettings.senderAddress);
  if (senderSettings?.senderCity) fromLines.push(senderSettings.senderCity);
  if (senderSettings?.senderCountry) fromLines.push(senderSettings.senderCountry);
  if (senderSettings?.senderEmail) fromLines.push(senderSettings.senderEmail);
  if (senderSettings?.senderPhone) fromLines.push(senderSettings.senderPhone);
  if (senderSettings?.senderExtraInfo) {
    senderSettings.senderExtraInfo.split("\n").forEach(l => { if (l.trim()) fromLines.push(l); });
  }
  fromY = drawAddressLines(fromLines, fromX, fromY);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(40, 40, 40);
  if (selectedClient) {
    const toLines: string[] = [];
    if (selectedClient.company) toLines.push(selectedClient.company);
    if (selectedClient.name) toLines.push(selectedClient.name);
    if (selectedClient.address) toLines.push(selectedClient.address);
    if (selectedClient.city) toLines.push(selectedClient.city);
    if (selectedClient.country) toLines.push(selectedClient.country);
    if (selectedClient.email) toLines.push(selectedClient.email);
    if (selectedClient.phone) toLines.push(selectedClient.phone);
    if (selectedClient.notes) {
      selectedClient.notes.split("\n").forEach(l => { if (l.trim()) toLines.push(l); });
    }
    if (selectedClient.extraInfo) {
      selectedClient.extraInfo.split("\n").forEach(l => { if (l.trim()) toLines.push(l); });
    }
    toY = drawAddressLines(toLines, toX, toY);
  }

  y = Math.max(fromY, toY) + 10;

  const tableHead = form.showAmounts
    ? [["Product", "Quantity", "Unit Price", "Tax", "Total"]]
    : [["Product", "Quantity"]];
  const tableBody = form.items.map(item => {
    const lineTotal = item.quantity * item.unitPrice;
    const taxRate = item.tax ?? 0;
    const desc = (item as InvoiceItem & { subText?: string }).subText ? `${item.description}\n${(item as InvoiceItem & { subText?: string }).subText}` : item.description;
    if (form.showAmounts) {
      return [desc, String(item.quantity), `${currencySymbol} ${fmt(item.unitPrice)}`, taxRate > 0 ? `${taxRate}%` : "—", `${currencySymbol} ${fmt(lineTotal)}`];
    }
    return [desc, String(item.quantity)];
  });

  autoTable(pdf, {
    startY: y,
    head: tableHead,
    body: tableBody,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 3.5, textColor: [40, 40, 40], lineColor: [220, 220, 220], lineWidth: 0.2 },
    headStyles: { fillColor: [240, 240, 240], textColor: [50, 50, 50], fontStyle: "bold", fontSize: 9 },
    bodyStyles: { fillColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    columnStyles: form.showAmounts
      ? { 0: { cellWidth: "auto" }, 1: { cellWidth: 22, halign: "center" }, 2: { cellWidth: 28, halign: "right" }, 3: { cellWidth: 16, halign: "center" }, 4: { cellWidth: 28, halign: "right" } }
      : { 0: { cellWidth: "auto" }, 1: { cellWidth: 25, halign: "center" } },
    didDrawCell: (data) => {
      if (data.section === "body" && data.row.index === tableBody.length - 1 && data.column.index === 0) {
        const finalRowY = data.cell.y + data.cell.height;
        pdf.setDrawColor(220, 220, 220);
        pdf.setLineWidth(0.2);
        pdf.line(margin, finalRowY, pageW - margin, finalRowY);
      }
    },
  });

  const tableEndY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  if (form.showAmounts) {
    const boxW = 62;
    const boxX = pageW - margin - boxW;
    const boxPad = 4;
    const lineH = 6;
    const boxH = 6 + lineH * 2 + 2 + lineH + boxPad * 2 + 2;
    const boxY = tableEndY;

    pdf.setFillColor(247, 248, 250);
    pdf.setDrawColor(210, 215, 220);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(boxX, boxY, boxW, boxH, 2, 2, "FD");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(30, 30, 30);
    const iconX = boxX + boxPad;
    const iconY = boxY + boxPad + 0.5;
    pdf.setFillColor(80, 80, 80);
    pdf.rect(iconX,     iconY + 2.5, 1.5, 1.5, "F");
    pdf.rect(iconX + 2, iconY + 1,   1.5, 3,   "F");
    pdf.rect(iconX + 4, iconY,       1.5, 4,   "F");
    pdf.text("Invoice Summary", boxX + boxPad + 7, boxY + boxPad + 3.5);

    pdf.setDrawColor(210, 215, 220);
    pdf.line(boxX, boxY + boxPad + 5.5, boxX + boxW, boxY + boxPad + 5.5);

    const row1Y = boxY + boxPad + 5.5 + lineH;
    const row2Y = row1Y + lineH;
    const row3Y = row2Y + lineH + 2;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(60, 60, 60);
    pdf.text("Subtotal", boxX + boxPad, row1Y);
    pdf.text(`${currencySymbol} ${fmt(subtotal)}`, boxX + boxW - boxPad, row1Y, { align: "right" });
    pdf.text("Tax", boxX + boxPad, row2Y);
    pdf.text(`${currencySymbol} ${fmt(taxTotal)}`, boxX + boxW - boxPad, row2Y, { align: "right" });

    pdf.setDrawColor(210, 215, 220);
    pdf.line(boxX + boxPad, row3Y - 4, boxX + boxW - boxPad, row3Y - 4);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(30, 30, 30);
    pdf.text("Total", boxX + boxPad, row3Y);
    pdf.text(`${currencySymbol} ${fmt(total)}`, boxX + boxW - boxPad, row3Y, { align: "right" });
  }

  if (form.notes) {
    const notesY = tableEndY + (form.showAmounts ? 46 : 6);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.text("Notes", margin, notesY);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(60, 60, 60);
    pdf.text(form.notes, margin, notesY + 5, { maxWidth: pageW - margin * 2 });
  }

  const numMatch = form.invoiceNumber.match(/(\d+)$/);
  const numStr = numMatch ? numMatch[1].padStart(4, "0") : form.invoiceNumber;

  pdf.setProperties({
    title: `Invoice-${numStr}`,
    subject: "Invoice",
    creator: "Tokyo Media Koueki",
  });

  return { pdf, filename: `Invoice-${numStr}.pdf` };
}
