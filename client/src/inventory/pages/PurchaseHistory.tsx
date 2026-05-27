import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { RefreshCw, Search, X, PackageCheck, RotateCcw, Loader2, Calendar, Download } from "lucide-react";
import { buildSupplierDisplay } from "@/inventory/lib/supplier";
import { toast } from "sonner";
import { usePagination } from "@/inventory/hooks/usePagination";
import { PaginationBar } from "@/inventory/components/PaginationBar";

/** 入庫履歴CSVエクスポート */
function exportPurchaseHistoryCSV(items: PurchaseHistoryItem[]) {
  const rows: string[][] = [
    ["管理番号", "商品名", "カテゴリ", "仕入先", "入庫日", "数量", "入庫単価", "入庫金額", "担当者", "ステータス"],
  ];
  for (const h of items) {
    const qty = parseFloat(h.quantity ?? "0");
    const unitPrice = h.unitPrice ? parseFloat(h.unitPrice) : null;
    const totalValue = unitPrice && qty > 0 ? unitPrice * qty : null;
    rows.push([
      h.kanriNo ?? "-",
      h.title,
      h.category ?? "",
      h.supplier ?? "",
      h.purchaseDate,
      h.quantity,
      unitPrice != null ? String(unitPrice) : "-",
      totalValue != null ? String(totalValue) : "-",
      h.operatorName ?? "",
      h.cancelled ? "取り消し済み" : "入庫済み",
    ]);
  }
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `入庫履歴_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type PurchaseHistoryItem = {
  id: number;
  zaicoId: number;
  kanriNo: string | null;
  title: string;
  category: string | null;
  supplier: string | null;
  quantity: string;
  unitPrice: string | null;
  purchaseDate: string;
  inventoryId: number | null;
  cancelled: number;
  operatorName: string | null;
  createdAt: Date;
  supplierUrl?: string | null;
  supplierName?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
};

export default function PurchaseHistory() {
  const { data: histories, isLoading, refetch } = trpc.inventory.purchaseHistory.list.useQuery({ limit: 200 });
  const cancelMutation = trpc.inventory.purchaseHistory.cancel.useMutation();
  const { data: currentUser } = trpc.auth.me.useQuery();
  const { data: operators } = trpc.inventory.zaico.getOperators.useQuery();

  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [cancellingIds, setCancellingIds] = useState<Set<number>>(new Set());

  // 検索フィルター（管理番号・商品名・カテゴリ・仕入先・日付範囲）
  const filtered = (histories as PurchaseHistoryItem[] | undefined)?.filter((h) => {
    // テキスト検索
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const textMatch =
        (h.kanriNo ?? "").toLowerCase().includes(q) ||
        h.title.toLowerCase().includes(q) ||
        (h.category ?? "").toLowerCase().includes(q) ||
        (h.supplier ?? "").toLowerCase().includes(q);
      if (!textMatch) return false;
    }

    // 日付範囲フィルター
    if (dateFrom && h.purchaseDate < dateFrom) return false;
    if (dateTo && h.purchaseDate > dateTo) return false;

    return true;
  }) ?? [];

  // 入庫履歴ページネーション
  const {
    page: histPage,
    setPage: setHistPage,
    totalPages: histTotalPages,
    paginatedItems: pagedHistories,
    totalItems: histTotalItems,
    startIndex: histStartIndex,
    endIndex: histEndIndex,
  } = usePagination(filtered);

  function clearFilters() {
    setSearchQuery("");
    setDateFrom("");
    setDateTo("");
  }

  const hasFilters = searchQuery.trim() || dateFrom || dateTo;

  // ログインユーザーのメールからoperatorKeyを解決する（サーバーのgetOperators APIを使用）
  function resolveOperatorKey(): "default" | "A" | "B" {
    if (!currentUser?.email || !operators) return "default";
    const matched = operators.find(
      (op) => op.email && op.email.toLowerCase() === currentUser.email!.toLowerCase()
    );
    return (matched?.key as "default" | "A" | "B") ?? "default";
  }

  async function handleCancel(history: PurchaseHistoryItem) {
    if (cancellingIds.has(history.id)) return;
    setCancellingIds((prev) => new Set(prev).add(history.id));
    try {
      const operatorKey = resolveOperatorKey();
      await cancelMutation.mutateAsync({
        id: history.id,
        purchaseId: history.zaicoId,
        operatorKey,
        kanriNo: history.kanriNo ?? undefined,
        title: history.title,
        category: history.category ?? undefined,
        supplier: history.supplier ?? undefined,
        purchaseItems: history.inventoryId
          ? [
              {
                inventory_id: history.inventoryId,
                quantity: history.quantity,
                unit_price: history.unitPrice ?? "0",
              },
            ]
          : [],
      });
      toast.success(`「${history.kanriNo || history.title}」の入庫を取り消しました`);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "取り消しに失敗しました";
      toast.error(msg);
    } finally {
      setCancellingIds((prev) => {
        const next = new Set(prev);
        next.delete(history.id);
        return next;
      });
    }
  }

  if (isLoading && !histories) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">入庫履歴を読み込み中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー（スクロール固定） */}
      <div className="-mx-4 px-4 pb-2 pt-1">
      <div className="rounded-xl border bg-card shadow-sm px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">入庫履歴</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              このサイトで入庫登録した履歴 ({filtered.length}/{histories?.length ?? 0} 件)
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                <X className="h-3.5 w-3.5 mr-1" />
                絞り込み解除
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => filtered.length > 0 && exportPurchaseHistoryCSV(filtered)}>
              <Download className="h-4 w-4 mr-1.5" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              更新
            </Button>
          </div>
        </div>
        {/* テキスト検索バー */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="管理番号・商品名・カテゴリ・仕入先で検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* 日付範囲フィルター */}
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 text-sm flex-1"
            placeholder="開始日"
          />
          <span className="text-muted-foreground text-sm flex-shrink-0">〜</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 text-sm flex-1"
            placeholder="終了日"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-muted-foreground hover:text-foreground flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      </div>

      {/* 履歴なし */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <PackageCheck className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">
            {hasFilters ? "条件に一致する入庫履歴がありません" : "入庫履歴がありません"}
          </p>
          {!hasFilters && (
            <p className="text-sm text-muted-foreground mt-1">
              入庫管理画面で入庫ボタンを押すと、ここに記録されます
            </p>
          )}
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="mt-3 text-muted-foreground">
              絞り込みを解除する
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">入庫日</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">管理番号</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">商品名</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">カテゴリ</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">仕入先</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">仕入単価</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">数量</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">ステータス</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">追跡番号</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {pagedHistories.map((h) => (
                  <tr
                    key={h.id}
                    className={`border-b last:border-0 hover:bg-muted/10 ${h.cancelled ? "opacity-50" : ""}`}
                  >
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {h.purchaseDate}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {h.kanriNo || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2.5 font-medium max-w-[200px] truncate">
                      {h.title}
                    </td>
                    <td className="px-4 py-2.5">
                      {h.category ? (
                        <Badge variant="outline" className="text-xs">{h.category}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {(() => {
                        const displayText = buildSupplierDisplay(h.supplierUrl, h.supplierName, h.supplier);
                        if (h.supplierUrl) {
                          return (
                            <a
                              href={h.supplierUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-primary hover:underline flex items-center gap-1"
                            >
                              🔗 {displayText}
                            </a>
                          );
                        }
                        return <span className="text-muted-foreground">{displayText || "—"}</span>;
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {h.unitPrice ? `¥${Number(h.unitPrice).toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {h.quantity}
                    </td>
                    <td className="px-4 py-2.5">
                      {h.cancelled ? (
                        <Badge variant="destructive" className="text-xs">取り消し済み</Badge>
                      ) : (
                        <Badge variant="default" className="text-xs bg-green-600">入庫済み</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {h.trackingNumber ? (
                        <span className="font-mono text-muted-foreground">{h.trackingNumber}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {!h.cancelled && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={cancellingIds.has(h.id)}
                              className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                            >
                              {cancellingIds.has(h.id) ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                              <span className="ml-1 text-xs">取り消し</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>入庫を取り消しますか？</AlertDialogTitle>
                              <AlertDialogDescription>
                                「{h.kanriNo || h.title}」の入庫を取り消します。
                                サイト内DBのステータスが「発注済み」に戻ります。
                                この操作は慎重に行ってください。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>キャンセル</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-orange-600 text-white hover:bg-orange-700"
                                onClick={() => handleCancel(h)}
                              >
                                取り消す
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar
            page={histPage}
            totalPages={histTotalPages}
            onPageChange={setHistPage}
            totalItems={histTotalItems}
            startIndex={histStartIndex}
            endIndex={histEndIndex}
          />
        </div>
      )}
    </div>
  );
}
