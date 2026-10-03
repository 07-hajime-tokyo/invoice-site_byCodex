import type { Dispatch, SetStateAction } from "react";
import type { InvoiceFormData } from "./types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { calcDueDate } from "./dates";

export function InvoiceMetadata({ form, setForm }: { form: InvoiceFormData; setForm: Dispatch<SetStateAction<InvoiceFormData>> }) {
  return (
<div className="bg-background border border-border rounded-lg p-4 space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">基本情報</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">インボイス番号 *</Label>
                  <Input value={form.invoiceNumber} onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))} placeholder="INV-20260324-001" className="h-8 text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs">ステータス</Label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as InvoiceFormData["status"] }))}>
                    <SelectTrigger className="h-8 text-sm mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">下書き</SelectItem>
                      <SelectItem value="sent">送付済み</SelectItem>
                      <SelectItem value="paid">支払済み</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">発行日</Label>
                  <Input
                    type="date"
                    value={form.invoiceDate}
                    onChange={e => {
                      const newDate = e.target.value;
                      setForm(f => ({
                        ...f,
                        invoiceDate: newDate,
                        // 支払期限が未設定 or まだ自動計算値のままなら自動更新
                        dueDate: calcDueDate(newDate),
                      }));
                    }}
                    className="h-8 text-sm mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">支払期限 <span className="text-muted-foreground font-normal">(発行日+1ヶ月-1日)</span></Label>
                  <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} className="h-8 text-sm mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">通貨</Label>
                  <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger className="h-8 text-sm mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EUR">EUR (€)</SelectItem>
                      <SelectItem value="USD">USD ($)</SelectItem>
                      <SelectItem value="JPY">JPY (¥)</SelectItem>
                      <SelectItem value="GBP">GBP (£)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2 pb-0.5">
                  <Switch
                    checked={form.showAmounts}
                    onCheckedChange={v => setForm(f => ({ ...f, showAmounts: v }))}
                    id="show-amounts"
                  />
                  <Label htmlFor="show-amounts" className="text-xs cursor-pointer">金額を表示</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">アクセントカラー</Label>
                  <input
                    type="color"
                    value={form.accentColor || "#db8b1a"}
                    onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
                    className="w-8 h-8 rounded cursor-pointer border border-border p-0.5 bg-transparent"
                    title="インボイスのアクセントカラーを変更"
                  />
                  <span className="text-xs text-muted-foreground font-mono">{form.accentColor || "#db8b1a"}</span>
                </div>
              </div>
            </div>
  );
}
