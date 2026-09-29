import { getPurchaseTrackingInfo } from "./carrier";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  PackageCheck,
  Loader2,
  Truck,
  Trash2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { getCarrierColor } from "@/inventory/lib/tracking";
import {
  combineSupplierInfo,
  buildSupplierDisplay,
} from "@/inventory/lib/supplier";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EbayListingUrlEditor } from "@/inventory/components/EbayListingUrlEditor";
import { type Purchase } from "./types";
import { parseEtc, hasUnitPrice, formatUnitPrice } from "./format";
import { ItemLabelsBlock } from "./ItemLabelsBlock";

export interface PurchaseCardMobileProps {
  purchase: Purchase;
  managementNo: string;
  supplierSite: string;
  checked: boolean;
  onToggleCheck: () => void;
  onComplete: () => void;
  processing: boolean;
  deleting: Set<number>;
  onDeleteInventory: (
    inventoryId: number,
    title: string,
    purchaseId?: number
  ) => void;
  statusLabel: Record<string, string>;
  CARRIER_OPTIONS: { value: string; label: string }[];
  getStatusClass: (purchase: Purchase) => string;
  getEffectiveStatusLabel: (purchase: Purchase) => string;
}

export function PurchaseCardMobile({
  purchase,
  managementNo,
  supplierSite,
  checked,
  onToggleCheck,
  onComplete,
  processing,
  deleting,
  onDeleteInventory,
  statusLabel,
  CARRIER_OPTIONS,
  getStatusClass,
  getEffectiveStatusLabel,
}: PurchaseCardMobileProps) {
  const [showDetail, setShowDetail] = useState(false);
  const firstItem = purchase.purchase_items[0];

  const trackingInfo = useMemo(
    () => getPurchaseTrackingInfo(purchase, CARRIER_OPTIONS),
    [purchase.extra, CARRIER_OPTIONS]
  );

  return (
    <div
      className={`rounded-xl border bg-card shadow-sm overflow-hidden transition-all ${checked ? "border-primary ring-1 ring-primary/30" : ""}`}
    >
      {/* カードヘッダー */}
      <div className={`px-4 pt-4 pb-3 ${checked ? "bg-primary/5" : ""}`}>
        <div className="flex items-start gap-3">
          <Checkbox
            checked={checked}
            onCheckedChange={onToggleCheck}
            className="mt-0.5 flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-bold text-base text-foreground truncate">
                {managementNo || purchase.num || `#${purchase.id}`}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ${getStatusClass(purchase)}`}
              >
                {getEffectiveStatusLabel(purchase)}
              </span>
            </div>
            {(purchase.csvSupplierName ||
              purchase.csvSupplierUrl ||
              supplierSite ||
              purchase.customer_name) && (
              <p className="text-sm text-muted-foreground truncate">
                仕入先:{" "}
                {purchase.csvSupplierUrl ? (
                  <a
                    href={purchase.csvSupplierUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    🔗{" "}
                    {buildSupplierDisplay(
                      purchase.csvSupplierUrl,
                      purchase.csvSupplierName,
                      purchase.customer_name
                    )}
                  </a>
                ) : (
                  combineSupplierInfo(
                    supplierSite,
                    purchase.csvSupplierName,
                    purchase.customer_name
                  )
                )}
              </p>
            )}
          </div>
        </div>

        {/* 商品一覧（コンパクト） */}
        <div className="mt-3 space-y-2">
          {purchase.purchase_items.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between gap-2 bg-muted/30 rounded-lg px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {item.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <Badge variant="outline" className="text-xs py-0">
                    {item.category || "未分類"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {item.quantity} {item.unit}
                    {hasUnitPrice(item.unit_price)
                      ? ` · ${formatUnitPrice(item.unit_price)}`
                      : ""}
                  </span>
                  {item.estimated_purchase_date && (
                    <span className="text-xs text-muted-foreground">
                      予定: {item.estimated_purchase_date}
                    </span>
                  )}
                </div>
                <ItemLabelsBlock item={item} />
                <EbayListingUrlEditor
                  inventoryId={item.inventory_id}
                  managementNo={parseEtc(item.etc).managementNo}
                  value={item.ebayListingUrl}
                  compact
                  className="mt-1"
                />
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    disabled={deleting.has(item.inventory_id)}
                    className="text-muted-foreground/50 hover:text-destructive transition-colors p-1 flex-shrink-0"
                  >
                    {deleting.has(item.inventory_id) ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>商品を削除しますか？</AlertDialogTitle>
                    <AlertDialogDescription>
                      「{item.title}」を削除します。この操作は元に戻せません。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>キャンセル</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() =>
                        onDeleteInventory(
                          item.inventory_id,
                          item.title,
                          purchase.id
                        )
                      }
                    >
                      削除する
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>

        {/* 追跡番号（あれば表示） */}
        {purchase.extra?.trackingNumber && trackingInfo && (
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${getCarrierColor(trackingInfo.carrierKey as Parameters<typeof getCarrierColor>[0])}`}
            >
              {trackingInfo.carrierName}
            </span>
            <span className="text-foreground text-base font-bold truncate">
              {purchase.extra.trackingNumber}
            </span>
            {trackingInfo.isEcohai ? (
              <button
                type="button"
                onClick={() => {
                  const form = document.createElement("form");
                  form.method = "POST";
                  form.action =
                    "https://www.ecohai.co.jp/cargo_tracking/search";
                  form.target = "_blank";
                  const input = document.createElement("input");
                  input.type = "hidden";
                  input.name = "slip[]";
                  input.value = trackingInfo.num;
                  form.appendChild(input);
                  document.body.appendChild(form);
                  form.submit();
                  document.body.removeChild(form);
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                追跡
              </button>
            ) : trackingInfo.url ? (
              <a
                href={trackingInfo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                追跡
              </a>
            ) : null}
          </div>
        )}
      </div>

      {/* 入庫ボタン（スマホ用・大きく） */}
      <div className="px-4 pb-4">
        <Button
          className="w-full h-12 text-base font-bold bg-green-600 hover:bg-green-700 text-white rounded-xl shadow-sm active:scale-[0.98] transition-transform"
          onClick={onComplete}
          disabled={processing}
        >
          {processing ? (
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
          ) : (
            <PackageCheck className="h-5 w-5 mr-2" />
          )}
          入庫する
        </Button>
      </div>

      {/* 詳細情報（折りたたみ） */}
      <div className="border-t">
        <button
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/20 transition-colors"
          onClick={() => setShowDetail(v => !v)}
        >
          <span className="flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5" />
            発送情報
            {purchase.extra?.shipDate && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
            )}
          </span>
          {showDetail ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        {showDetail && (
          <div className="px-4 pb-3 space-y-1.5 text-sm bg-muted/10">
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16 flex-shrink-0">
                発送日:
              </span>
              <span>
                {purchase.extra?.shipDate ?? (
                  <span className="italic text-muted-foreground/60">
                    未設定
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
