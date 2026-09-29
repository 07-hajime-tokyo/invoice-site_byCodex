import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type InboundBox,
  type InboundInvoiceRollup,
  type InboundLabel,
} from "@/inventory/lib/inboundDesk";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ArrowRight, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import {
  Phase,
  PHASES,
  allocationBadge,
  carrierLabel,
  formatDateTime,
} from "./presentation";

export function PhaseNavigation({
  phase,
  onChange,
  incomingBoxCount,
  incomingLabelCount,
  pendingCount,
  recentCount,
}: {
  phase: Phase;
  onChange: (phase: Phase) => void;
  incomingBoxCount: number;
  incomingLabelCount: number;
  pendingCount: number;
  recentCount: number;
}) {
  const counts: Record<Phase, string> = {
    receive: `${incomingBoxCount.toLocaleString()}箱 ${incomingLabelCount.toLocaleString()}台`,
    inspect: `${pendingCount.toLocaleString()}台`,
    review: `${recentCount.toLocaleString()}件`,
  };
  return (
    <nav
      aria-label="荷受けフェーズ"
      className="sticky top-0 z-20 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur"
    >
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1">
        {PHASES.map((item, index) => (
          <div key={item.value} className="contents">
            <button
              type="button"
              onClick={() => onChange(item.value)}
              aria-current={phase === item.value ? "step" : undefined}
              className={cn(
                "min-w-0 rounded-lg px-2 py-3 text-center transition-colors md:px-4",
                phase === item.value
                  ? "bg-slate-950 text-white shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <span className="block text-sm font-semibold md:inline md:text-base">
                {item.number} {item.label}
              </span>{" "}
              <span className="block text-xs font-bold md:inline md:text-sm">
                {counts[item.value]}
              </span>
            </button>
            {index < PHASES.length - 1 ? (
              <ArrowRight
                className="h-4 w-4 text-muted-foreground"
                aria-hidden
              />
            ) : null}
          </div>
        ))}
      </div>
    </nav>
  );
}

export function LabelDetails({ label }: { label: InboundLabel }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="font-semibold text-slate-950">{label.title}</div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="font-mono">
          {label.labelId}
        </Badge>
        <Badge variant="secondary">{allocationBadge(label)}</Badge>
      </div>
      <div className="text-xs text-muted-foreground">
        旧管理番号: {label.legacyManagementNo || "-"}
      </div>
    </div>
  );
}

export function InvoiceRollupTable({
  rollups,
  projected,
}: {
  rollups: InboundInvoiceRollup[];
  projected: boolean;
}) {
  if (rollups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        表示対象のインボイスはありません
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">インボイス</th>
            <th className="px-3 py-2 text-right">必要</th>
            <th className="px-3 py-2 text-right">出庫済</th>
            <th className="px-3 py-2 text-right">在庫確保</th>
            <th className="px-3 py-2 text-right">完了まであと</th>
            {projected ? (
              <th className="px-3 py-2 text-right">今回の荷受け</th>
            ) : null}
            <th className="px-3 py-2 text-right">
              {projected ? "それでも不足" : "現在不足"}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rollups.map(rollup => (
            <tr key={rollup.key}>
              <td className="px-3 py-3 font-semibold">
                No.{rollup.key} {rollup.partner}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {rollup.csvOrderQty}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {rollup.deliveredCount}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {projected
                  ? rollup.stockCountBeforeInspection
                  : rollup.stockCount}
              </td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums">
                {projected
                  ? rollup.remainingBeforeInbound
                  : rollup.finalRemaining}
              </td>
              {projected ? (
                <td className="px-3 py-3 text-right font-semibold text-blue-700 tabular-nums">
                  {rollup.inboundCount}
                </td>
              ) : null}
              <td
                className={cn(
                  "px-3 py-3 text-right font-bold tabular-nums",
                  (projected
                    ? rollup.stillShortAfterInbound
                    : rollup.finalRemaining) > 0
                    ? "text-rose-700"
                    : "text-emerald-700"
                )}
              >
                {projected
                  ? rollup.stillShortAfterInbound
                  : rollup.finalRemaining}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UndoButton({
  kind,
  labelIds,
  label,
  onDone,
}: {
  kind: "receive" | "inspection";
  labelIds: string[];
  label: string;
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const preview = trpc.inventory.inboundDesk.undoPreview.useQuery(
    { kind, labelIds },
    { enabled: open && labelIds.length > 0 }
  );
  const undo = trpc.inventory.inboundDesk.undo.useMutation();
  const utils = trpc.useUtils();

  async function execute() {
    try {
      const result = await undo.mutateAsync({
        kind,
        labelIds,
        operatorName: getCurrentWorkWorkerName("荷受け担当"),
      });
      if (result.restored.length)
        toast.success(`${result.restored.length}台を取り消しました`);
      if (result.rejected.length)
        toast.warning(
          result.rejected
            .map(item => `${item.labelId}: ${item.reason}`)
            .join(" / ")
        );
      setOpen(false);
      await Promise.all([
        utils.inventory.inboundDesk.snapshot.invalidate(),
        utils.inventory.inboundDesk.undoPreview.invalidate(),
        utils.inventory.actionItems.list.invalidate(),
        utils.inventory.zaico.getInventories.invalidate(),
      ]);
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "取消に失敗しました");
    }
  }

  const data = preview.data;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="border-rose-300 text-rose-800 hover:bg-rose-50"
        onClick={() => setOpen(true)}
        disabled={!labelIds.length}
      >
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {kind === "receive" ? "受け取り" : "動作確認"}を取り消す
            </DialogTitle>
            <DialogDescription>
              実際に状態を取得し直し、戻せる個体だけを巻き戻します。
            </DialogDescription>
          </DialogHeader>
          {preview.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : data ? (
            <div className="space-y-3">
              <div className="grid gap-2 text-sm sm:grid-cols-4">
                <Badge variant="secondary">取消可能 {data.summary.undoable}台</Badge>
                <Badge variant="outline">戻る在庫 {data.summary.inventoryRollback}点</Badge>
                <Badge variant="outline">取消依頼 {data.summary.actionItemsCancelled}件</Badge>
                <Badge variant="outline">保持依頼 {data.summary.actionItemsRetained}件</Badge>
              </div>
              <div className="divide-y rounded-lg border">
                {data.items.map(item => (
                  <div key={item.labelId} className="p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold">{item.labelId}</span>
                      <Badge variant={item.canUndo ? "secondary" : "destructive"}>
                        {item.canUndo ? "取消可能" : "取消不可"}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.reason ??
                        `在庫 ${item.inventoryRollback}点 / 代替品依頼: ${
                          item.actionItemDisposition === "cancel"
                            ? "未完了のため取消"
                            : item.actionItemDisposition === "retain"
                              ? "完了済みのため保持"
                              : "なし"
                        }`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-destructive">
              {preview.error?.message ?? "取消内容を取得できませんでした"}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              閉じる
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void execute()}
              disabled={!data?.summary.undoable || undo.isPending}
            >
              {undo.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              取消を実行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function InboundBoxCard({
  box,
  undoLabelIds,
  onRefresh,
}: {
  box: InboundBox;
  undoLabelIds: string[];
  onRefresh: () => Promise<void>;
}) {
  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="font-mono text-base font-bold text-slate-950">
            {box.trackingNumber || "追跡番号なし"}
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <Badge>{carrierLabel(box)}</Badge>
            <Badge variant="outline">{box.supplierName || "仕入先不明"}</Badge>
            <Badge variant="secondary">
              {box.labels.length.toLocaleString()}台
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs text-muted-foreground">
            荷受け {formatDateTime(box.receivedAt)}
          </div>
          <UndoButton
            kind="receive"
            labelIds={undoLabelIds}
            label="箱ごと取消"
            onDone={onRefresh}
          />
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {box.labels.map(label => (
          <div
            key={label.labelId}
            className="rounded-lg border bg-background p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <LabelDetails label={label} />
              <UndoButton
                kind="receive"
                labelIds={[label.labelId]}
                label="取消"
                onDone={onRefresh}
              />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
