/** Invoice screen entry: list, create and edit navigation. */
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertCircle } from "lucide-react";
import type { InvoiceItem, InvoiceFormData } from "./invoices/types";
import { calcDueDate } from "./invoices/dates";
import { storedInvoiceToEditForm } from "./invoices/storedInvoiceForm";
import { InvoiceEditor } from "./invoices/InvoiceEditor";
import { InvoiceList } from "./invoices/InvoiceList";

const TODAY = new Date().toISOString().slice(0, 10);

const EMPTY_FORM: InvoiceFormData = {
  invoiceNumber: "",
  clientId: null,
  invoiceDate: TODAY,
  dueDate: calcDueDate(TODAY),
  currency: "EUR",
  showAmounts: true,
  notes: "",
  rawChat: "",
  status: "draft",
  accentColor: "#db8b1a",
  items: [],
};

type View = "list" | "new" | { editId: number } | { newWithNumber: string; items?: InvoiceItem[] };

export default function InvoicePage({ initialEditId }: { initialEditId?: number | null }) {
  const [view, setView] = useState<View>(() => {
    if (initialEditId) return { editId: initialEditId };
    return "list";
  });
  const utils = trpc.useUtils();

  // Load invoice for editing
  const editId = typeof view === "object" && "editId" in view ? view.editId : null;
  const { data: editInvoice, isLoading: editLoading } = trpc.invoices.get.useQuery(
    { id: editId! },
    { enabled: editId !== null }
  );

  // Fetch next invoice number (used when creating new invoice)
  const isNewView = view === "new";
  const { data: nextNumberData, isLoading: nextNumberLoading, isFetching: nextNumberFetching } = trpc.whatsappHistory.getNextNumber.useQuery(
    undefined,
    { enabled: isNewView, staleTime: 0, refetchOnMount: "always" }
  );

  const handleEdit = useCallback((id: number) => setView({ editId: id }), []);
  const handleNew = useCallback(() => {
    void utils.whatsappHistory.getNextNumber.invalidate();
    setView("new");
  }, [utils]);
  const handleNewWithNumber = useCallback((num: string, items?: InvoiceItem[]) => setView({ newWithNumber: num, items }), []);
  const handleBack = useCallback(() => {
    setView("list");
    utils.invoices.list.invalidate();
    utils.whatsappHistory.getNextNumber.invalidate();
  }, [utils]);

  if (view === "list") {
    return <InvoiceList onNew={handleNew} onNewWithNumber={handleNewWithNumber} onEdit={handleEdit} />;
  }

  if (view === "new") {
    // Wait for next number to load before rendering the editor
    if (nextNumberLoading || nextNumberFetching || !nextNumberData) {
      return (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={18} className="animate-spin text-muted-foreground" />
        </div>
      );
    }
    const autoNumber = nextNumberData?.nextFormatted ?? "";
    const newForm: InvoiceFormData = { ...EMPTY_FORM, invoiceNumber: autoNumber };
    return (
      <InvoiceEditor
        key={newForm.invoiceNumber || "new"}
        initialData={newForm}
        invoiceId={null}
        onSaved={handleBack}
        onCancel={handleBack}
      />
    );
  }

  if (typeof view === "object" && "newWithNumber" in view) {
    const newForm: InvoiceFormData = {
      ...EMPTY_FORM,
      invoiceNumber: view.newWithNumber,
      ...(view.items && view.items.length > 0
        ? { items: view.items.map((item, idx) => ({ ...item, sortOrder: idx })) }
        : {}),
    };
    return (
      <InvoiceEditor
        initialData={newForm}
        invoiceId={null}
        onSaved={handleBack}
        onCancel={handleBack}
      />
    );
  }

  // Edit mode
  if (editLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!editInvoice) {
    return (
      <div className="text-center py-16 space-y-3">
        <AlertCircle size={32} className="mx-auto text-destructive" />
        <p className="text-sm text-muted-foreground">請求書が見つかりませんでした</p>
        <Button size="sm" onClick={handleBack}>一覧に戻る</Button>
      </div>
    );
  }

  const editForm: InvoiceFormData = storedInvoiceToEditForm(editInvoice);

  return (
    <InvoiceEditor
      initialData={editForm}
      invoiceId={editInvoice.id}
      onSaved={handleBack}
      onCancel={handleBack}
    />
  );
}
