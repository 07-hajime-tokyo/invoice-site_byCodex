export interface InvoiceItem {
  description: string;
  subText?: string; // 商品名の下に表示するサブテキスト（種類・カラー等）
  quantity: number;
  unitPrice: number;
  currency?: string;
  sortOrder?: number;
  tax?: number; // tax rate 0-100
}

export interface InvoiceFormData {
  invoiceNumber: string;
  clientId: number | null;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  showAmounts: boolean;
  notes: string;
  rawChat: string;
  status: "draft" | "sent" | "paid";
  accentColor: string;
  items: InvoiceItem[];
}

export type InvoiceClientOption = {
  id: number;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type InvoicePreviewProps = {
  form: InvoiceFormData;
  clientData: { name: string; company?: string | null; email?: string | null; phone?: string | null; address?: string | null; city?: string | null; country?: string | null; notes?: string | null; extraInfo?: string | null } | null;
  senderSettings: {
    senderName?: string | null;
    senderCompany?: string | null;
    senderEmail?: string | null;
    senderPhone?: string | null;
    senderAddress?: string | null;
    senderCity?: string | null;
    senderCountry?: string | null;
    logoUrl?: string | null;
    taxRate?: string | null;
    senderExtraInfo?: string | null;
  } | null;
};
