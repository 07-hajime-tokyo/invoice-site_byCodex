import type { InvoicePreviewProps } from "./types";

export type SenderSettingsData = {
  logoUrl?: string | null;
  senderCompany?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  senderCity?: string | null;
  senderCountry?: string | null;
  senderEmail?: string | null;
  senderPhone?: string | null;
  senderExtraInfo?: string | null;
} | null;

export type InvoicePdfClient = InvoicePreviewProps["clientData"];
