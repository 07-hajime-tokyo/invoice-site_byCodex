import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { FedexShipmentDialog, HistoryItem } from "@/inventory/pages/DeliveryHistory";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";

// ============================================================
// 出庫履歴ごとのFedEx登録セクション
// ============================================================
export function DeliveryHistoryFedexSection({ invoiceNo, partner }: { invoiceNo: string; partner: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const { data: histories, isLoading } = trpc.inventory.deliveryHistory.listByInvoicePrefix.useQuery(
    { invoiceNo },
    { enabled: isOpen } // トグルが開いたときのみ取得
  );
  const { data: fedexShipmentsData, refetch: refetchFedex } = trpc.inventory.fedex.getAll.useQuery();
  const utils = trpc.useUtils();
  const [fedexDialog, setFedexDialog] = useState<{ deliveryNo: string; historyId: number; items: HistoryItem[] } | null>(null);

  const fedexShipmentsMap = useMemo(() => {
    const map = new Map<string, Array<{ id: number; sheetName: string; shippingDate: string; trackingNumber: string; spreadsheetStatus: string; itemsJson: string; historyId?: number | null }>>();
    if (!fedexShipmentsData) return map;
    for (const s of fedexShipmentsData as Array<{ id: number; deliveryNo: string; sheetName: string; shippingDate: string; trackingNumber: string; spreadsheetStatus: string; itemsJson: string; historyId?: number | null }>) {
      const key = s.deliveryNo;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ id: s.id, sheetName: s.sheetName, shippingDate: s.shippingDate, trackingNumber: s.trackingNumber, spreadsheetStatus: s.spreadsheetStatus, itemsJson: s.itemsJson, historyId: s.historyId });
    }
    return map;
  }, [fedexShipmentsData]);

  const createFedexMutation = trpc.inventory.fedex.create.useMutation({
    onSuccess: (data) => {
      refetchFedex();
      utils.inventory.partner.getAdminShipments.invalidate();
      if (data.success) {
        toast.success(data.message ?? "FedEx発送情報をスプシに登録しました");
      } else {
        toast.warning(data.message ?? "DBには保存しましたが、スプシへの書き込みに失敗しました");
      }
      setFedexDialog(null);
    },
    onError: (err) => {
      toast.error(`FedEx発送登録に失敗しました: ${err.message}`);
    },
  });

  // 出庫Noごとにグループ化
  const grouped = new Map<string, { historyId: number; items: HistoryItem[]; createdAt: Date }[]>();
  if (histories) {
    for (const h of histories) {
      const dn = h.deliveryNo;
      if (!grouped.has(dn)) grouped.set(dn, []);
      grouped.get(dn)!.push({ historyId: h.id, items: h.items, createdAt: new Date(h.createdAt) });
    }
  }
  const deliveryNos = Array.from(grouped.keys());

  return (
    <div className="border-t border-border/40">
      {/* トグルヘッダー */}
      <button
        className="w-full px-4 py-2.5 text-xs font-medium text-muted-foreground bg-muted/20 flex items-center gap-2 hover:bg-muted/40 transition-colors"
        onClick={() => setIsOpen((v) => !v)}
      >
        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Send className="h-3.5 w-3.5" />
        出庫履歴からFedEx登録
        {!isOpen && (
          <span className="ml-auto text-xs text-muted-foreground/60">クリックで展開</span>
        )}
      </button>
      {isOpen && (
        <>
      {isLoading && (
        <div className="px-4 py-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />出庫履歴を読み込み中...
        </div>
      )}
      {!isLoading && deliveryNos.length === 0 && (
        <div className="px-4 py-3 text-xs text-muted-foreground">出庫履歴なし</div>
      )}
      <div className="divide-y divide-border/30">
        {deliveryNos.map((dn) => {
          const entries = grouped.get(dn)!;
          const latestEntry = entries[0];
          const allItems = entries.flatMap(e => e.items);
          const existingShipments = fedexShipmentsMap.get(dn) ?? [];
          const hasShipment = existingShipments.length > 0;
          // 出庫日をdeliveryNoから抽出（例: 379_luca20260423 -> 2026/04/23）
          const dateMatch = dn.match(/(\d{4})(\d{2})(\d{2})$/);
          const dateLabel = dateMatch ? `${parseInt(dateMatch[2])}/${parseInt(dateMatch[3])}出庫` : dn;

          return (
            <div key={dn} className="px-4 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-semibold text-foreground">{dn}</span>
                  <Badge variant="outline" className="text-xs">{dateLabel}</Badge>
                  <span className="text-xs text-muted-foreground">{allItems.reduce((s, it) => s + it.quantity, 0)}台</span>
                  {hasShipment && (
                    <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">
                      FedEx登録済 {existingShipments.length}件
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {allItems.map(it => it.title).join(", ")}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="flex-shrink-0 h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                onClick={() => setFedexDialog({ deliveryNo: dn, historyId: latestEntry.historyId, items: allItems })}
              >
                <Send className="h-3 w-3 mr-1" />
                FedEx登録
              </Button>
            </div>
          );
        })}
      </div>

      {fedexDialog && (
        <FedexShipmentDialog
          open={!!fedexDialog}
          onClose={() => setFedexDialog(null)}
          groupKey={fedexDialog.deliveryNo}
          groupItems={fedexDialog.items}
          onSubmit={(data) => createFedexMutation.mutate({
            deliveryNo: fedexDialog.deliveryNo,
            sheetName: data.sheetName,
            shippingDate: data.shippingDate,
            trackingNumber: data.trackingNumber,
            items: data.items,
            historyId: fedexDialog.historyId,
            operatorName: getCurrentWorkWorkerName("野田"),
          })}
          isPending={createFedexMutation.isPending}
          existingShipments={fedexShipmentsMap.get(fedexDialog.deliveryNo) ?? []}
        />
      )}
        </>
      )}
    </div>
  );
}
