import type { InvoiceFormData, InvoiceItem } from "./types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

export function InvoiceItemsEditor({ form, addItem, updateItem, removeItem }: {
  form: InvoiceFormData;
  addItem: () => void;
  updateItem: (index: number, field: keyof InvoiceItem, value: string | number) => void;
  removeItem: (index: number) => void;
}) {
  return (
<div className="space-y-3">
            <div className="bg-background border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">明細</h3>
                <Button size="sm" variant="outline" onClick={addItem} className="h-7 text-xs gap-1">
                  <Plus size={11} /> 行を追加
                </Button>
              </div>

              {form.items.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4 italic">
                  WhatsAppから解析するか、手動で行を追加してください
                </p>
              ) : (
                <div className="space-y-2">
                  {/* Header */}
                  <div className={`grid gap-2 text-[10px] font-bold text-muted-foreground uppercase px-1 ${form.showAmounts ? "grid-cols-[1fr_60px_80px_24px]" : "grid-cols-[1fr_60px_24px]"}`}>
                    <span>商品名</span>
                    <span className="text-right">数量</span>
                    {form.showAmounts && <span className="text-right">単価</span>}
                    <span></span>
                  </div>
                  {form.items.map((item, idx) => (
                    <div key={idx} className={`grid gap-2 items-start ${form.showAmounts ? "grid-cols-[1fr_60px_80px_24px]" : "grid-cols-[1fr_60px_24px]"}`}>
                      <div className="flex flex-col gap-1">
                        <Input
                          value={item.description}
                          onChange={e => updateItem(idx, "description", e.target.value)}
                          placeholder="商品名・説明"
                          className="h-8 text-xs"
                        />
                        <Input
                          value={item.subText ?? ""}
                          onChange={e => updateItem(idx, "subText", e.target.value)}
                          placeholder="種類・カラー等（任意）"
                          className="h-7 text-xs text-muted-foreground"
                        />
                      </div>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={e => updateItem(idx, "quantity", Number(e.target.value))}
                        onFocus={e => e.currentTarget.select()}
                        className="h-8 text-xs text-right"
                        min={0}
                      />
                      {form.showAmounts && (
                        <Input
                          type="number"
                          value={item.unitPrice}
                          onChange={e => updateItem(idx, "unitPrice", Number(e.target.value))}
                          onFocus={e => e.currentTarget.select()}
                          className="h-8 text-xs text-right"
                          min={0}
                        />
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem(idx)}
                      >
                        <X size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Totals */}
              {form.showAmounts && form.items.length > 0 && (
                <div className="border-t border-border pt-3 space-y-1">
                  {(() => {
                    const subtotal = form.items.reduce((s, item) => s + item.quantity * item.unitPrice, 0);
                    const sym = form.currency === "USD" ? "$" : form.currency === "EUR" ? "€" : form.currency;
                    return (
                      <div className="flex justify-between text-sm font-bold">
                        <span>合計</span>
                        <span>{sym}{subtotal.toLocaleString()}</span>
                      </div>
                    );
                  })()}
                </div>
              )}
        </div>
        </div>
  );
}
