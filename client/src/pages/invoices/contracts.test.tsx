import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadInvoiceReference } from "./reference";
import type { InvoiceFormData } from "./types";

const subject = process.env.INVOICE_REFERENCE
  ? loadInvoiceReference(process.env.INVOICE_REFERENCE)
  : { ...await import("./clientRules"), ...await import("./dates"), ...await import("./InvoicePreview") };

const clients = [
  { id: 1, name: "Luca Test", company: "Example Ltd", email: "luca@example.invalid", phone: "+39 123 456 789" },
  { id: 2, name: "Luca", company: "Other", phone: "1234567" },
  { id: 3, name: "サイモン", company: "Ｈｅｎｎｅｓ Ｋａｍｕｓｉｅｎ", phone: "000111222" },
  { id: 4, name: "A", company: null, email: null, phone: null },
];

describe("invoice rules captured before extraction", () => {
  it("preserves due dates including overflow and invalid input", () => {
    const inputs = ["", "2026-03-25", "2026-01-31", "2024-01-31", "2024-02-29", "2026-12-31", "2026-09-30", "invalid", "2026-03-29T23:30:00Z"];
    expect(inputs.map(input => {
      try { return [input, subject.calcDueDate(input)]; }
      catch (error) { return [input, (error as Error).name]; }
    })).toMatchSnapshot();
  });
  it("preserves currency defaults and name/company matching", () => {
    expect([null, undefined, {}, ...clients, ...["ルカ", "MAXIM", "マキシム", "Nele", "ネレ", "Simon", "Samee", "Unknown", "ＬＵＣＡ"].map(name => ({ name }))]
      .map(client => subject.getDefaultCurrencyForClient(client))).toMatchSnapshot();
  });
  it("preserves normalization, telephone thresholds and first matching client", () => {
    const inputs = [null, undefined, "", "~ LUCA TEST", "Ｌｕｃａ", "luca@example.invalid", "Example", "+39 (123) 456-789", "123456", "1234567", "サイモン", "A", "L", "missing", "a+b@example.invalid", "~  Ａ＿Ｂ"];
    const before = JSON.stringify(clients);
    expect(inputs.map(input => [input, subject.normalizeClientLookupText(input), subject.phoneDigits(input), subject.findClientByDetectedSender(clients, input)?.id ?? null])).toMatchSnapshot();
    expect(JSON.stringify(clients)).toBe(before);
    expect(subject.findClientByDetectedSender([], "Luca")).toBeNull();
    expect(subject.findClientByDetectedSender(clients, "Luca")).toBe(clients[0]);
  });
});

const form: InvoiceFormData = {
  invoiceNumber: "INV-20260930-0042", clientId: 1, invoiceDate: "2026-09-30", dueDate: "2026-10-29",
  currency: "EUR", showAmounts: true, notes: "固定の備考\nSecond line", rawChat: "", status: "draft", accentColor: "#db8b1a",
  items: [{ description: "商品 <One>", subText: "Blue / A", quantity: 2, unitPrice: 1234.567, tax: 10 }, { description: "Zero", quantity: 0, unitPrice: 50 }, { description: "Credit", quantity: 1, unitPrice: -3.25, tax: 0 }],
};
const client = { name: "Example:Client", company: " Test：Company ", email: "test@example.invalid", phone: "+00 1234567", address: " Address:Line ", city: "City", country: "Country", notes: "Note:Text", extraInfo: "First:Line\n\nThird：Line" };
const sender = { senderCompany: "Sender Ltd", senderName: "Sender", senderAddress: "Address", senderCity: "City", senderCountry: "Country", senderEmail: "sender@example.invalid", senderPhone: "0000000", senderExtraInfo: "Line 1\nLine 2", taxRate: "99" };
const scenarios: Array<[string, InvoiceFormData, typeof client | null, typeof sender | null]> = [
  ...["EUR", "USD", "GBP", "JPY", "CAD"].map(currency => [currency, { ...form, currency }, client, sender] as [string, InvoiceFormData, typeof client, typeof sender]),
  ["amounts hidden", { ...form, showAmounts: false }, client, sender],
  ["empty", { ...form, items: [], notes: "", invoiceDate: "", dueDate: "", accentColor: "" }, null, null],
  ["empty hidden", { ...form, items: [], showAmounts: false }, null, null],
  ["plain number", { ...form, invoiceNumber: "0042" }, client, sender],
  ["name only", form, { ...client, company: "", extraInfo: "" }, { ...sender, senderCompany: "" }],
];

describe("invoice preview HTML captured before extraction", () => {
  for (const [name, data, clientData, senderSettings] of scenarios) {
    it(name, () => {
      const before = JSON.stringify([data, clientData, senderSettings]);
      expect(renderToStaticMarkup(<subject.InvoicePreview form={data} clientData={clientData} senderSettings={senderSettings} />)).toMatchSnapshot();
      expect(JSON.stringify([data, clientData, senderSettings])).toBe(before);
    });
  }
});
