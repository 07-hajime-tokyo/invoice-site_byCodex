import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PackageCheck, Loader2, Truck } from "lucide-react";
import { parseEtc } from "./format";
import { type PurchasePageModel } from "./usePurchasesPage";

export function PurchaseSelectionBar({
  checkedPurchases,
  setCheckedPurchaseIds,
  setBulkTrackingForm,
  setShowBulkTrackingDialog,
  bulkProcessing,
  setShowBulkConfirm,
}: Pick<
  PurchasePageModel,
  | "checkedPurchases"
  | "setCheckedPurchaseIds"
  | "setBulkTrackingForm"
  | "setShowBulkTrackingDialog"
  | "bulkProcessing"
  | "setShowBulkConfirm"
>) {
  return (
    <>
      {checkedPurchases.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg z-10">
          <div className="max-w-5xl mx-auto px-4 py-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {checkedPurchases.map(p => {
                const fi = p.purchase_items[0];
                const { managementNo: mn } = parseEtc(fi?.etc);
                return (
                  <Badge key={p.id} variant="secondary" className="text-xs">
                    {mn || p.num || `#${p.id}`}
                  </Badge>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 text-sm text-muted-foreground">
                <PackageCheck className="h-4 w-4 inline mr-1.5 text-green-600" />
                {checkedPurchases.length}件選択中
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCheckedPurchaseIds(new Set())}
              >
                選択解除
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBulkTrackingForm({
                    trackingNumber: "",
                    shipDate: new Date().toLocaleDateString("sv-SE"),
                    carrier: "auto",
                  });
                  setShowBulkTrackingDialog(true);
                }}
                disabled={bulkProcessing}
                className="border-blue-500 text-blue-600 hover:bg-blue-50"
              >
                <Truck className="h-4 w-4 mr-1.5" />
                追跡番号を一括登録
              </Button>
              <Button
                onClick={() => setShowBulkConfirm(true)}
                disabled={bulkProcessing}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {bulkProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <PackageCheck className="h-4 w-4 mr-1.5" />
                )}
                まとめて入庫
                <Badge className="ml-1.5 bg-white/20 text-white text-xs">
                  {checkedPurchases.length}
                </Badge>
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
