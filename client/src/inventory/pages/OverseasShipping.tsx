import { useState, useMemo, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Globe, Package, MessageSquare, Settings2, Eye, EyeOff, Plus, Pencil, Trash2,
  Mail, RefreshCw, Search, X, ChevronDown, ChevronRight, ExternalLink, Check, Reply, CheckCircle2, AlertCircle,
  Loader2, Send
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { normalizeProductName, isReturnProduct, toEnglishProductName, matchesCsvProductName } from "@/inventory/lib/productNameUtils";
import { InvoiceStockSection } from "@/inventory/components/InvoiceStockSection";
import { FedexShipmentDialog, HistoryItem } from "@/inventory/pages/DeliveryHistory";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import { suggestCsvProduct } from "@shared/productMatching";

// ============================================================
// 出庫履歴ごとのFedEx登録セクション
// ============================================================
function DeliveryHistoryFedexSection({ invoiceNo, partner }: { invoiceNo: string; partner: string }) {
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

// 取引先ポータルと同じ表示形式のコンポーネント
function PartnerView({
  shipments,
  csvData,
}: {
  shipments: FedexShipment[];
  csvData: Record<string, CsvInvoiceData>;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  // 追跡番号グループを構築（PartnerPortalと同じロジック）
  const shipmentGroups = useMemo(() => {
    type PartnerShipmentRow = {
      invoiceNo: string;
      productName: string;
      orderedQty: number;
      shippedQty: number;
      remainingQty: number | null;
      productOrder: number;
    };
    type PartnerShipmentGroup = {
      key: string;
      trackingNumber: string;
      shippingDate: string;
      rows: PartnerShipmentRow[];
      isComplete: boolean;
      invoiceNos: Set<string>;
      rowMap: Map<string, PartnerShipmentRow>;
    };

    const groups: PartnerShipmentGroup[] = [];
    const groupMap = new Map<string, PartnerShipmentGroup>();

    function setRemaining(row: PartnerShipmentRow) {
      row.remainingQty = row.orderedQty > 0 ? Math.max(0, row.orderedQty - row.shippedQty) : null;
    }

    function upsertRow(
      group: PartnerShipmentGroup,
      rowKey: string,
      invoiceNo: string,
      productName: string,
      orderedQty: number,
      shippedQty: number,
      productOrder: number,
    ) {
      const existing = group.rowMap.get(rowKey);
      if (existing) {
        existing.shippedQty += shippedQty;
        if (orderedQty > 0) existing.orderedQty = orderedQty;
        existing.productOrder = Math.min(existing.productOrder, productOrder);
        setRemaining(existing);
        return;
      }
      const row: PartnerShipmentRow = {
        invoiceNo,
        productName,
        orderedQty,
        shippedQty,
        remainingQty: null,
        productOrder,
      };
      setRemaining(row);
      group.rowMap.set(rowKey, row);
    }

    for (const s of shipments) {
      let items: ShipmentItem[] = [];
      try { items = JSON.parse(s.itemsJson); } catch { items = []; }
      const invoiceNo = s.deliveryNo.match(/^(\d+)/)?.[1] ?? s.deliveryNo;
      const products = csvData[invoiceNo]?.products ?? [];
      const groupKey = `${s.trackingNumber}_${s.shippingDate}`;
      if (!groupMap.has(groupKey)) {
        const g: PartnerShipmentGroup = {
          key: groupKey,
          trackingNumber: s.trackingNumber,
          shippingDate: s.shippingDate,
          rows: [],
          isComplete: false,
          invoiceNos: new Set<string>(),
          rowMap: new Map<string, PartnerShipmentRow>(),
        };
        groupMap.set(groupKey, g);
        groups.push(g);
      }
      const group = groupMap.get(groupKey)!;
      group.invoiceNos.add(invoiceNo);
      items.forEach((item, idx) => {
        const normalizedItem: ShipmentItem = isReturnProduct(item.productNameJa)
          ? { ...item, productNameJa: normalizeProductName(item.productNameJa), productNameEn: normalizeProductName(item.productNameEn) }
          : item;
        const matchedCsvProduct = findShipmentCsvProduct(products, {
          shipment: s,
          item: normalizedItem,
          itemIndex: idx,
        });
        const rawTitle = normalizedItem.productNameJa || normalizedItem.productNameEn || "";
        const productName = matchedCsvProduct?.name ?? cleanShipmentProductTitle(rawTitle);
        const productOrder = matchedCsvProduct?.index ?? products.length;
        const rowKey = matchedCsvProduct
          ? `${invoiceNo}:csv:${matchedCsvProduct.name}`
          : `${invoiceNo}:raw:${normalizeShipmentGroupKey(productName)}`;
        upsertRow(
          group,
          rowKey,
          invoiceNo,
          productName,
          matchedCsvProduct?.qty ?? 0,
          normalizedItem.quantity,
          productOrder,
        );
      });
    }

    for (const group of groups) {
      for (const invoiceNo of Array.from(group.invoiceNos)) {
        const products = csvData[invoiceNo]?.products ?? [];
        products.forEach((product, index) => {
          upsertRow(group, `${invoiceNo}:csv:${product.name}`, invoiceNo, product.name, product.qty, 0, index);
        });
      }
      group.rows = Array.from(group.rowMap.values()).sort((a, b) =>
        a.invoiceNo.localeCompare(b.invoiceNo, "ja") ||
        a.productOrder - b.productOrder ||
        a.productName.localeCompare(b.productName, "ja")
      );
      group.isComplete = group.rows.length > 0 && group.rows.every((row) => row.remainingQty !== null && row.remainingQty <= 0);
    }

    // 発送日の新しい順（M/D形式とYYYY-MM-DD形式の混在に対応）
    const parseDateStr = (s: string): number => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s).getTime();
      const parts = s.split("/");
      if (parts.length === 2) {
        const m = parseInt(parts[0], 10);
        const d = parseInt(parts[1], 10);
        if (!isNaN(m) && !isNaN(d)) return new Date(2026, m - 1, d).getTime();
      }
      return 0;
    };
    return groups.sort((a, b) => parseDateStr(b.shippingDate) - parseDateStr(a.shippingDate));
  }, [shipments, csvData]);

  // 発送数サマリー（残数計算用）
  const invoiceSummary = useMemo(() => {
    const summary: Record<string, { orderedQty: number; shippedQty: number }> = {};
    for (const [invoiceNo, data] of Object.entries(csvData)) {
      summary[invoiceNo] = { orderedQty: data.products.reduce((s, p) => s + p.qty, 0), shippedQty: 0 };
    }
    for (const s of shipments) {
      const invoiceNo = s.deliveryNo.match(/^(\d+)/)?.[1] ?? s.deliveryNo;
      let items: ShipmentItem[] = [];
      try { items = JSON.parse(s.itemsJson); } catch { items = []; }
      const shipped = items.reduce((sum, item) => sum + item.quantity, 0);
      if (!summary[invoiceNo]) summary[invoiceNo] = { orderedQty: 0, shippedQty: 0 };
      summary[invoiceNo].shippedQty += shipped;
    }
    return summary;
  }, [shipments, csvData]);

  // 初回ロード時に直近のグループのみ展開
  useEffect(() => {
    if (!initialized && shipmentGroups.length > 0) {
      setExpandedGroups(new Set([shipmentGroups[0].key]));
      setInitialized(true);
    }
  }, [shipmentGroups, initialized]);

  if (shipmentGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Package className="h-12 w-12 mb-3 opacity-30" />
        <p className="text-sm">発送記録がありません</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {shipmentGroups.map((group, groupIdx) => {
        const isExpanded = expandedGroups.has(group.key);
        const toggleGroup = () => {
          setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(group.key)) next.delete(group.key);
            else next.add(group.key);
            return next;
          });
        };
        return (
          <Card key={group.key} className={group.isComplete ? "opacity-70" : ""}>
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg"
              onClick={toggleGroup}
            >
              <div className="text-muted-foreground flex-shrink-0">
                {isExpanded
                  ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                  : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                }
              </div>
              <span className="text-sm font-medium text-muted-foreground flex-shrink-0">Tracking:</span>
              <span className="font-mono font-semibold text-sm">{group.trackingNumber}</span>
              <span className="text-sm text-muted-foreground">·</span>
              <span className="text-sm text-muted-foreground flex-shrink-0">{group.shippingDate}</span>
              {groupIdx === 0 && (
                <Badge className="bg-sky-500/10 text-sky-600 border-sky-200 text-xs flex-shrink-0">Latest</Badge>
              )}
              {group.isComplete && (
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200 text-xs flex-shrink-0">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Complete
                </Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground flex-shrink-0">{group.rows.length} item{group.rows.length !== 1 ? "s" : ""}</span>
            </div>
            {isExpanded && (
              <CardContent className="px-4 pb-4 border-t">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs border-b">
                      <th className="text-left py-1.5 font-medium">Invoice</th>
                      <th className="text-left py-1.5 font-medium">Product</th>
                      <th className="text-right py-1.5 font-medium">Ordered</th>
                      <th className="text-right py-1.5 font-medium">Shipped</th>
                      <th className="text-right py-1.5 font-medium">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row, i) => {
                      return (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          <td className="py-2 text-muted-foreground text-xs">No.{row.invoiceNo}</td>
                          <td className="py-2"><div className="font-medium">{row.productName}</div></td>
                          <td className="py-2 text-right text-muted-foreground">{row.orderedQty > 0 ? row.orderedQty : "-"}</td>
                          <td className="py-2 text-right font-semibold">{row.shippedQty}</td>
                          <td className="py-2 text-right">
                            {row.remainingQty !== null && row.remainingQty > 0 ? (
                              <span className="text-amber-600 font-medium">{row.remainingQty}</span>
                            ) : row.remainingQty === 0 ? (
                              <span className="text-emerald-600 font-medium">0</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// 型定義
type FedexShipment = {
  id: number;
  deliveryNo: string;
  sheetName: string;
  shippingDate: string;
  trackingNumber: string;
  itemsJson: string;
  spreadsheetStatus: string;
  operatorName: string | null;
  createdAt: Date;
};
type ShipmentItem = {
  productNameJa: string;
  productNameEn: string;
  quantity: number;
  invoiceNo?: string;
  managementNo?: string | null;
};
type CsvInvoiceData = {
  partner: string;
  paymentDate: string;
  products: Array<{ name: string; qty: number }>;
  isComplete?: boolean;
};
type PartnerPortal = {
  id: number;
  partnerCode: string;
  partnerName: string;
  sheetName: string;
  password: string;
  isActive: number;
};
type PartnerMessage = {
  id: number;
  partnerCode: string;
  partnerName: string;
  fedexShipmentId: number | null;
  message: string;
  isRead: number;
  replyText: string | null;
  repliedAt: Date | null;
  isDeleted: number;
  createdAt: Date;
};

// インボイスNoをdeliveryNoから抽出
function extractInvoiceNo(deliveryNo: string): string {
  const match = deliveryNo.match(/^(\d+)/);
  return match ? match[1] : deliveryNo;
}

// 取引先ラベルを返す
function partnerLabel(sheetName: string): string {
  if (sheetName === "独発送管理") return "Luca";
  if (sheetName === "サミー発送管理") return "Samee";
  return sheetName;
}

// インボイスエントリの型
type InvoiceEntry = {
  invoiceNo: string;
  partner: string;
  paymentDate: string;
  products: Array<{ name: string; qty: number }>;
  isComplete: boolean;
  totalOrderQty: number;
  shipments: Array<{
    shipment: FedexShipment;
    item: ShipmentItem;
    itemIndex: number;
  }>;
  totalShippedQty: number;
};

type AggregatedShipmentRow = {
  key: string;
  shippingDate: string;
  trackingNumber: string;
  productName: string;
  quantity: number;
  productOrder: number;
};

function normalizeShipmentGroupKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\u3000・･_\-ー,、]/g, "");
}

function cleanShipmentProductTitle(title: string): string {
  return title.replace(/\s*[\(\（][^\)\）]*[\)\）]\s*/g, "").trim() || title.trim();
}

function sameShipmentValue(values: string[], fallback: string): string {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (unique.length === 0) return "";
  return unique.length === 1 ? unique[0] : fallback;
}

function findShipmentCsvProduct(
  products: CsvInvoiceData["products"],
  row: InvoiceEntry["shipments"][number],
): { name: string; qty: number; index: number } | null {
  const itemTitle = row.item.productNameJa || row.item.productNameEn || "";
  const suggestion = suggestCsvProduct(
    itemTitle,
    row.item.managementNo ?? row.shipment.deliveryNo,
    products.map((product) => ({ name: product.name, qty: product.qty })),
  );
  if (!suggestion) return null;

  const index = products.findIndex((product) => product.name === suggestion.name);
  if (index < 0) return null;
  return { ...products[index], index };
}

function aggregateShipmentRowsByOrderLine(
  products: CsvInvoiceData["products"],
  rows: InvoiceEntry["shipments"],
): AggregatedShipmentRow[] {
  const groups = new Map<string, AggregatedShipmentRow & { dates: string[]; trackingNumbers: string[] }>();

  for (const row of rows) {
    const rawTitle = row.item.productNameJa || row.item.productNameEn || "";
    const linkedProduct = findShipmentCsvProduct(products, row);
    const productName = linkedProduct?.name ?? cleanShipmentProductTitle(rawTitle);
    const key = normalizeShipmentGroupKey(productName);
    const existing = groups.get(key);

    if (existing) {
      existing.quantity += row.item.quantity;
      existing.dates.push(row.shipment.shippingDate);
      existing.trackingNumbers.push(row.shipment.trackingNumber);
    } else {
      groups.set(key, {
        key,
        shippingDate: row.shipment.shippingDate,
        trackingNumber: row.shipment.trackingNumber,
        productName,
        quantity: row.item.quantity,
        productOrder: linkedProduct?.index ?? products.length,
        dates: [row.shipment.shippingDate],
        trackingNumbers: [row.shipment.trackingNumber],
      });
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      key: group.key,
      shippingDate: sameShipmentValue(group.dates, "複数日"),
      trackingNumber: sameShipmentValue(group.trackingNumbers, "複数"),
      productName: group.productName,
      quantity: group.quantity,
      productOrder: group.productOrder,
    }))
    .sort((a, b) => a.productOrder - b.productOrder || a.productName.localeCompare(b.productName, "ja"));
}

export default function OverseasShipping() {
  const [, setLocation] = useLocation();
  const [showComplete, setShowComplete] = useState(false);
  const [activeTab, setActiveTab] = useState("shipments");
  const [partnerTab, setPartnerTab] = useState<"all" | "luca" | "samee">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPartners, setSelectedPartners] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // データ取得
  const { data: adminData, isLoading, refetch } = trpc.inventory.partner.getAdminShipments.useQuery();
  const { data: portals, refetch: refetchPortals } = trpc.inventory.partner.listPortals.useQuery();
  const { data: messages, refetch: refetchMessages } = trpc.inventory.partner.listMessages.useQuery();
  // 未完了在庫タブ用データ
  const { data: allInventories } = trpc.inventory.zaico.getInventories.useQuery();
  const { data: csvRows } = trpc.inventory.orderManagement.getCsvData.useQuery();
  const { data: incompleteInvoices } = trpc.inventory.orderManagement.getIncompleteInvoices.useQuery();
  const utils = trpc.useUtils();
  // 取引先管理
  const createPortalMutation = trpc.inventory.partner.createPortal.useMutation({
    onSuccess: () => { toast.success("取引先を追加しました"); refetchPortals(); setNewPortalOpen(false); },
    onError: (e) => toast.error(e.message),
  });
  const updatePortalMutation = trpc.inventory.partner.updatePortal.useMutation({
    onSuccess: () => { toast.success("更新しました"); refetchPortals(); setEditPortalOpen(false); },
    onError: (e) => toast.error(e.message),
  });
  const deletePortalMutation = trpc.inventory.partner.deletePortal.useMutation({
    onSuccess: () => { toast.success("削除しました"); refetchPortals(); },
    onError: (e) => toast.error(e.message),
  });
  const markReadMutation = trpc.inventory.partner.markMessageRead.useMutation({
    onSuccess: () => refetchMessages(),
  });
  const deleteMessageMutation = trpc.inventory.partner.deleteMessage.useMutation({
    onSuccess: () => { toast.success("削除しました"); refetchMessages(); },
    onError: (e) => toast.error(e.message),
  });
  const replyMessageMutation = trpc.inventory.partner.replyMessage.useMutation({
    onSuccess: () => { toast.success("返信しました"); refetchMessages(); setReplyingId(null); setReplyText(""); },
    onError: (e) => toast.error(e.message),
  });

  // 返信状態
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  // メッセージ検索
  const [adminMessageSearch, setAdminMessageSearch] = useState("");
  // メッセージ内容表示/非表示
  const [adminCollapsedMessages, setAdminCollapsedMessages] = useState<Set<number>>(new Set());
  // スレッド返信入力
  const [adminThreadReplyTexts, setAdminThreadReplyTexts] = useState<Record<number, string>>({});
  const [adminReplyingThreadId, setAdminReplyingThreadId] = useState<number | null>(null);
  // スレッド取得
  const adminMessageIds = useMemo(() => (messages as PartnerMessage[] ?? []).map(m => m.id), [messages]);
  const { data: adminThreads, refetch: refetchAdminThreads } = trpc.inventory.partner.getThreads.useQuery(
    { parentMessageIds: adminMessageIds },
    { enabled: adminMessageIds.length > 0, retry: false }
  );
  const addAdminThreadReplyMutation = trpc.inventory.partner.addAdminThreadReply.useMutation({
    onSuccess: () => {
      toast.success("返信しました");
      setAdminReplyingThreadId(null);
      setAdminThreadReplyTexts({});
      refetchMessages();
      refetchAdminThreads();
    },
    onError: (e) => toast.error(e.message),
  });
  const markThreadReadByAdminMutation = trpc.inventory.partner.markThreadReadByAdmin.useMutation();

  // 手動発送登録状態
  const [manualForm, setManualForm] = useState({
    invoiceNo: "",
    sheetName: "独発送管理",
    shippingDate: "",
    trackingNumber: "",
    items: [{ productNameJa: "", productNameEn: "", quantity: 1 }] as Array<{ productNameJa: string; productNameEn: string; quantity: number }>,
  });
  const addManualShipmentMutation = trpc.inventory.partner.addManualShipment.useMutation({
    onSuccess: () => {
      toast.success("発送データを登録しました");
      refetch();
      setManualForm({ invoiceNo: "", sheetName: "独発送管理", shippingDate: "", trackingNumber: "", items: [{ productNameJa: "", productNameEn: "", quantity: 1 }] });
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteManualShipmentMutation = trpc.inventory.partner.deleteManualShipment.useMutation({
    onSuccess: () => { toast.success("削除しました"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  // ダイアログ状態
  const [newPortalOpen, setNewPortalOpen] = useState(false);
  const [editPortalOpen, setEditPortalOpen] = useState(false);
  const [editingPortal, setEditingPortal] = useState<PartnerPortal | null>(null);
  const [newPortalForm, setNewPortalForm] = useState({ partnerCode: "", partnerName: "", sheetName: "", password: "" });
  const [editPortalForm, setEditPortalForm] = useState({ partnerName: "", sheetName: "", password: "" });

  // 発送データの整理
  const shipments = adminData?.shipments ?? [];
  const csvData = (adminData?.csvData ?? {}) as Record<string, CsvInvoiceData>;

  // CSVインボイスを主体として、発送記録を紐づけたエントリを構築
  const invoiceEntries = useMemo((): InvoiceEntry[] => {
    // fedexShipmentsをインボイスNoでインデックス化
    // 返品商品は正規化して通常商品に統合する
    const shipmentsByInvoice = new Map<string, Array<{ shipment: FedexShipment; item: ShipmentItem; itemIndex: number }>>();
    for (const s of shipments) {
      const invNo = extractInvoiceNo(s.deliveryNo);
      let items: ShipmentItem[] = [];
      try { items = JSON.parse(s.itemsJson); } catch { items = []; }
      if (!shipmentsByInvoice.has(invNo)) shipmentsByInvoice.set(invNo, []);
      items.forEach((item, idx) => {
        // 返品商品は商品名から「返品」を除去して通常商品として扱う
        const normalizedItem: ShipmentItem = isReturnProduct(item.productNameJa)
          ? { ...item, productNameJa: normalizeProductName(item.productNameJa), productNameEn: normalizeProductName(item.productNameEn) }
          : item;
        shipmentsByInvoice.get(invNo)!.push({ shipment: s, item: normalizedItem, itemIndex: idx });
      });
    }

    // CSVのインボイスを主体として構築
    const entries: InvoiceEntry[] = [];
    for (const [invoiceNo, data] of Object.entries(csvData)) {
      const invShipments = shipmentsByInvoice.get(invoiceNo) ?? [];
      const totalOrderQty = data.products.reduce((sum, p) => sum + p.qty, 0);
      const totalShippedQty = invShipments.reduce((sum, r) => sum + r.item.quantity, 0);
      const invoiceNumber = Number.parseInt(invoiceNo, 10);
      const isLegacyComplete = Number.isFinite(invoiceNumber) && invoiceNumber <= 383;
      // 100%発送済みの場合は自動的に完了扱い
      const isComplete = isLegacyComplete || (totalOrderQty > 0 && totalShippedQty >= totalOrderQty);
      entries.push({
        invoiceNo,
        partner: data.partner,
        paymentDate: data.paymentDate,
        products: data.products,
        isComplete,
        totalOrderQty,
        shipments: invShipments,
        totalShippedQty,
      });
    }

    // インボイスNo降順でソート
    entries.sort((a, b) => parseInt(b.invoiceNo) - parseInt(a.invoiceNo));
    return entries;
  }, [shipments, csvData]);

  // 取引先一覧
  const partners = useMemo(() => {
    const set = new Set<string>();
    for (const e of invoiceEntries) {
      if (e.partner) set.add(e.partner);
    }
    return Array.from(set).sort();
  }, [invoiceEntries]);

  // ルカ/サミー判定ヘルパー
  const isLucaPartner = (partner: string) => {
    const p = partner.toLowerCase();
    return p.includes("ルカ") || p.includes("luca");
  };
  const isSameePartner = (partner: string) => {
    const p = partner.toLowerCase();
    return p.includes("サミ") || p.includes("samm") || p.includes("same");
  };

  // フィルタリング
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return invoiceEntries.filter(entry => {
      if (!showComplete && entry.isComplete) return false;
      if (selectedPartners.size > 0 && !selectedPartners.has(entry.partner)) return false;
      // ルカ/サミータブフィルター
      if (partnerTab === "luca" && !isLucaPartner(entry.partner)) return false;
      if (partnerTab === "samee" && !isSameePartner(entry.partner)) return false;
      if (!q) return true;
      if (entry.invoiceNo.includes(q)) return true;
      if (entry.partner.toLowerCase().includes(q)) return true;
      if (entry.products.some(p => p.name.toLowerCase().includes(q))) return true;
      if (entry.shipments.some(r =>
        r.item.productNameJa?.toLowerCase().includes(q) ||
        r.shipment.trackingNumber.includes(q)
      )) return true;
      return false;
    });
  }, [invoiceEntries, showComplete, selectedPartners, searchQuery, partnerTab]);

  function toggleExpand(key: string) {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function togglePartner(p: string) {
    setSelectedPartners(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  const unreadCount = messages?.filter((m: PartnerMessage) => m.isRead === 0).length ?? 0;

  // 未完了インボイスに該当する在庫グループ（在庫数≥1）
  const pendingStockGroups = useMemo(() => {
    if (!incompleteInvoices || !csvRows || !allInventories) return [];
    // インボイスNoごとに在庫を照合
    const groups: Array<{
      invoiceNo: string;
      partner: string;
      csvProducts: Array<{ productName: string; orderQty: number; sellingPrice: number | null; currency: string }>;
      matchedInventories: Array<{ id: number; title: string; quantity: string; etc: string | null; unit_price: number | null; purchase_unit_price?: number | null; supplierUrl?: string | null; supplierName?: string | null; trackingNumber?: string | null; matchedCsvProduct: string }>;
    }> = [];
    for (const invoice of incompleteInvoices) {
      // このインボイスのCsv商品一覧
      const invoiceCsvRows = csvRows.filter((r) => r.invoiceNo === invoice.invoiceNo);
      if (invoiceCsvRows.length === 0) continue;
      const csvProducts = invoiceCsvRows.map((r) => ({
        productName: r.productName,
        orderQty: r.orderQty,
        sellingPrice: r.sellingPrice,
        currency: r.currency,
      }));
      // 在庫から各CSV商品に該当するものを検索（在庫数≥1）
      const matchedInventories: Array<{ id: number; title: string; quantity: string; etc: string | null; unit_price: number | null; purchase_unit_price?: number | null; supplierUrl?: string | null; supplierName?: string | null; trackingNumber?: string | null; matchedCsvProduct: string }> = [];
      const addedIds = new Set<number>();
      for (const csvProd of invoiceCsvRows) {
        if (!csvProd.productName) continue;
        for (const inv of allInventories) {
          if (addedIds.has(inv.id)) continue;
          const qty = parseFloat(inv.quantity ?? "0");
          if (qty <= 0) continue;
          if (matchesCsvProductName(inv.title, csvProd.productName)) {
            matchedInventories.push({
              id: inv.id,
              title: inv.title,
              quantity: inv.quantity ?? "0",
              etc: inv.etc ?? null,
              unit_price: inv.unit_price ?? null,
              purchase_unit_price: (inv as Record<string, unknown>).purchase_unit_price as number | null ?? null,
              supplierUrl: (inv as Record<string, unknown>).supplierUrl as string | null ?? null,
              supplierName: (inv as Record<string, unknown>).supplierName as string | null ?? null,
              trackingNumber: (inv as Record<string, unknown>).trackingNumber as string | null ?? null,
              matchedCsvProduct: csvProd.productName,
            });
            addedIds.add(inv.id);
          }
        }
      }
      if (matchedInventories.length > 0) {
        groups.push({ invoiceNo: invoice.invoiceNo, partner: invoice.partner, csvProducts, matchedInventories });
      }
    }
    return groups;
  }, [incompleteInvoices, csvRows, allInventories]);

  // 現在のサイトのオリジン（取引先ポータルURL用）
  const siteOrigin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="rounded-xl border bg-card shadow-sm px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-sky-500" />
              <div>
                <h1 className="text-xl font-bold text-foreground">海外発送</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  インボイスNo別 発注数・発送数 ({filtered.length} 件)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={!showComplete ? "default" : "outline"}
                size="sm"
                onClick={() => setShowComplete(v => !v)}
                className="text-xs"
              >
                {!showComplete ? "未完了のみ" : "全件表示"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                更新
              </Button>
            </div>
          </div>

          <TabsList className="h-8">
            <TabsTrigger value="shipments" className="text-xs flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" />
              発送一覧
            </TabsTrigger>
            <TabsTrigger value="messages" className="text-xs flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              メッセージ
              {unreadCount > 0 && (
                <Badge variant="destructive" className="ml-0.5 h-4 min-w-4 text-xs px-1">{unreadCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="partners" className="text-xs flex items-center gap-1.5">
              <Settings2 className="h-3.5 w-3.5" />
              取引先管理
            </TabsTrigger>
            <TabsTrigger value="manual" className="text-xs flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              手動追加
            </TabsTrigger>

          </TabsList>
        </div>

        {/* 発送一覧タブ */}
        <TabsContent value="shipments" className="mt-3 space-y-3">
          {/* ルカ/サミーサブタブ */}
          <div className="flex gap-1 bg-muted/50 rounded-lg p-1 w-fit">
            {(["all", "luca", "samee"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setPartnerTab(tab)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  partnerTab === tab
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "all" ? "すべて" : tab === "luca" ? "Luca" : "Samee"}
              </button>
            ))}
          </div>

          {/* 検索バー */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="インボイスNo・取引先・商品名・追跡番号で検索..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* 取引先フィルター */}
          {partners.length > 1 && (
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={() => setSelectedPartners(new Set())}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selectedPartners.size === 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                すべて
              </button>
              {partners.map(p => (
                <button
                  key={p}
                  onClick={() => togglePartner(p)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    selectedPartners.has(p)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {selectedPartners.has(p) && <Check className="h-3 w-3" />}
                  {p}
                </button>
              ))}
              {selectedPartners.size > 0 && (
                <button onClick={() => setSelectedPartners(new Set())} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-1">
                  <X className="h-3.5 w-3.5" />選択解除
                </button>
              )}
            </div>
          )}

          {/* Luca/Sameeタブは取引先ポータルと同じ表示 */}
          {partnerTab !== "all" ? (
            isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                データを読み込み中...
              </div>
            ) : (
              <PartnerView
                shipments={shipments.filter(s =>
                  partnerTab === "luca"
                    ? s.sheetName === "独発送管理"
                    : s.sheetName === "サミー発送管理"
                )}
                csvData={csvData}
              />
            )
          ) : isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              データを読み込み中...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Package className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">
                {searchQuery ? "検索条件に一致するデータがありません" : showComplete ? "発送記録がありません" : "未完了の発送記録がありません"}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(entry => {
                const isExpanded = expandedKeys.has(entry.invoiceNo);
                const pct = entry.totalOrderQty > 0
                  ? Math.min(100, Math.round((entry.totalShippedQty / entry.totalOrderQty) * 100))
                  : 0;
                const remaining = Math.max(0, entry.totalOrderQty - entry.totalShippedQty);

                // インボイスヘッダーに表示する商品名（発注商品の名前を短縮表示）
                const productSummary = entry.products.length > 0
                  ? entry.products.map(p => p.name).join(", ")
                  : "";
                const aggregatedShipmentRows = aggregateShipmentRowsByOrderLine(entry.products, entry.shipments);

                return (
                  <div key={entry.invoiceNo} className={`rounded-lg border bg-card shadow-sm overflow-hidden ${entry.isComplete ? "opacity-60" : ""}`}>
                    {/* ヘッダー行（クリックで展開） */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => toggleExpand(entry.invoiceNo)}
                    >
                      <div className="text-muted-foreground flex-shrink-0">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </div>

                      {/* インボイスNo（クリックで出庫履歴タブへジャンプ） */}
                      <div
                        className="font-mono font-semibold text-sm w-16 flex-shrink-0 text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); setLocation(`/inventory/history?group=${entry.invoiceNo}`); }}
                        title="出庫履歴で該当インボイスを表示"
                      >
                        No.{entry.invoiceNo}
                      </div>

                      {/* 取引先 */}
                      <Badge variant="outline" className="text-xs flex-shrink-0">
                        {entry.partner}
                      </Badge>

                      {/* 商品名（取引先バッジの隣に表示） */}
                      {productSummary && (
                        <span className="text-xs text-muted-foreground truncate hidden sm:block max-w-[200px]">
                          {productSummary}
                        </span>
                      )}

                      {/* 完了バッジ */}
                      {entry.isComplete && (
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200 text-xs flex-shrink-0">Complete</Badge>
                      )}

                      {/* 発送状況 */}
                      <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                        {entry.totalShippedQty > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">{entry.totalShippedQty}</span>
                            {entry.totalOrderQty > 0 && <span>/{entry.totalOrderQty}台</span>}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">未発送</span>
                        )}
                        {remaining > 0 && entry.totalShippedQty > 0 && (
                          <Badge variant="secondary" className="text-xs">残{remaining}台</Badge>
                        )}
                      </div>

                      {/* 進捗バー */}
                      {entry.totalOrderQty > 0 && (
                        <div className="w-20 flex-shrink-0">
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-green-500" : pct >= 50 ? "bg-blue-500" : "bg-amber-500"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="text-right text-xs text-muted-foreground mt-0.5">{pct}%</div>
                        </div>
                      )}
                    </div>

                    {/* 展開時の詳細 */}
                    {isExpanded && (
                      <div className="border-t bg-muted/10">
                        {/* 発注商品一覧 */}
                        {entry.products.length > 0 && (
                          <div className="px-4 py-3">
                            <div className="text-xs font-medium text-muted-foreground mb-2">取引データ発注商品</div>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-muted-foreground text-xs border-b">
                                  <th className="text-left py-1 font-medium">商品名</th>
                                  <th className="text-right py-1 font-medium">発注数</th>
                                </tr>
                              </thead>
                              <tbody>
                                {entry.products.map((p, i) => (
                                  <tr key={i} className="border-b border-border/40 last:border-0">
                                    <td className="py-1.5 text-sm">{p.name}</td>
                                    <td className="py-1.5 text-right text-sm">{p.qty}台</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* 発送記録 */}
                        {entry.shipments.length > 0 ? (
                          <div className="px-4 py-3 border-t border-border/40">
                            <div className="text-xs font-medium text-muted-foreground mb-2">発送記録</div>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-muted-foreground text-xs border-b">
                                  <th className="text-left py-1 font-medium">発送日</th>
                                  <th className="text-left py-1 font-medium">追跡番号</th>
                                  <th className="text-left py-1 font-medium">商品名</th>
                                  <th className="text-right py-1 font-medium">発送数</th>
                                </tr>
                              </thead>
                              <tbody>
                                {aggregatedShipmentRows.map((row) => (
                                  <tr key={row.key} className="border-b border-border/40 last:border-0">
                                    <td className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">{row.shippingDate}</td>
                                    <td className="py-1.5 font-mono text-xs">{row.trackingNumber}</td>
                                    <td className="py-1.5 text-sm">{row.productName}</td>
                                    <td className="py-1.5 text-right font-medium">{row.quantity}台</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="px-4 py-3 border-t border-border/40 text-xs text-muted-foreground">
                            発送記録なし
                          </div>
                        )}
                        {/* 未完了インボイスの在庫一覧（照合在庫が1件以上ある場合のみ表示） */}
                        {!entry.isComplete && (() => {
                          const stockGroup = pendingStockGroups.find((g) => g.invoiceNo === entry.invoiceNo);
                          if (!stockGroup || stockGroup.matchedInventories.length === 0) return null;
                          return (
                            <InvoiceStockSection
                              invoiceNo={entry.invoiceNo}
                              partner={entry.partner}
                              csvProducts={stockGroup.csvProducts.map((p) => ({
                                productName: p.productName,
                                orderQty: p.orderQty,
                                sellingPrice: p.sellingPrice,
                                currency: p.currency,
                              }))}
                              matchedInventories={stockGroup.matchedInventories}
                              csvRows={(csvRows ?? []).map((r) => ({
                                invoiceNo: r.invoiceNo,
                                productName: r.productName,
                                sellingPrice: r.sellingPrice,
                                currency: r.currency,
                              }))}
                              onDeliverySuccess={() => { refetch(); utils.inventory.zaico.getInventories.invalidate(); utils.inventory.orderManagement.getIncompleteInvoices.invalidate(); }}
                            />
                          );
                        })()}
                        {/* 出庫履歴からFedEx登録（出庫Noごとに個別登録） */}
                        <DeliveryHistoryFedexSection invoiceNo={entry.invoiceNo} partner={entry.partner} />
                      </div>
                    )}
                  </div>
                );
              })}

            </div>
          )}
        </TabsContent>

        {/* メッセージタブ */}
        <TabsContent value="messages" className="mt-3 space-y-3">
          {/* 検索バー */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="メッセージを検索..."
              value={adminMessageSearch}
              onChange={e => setAdminMessageSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {!messages || (messages as PartnerMessage[]).filter(m => !m.isDeleted).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">メッセージはありません</div>
          ) : (
            (messages as PartnerMessage[])
              .filter(m => !m.isDeleted)
              .filter(m => {
                if (!adminMessageSearch.trim()) return true;
                const q = adminMessageSearch.toLowerCase();
                return (
                  m.message.toLowerCase().includes(q) ||
                  m.partnerName.toLowerCase().includes(q) ||
                  (m.replyText ?? "").toLowerCase().includes(q)
                );
              })
              .map(msg => {
                const isCollapsed = adminCollapsedMessages.has(msg.id);
                const msgThreads = (adminThreads ?? []).filter(t => t.parentMessageId === msg.id);
                const isReplyingThread = adminReplyingThreadId === msg.id;
                return (
                <Card key={msg.id} className={msg.isRead ? "opacity-70" : "border-sky-200"}>
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-sky-500" />
                            <span className="font-medium text-sm">{msg.partnerName}</span>
                            {!msg.isRead && <Badge className="bg-sky-500 text-white text-xs px-1.5">未読</Badge>}
                            {msg.replyText && <Badge className="bg-emerald-500 text-white text-xs px-1.5"><Reply className="h-3 w-3 mr-0.5 inline" />返信済</Badge>}
                            {msgThreads.length > 0 && <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-xs px-1.5">{msgThreads.length}件のスレッド</Badge>}
                            <span className="text-xs text-muted-foreground ml-auto">
                              {new Date(msg.createdAt).toLocaleString("ja-JP")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!msg.isRead && (
                            <Button variant="ghost" size="sm" onClick={() => markReadMutation.mutate({ id: msg.id })} className="text-xs">既読</Button>
                          )}
                          {/* 表示/非表示トグル */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            title={isCollapsed ? "内容を表示" : "内容を非表示"}
                            onClick={() => setAdminCollapsedMessages(prev => {
                              const next = new Set(prev);
                              if (next.has(msg.id)) next.delete(msg.id);
                              else next.add(msg.id);
                              return next;
                            })}
                          >
                            {isCollapsed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs flex items-center gap-1"
                            onClick={() => { setReplyingId(replyingId === msg.id ? null : msg.id); setReplyText(msg.replyText ?? ""); }}
                          >
                            <Reply className="h-3.5 w-3.5" />
                            返信
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteMessageMutation.mutate({ id: msg.id })}
                            disabled={deleteMessageMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      {/* メッセージ本文（非表示時は件名のみ） */}
                      {isCollapsed ? (
                        <p className="text-xs text-muted-foreground italic">内容を非表示中（アイコンで表示）</p>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                      )}
                      {/* 返信表示 */}
                      {!isCollapsed && msg.replyText && replyingId !== msg.id && (
                        <div className="ml-6 rounded bg-emerald-50 border border-emerald-200 p-2.5">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Reply className="h-3.5 w-3.5 text-emerald-600" />
                            <span className="text-xs font-medium text-emerald-700">返信済み</span>
                            {msg.repliedAt && <span className="text-xs text-muted-foreground ml-auto">{new Date(msg.repliedAt).toLocaleString("ja-JP")}</span>}
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{msg.replyText}</p>
                        </div>
                      )}
                      {/* スレッド返信一覧 */}
                      {!isCollapsed && msgThreads.length > 0 && (
                        <div className="space-y-2 ml-6">
                          {msgThreads.map(t => (
                            <div key={t.id} className={`rounded p-2.5 border ${
                              t.senderType === "admin"
                                ? "bg-emerald-50 border-emerald-200"
                                : "bg-sky-50 border-sky-200"
                            }`}>
                              <div className="flex items-center gap-1.5 mb-1">
                                <Reply className="h-3.5 w-3.5 text-sky-600" />
                                <span className="text-xs font-medium">
                                  {t.senderType === "admin" ? `管理者 (${t.senderName})` : `取引先 (${t.senderName})`}
                                </span>
                                <span className="ml-auto text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString("ja-JP")}</span>
                              </div>
                              <p className="text-sm whitespace-pre-wrap">{t.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* 返信フォーム（既存返信ボタン経由） */}
                      {!isCollapsed && replyingId === msg.id && (
                        <div className="ml-6 space-y-2">
                          <Textarea
                            value={replyText}
                            onChange={e => setReplyText(e.target.value)}
                            placeholder="返信内容を入力..."
                            rows={3}
                            className="text-sm"
                          />
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setReplyingId(null)}>キャンセル</Button>
                            <Button
                              size="sm"
                              disabled={!replyText.trim() || replyMessageMutation.isPending}
                              onClick={() => replyMessageMutation.mutate({ id: msg.id, replyText })}
                              className="flex items-center gap-1.5"
                            >
                              <Reply className="h-3.5 w-3.5" />
                              {replyMessageMutation.isPending ? "送信中..." : "返信する"}
                            </Button>
                          </div>
                        </div>
                      )}
                      {/* スレッド返信フォーム */}
                      {!isCollapsed && replyingId !== msg.id && (
                        <div className="ml-6">
                          {isReplyingThread ? (
                            <div className="space-y-2">
                              <Textarea
                                value={adminThreadReplyTexts[msg.id] ?? ""}
                                onChange={e => setAdminThreadReplyTexts(prev => ({ ...prev, [msg.id]: e.target.value }))}
                                placeholder="スレッド返信を入力..."
                                rows={3}
                                className="text-sm"
                              />
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="ghost" onClick={() => setAdminReplyingThreadId(null)}>キャンセル</Button>
                                <Button
                                  size="sm"
                                  disabled={!(adminThreadReplyTexts[msg.id] ?? "").trim() || addAdminThreadReplyMutation.isPending}
                                  onClick={() => {
                                    addAdminThreadReplyMutation.mutate({
                                      parentMessageId: msg.id,
                                      content: adminThreadReplyTexts[msg.id] ?? "",
                                    });
                                    markThreadReadByAdminMutation.mutate({ parentMessageId: msg.id });
                                  }}
                                  className="flex items-center gap-1.5"
                                >
                                  <Reply className="h-3.5 w-3.5" />
                                  {addAdminThreadReplyMutation.isPending ? "送信中..." : "スレッド返信"}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            msgThreads.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-sky-600 hover:text-sky-700 px-2"
                                onClick={() => {
                                  setAdminReplyingThreadId(msg.id);
                                  markThreadReadByAdminMutation.mutate({ parentMessageId: msg.id });
                                }}
                              >
                                <Reply className="h-3.5 w-3.5 mr-1" />
                                スレッドへ返信
                              </Button>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* 取引先管理タブ */}
        <TabsContent value="partners" className="mt-3 space-y-4">
          <div className="flex justify-end">
            <Dialog open={newPortalOpen} onOpenChange={setNewPortalOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  取引先を追加
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>取引先を追加</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-1.5">
                    <Label>取引先コード（URLスラグ）</Label>
                    <Input placeholder="例: luca" value={newPortalForm.partnerCode} onChange={e => setNewPortalForm(f => ({ ...f, partnerCode: e.target.value }))} />
                    <p className="text-xs text-muted-foreground">英小文字・数字のみ。ポータルURLに使用されます。</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>表示名（英語）</Label>
                    <Input placeholder="例: Luca" value={newPortalForm.partnerName} onChange={e => setNewPortalForm(f => ({ ...f, partnerName: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>スプシシート名</Label>
                    <Input placeholder="例: 独発送管理" value={newPortalForm.sheetName} onChange={e => setNewPortalForm(f => ({ ...f, sheetName: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>パスワード</Label>
                    <Input type="text" placeholder="取引先に共有するパスワード" value={newPortalForm.password} onChange={e => setNewPortalForm(f => ({ ...f, password: e.target.value }))} />
                  </div>
                  <Button
                    className="w-full"
                    disabled={!newPortalForm.partnerCode || !newPortalForm.partnerName || !newPortalForm.sheetName || !newPortalForm.password || createPortalMutation.isPending}
                    onClick={() => createPortalMutation.mutate(newPortalForm)}
                  >
                    追加する
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-3">
            {!portals || portals.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">取引先が登録されていません</div>
            ) : (
              (portals as PartnerPortal[]).map(portal => (
                <Card key={portal.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{portal.partnerName}</span>
                          <Badge variant="outline" className="text-xs font-mono">{portal.partnerCode}</Badge>
                          {portal.isActive ? (
                            <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200 text-xs">有効</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">無効</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div>シート: {portal.sheetName}</div>
                          <div>パスワード: <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{portal.password}</span></div>
                        </div>
                        {/* ポータルURL（クリックで開けるリンク） */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">ポータルURL:</span>
                          <a
                            href={`${siteOrigin}/inventory/partner/${portal.partnerCode}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-mono text-sky-600 hover:text-sky-700 hover:underline flex items-center gap-1"
                          >
                            {siteOrigin}/inventory/partner/{portal.partnerCode}
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </a>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditingPortal(portal);
                            setEditPortalForm({ partnerName: portal.partnerName, sheetName: portal.sheetName, password: portal.password });
                            setEditPortalOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`「${portal.partnerName}」を削除しますか？`)) {
                              deletePortalMutation.mutate({ id: portal.id });
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* 編集ダイアログ */}
          <Dialog open={editPortalOpen} onOpenChange={setEditPortalOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>取引先を編集: {editingPortal?.partnerName}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label>表示名（英語）</Label>
                  <Input value={editPortalForm.partnerName} onChange={e => setEditPortalForm(f => ({ ...f, partnerName: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>スプシシート名</Label>
                  <Input value={editPortalForm.sheetName} onChange={e => setEditPortalForm(f => ({ ...f, sheetName: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>パスワード</Label>
                  <Input type="text" value={editPortalForm.password} onChange={e => setEditPortalForm(f => ({ ...f, password: e.target.value }))} />
                </div>
                <Button
                  className="w-full"
                  disabled={!editPortalForm.partnerName || !editPortalForm.sheetName || !editPortalForm.password || updatePortalMutation.isPending}
                  onClick={() => {
                    if (editingPortal) updatePortalMutation.mutate({ id: editingPortal.id, ...editPortalForm });
                  }}
                >
                  更新する
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* 手動発送登録タブ */}
        <TabsContent value="manual" className="mt-3 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <h3 className="font-medium text-sm">発送データを手動登録</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">インボイスNo</Label>
                  <Input
                    placeholder="370"
                    value={manualForm.invoiceNo}
                    onChange={e => setManualForm(f => ({ ...f, invoiceNo: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">取引先</Label>
                  <select
                    className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
                    value={manualForm.sheetName}
                    onChange={e => setManualForm(f => ({ ...f, sheetName: e.target.value }))}
                  >
                    <option value="独発送管理">Luca（独発送管理）</option>
                    <option value="サミー発送管理">Samee（サミー発送管理）</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">発送日（例: 3/26）</Label>
                  <Input
                    placeholder="3/26"
                    value={manualForm.shippingDate}
                    onChange={e => setManualForm(f => ({ ...f, shippingDate: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">追跡番号</Label>
                  <Input
                    placeholder="870003994326"
                    value={manualForm.trackingNumber}
                    onChange={e => setManualForm(f => ({ ...f, trackingNumber: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">商品リスト</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setManualForm(f => ({ ...f, items: [...f.items, { productNameJa: "", productNameEn: "", quantity: 1 }] }))}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    商品を追加
                  </Button>
                </div>
                {manualForm.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_60px_32px] gap-2 items-center">
                    <Input
                      placeholder="商品名（日本語）"
                      value={item.productNameJa}
                      onChange={e => {
                        const ja = e.target.value;
                        const en = toEnglishProductName(ja);
                        setManualForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, productNameJa: ja, productNameEn: en || it.productNameEn } : it) }));
                      }}
                      className="h-8 text-sm"
                    />
                    <Input
                      placeholder="商品名（英語）"
                      value={item.productNameEn}
                      onChange={e => setManualForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, productNameEn: e.target.value } : it) }))}
                      className="h-8 text-sm"
                    />
                    <Input
                      type="number"
                      min={1}
                      placeholder="数量"
                      value={item.quantity}
                      onChange={e => setManualForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, quantity: parseInt(e.target.value) || 1 } : it) }))}
                      className="h-8 text-sm"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setManualForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}
                      disabled={manualForm.items.length <= 1}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!manualForm.invoiceNo || !manualForm.trackingNumber || !manualForm.shippingDate || addManualShipmentMutation.isPending}
                  onClick={() => addManualShipmentMutation.mutate({
                    invoiceNo: manualForm.invoiceNo,
                    sheetName: manualForm.sheetName,
                    shippingDate: manualForm.shippingDate,
                    trackingNumber: manualForm.trackingNumber,
                    items: manualForm.items.filter(it => it.productNameJa || it.productNameEn),
                    operatorName: getCurrentWorkWorkerName("野田"),
                  })}
                >
                  {addManualShipmentMutation.isPending ? "登録中..." : "発送データを登録"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 登録済み手動データ一覧 */}
          {adminData?.shipments.filter(s => (s as { isManual?: boolean }).isManual).length ? (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">登録済み手動データ</h4>
              {adminData.shipments.filter(s => (s as { isManual?: boolean }).isManual).map(s => (
                <Card key={s.id} className="border-amber-200">
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="text-sm space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">インボイス No.{s.deliveryNo}</span>
                        <Badge variant="outline" className="text-xs">{partnerLabel(s.sheetName)}</Badge>
                        <span className="text-muted-foreground text-xs">{s.shippingDate}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">追跡: {s.trackingNumber}</div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => deleteManualShipmentMutation.mutate({ id: (s as { manualId?: number }).manualId ?? -s.id })}
                      disabled={deleteManualShipmentMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
