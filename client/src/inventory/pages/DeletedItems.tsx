import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Search, RotateCcw, Trash2, RefreshCw, Package, MapPin, Tag, Clock, User } from "lucide-react";
import { usePagination } from "@/inventory/hooks/usePagination";
import { PaginationBar } from "@/inventory/components/PaginationBar";

export default function DeletedItems() {
  const utils = trpc.useUtils();

  const [searchQuery, setSearchQuery] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<{ id: number; title: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);

  const { data: deletedItems = [], isLoading, refetch } = trpc.inventory.deletedItems.list.useQuery();

  const restoreMutation = trpc.inventory.deletedItems.restore.useMutation({
    onSuccess: () => {
      toast.success(`${restoreTarget?.title} を在庫一覧に復元しました。`);
      setRestoreTarget(null);
      utils.inventory.deletedItems.list.invalidate();
      refetch();
    },
    onError: (err) => {
      toast.error(`復元失敗: ${err.message}`);
      setRestoreTarget(null);
    },
  });

  const permanentDeleteMutation = trpc.inventory.deletedItems.permanentDelete.useMutation({
    onSuccess: () => {
      toast.success(`${deleteTarget?.title} を完全に削除しました。`);
      setDeleteTarget(null);
      utils.inventory.deletedItems.list.invalidate();
      refetch();
    },
    onError: (err) => {
      toast.error(`削除失敗: ${err.message}`);
      setDeleteTarget(null);
    },
  });

  const filteredItems = deletedItems.filter((item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      (item.category ?? "").toLowerCase().includes(q) ||
      (item.place ?? "").toLowerCase().includes(q)
    );
  });

  const {
    page: delPage,
    setPage: setDelPage,
    totalPages: delTotalPages,
    paginatedItems: pagedDeletedItems,
    totalItems: delTotalItems,
    startIndex: delStartIndex,
    endIndex: delEndIndex,
  } = usePagination(filteredItems);

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">削除済み商品</h1>
          <p className="text-sm text-muted-foreground mt-1">
            在庫一覧から削除した商品の履歴です。復元すると在庫一覧に戻ります。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          更新
        </Button>
      </div>

      {/* 検索バー */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="商品名・カテゴリ・保管場所で検索..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* 件数表示 */}
      <div className="text-sm text-muted-foreground">
        {isLoading ? "読み込み中..." : `${filteredItems.length} 件`}
      </div>

      {/* カード一覧 */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">読み込み中...</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {searchQuery ? "検索条件に一致する商品がありません" : "削除済み商品はありません"}
        </div>
      ) : (
        <div className="space-y-3">
          {pagedDeletedItems.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border bg-card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              {/* 左: 商品情報 */}
              <div className="flex-1 min-w-0 space-y-2">
                {/* 商品名 + カテゴリ */}
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="font-semibold text-base leading-tight break-all">{item.title}</span>
                  {item.category && (
                    <Badge variant="secondary" className="text-xs shrink-0">{item.category}</Badge>
                  )}
                </div>

                {/* メタ情報 */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {item.place && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" />
                      {item.place}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Package className="w-3.5 h-3.5" />
                    在庫数: <span className="font-medium text-foreground">
                      {item.quantity != null ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : "—"}
                    </span>
                  </span>
                  {item.unitPrice != null && item.unitPrice !== "" && (
                    <span className="flex items-center gap-1">
                      <Tag className="w-3.5 h-3.5" />
                      仕入単価: <span className="font-medium text-foreground">
                        ¥{Number(item.unitPrice).toLocaleString()}
                      </span>
                    </span>
                  )}
                </div>

                {/* 削除日時・削除者 */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDate(item.createdAt)}
                  </span>
                  {item.deletedBy && (
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {item.deletedBy}
                    </span>
                  )}
                </div>
              </div>

              {/* 右: 操作ボタン */}
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-sm"
                  onClick={() => setRestoreTarget({ id: item.id, title: item.title })}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  復元
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-sm border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  onClick={() => setDeleteTarget({ id: item.id, title: item.title })}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  完全削除
                </Button>
              </div>
            </div>
          ))}
          <PaginationBar
            page={delPage}
            totalPages={delTotalPages}
            onPageChange={setDelPage}
            totalItems={delTotalItems}
            startIndex={delStartIndex}
            endIndex={delEndIndex}
          />
        </div>
      )}

      {/* 復元確認ダイアログ */}
      <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>商品を復元しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold">{restoreTarget?.title}</span> を在庫一覧に復元します。
              在庫一覧に表示されるようになります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (restoreTarget) {
                  restoreMutation.mutate({ id: restoreTarget.id });
                }
              }}
              disabled={restoreMutation.isPending}
            >
              {restoreMutation.isPending ? "復元中..." : "復元する"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 完全削除確認ダイアログ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>完全に削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold">{deleteTarget?.title}</span> の削除履歴を完全に削除します。
              この操作は取り消せません。復元もできなくなります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  permanentDeleteMutation.mutate({ id: deleteTarget.id });
                }
              }}
              disabled={permanentDeleteMutation.isPending}
            >
              {permanentDeleteMutation.isPending ? "削除中..." : "完全削除する"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
