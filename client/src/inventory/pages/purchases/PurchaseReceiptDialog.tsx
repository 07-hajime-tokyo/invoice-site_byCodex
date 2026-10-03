import { Button } from "@/components/ui/button";
import { PackageCheck, Loader2 } from "lucide-react";
import { combineSupplierInfo } from "@/inventory/lib/supplier";
import { parseEtc, formatUnitPrice } from "./format";
import { type PurchasePageModel } from "./usePurchasesPage";

export function PurchaseReceiptDialog({
  confirmPurchase,
  today,
  operators,
  handleOperatorChange,
  selectedOperatorKey,
  setConfirmPurchase,
  executeComplete,
  processingIds,
}: Pick<
  PurchasePageModel,
  | "confirmPurchase"
  | "today"
  | "operators"
  | "handleOperatorChange"
  | "selectedOperatorKey"
  | "setConfirmPurchase"
  | "executeComplete"
  | "processingIds"
>) {
  return (
    <>
      {confirmPurchase &&
        (() => {
          const firstItem = confirmPurchase.purchase_items[0];
          const { managementNo, supplierSite } = parseEtc(firstItem?.etc);
          return (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-card rounded-t-2xl sm:rounded-xl shadow-2xl border max-w-md w-full overflow-hidden">
                <div className="px-6 py-4 border-b bg-muted/30">
                  <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                    <PackageCheck className="h-5 w-5 text-green-600" />
                    入庫確認
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    以下の内容で入庫登録しますか？
                  </p>
                </div>
                <div className="px-6 py-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">管理番号</p>
                      <p className="font-medium">{managementNo || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">入庫日</p>
                      <p className="font-medium">{today}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">商品名</p>
                      <p className="font-medium">{firstItem?.title ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        仕入れ単価
                      </p>
                      <p className="font-medium">
                        {formatUnitPrice(firstItem?.unit_price)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">数量</p>
                      <p className="font-medium">
                        {firstItem?.quantity ?? "-"} {firstItem?.unit ?? ""}
                      </p>
                    </div>
                    {(confirmPurchase.csvSupplierName ||
                      supplierSite ||
                      confirmPurchase.customer_name) && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground">仕入先</p>
                        <p className="font-medium">
                          {combineSupplierInfo(
                            supplierSite,
                            confirmPurchase.csvSupplierName,
                            confirmPurchase.customer_name
                          )}
                        </p>
                      </div>
                    )}
                    {firstItem?.category && (
                      <div>
                        <p className="text-xs text-muted-foreground">
                          カテゴリー
                        </p>
                        <p className="font-medium">{firstItem.category}</p>
                      </div>
                    )}
                  </div>
                  {/* 操作者選択 */}
                  {operators && operators.length > 1 && (
                    <div className="pt-2 border-t">
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
                    onClick={() => setConfirmPurchase(null)}
                  >
                    キャンセル
                  </Button>
                  <Button
                    className="flex-1 h-12 text-base font-bold bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => executeComplete(confirmPurchase)}
                    disabled={processingIds.has(confirmPurchase.id)}
                  >
                    {processingIds.has(confirmPurchase.id) ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    ) : (
                      <PackageCheck className="h-4 w-4 mr-1.5" />
                    )}
                    入庫登録する
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
}
