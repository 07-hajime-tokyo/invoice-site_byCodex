import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Truck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CARRIER_OPTIONS } from "./constants";
import { parseEtc } from "./format";
import { type PurchasePageModel } from "./usePurchasesPage";

export function BulkTrackingDialog({
  showBulkTrackingDialog,
  checkedPurchases,
  bulkTrackingForm,
  setBulkTrackingForm,
  setShowBulkTrackingDialog,
  isBulkTrackingSubmitting,
  handleBulkTrackingSubmit,
}: Pick<
  PurchasePageModel,
  | "showBulkTrackingDialog"
  | "checkedPurchases"
  | "bulkTrackingForm"
  | "setBulkTrackingForm"
  | "setShowBulkTrackingDialog"
  | "isBulkTrackingSubmitting"
  | "handleBulkTrackingSubmit"
>) {
  return (
    <>
      {showBulkTrackingDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-t-2xl sm:rounded-xl shadow-2xl border max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b bg-muted/30">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Truck className="h-5 w-5 text-blue-600" />
                追跡番号を一括登録
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                以下 {checkedPurchases.length} 件に同じ追跡番号を登録します
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* 対象一覧 */}
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                        管理番号
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                        商品名
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkedPurchases.map(p => {
                      const fi = p.purchase_items[0];
                      const { managementNo: mn } = parseEtc(fi?.etc);
                      return (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">
                            {mn || p.num || `#${p.id}`}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {fi?.title ?? "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* 入力フォーム */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    追跡番号 <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="text"
                    placeholder="追跡番号を入力"
                    value={bulkTrackingForm.trackingNumber}
                    onChange={e =>
                      setBulkTrackingForm(f => ({
                        ...f,
                        trackingNumber: e.target.value,
                      }))
                    }
                    className="h-9"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    発送日
                  </label>
                  <Input
                    type="date"
                    value={bulkTrackingForm.shipDate}
                    onChange={e =>
                      setBulkTrackingForm(f => ({
                        ...f,
                        shipDate: e.target.value,
                      }))
                    }
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    配送業者
                  </label>
                  <Select
                    value={bulkTrackingForm.carrier}
                    onValueChange={v =>
                      setBulkTrackingForm(f => ({ ...f, carrier: v }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="自動判別" />
                    </SelectTrigger>
                    <SelectContent>
                      {CARRIER_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowBulkTrackingDialog(false)}
                disabled={isBulkTrackingSubmitting}
              >
                キャンセル
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={handleBulkTrackingSubmit}
                disabled={
                  isBulkTrackingSubmitting ||
                  !bulkTrackingForm.trackingNumber.trim()
                }
              >
                {isBulkTrackingSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Truck className="h-4 w-4 mr-1.5" />
                )}
                {checkedPurchases.length}件に一括登録
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
