import type { InvoiceFormData, InvoicePreviewProps } from "./types";
export const pdfForm: InvoiceFormData = {
  invoiceNumber: "INV-20260930-42", clientId: 1, invoiceDate: "2026-09-30", dueDate: "2026-10-29",
  currency: "EUR", showAmounts: true, notes: "Fixed notes\nSecond line", rawChat: "", status: "draft", accentColor: "#db8b1a",
  items: [{ description: "Product One", subText: "Blue / A", quantity: 2, unitPrice: 1234.567, tax: 10 },
    { description: "Zero", quantity: 0, unitPrice: 50 }, { description: "Credit", quantity: 1, unitPrice: -3.25, tax: 0 },
    { description: "Fraction", quantity: 1.25, unitPrice: 0.1234, tax: 8.5 }],
};
export const pdfClient: InvoicePreviewProps["clientData"] = { name: "Example:Client", company: " Client Ltd ", address: " Address:Line ", city: "City", country: "Country", email: "test@example.invalid", phone: "0000000", notes: "Customer note\n\nSecond", extraInfo: "Reference:Fixed" };
export const pdfSender = { senderCompany: "Sender Ltd", senderName: "Sender", senderAddress: "Address", senderCity: "City", senderCountry: "Country", senderEmail: "sender@example.invalid", senderPhone: "0000000", senderExtraInfo: "Line 1\n\nLine 2" };
export const pdfCases: Array<[string, InvoiceFormData]> = [
  ...["EUR", "USD", "GBP", "JPY", "CAD"].map(currency => [currency, { ...pdfForm, currency }] as [string, InvoiceFormData]),
  ["hidden", { ...pdfForm, showAmounts: false }],
  ["empty", { ...pdfForm, items: [], notes: "", invoiceNumber: "CUSTOM", invoiceDate: "", dueDate: "", accentColor: "invalid" }],
  ["empty hidden", { ...pdfForm, items: [], showAmounts: false }],
  ["multiple pages", { ...pdfForm, items: Array.from({ length: 90 }, (_, i) => ({ description: `Item ${i + 1}`, subText: "Description wrapping and fixed variant", quantity: i + 1, unitPrice: 1.25, tax: i % 2 ? 10 : undefined })) }],
];
// A fixed 1x1 PNG; never fetched from an external service.
export const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQcEgAAAFEAMELjZZCAAAAAElFTkSuQmCC";
