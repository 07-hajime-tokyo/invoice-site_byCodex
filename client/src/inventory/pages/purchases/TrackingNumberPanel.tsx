import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "lucide-react";
import { type Purchase } from "./types";
import { parseEtc } from "./format";
import { getPurchaseCarrierMeta } from "./carrier";

export function TrackingNumberPanel({
  purchases,
  isOpen,
  onToggle,
}: {
  purchases: Purchase[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const trackingRows = useMemo(() => {
    return purchases
      .map(purchase => {
        const trackingNumber = purchase.extra?.trackingNumber?.trim();
        if (!trackingNumber) return null;
        const firstItem = purchase.purchase_items[0];
        const { managementNo } = parseEtc(firstItem?.etc);
        const carrierMeta = getPurchaseCarrierMeta(purchase, trackingNumber);
        return {
          purchaseId: purchase.id,
          trackingNumber,
          managementNo: managementNo || purchase.num || `#${purchase.id}`,
          title: firstItem?.title ?? "-",
          itemCount: purchase.purchase_items.length,
          carrierMeta,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [purchases]);
  const missingTrackingCount = purchases.length - trackingRows.length;

  async function copyTrackingNumbers(
    numbers: string[],
    successMessage: string
  ) {
    if (numbers.length === 0) return;
    try {
      await navigator.clipboard.writeText(numbers.join("\n"));
      toast.success(successMessage);
    } catch {
      toast.error("追跡番号のコピーに失敗しました");
    }
  }

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-foreground">
            📦 追跡番号一覧（{trackingRows.length}件）
          </span>
          {missingTrackingCount > 0 && (
            <span className="hidden sm:inline text-xs text-muted-foreground">
              追跡番号なし: {missingTrackingCount}件
            </span>
          )}
        </span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="border-t bg-muted/10">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              追跡番号あり: {trackingRows.length}件
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={trackingRows.length === 0}
              onClick={() =>
                copyTrackingNumbers(
                  trackingRows.map(row => row.trackingNumber),
                  `${trackingRows.length}件の追跡番号をコピーしました`
                )
              }
              className="h-8"
            >
              まとめてコピー
            </Button>
          </div>
          {trackingRows.length > 0 ? (
            <div className="max-h-[360px] overflow-y-auto divide-y">
              {trackingRows.map(row => (
                <div
                  key={row.purchaseId}
                  className="px-4 py-3 space-y-2 sm:space-y-1.5"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${row.carrierMeta.colorClass}`}
                    >
                      {row.carrierMeta.carrierName}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyTrackingNumbers(
                          [row.trackingNumber],
                          "追跡番号をコピーしました"
                        )
                      }
                      className="font-mono text-lg font-bold text-foreground hover:text-primary transition-colors"
                    >
                      {row.trackingNumber}
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {row.managementNo} / {row.title}
                    {row.itemCount > 1 ? ` ほか${row.itemCount - 1}点` : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              追跡番号が登録された荷物はありません
            </div>
          )}
          {missingTrackingCount > 0 && (
            <div className="px-4 py-2 border-t text-xs text-muted-foreground">
              追跡番号なし: {missingTrackingCount}件
            </div>
          )}
        </div>
      )}
    </div>
  );
}
