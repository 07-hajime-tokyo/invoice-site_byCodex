import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ActionItemForm } from "@/inventory/components/ActionItemForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

type StatusFilter = "open" | "done" | "all";

function formatDate(value: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ActionItems() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [search, setSearch] = useState("");
  const { data: items = [], isLoading, refetch, isFetching } = trpc.inventory.actionItems.list.useQuery({ status });

  const setStatusMutation = trpc.inventory.actionItems.setStatus.useMutation({
    onSuccess: async () => {
      await utils.inventory.actionItems.list.invalidate();
    },
    onError: (error) => toast.error(`更新失敗: ${error.message}`),
  });

  const deleteMutation = trpc.inventory.actionItems.delete.useMutation({
    onSuccess: async () => {
      toast.success("削除しました");
      await utils.inventory.actionItems.list.invalidate();
    },
    onError: (error) => toast.error(`削除失敗: ${error.message}`),
  });

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      item.title.toLowerCase().includes(q) ||
      item.assignee.toLowerCase().includes(q) ||
      item.detail.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-emerald-600" />
            やることリスト
          </h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          更新
        </Button>
      </div>

      <ActionItemForm onCreated={() => refetch()} />

      <Card className="rounded-lg">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              {(["open", "done", "all"] as StatusFilter[]).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={status === value ? "default" : "outline"}
                  onClick={() => setStatus(value)}
                >
                  {value === "open" ? "未完了" : value === "done" ? "完了" : "すべて"}
                </Button>
              ))}
            </div>
            <div className="relative w-full sm:w-[320px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="検索"
                className="pl-9"
              />
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            {isLoading ? "読み込み中..." : `${filteredItems.length}件`}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">読み込み中...</div>
      ) : filteredItems.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">やることはありません</div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const done = item.status === "done";
            return (
              <Card key={item.id} className={`rounded-lg ${done ? "opacity-65" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <Checkbox
                        checked={done}
                        onCheckedChange={(checked) => {
                          setStatusMutation.mutate({ id: item.id, status: checked ? "done" : "open" });
                        }}
                        className="mt-1"
                      />
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className={`font-semibold break-all ${done ? "line-through" : ""}`}>{item.title}</h2>
                          <Badge variant={done ? "secondary" : "default"}>{item.assignee}</Badge>
                          {done ? (
                            <Badge variant="outline" className="text-emerald-700">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              完了
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm whitespace-pre-wrap leading-6">{item.detail}</p>
                        <div className="text-xs text-muted-foreground">
                          登録: {formatDate(item.createdAt)}
                          {item.completedAt ? ` / 完了: ${formatDate(item.completedAt)}` : ""}
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate({ id: item.id })}
                      aria-label="削除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
