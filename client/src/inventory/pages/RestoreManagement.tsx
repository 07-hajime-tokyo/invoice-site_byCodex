import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { Clock, DatabaseBackup, History, Package, RefreshCw, RotateCcw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

type RestoreFieldPreview = {
  field: string;
  label: string;
  restoreValue: string | null | undefined;
  currentValue: string | null | undefined;
};

type HistoryRestoreTarget = {
  localInventoryId: number;
  memoId: number;
  title: string;
  managementNo: string;
  fields: RestoreFieldPreview[];
};

type DeletedRestoreTarget = {
  id: number;
  title: string;
  managementNo: string;
  quantity: string | null;
  unitPrice: string | null;
};

type FullSnapshotRestoreTarget = {
  memoId: number;
  title: string;
  managementNo: string;
  source: string;
  reason: string;
  purchaseCount: number;
  labelCount: number;
  createdAt: unknown;
};

function formatDate(value: unknown): string {
  if (!value) return "-";
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayValue(value: unknown): string {
  const text = String(value ?? "").trim();
  return text === "" ? "（空）" : text;
}

function priceValue(value: unknown): string {
  if (value == null || value === "") return "-";
  const num = Number(value);
  return Number.isFinite(num) ? `¥${num.toLocaleString()}` : String(value);
}

export default function RestoreManagement() {
  const utils = trpc.useUtils();
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [historyTarget, setHistoryTarget] = useState<HistoryRestoreTarget | null>(null);
  const [deletedTarget, setDeletedTarget] = useState<DeletedRestoreTarget | null>(null);
  const [fullSnapshotTarget, setFullSnapshotTarget] = useState<FullSnapshotRestoreTarget | null>(null);

  const searchQuery = trpc.inventory.restoreManagement.search.useQuery(
    { query, limit: 100 },
  );

  const restoreDeletedMutation = trpc.inventory.restoreManagement.restoreDeleted.useMutation({
    onSuccess: async () => {
      toast.success("削除済み商品を復元しました");
      setDeletedTarget(null);
      await Promise.all([
        utils.inventory.restoreManagement.search.invalidate(),
        utils.inventory.deletedItems.list.invalidate(),
        utils.inventory.zaico.getInventories.invalidate(),
      ]);
    },
    onError: (error) => toast.error(`復元に失敗しました: ${error.message}`),
  });

  const restoreHistoryMutation = trpc.inventory.restoreManagement.restoreFromHistory.useMutation({
    onSuccess: async () => {
      toast.success("変更履歴の変更前データに復元しました");
      setHistoryTarget(null);
      await Promise.all([
        utils.inventory.restoreManagement.search.invalidate(),
        utils.inventory.inventoryMemo.listAll.invalidate(),
        utils.inventory.zaico.getInventories.invalidate(),
      ]);
    },
    onError: (error) => toast.error(`履歴復元に失敗しました: ${error.message}`),
  });

  const restoreFullSnapshotMutation = trpc.inventory.restoreManagement.restoreFullSnapshot.useMutation({
    onSuccess: async (result) => {
      toast.success(`完全復元しました（入庫管理 ${result.purchaseCount}件 / 商品ID ${result.labelCount}件）`);
      setFullSnapshotTarget(null);
      await Promise.all([
        utils.inventory.restoreManagement.search.invalidate(),
        utils.inventory.inventoryMemo.listAll.invalidate(),
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.zaico.getPurchases.invalidate(),
        utils.inventory.deletedItems.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(`完全復元に失敗しました: ${error.message}`),
  });

  const data = searchQuery.data;
  const inventories = data?.inventories ?? [];
  const deletedItems = data?.deletedItems ?? [];
  const fullSnapshots = data?.fullSnapshots ?? [];
  const histories = data?.histories ?? [];

  const runSearch = () => {
    setQuery(searchInput.trim());
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-rose-500" />
            <h1 className="text-2xl font-bold">復元管理</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            商品ID・旧管理番号・商品名・追跡に関係する変更履歴を確認し、必要なものだけ復元します。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => searchQuery.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          更新
        </Button>
      </div>

      <Card className="rounded-lg">
        <CardHeader className="gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4 text-muted-foreground" />
            検索
          </CardTitle>
          <CardDescription>
            商品ID、旧管理番号、商品名、仕入先、削除済み商品、変更履歴を横断して検索します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              runSearch();
            }}
          >
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="例: ebay_7696_2 / 商品ID / 旧管理番号 / 商品名"
              className="sm:max-w-xl"
            />
            <Button type="submit" disabled={searchQuery.isFetching}>
              <Search className="mr-2 h-4 w-4" />
              検索
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Package className="h-4 w-4" />
            現在の商品
          </div>
          <div className="mt-2 text-2xl font-semibold">{inventories.length}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Trash2 className="h-4 w-4" />
            削除済み
          </div>
          <div className="mt-2 text-2xl font-semibold">{deletedItems.length}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <DatabaseBackup className="h-4 w-4" />
            完全復元
          </div>
          <div className="mt-2 text-2xl font-semibold">{fullSnapshots.length}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <History className="h-4 w-4" />
            変更履歴
          </div>
          <div className="mt-2 text-2xl font-semibold">{histories.length}</div>
        </div>
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">現在の商品</CardTitle>
          <CardDescription>現在DBにある商品です。削除済みも状態付きで表示します。</CardDescription>
        </CardHeader>
        <CardContent>
          {searchQuery.isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">読み込み中...</div>
          ) : inventories.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">該当する商品がありません</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>商品</TableHead>
                  <TableHead>管理番号</TableHead>
                  <TableHead>商品ID</TableHead>
                  <TableHead>在庫数</TableHead>
                  <TableHead>仕入単価</TableHead>
                  <TableHead>状態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventories.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-normal font-medium">{item.title}</TableCell>
                    <TableCell>{item.managementNo || "-"}</TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap gap-1">
                        {item.itemLabels.length === 0 ? (
                          <span className="text-muted-foreground">-</span>
                        ) : (
                          item.itemLabels.map((label) => (
                            <Badge key={label.labelId} variant="secondary" className="font-mono">
                              {label.labelId}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{item.quantity}{item.unit ?? ""}</TableCell>
                    <TableCell>{priceValue(item.unitPrice)}</TableCell>
                    <TableCell>
                      {item.isDeleted ? (
                        <Badge variant="outline" className="border-rose-200 text-rose-700">削除済み</Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-200 text-emerald-700">有効</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">削除済み商品</CardTitle>
          <CardDescription>削除済み商品から在庫一覧へ戻す場合はこちらから復元します。</CardDescription>
        </CardHeader>
        <CardContent>
          {deletedItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">該当する削除済み商品はありません</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>商品</TableHead>
                  <TableHead>管理番号</TableHead>
                  <TableHead>在庫数</TableHead>
                  <TableHead>仕入単価</TableHead>
                  <TableHead>削除日</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deletedItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-normal font-medium">{item.title}</TableCell>
                    <TableCell>{item.managementNo || "-"}</TableCell>
                    <TableCell>{displayValue(item.quantity)}{item.unit ?? ""}</TableCell>
                    <TableCell>{priceValue(item.unitPrice)}</TableCell>
                    <TableCell>{formatDate(item.createdAt)}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeletedTarget({
                          id: item.id,
                          title: item.title,
                          managementNo: item.managementNo,
                          quantity: item.quantity,
                          unitPrice: item.unitPrice,
                        })}
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        復元
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">完全復元スナップショット</CardTitle>
          <CardDescription>
            在庫本体・入庫管理の発注データ・商品IDを、編集や上書きの直前状態にまとめて戻します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fullSnapshots.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">該当する完全復元スナップショットはありません</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日時</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead>管理番号</TableHead>
                  <TableHead>保存理由</TableHead>
                  <TableHead>対象</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fullSnapshots.map((snapshot) => (
                  <TableRow key={snapshot.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDate(snapshot.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-normal font-medium">{snapshot.title || "-"}</TableCell>
                    <TableCell>{snapshot.managementNo || "-"}</TableCell>
                    <TableCell className="whitespace-normal text-xs text-muted-foreground">
                      <div>{snapshot.reason || "-"}</div>
                      <div>保存元: {snapshot.source || "-"}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>入庫管理 {snapshot.purchaseCount}件</div>
                      <div>商品ID {snapshot.labelCount}件</div>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!snapshot.canRestore}
                        onClick={() => setFullSnapshotTarget({
                          memoId: snapshot.id,
                          title: snapshot.title || "-",
                          managementNo: snapshot.managementNo || "-",
                          source: snapshot.source || "-",
                          reason: snapshot.reason || "-",
                          purchaseCount: snapshot.purchaseCount,
                          labelCount: snapshot.labelCount,
                          createdAt: snapshot.createdAt,
                        })}
                      >
                        <DatabaseBackup className="mr-1.5 h-3.5 w-3.5" />
                        完全復元
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">変更履歴</CardTitle>
          <CardDescription>編集で記録された変更前データに戻せます。復元前に差分を確認します。</CardDescription>
        </CardHeader>
        <CardContent>
          {histories.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">該当する変更履歴はありません</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日時</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead>管理番号</TableHead>
                  <TableHead>内容</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {histories.map((history) => (
                  <TableRow key={history.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDate(history.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-normal font-medium">{history.title || "-"}</TableCell>
                    <TableCell>{history.managementNo || "-"}</TableCell>
                    <TableCell className="max-w-[520px] whitespace-normal text-xs text-muted-foreground">
                      {history.fields.length > 0 ? (
                        <div className="space-y-1">
                          {history.fields.slice(0, 4).map((field) => (
                            <div key={field.field}>
                              <span className="font-medium text-foreground">{field.label}</span>: {displayValue(field.currentValue)} → {displayValue(field.restoreValue)}
                            </div>
                          ))}
                          {history.fields.length > 4 && <div>ほか {history.fields.length - 4} 件</div>}
                        </div>
                      ) : (
                        displayValue(history.memo)
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!history.canRestore || !history.inventoryLocalId}
                        onClick={() => {
                          if (!history.inventoryLocalId) return;
                          setHistoryTarget({
                            localInventoryId: history.inventoryLocalId,
                            memoId: history.id,
                            title: history.title || "-",
                            managementNo: history.managementNo,
                            fields: history.fields,
                          });
                        }}
                      >
                        <DatabaseBackup className="mr-1.5 h-3.5 w-3.5" />
                        履歴から復元
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deletedTarget} onOpenChange={(open) => !open && setDeletedTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>削除済み商品を復元しますか？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p className="font-medium text-foreground">{deletedTarget?.title}</p>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div>旧管理番号: {deletedTarget?.managementNo || "-"}</div>
                  <div>在庫数: {displayValue(deletedTarget?.quantity)}</div>
                  <div>仕入単価: {priceValue(deletedTarget?.unitPrice)}</div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletedTarget) restoreDeletedMutation.mutate({ id: deletedTarget.id });
              }}
              disabled={restoreDeletedMutation.isPending}
            >
              {restoreDeletedMutation.isPending ? "復元中..." : "復元する"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!fullSnapshotTarget} onOpenChange={(open) => !open && setFullSnapshotTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>完全復元しますか？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  在庫本体、入庫管理の発注データ、商品IDをこのスナップショットの状態に戻します。
                </p>
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="font-medium text-foreground">{fullSnapshotTarget?.title}</div>
                  <div>旧管理番号: {fullSnapshotTarget?.managementNo || "-"}</div>
                  <div>保存日時: {formatDate(fullSnapshotTarget?.createdAt)}</div>
                  <div>保存理由: {fullSnapshotTarget?.reason || "-"}</div>
                  <div>保存元: {fullSnapshotTarget?.source || "-"}</div>
                  <div>入庫管理: {fullSnapshotTarget?.purchaseCount ?? 0}件</div>
                  <div>商品ID: {fullSnapshotTarget?.labelCount ?? 0}件</div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (fullSnapshotTarget) {
                  restoreFullSnapshotMutation.mutate({ memoId: fullSnapshotTarget.memoId });
                }
              }}
              disabled={restoreFullSnapshotMutation.isPending}
            >
              {restoreFullSnapshotMutation.isPending ? "復元中..." : "完全復元する"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!historyTarget} onOpenChange={(open) => !open && setHistoryTarget(null)}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>変更履歴の内容に復元しますか？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-medium text-foreground">{historyTarget?.title}</p>
                  <p className="text-xs text-muted-foreground">旧管理番号: {historyTarget?.managementNo || "-"}</p>
                </div>
                <div className="max-h-[320px] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>項目</TableHead>
                        <TableHead>現在</TableHead>
                        <TableHead>復元後</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(historyTarget?.fields ?? []).map((field) => (
                        <TableRow key={field.field}>
                          <TableCell className="font-medium">{field.label}</TableCell>
                          <TableCell className="whitespace-normal">{displayValue(field.currentValue)}</TableCell>
                          <TableCell className="whitespace-normal">{displayValue(field.restoreValue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (historyTarget) {
                  restoreHistoryMutation.mutate({
                    localInventoryId: historyTarget.localInventoryId,
                    memoId: historyTarget.memoId,
                  });
                }
              }}
              disabled={restoreHistoryMutation.isPending}
            >
              {restoreHistoryMutation.isPending ? "復元中..." : "この内容で復元する"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
