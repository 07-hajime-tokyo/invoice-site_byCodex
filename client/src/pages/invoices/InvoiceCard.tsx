import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { AlertCircle, Loader2, Eye, Pencil, FileDown, Copy, Trash2 } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { invoiceCardAmounts } from "./listRules";

export type InvoiceCardData = {
  id: number; invoiceNumber: string; status: string; currency: string;
  invoiceDate?: string | null; totalAmount?: number | null; itemCount?: number | null;
};
export type InvoiceCardActions = {
  onStatusChange: (input: { id: number; status: "draft" | "sent" | "paid" }) => void;
  onPreview: (id: number) => void;
  onEdit: (id: number) => void;
  onPdf: (id: number, invoiceNumber: string) => void;
  onClone: (input: { id: number }) => void;
  onDelete: (input: { id: number }) => void;
};
export function InvoiceCard({ inv, client, rateMap, previewBusy, pdfBusy, clonePending, actions }: {
  inv: InvoiceCardData; client: { name: string } | null | undefined; rateMap: Record<string, number>;
  previewBusy: boolean; pdfBusy: boolean; clonePending: boolean; actions: InvoiceCardActions;
}) {
  const { totalAmount, itemCount, jpyAmount, isOver1M } = invoiceCardAmounts(inv, rateMap);
  return (
              <div
                className="flex flex-col gap-3 p-4 bg-background border border-border rounded-lg hover:bg-muted/20 transition-colors sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground truncate">{inv.invoiceNumber}</span>
                    <StatusBadge status={inv.status} />
                    {jpyAmount != null && (
                      <span className={`flex items-center gap-1 text-xs font-medium ${
                        isOver1M ? "text-orange-500" : "text-muted-foreground"
                      }`}>
                        {isOver1M && <AlertCircle size={12} className="text-orange-500" />}
                        ¥{jpyAmount.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {client && <span>{client.name}</span>}
                    {inv.invoiceDate && <span>{inv.invoiceDate}</span>}
                    <span>{itemCount}件の明細</span>
                    <span>{inv.currency}</span>
                    {totalAmount > 0 && (
                      <span className="font-medium text-foreground/70">{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} {inv.currency}</span>
                    )}
                  </div>
                </div>
                <div className="flex w-full flex-wrap items-center gap-1 sm:ml-3 sm:w-auto sm:flex-shrink-0">
                  <Select
                    value={inv.status}
                    onValueChange={v => actions.onStatusChange({ id: inv.id, status: v as "draft" | "sent" | "paid" })}
                  >
                    <SelectTrigger className="h-8 w-full text-xs border-border sm:h-7 sm:w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">下書き</SelectItem>
                      <SelectItem value="sent">送付済み</SelectItem>
                      <SelectItem value="paid">支払済み</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    title="プレビュー"
                    onClick={() => actions.onPreview(inv.id)}
                    disabled={previewBusy}
                  >
                    {previewBusy
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Eye size={13} />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => actions.onEdit(inv.id)} title="編集">
                    <Pencil size={13} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    title="PDF保存"
                    onClick={() => actions.onPdf(inv.id, inv.invoiceNumber)}
                    disabled={pdfBusy}
                  >
                    {pdfBusy
                      ? <Loader2 size={13} className="animate-spin" />
                      : <FileDown size={13} />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    title="クローン（最新番号+1で複製）"
                    onClick={() => actions.onClone({ id: inv.id })}
                    disabled={clonePending}
                  >
                    <Copy size={13} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="削除"
                    onClick={() => {
                      if (confirm(`「${inv.invoiceNumber}」を削除しますか？`)) {
                        actions.onDelete({ id: inv.id });
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
  );
}
