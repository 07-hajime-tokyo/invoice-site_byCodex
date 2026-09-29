import type { Dispatch, SetStateAction } from "react";
import type {
  InvoiceFormData,
  InvoiceClientOption,
  InvoicePreviewProps,
} from "./types";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
export function InvoiceContacts({
  form,
  setForm,
  clients,
  selectedClient,
  handleClientChange,
}: {
  form: InvoiceFormData;
  setForm: Dispatch<SetStateAction<InvoiceFormData>>;
  clients: InvoiceClientOption[];
  selectedClient: InvoicePreviewProps["clientData"];
  handleClientChange: (value: string) => void;
}) {
  return (
    <>
      <div className="bg-background border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
          宛先
        </h3>
        <Select
          value={form.clientId ? String(form.clientId) : "__none__"}
          onValueChange={handleClientChange}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="宛先を選択..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">選択しない</SelectItem>
            {clients.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
                {c.company ? ` (${c.company})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedClient && (
          <div className="text-xs text-muted-foreground space-y-0.5">
            {selectedClient.address && <p>{selectedClient.address}</p>}
            {selectedClient.city && (
              <p>
                {selectedClient.city}
                {selectedClient.country ? `, ${selectedClient.country}` : ""}
              </p>
            )}
            {selectedClient.email && <p>{selectedClient.email}</p>}
            {selectedClient.phone && <p>{selectedClient.phone}</p>}
          </div>
        )}
      </div>
      <div className="bg-background border border-border rounded-lg p-4 space-y-2">
        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
          備考
        </Label>
        <Textarea
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          placeholder="支払い方法、振込先など..."
          className="text-sm min-h-[80px] resize-y mt-1"
        />
      </div>
    </>
  );
}
