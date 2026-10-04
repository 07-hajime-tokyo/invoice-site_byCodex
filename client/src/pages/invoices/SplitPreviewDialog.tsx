import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Save,
} from "lucide-react";
import type { InvoiceSplit } from "./splitInvoices";
export function SplitPreviewDialog({
  open,
  onOpenChange,
  currency,
  exchangeRateInfo,
  splitPreview,
  isCreating,
  isSplitting,
  onCancel,
  onSave,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  exchangeRateInfo: { rate: number; date: string } | null;
  splitPreview: InvoiceSplit[];
  isCreating: boolean;
  isSplitting: boolean;
  onCancel: () => void;
  onSave: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={16} className="text-orange-500" />
            インボイス自動分割プレビュー
          </DialogTitle>
          <DialogDescription>
            {exchangeRateInfo && (
              <span className="text-xs">
                為替レート: 1 {currency} ={" "}
                {exchangeRateInfo.rate.toLocaleString()} 円（
                {exchangeRateInfo.date}）　上限: 100万円/回
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {splitPreview.length === 1 ? (
          <div className="py-4">
            <div className="flex items-center gap-2 text-green-600 bg-green-50 border border-green-200 rounded-lg p-3">
              <CheckCircle2 size={16} />
              <div>
                <p className="text-sm font-semibold">分割不要です</p>
                <p className="text-xs text-muted-foreground">
                  合計 {splitPreview[0]?.totalJpy.toLocaleString()}{" "}
                  円で100万円以下です。通常の「保存」で登録できます。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-orange-600 bg-orange-50 border border-orange-200 rounded-lg p-3">
              <AlertCircle size={16} />
              <p className="text-sm">
                合計金額が100万円を超えるため、
                <strong>{splitPreview.length}枚</strong>に分割します。
              </p>
            </div>
            {splitPreview.map((group, idx) => (
              <div
                key={idx}
                className="border border-border rounded-lg overflow-hidden"
              >
                <div className="bg-muted/50 px-3 py-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    インボイス #{group.invoiceNumber}
                    {idx === 0 ? " (元番号)" : " (連番)"}
                  </span>
                  <span className="text-xs font-mono text-orange-600">
                    約 {Math.round(group.totalJpy).toLocaleString()} 円
                  </span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="text-left px-3 py-1.5 font-medium">
                        商品
                      </th>
                      <th className="text-right px-3 py-1.5 font-medium">
                        数量
                      </th>
                      <th className="text-right px-3 py-1.5 font-medium">
                        単価
                      </th>
                      <th className="text-right px-3 py-1.5 font-medium">
                        小計(円)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item, iIdx) => (
                      <tr
                        key={iIdx}
                        className="border-b border-border/50 last:border-0"
                      >
                        <td className="px-3 py-1.5">
                          {item.description}
                          {item.subText && (
                            <span className="text-muted-foreground ml-1">
                              ({item.subText})
                            </span>
                          )}
                        </td>
                        <td className="text-right px-3 py-1.5">
                          {item.quantity}
                        </td>
                        <td className="text-right px-3 py-1.5">
                          {currency} {item.unitPrice.toLocaleString()}
                        </td>
                        <td className="text-right px-3 py-1.5">
                          {Math.round(
                            item.quantity *
                              item.unitPrice *
                              (exchangeRateInfo?.rate ?? 1)
                          ).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            キャンセル
          </Button>
          {splitPreview.length === 1 ? (
            <Button size="sm" onClick={onSave} disabled={isCreating}>
              {isCreating ? (
                <RefreshCw size={12} className="animate-spin mr-1" />
              ) : (
                <Save size={12} className="mr-1" />
              )}
              そのまま保存
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={isSplitting}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {isSplitting ? (
                <>
                  <RefreshCw size={12} className="animate-spin mr-1" />{" "}
                  作成中...
                </>
              ) : (
                <>
                  <Sparkles size={12} className="mr-1" /> {splitPreview.length}
                  枚に分割して保存
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
