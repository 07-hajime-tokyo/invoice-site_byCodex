import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { getReceiptAckLabel, normalizeReceiptAckStatus, receiptAckTitle } from "./receiptAck";
import type { PurchaseHistoryItem } from "./types";

type ReceiptAckCellProps = {
  history: PurchaseHistoryItem;
  isUpdating: boolean;
  onMarkDone: (history: PurchaseHistoryItem) => void;
};

export function ReceiptAckCell({ history, isUpdating, onMarkDone }: ReceiptAckCellProps) {
  const status = normalizeReceiptAckStatus(history.receiptAckStatus);
  const label = getReceiptAckLabel(history);

  if (!status) {
    return <span className="text-muted-foreground">—</span>;
  }

  if (status === "pending") {
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">未</Badge>
        <Button
          size="sm"
          variant="outline"
          disabled={isUpdating || history.cancelled !== 0 || !history.receiptAckPurchaseId}
          onClick={() => onMarkDone(history)}
          className="h-7 px-2 text-xs"
        >
          {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          済にする
        </Button>
      </div>
    );
  }

  if (status === "done") {
    return (
      <Badge variant={history.receiptAckSource === "manual" ? "outline" : "default"} className={history.receiptAckSource === "manual" ? "text-xs" : "bg-green-600 text-xs"}>
        {label}
      </Badge>
    );
  }

  if (status === "not_required") {
    return <Badge variant="secondary" className="text-xs" title={receiptAckTitle(history)}>対象外</Badge>;
  }

  if (status === "unavailable") {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700" title={receiptAckTitle(history)}>
        確認不可
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-xs" title={receiptAckTitle(history)}>
      判定不可
    </Badge>
  );
}
