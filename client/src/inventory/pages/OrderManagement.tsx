import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Search, X, ChevronDown, ChevronRight, Download, BarChart2, Package, Check, AlertTriangle, CheckCircle2, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { SummaryItem } from "./order-management/types";
import { exportOrderManagementCSV } from "./order-management/exportCsv";
import { progressColor, orderStockCoverage, isOrderStockShort, deliveryDateKey, deliveryDateLabel } from "./order-management/display";
import { aggregateDeliveryItems } from "./order-management/aggregateDeliveries";
import { buildColorSummary } from "./order-management/colorSummary";
import { InvoiceMemoField } from "./order-management/InvoiceMemoField";
import { PurchaseDetailPanel } from "./order-management/PurchaseDetailPanel";
import { InventoryDetailPanel } from "./order-management/InventoryDetailPanel";
import { DeliveryDetailPanel } from "./order-management/DeliveryDetailPanel";

export default function OrderManagement() {
  const [, setLocation] = useLocation();
  const { data: summary, isLoading, refetch } = trpc.inventory.orderManagement.getSummary.useQuery();
  const setManualComplete = trpc.inventory.invoiceMemo.setManualComplete.useMutation({
    onSuccess: () => refetch(),
  });
  const backfillDeliveryOrderLines = trpc.inventory.orderManagement.backfillDeliveryOrderLines.useMutation({
    onSuccess: (result) => {
      toast.success(`既存出庫履歴を再判定しました（更新 ${result.updatedItems}件）`);
      void refetch();
    },
    onError: (error) => {
      toast.error(`再判定に失敗しました: ${error.message}`);
    },
  });
  const utils = trpc.useUtils();
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    try { return localStorage.getItem("om_searchQuery") ?? ""; } catch { return ""; }
  });
  const [selectedPartners, setSelectedPartners] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("om_selectedPartners");
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed);
      }
    } catch {}
    return new Set<string>();
  });
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  // 商品詳細トグル状態: "type-invoiceKey-idx" -> boolean
  const [openDetailItems, setOpenDetailItems] = useState<Record<string, boolean>>({});
  function toggleDetailItem(key: string) {
    setOpenDetailItems((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  const [hideCompleted, setHideCompleted] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("om_hideCompleted");
      return v === null ? true : v === "true";
    } catch { return true; }
  });

  // フィルター変更時にlocalStorageに保存
  const handleSearchQuery = (v: string) => {
    setSearchQuery(v);
    try { localStorage.setItem("om_searchQuery", v); } catch {}
  };
  const handleTogglePartner = (v: string) => {
    setSelectedPartners((prev) => {
      const next = new Set(prev);
      if (v === "すべて") {
        // 「すべて」をクリックしたら選択をすべてクリア
        next.clear();
      } else if (next.has(v)) {
        next.delete(v);
      } else {
        next.add(v);
      }
      try { localStorage.setItem("om_selectedPartners", JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };
  const handleHideCompleted = () => {
    setHideCompleted((prev) => {
      const next = !prev;
      try { localStorage.setItem("om_hideCompleted", String(next)); } catch {}
      return next;
    });
  };

  // 取引先一覧を集計
  const partners = useMemo(() => {
    if (!summary) return ["すべて"];
    const set = new Set<string>();
    for (const item of summary as SummaryItem[]) {
      set.add(item.partner || "その他");
    }
    return ["すべて", ...Array.from(set).sort()];
  }, [summary]);

  // 8桁日付形式（YYYYMMDD）の出庫Noを判定する関数
  const isDateBasedKey = (key: string) => /^\d{8}$/.test(key);

  const filtered = useMemo(() => {
    if (!summary) return [];
    const q = searchQuery.trim().toLowerCase();
    return (summary as SummaryItem[]).filter((item) => {
      // 8桁日付形式の出庫Noは除外
      if (isDateBasedKey(item.key)) return false;
      // 完了判定: 出庫数>=発注数 OR manualComplete OR csvStatus=complete
      const isComplete = item.manualComplete || item.csvStatus === "complete" ||
        (item.csvOrderQty > 0 && item.deliveredCount >= item.csvOrderQty);
      // 未完了のみ表示トグル
      if (hideCompleted && isComplete) return false;
      if (selectedPartners.size > 0 && !selectedPartners.has(item.partner || "その他")) return false;
      if (!q) return true;
      if (item.key.toLowerCase().includes(q)) return true;
      if ((item.partner ?? "").toLowerCase().includes(q)) return true;
      if (item.purchaseItems.some((p) => p.managementNo.toLowerCase().includes(q) || p.title.toLowerCase().includes(q))) return true;
      if (item.inventoryItems.some((i) => i.managementNo.toLowerCase().includes(q) || i.title.toLowerCase().includes(q))) return true;
      if (item.csvProducts.some((p) => p.name.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [summary, searchQuery, selectedPartners, hideCompleted]);

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー（スクロール固定） */}
      <div className="-mx-4 px-4 pb-2 pt-1">
      <div className="rounded-xl border bg-card shadow-sm px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">発注管理</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              インボイスNo別 発注数・出庫数・進捗 ({filtered.length} 件)
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant={hideCompleted ? "default" : "outline"}
              size="sm"
              onClick={handleHideCompleted}
              className="text-xs"
            >
              {hideCompleted ? "未完了のみ" : "全件表示"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => filtered.length > 0 && exportOrderManagementCSV(filtered)}
            >
              <Download className="h-4 w-4 mr-1.5" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              更新
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => backfillDeliveryOrderLines.mutate({ limit: 2000 })}
              disabled={backfillDeliveryOrderLines.isPending}
            >
              {backfillDeliveryOrderLines.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1.5" />
              )}
              既存履歴を再判定
            </Button>
          </div>
        </div>
        {/* 検索バー */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="インボイスNo・取引先・商品名で検索..."
            value={searchQuery}
            onChange={(e) => handleSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      </div>

      {/* ローディング */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" />
          データを読み込み中...
        </div>
      )}

      {/* 取引先タブ（複数選択対応） */}
      {partners.length > 1 && !isLoading && (
        <div className="flex flex-wrap gap-2 items-center">
          <button
            key="すべて"
            onClick={() => handleTogglePartner("すべて")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedPartners.size === 0
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            すべて
          </button>
          {partners.filter((p) => p !== "すべて").map((p) => {
            const isSelected = selectedPartners.has(p);
            return (
              <button
                key={p}
                onClick={() => handleTogglePartner(p)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {isSelected && <Check className="h-3 w-3" />}
                {p}
              </button>
            );
          })}
          {selectedPartners.size > 0 && (
            <button
              onClick={() => handleTogglePartner("すべて")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-1"
            >
              <X className="h-3.5 w-3.5" />
              選択解除
            </button>
          )}
        </div>
      )}

      {/* データなし */}
      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <BarChart2 className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm">
            {searchQuery ? "検索条件に一致するデータがありません" : "データがありません"}
          </p>
        </div>
      )}

      {/* 集計カード一覧 */}
      <div className="space-y-3">
        {filtered.map((item) => {
          const isExpanded = expandedKeys.has(item.key);
          const pct = item.csvOrderQty > 0
            ? Math.round((item.deliveredCount / item.csvOrderQty) * 100)
            : 0;
          const remaining = Math.max(0, item.csvOrderQty - item.deliveredCount);
          // 超過出庫: 出庫数が発注数を超えている
          const excessDelivery = item.csvOrderQty > 0 && item.deliveredCount > item.csvOrderQty
            ? item.deliveredCount - item.csvOrderQty
            : 0;
          // 完了判定: manualComplete OR csvStatus=complete のみ
          // ※出庫数>=発注数だけでは完了にしない（超過出庫の場合は手動完了が必要）
          // ※ちょうど一致（出庫==発注）の場合は自動完了
          const isAutoComplete = item.csvOrderQty > 0 && item.deliveredCount === item.csvOrderQty;
          const isComplete = item.manualComplete || item.csvStatus === "complete" || isAutoComplete;
          const colorSummary = buildColorSummary(item);
          const aggregatedDeliveryItems = aggregateDeliveryItems(item);

          return (
            <div key={item.key} className="rounded-lg border bg-card shadow-sm overflow-hidden">
              {/* 超過出庫時の注意バナー */}
              {excessDelivery > 0 && (
                <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                  <span>
                    超過出庫: 発注数 <strong>{item.csvOrderQty}個</strong> に対して出庫数が <strong>{item.deliveredCount}個</strong>（{excessDelivery}個超過）— 内容を確認の上、手動完了してください
                  </span>
                  {!item.manualComplete && (
                    <button
                      className="ml-auto flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-700 text-xs font-medium"
                      onClick={(e) => { e.stopPropagation(); setManualComplete.mutate({ invoiceKey: item.key, completed: true }); }}
                    >
                      <CheckCircle2 className="h-3 w-3" />完了にする
                    </button>
                  )}
                </div>
              )}
              {/* 手動完了時の解除バナー */}
              {item.manualComplete && (
                <div className="flex items-center gap-2 px-4 py-1 bg-green-50 border-b border-green-200 text-green-800 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  <span>手動完了済み</span>
                  <button
                    className="ml-auto text-green-700 underline hover:no-underline text-xs"
                    onClick={(e) => { e.stopPropagation(); setManualComplete.mutate({ invoiceKey: item.key, completed: false }); }}
                  >
                    完了を解除
                  </button>
                </div>
              )}
              {/* カードヘッダー */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => toggleExpand(item.key)}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base text-foreground">No.{item.key}</span>
                      {item.partner && item.partner !== "その他" && (
                        <Badge variant="secondary" className="text-xs font-medium">
                          {item.partner}
                        </Badge>
                      )}
                      {remaining > 0 && !isComplete && (
                        <Badge variant="destructive" className="text-xs">
                          残 {remaining}個
                        </Badge>
                      )}
                      {isComplete && (
                        <Badge className="text-xs bg-green-500 text-white">完了</Badge>
                      )}
                      {colorSummary.length > 0 && (
                        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs">
                          <span className="font-medium text-foreground">発注+在庫+出庫</span>
                          {colorSummary.map((cs) => {
                            const covered = orderStockCoverage(cs);
                            const isShort = isOrderStockShort(cs);
                            return (
                              <span
                                key={cs.colorName}
                                className={isShort ? "font-medium text-red-600" : "text-foreground"}
                                title={`${cs.colorName}: 発注${cs.zaicoCount}個 / 在庫${cs.stockCount}個 / 出庫${cs.deliveredCount}個 / 取引データ発注${cs.csvQty}個`}
                              >
                                {cs.colorName} {covered}/{cs.csvQty}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {/* 進捗バー */}
                    {item.csvOrderQty > 0 && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${progressColor(pct)}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          出庫{item.deliveredCount}/{item.csvOrderQty}個 ({pct}%)
                        </span>
                      </div>
                    )}
                    {/* 取引データ商品名（1件目のみ表示） */}
                    {item.csvProducts.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {item.csvProducts[0].name}
                        {item.csvProducts.length > 1 && ` 他${item.csvProducts.length - 1}件`}
                      </p>
                    )}
                  </div>
                </div>
                {/* サマリーバッジ（右側） */}
                <div className="flex items-center gap-1.5 flex-wrap justify-end flex-shrink-0 ml-3">
                  {item.csvOrderQty > 0 && (
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-muted-foreground">発注:</span>
                      <Badge variant="outline" className="text-gray-700 text-xs px-1.5 py-0">
                        {item.csvOrderQty}個
                      </Badge>
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">出庫:</span>
                    <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50 text-xs px-1.5 py-0">
                      {item.deliveredCount}個
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">在庫:</span>
                    <Badge variant="outline" className="text-purple-600 border-purple-200 bg-purple-50 text-xs px-1.5 py-0">
                      {item.stockCount}個
                    </Badge>
                  </div>
                </div>
              </div>

              {/* 展開時の詳細 */}
              {isExpanded && (
                <div className="border-t divide-y">
                  {/* インボイス備考欄 */}
                  <div className="px-4 py-2.5 bg-yellow-50/60 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground flex-shrink-0">備考:</span>
                    <InvoiceMemoField invoiceKey={item.key} colorKey="__invoice__" />
                  </div>
                  {/* 取引データ発注明細 */}
                  {item.csvProducts.length > 0 && (
                    <div className="px-4 py-3 bg-gray-50/50">
                      <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-gray-500"></span>
                        取引データ発注明細（{item.csvProducts.length}件）
                      </p>
                      <div className="space-y-1.5">
                        {item.csvProducts.map((p, i) => (
                          <div key={i} className="flex items-center justify-between text-sm bg-white rounded px-3 py-1.5 border border-gray-100">
                            <div className="min-w-0 flex-1">
                              <span className="font-medium text-foreground">{p.name}</span>

                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              <span className="text-sm font-medium">{p.qty}個</span>
                              {p.status && (
                                <Badge variant="outline" className="text-xs">{p.status}</Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 発注一覧＋カラー別集計 */}
                  {item.purchaseItems.length > 0 && (
                    <div className="px-4 py-3 bg-blue-50/30">
                      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                        <p className="text-xs font-semibold text-blue-700 flex items-center gap-1">
                          <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                          発注一覧（{item.purchaseItems.length}件）
                        </p>
                        {/* カラー別集計バッジ＋メモ欄 */}
                        {colorSummary.length > 0 && (
                          <div className="flex flex-col gap-1.5">
                            {colorSummary.map((cs, index) => {
                              const covered = orderStockCoverage(cs);
                              const isShort = isOrderStockShort(cs);
                              return (
                                <div key={cs.colorName} className="flex items-center gap-1.5 flex-wrap justify-end">
                                  {index === 0 && <span className="text-xs font-medium text-foreground">発注+在庫+出庫</span>}
                                  <span
                                    className={`text-xs ${isShort ? "font-medium text-red-600" : "text-foreground"}`}
                                    title={`${cs.colorName}: 発注${cs.zaicoCount}個 / 在庫${cs.stockCount}個 / 出庫${cs.deliveredCount}個 / 取引データ発注${cs.csvQty}個`}
                                  >
                                    {cs.colorName} {covered}/{cs.csvQty}
                                  </span>
                                  <InvoiceMemoField invoiceKey={item.key} colorKey={cs.colorName} />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {item.purchaseItems.map((p, i) => {
                          const detailKey = `purchase-${item.key}-${i}`;
                          const isOpen = !!openDetailItems[detailKey];
                          return (
                            <div key={i} className="rounded border border-blue-100 bg-white overflow-hidden">
                              <button
                                onClick={() => toggleDetailItem(detailKey)}
                                className={`w-full flex items-center justify-between text-sm px-3 py-1.5 hover:bg-blue-50/50 transition-colors ${isOpen ? "bg-blue-50/50" : ""}`}
                              >
                                <div className="min-w-0 flex-1 flex items-center gap-1.5 text-left">
                                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                                  <span className="text-xs text-muted-foreground">{p.num}</span>
                                  <span className="font-medium text-foreground">{p.title}</span>
                                  <span className="text-xs text-muted-foreground">({p.managementNo})</span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <span className="text-sm font-medium">{p.quantity}個</span>
                                  <Badge variant="outline" className={p.status === "purchased" ? "text-green-600 border-green-200 bg-green-50 text-xs" : "text-blue-600 border-blue-200 bg-blue-50 text-xs"}>
                                    {p.status === "purchased" ? "入庫済" : "発注済"}
                                  </Badge>
                                </div>
                              </button>
                              {isOpen && (
                                <PurchaseDetailPanel purchaseId={p.purchaseId} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 在庫一覧 */}
                  {item.inventoryItems.length > 0 && (
                    <div className="px-4 py-3 bg-purple-50/30">
                      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                        <p className="text-xs font-semibold text-purple-700 flex items-center gap-1">
                          <span className="inline-block w-2 h-2 rounded-full bg-purple-500"></span>
                          在庫一覧（{item.inventoryItems.length}件）
                        </p>
                        {/* 在庫カラー別集計バッジ */}
                        {colorSummary.length > 0 && colorSummary.some((cs) => cs.stockCount > 0) && (
                          <div className="flex flex-wrap gap-1.5">
                            {colorSummary.filter((cs) => cs.stockCount > 0).map((cs) => (
                              <div
                                key={cs.colorName}
                                className="flex items-center gap-1 bg-white border border-purple-100 rounded-full px-2 py-0.5 text-xs"
                                title={`${cs.colorName}: 在庫${cs.stockCount}個 / 取引データ発注${cs.csvQty}個`}
                              >
                                <span className="font-medium text-purple-800">{cs.colorName}</span>
                                <span className="text-muted-foreground">
                                  {cs.stockCount}/{cs.csvQty}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {item.inventoryItems.map((inv, i) => {
                          const detailKey = `inventory-${item.key}-${i}`;
                          const isOpen = !!openDetailItems[detailKey];
                          return (
                            <div key={i} className="rounded border border-purple-100 bg-white overflow-hidden">
                              <button
                                onClick={() => toggleDetailItem(detailKey)}
                                className={`w-full flex items-center justify-between text-sm px-3 py-1.5 hover:bg-purple-50/50 transition-colors ${isOpen ? "bg-purple-50/50" : ""}`}
                              >
                                <div className="min-w-0 flex-1 flex items-center gap-1.5 text-left">
                                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                                  <span className="font-medium text-foreground">{inv.title}</span>
                                  <span className="text-xs text-muted-foreground">({inv.managementNo})</span>
                                </div>
                                <span className="text-sm font-medium flex-shrink-0 ml-2">{inv.quantity}個</span>
                              </button>
                              {isOpen && (
                                <InventoryDetailPanel
                                  inventoryId={inv.inventoryId}
                                  unitPrice={(inv as { unitPrice?: string }).unitPrice}
                                  trackingNumber={(inv as { trackingNumber?: string }).trackingNumber}
                                  supplierUrl={(inv as { supplierUrl?: string }).supplierUrl}
                                  supplierName={(inv as { supplierName?: string }).supplierName}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 出庫履歴 */}
                  {item.deliveryItems.length > 0 && (
                    <div className="px-4 py-3 bg-orange-50/30">
                      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                        <p className="text-xs font-semibold text-orange-700 flex items-center gap-1">
                          <span className="inline-block w-2 h-2 rounded-full bg-orange-500"></span>
                          出庫履歴（{item.deliveryItems.length}件）
                        </p>
                        {/* 出庫カラー別集計バッジ */}
                        {colorSummary.length > 0 && colorSummary.some((cs) => cs.deliveredCount > 0) && (
                          <div className="flex flex-wrap gap-1.5">
                            {colorSummary.filter((cs) => cs.deliveredCount > 0).map((cs) => (
                              <div
                                key={cs.colorName}
                                className="flex items-center gap-1 bg-white border border-orange-100 rounded-full px-2 py-0.5 text-xs"
                                title={`${cs.colorName}: 出庫${cs.deliveredCount}個 / 取引データ発注${cs.csvQty}個`}
                              >
                                <span className="font-medium text-orange-800">{cs.colorName}</span>
                                <span className="text-muted-foreground">
                                  {cs.deliveredCount}/{cs.csvQty}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {aggregatedDeliveryItems.map((d, i) => {
                          const detailKey = `delivery-${item.key}-${i}`;
                          const isOpen = !!openDetailItems[detailKey];
                          return (
                            <div key={i} className="rounded border border-orange-100 bg-white overflow-hidden">
                              <button
                                onClick={() => toggleDetailItem(detailKey)}
                                className={`w-full flex items-center justify-between text-sm px-3 py-1.5 hover:bg-orange-50/50 transition-colors ${isOpen ? "bg-orange-50/50" : ""}`}
                              >
                                <div className="min-w-0 flex-1 flex items-center gap-1.5 text-left">
                                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                                  <button
                                    type="button"
                                    className="text-xs text-primary hover:underline font-mono"
                                    onClick={(e) => { e.stopPropagation(); const no = d.deliveryNo.match(/^(\d+)/)?.[1]; if (no) setLocation(`/inventory/delivery-history?group=${no}`); }}
                                  >{d.deliveryNo}</button>
                                  <span className="font-medium text-foreground">{d.title.replace(/\s*[（(][^）)]*[）)]\s*/g, "").trim()}</span>
                                  {d.managementNo && (
                                    <span className="text-xs text-muted-foreground">({d.managementNo})</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <span className="text-sm font-medium">{d.quantity}個</span>
                                  <button
                                    type="button"
                                    className="text-xs text-primary hover:underline"
                                    onClick={(e) => { e.stopPropagation(); const dateStr = d.deliveredDateKey || deliveryDateKey(d.deliveredAt); if (dateStr) setLocation(`/inventory/delivery-history?date=${dateStr}`); }}
                                  >{deliveryDateLabel(d.deliveredAt)}</button>
                                </div>
                              </button>
                              {isOpen && (
                                <DeliveryDetailPanel
                                  deliveryNo={d.deliveryNo}
                                  deliveredAt={d.deliveredAt}
                                  unitPrice={(d as { unitPrice?: string }).unitPrice ?? ""}
                                  trackingNumber={(d as { trackingNumber?: string }).trackingNumber ?? ""}
                                  supplierUrl={(d as { supplierUrl?: string }).supplierUrl ?? ""}
                                  supplierName={(d as { supplierName?: string }).supplierName ?? ""}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 詳細なし */}
                  {item.csvProducts.length === 0 && item.purchaseItems.length === 0 && item.inventoryItems.length === 0 && item.deliveryItems.length === 0 && (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      詳細データがありません
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
