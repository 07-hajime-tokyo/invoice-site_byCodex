import { ExternalLink } from "lucide-react";

/** 出庫詳細パネル（サーバーから取得済みの仕入情報を直接受取る） */
export function DeliveryDetailPanel({ deliveryNo, deliveredAt, unitPrice, trackingNumber, supplierUrl, supplierName }: {
  deliveryNo: string; deliveredAt: string; unitPrice: string; trackingNumber: string; supplierUrl: string; supplierName: string;
}) {
  return (
    <div className="px-4 py-2.5 bg-orange-50/30 border-t border-orange-100 text-sm space-y-1.5">
      {trackingNumber && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">追跡番号</span>
          <span className="font-mono text-right">{trackingNumber}</span>
        </div>
      )}
      {supplierName && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">仕入先</span>
          {supplierUrl ? (
            <a href={supplierUrl} target="_blank" rel="noopener noreferrer" className="text-right text-primary hover:underline flex items-center gap-1">
              <ExternalLink className="h-3 w-3 flex-shrink-0" />{supplierName}
            </a>
          ) : (
            <span className="text-right">{supplierName}</span>
          )}
        </div>
      )}
      {unitPrice !== "" && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
          <span className="font-semibold text-right">¥{Number(unitPrice).toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
