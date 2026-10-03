import { Button } from "@/components/ui/button";
import { PackageCheck, Loader2 } from "lucide-react";
import { parseEtc } from "./format";
import { type PurchasePageModel } from "./usePurchasesPage";

export function BulkReceiptDialog({
  showBulkConfirm,
  checkedPurchases,
  today,
  operators,
  handleOperatorChange,
  selectedOperatorKey,
  setShowBulkConfirm,
  bulkProcessing,
  handleBulkComplete,
}: Pick<
  PurchasePageModel,
  | "showBulkConfirm"
  | "checkedPurchases"
  | "today"
  | "operators"
  | "handleOperatorChange"
  | "selectedOperatorKey"
  | "setShowBulkConfirm"
  | "bulkProcessing"
  | "handleBulkComplete"
>) {
  return (
    <>
      {showBulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-t-2xl sm:rounded-xl shadow-2xl border max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b bg-muted/30">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <PackageCheck className="h-5 w-5 text-green-600" />
                まとめて入庫確認
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                以下 {checkedPurchases.length} 件をまとめて入庫登録しますか？
              </p>
            </div>
            <div className="px-6 py-4">
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
              <p className="text-xs text-muted-foreground mt-3">
                入庫日: {today}（今日）
              </p>
              {operators && operators.length > 1 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs text-muted-foreground mb-2">
                    操作者（作業履歴に記録されます）
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {operators.map(op => (
                      <button
                        key={op.key}
                        onClick={() => handleOperatorChange(op.key)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          selectedOperatorKey === op.key
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-foreground border-border hover:bg-muted/50"
                        }`}
                      >
                        {op.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowBulkConfirm(false)}
                disabled={bulkProcessing}
              >
                キャンセル
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={handleBulkComplete}
                disabled={bulkProcessing}
              >
                {bulkProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <PackageCheck className="h-4 w-4 mr-1.5" />
                )}
                まとめて入庫登録する
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
