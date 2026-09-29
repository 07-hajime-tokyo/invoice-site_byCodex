import { toast } from "sonner";
import type { InvoiceFormData } from "./types";
import type { InvoicePdfClient, SenderSettingsData } from "./pdfTypes";
import { drawInvoicePdf } from "./pdfDrawing";
import { createDownloadablePdfBlob } from "./pdfBlob";
import { downloadPdfBlob } from "./pdfDownload";

export async function generateInvoicePdf(
  form: InvoiceFormData,
  selectedClient: InvoicePdfClient,
  senderSettings: SenderSettingsData,
) {
  const { pdf, filename } = await drawInvoicePdf(form, selectedClient, senderSettings);
  const modifiedBlob = await createDownloadablePdfBlob(pdf);
  downloadPdfBlob(modifiedBlob, filename);
  toast.success("PDFをダウンロードしました");
}
