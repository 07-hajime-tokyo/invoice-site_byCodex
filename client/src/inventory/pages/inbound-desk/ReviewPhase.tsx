import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type InboundInvoiceRollup,
  type InboundLabel,
} from "@/inventory/lib/inboundDesk";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import {
  InspectionOutcome,
  OUTCOME_LABELS,
  formatDateTime,
} from "./presentation";
import { UndoButton, LabelDetails, InvoiceRollupTable } from "./sharedUi";

export function ReviewPhase({
  pendingCount,
  recent,
  actionItems,
  rollups,
  onRefresh,
}: {
  pendingCount: number;
  recent: Array<
    InboundLabel & {
      outcome: InspectionOutcome;
      actionItemId: number | null;
      requestReplacement: boolean;
      processedAt: string;
      workerName: string;
    }
  >;
  actionItems: Array<{
    id: number;
    title: string;
    assignee: string;
    detail: string;
    status: string;
    sourceKey: string | null;
    createdAt: string;
  }>;
  rollups: InboundInvoiceRollup[];
  onRefresh: () => Promise<void>;
}) {
  const outcomeLabel = OUTCOME_LABELS;
  return (
    <div className="space-y-6">
      <section
        className={cn(
          "rounded-xl border p-5 shadow-sm",
          pendingCount === 0
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-200 bg-amber-50"
        )}
      >
        <div className="flex items-center gap-3">
          {pendingCount === 0 ? (
            <CheckCircle2 className="h-8 w-8 text-emerald-700" />
          ) : (
            <TriangleAlert className="h-8 w-8 text-amber-700" />
          )}
          <div>
            <div className="text-sm font-medium">動作確認待ち</div>
            <div className="text-3xl font-bold tabular-nums">
              {pendingCount.toLocaleString()}台
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">直近の処理結果</h2>
          {recent.length ? (
            <UndoButton
              kind="inspection"
              labelIds={Array.from(new Set(recent.map(item => item.labelId)))}
              label="表示中を一括取消"
              onDone={onRefresh}
            />
          ) : null}
        </div>
        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            荷受けデスクでの動作確認の結果はまだありません
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {recent.map(item => (
              <article
                key={`${item.labelId}:${item.processedAt}`}
                className="rounded-xl border bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <Badge
                    variant={
                      item.outcome === "stocked" ? "default" : "secondary"
                    }
                  >
                    {outcomeLabel[item.outcome]}
                    {item.requestReplacement ? "＋代替品仕入" : ""}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(item.processedAt)}
                  </span>
                </div>
                <div className="mt-3">
                  <LabelDetails label={item} />
                </div>
                <div className="mt-3">
                  <UndoButton
                    kind="inspection"
                    labelIds={[item.labelId]}
                    label="動作確認を取消"
                    onDone={onRefresh}
                  />
                </div>
                {item.outcome === "defective" || item.outcome === "junk" ? (
                  <DefectiveMarketRefresh item={item} onRefresh={onRefresh} />
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
        <h2 className="text-lg font-semibold">不良で作った「やること」</h2>
        {actionItems.length === 0 ? (
          <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            代替品の仕入れ依頼はありません
          </div>
        ) : (
          actionItems.map(item => (
            <div key={item.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={item.status === "open" ? "default" : "secondary"}
                >
                  {item.status === "open" ? "未完了" : "完了"}
                </Badge>
                <span className="font-semibold">{item.assignee}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(item.createdAt)}
                </span>
              </div>
              <div className="mt-2">{item.detail}</div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">インボイス別の最終状態</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            現在の出庫済み・在庫確保を基準にした結果です。
          </p>
        </div>
        <InvoiceRollupTable rollups={rollups} projected={false} />
      </section>
    </div>
  );
}

export function DefectiveMarketRefresh({
  item,
  onRefresh,
}: {
  item: InboundLabel;
  onRefresh: () => Promise<void>;
}) {
  const [keyword, setKeyword] = useState(item.marketKeyword ?? "");
  const refreshMutation =
    trpc.inventory.inboundDesk.refreshDefectiveListing.useMutation();

  useEffect(() => setKeyword(item.marketKeyword ?? ""), [item.marketKeyword]);

  async function refreshMarket() {
    try {
      const result = await refreshMutation.mutateAsync({
        labelId: item.labelId,
        keyword: keyword.trim() || undefined,
      });
      if (result.sheet.success) {
        toast.success("相場と不良在庫シートを更新しました");
      } else {
        toast.warning(
          `相場は更新しましたが、シート連携に失敗しました: ${result.sheet.message ?? "不明"}`
        );
      }
      await onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "相場を再取得できませんでした"
      );
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">
          {item.defectPhotoCount
            ? `写真${item.defectPhotoCount}枚`
            : "写真なし"}
        </Badge>
        <Badge variant="outline">
          中央値:{" "}
          {item.marketMedian == null
            ? "該当なし"
            : `${item.marketMedian.toLocaleString()}円`}
        </Badge>
        <Badge variant={item.defectiveSheetSyncedAt ? "secondary" : "outline"}>
          {item.defectiveSheetSyncedAt ? "シート反映済み" : "シート未反映"}
        </Badge>
      </div>
      <Input
        aria-label={`${item.labelId}の検索キーワード`}
        value={keyword}
        onChange={event => setKeyword(event.target.value)}
        placeholder="検索キーワードを修正"
        className="min-h-11 bg-white text-sm"
      />
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full bg-white"
        disabled={refreshMutation.isPending}
        onClick={() => void refreshMarket()}
      >
        {refreshMutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        キーワードで相場を再取得
      </Button>
    </div>
  );
}

export function DefectiveGroupingPanel() {
  const utils = trpc.useUtils();
  const query = trpc.inventory.inboundDesk.defectiveGroups.useQuery();
  const [selected, setSelected] = useState<string[]>([]);
  const createGroup = trpc.inventory.inboundDesk.createDefectiveGroup.useMutation({
    onSuccess: result => {
      setSelected([]);
      void utils.inventory.inboundDesk.defectiveGroups.invalidate();
      if (result.sheet.success) toast.success(`${result.group.groupCode} をまとめ用1行としてシートへ登録しました`);
      else toast.warning(`${result.group.groupCode} は作成済みです。シート連携は要確認: ${result.sheet.message ?? "未反映"}`);
    },
    onError: error => toast.error(error.message),
  });
  const dissolveGroup = trpc.inventory.inboundDesk.dissolveDefectiveGroup.useMutation({
    onSuccess: result => {
      void utils.inventory.inboundDesk.defectiveGroups.invalidate();
      toast.success(`${result.groupCode} を解除しました。シート行は監査用に解除済みとして残します`);
    },
    onError: error => toast.error(error.message),
  });
  const syncGroup = trpc.inventory.inboundDesk.syncDefectiveGroup.useMutation({
    onSuccess: result => {
      void utils.inventory.inboundDesk.defectiveGroups.invalidate();
      if (result.sheet.success) toast.success(`${result.groupCode} をシートへ再送しました`);
      else toast.warning(`${result.groupCode} のシート連携に失敗しました: ${result.sheet.message ?? "要確認"}`);
    },
    onError: error => toast.error(error.message),
  });
  const activeGroups = (query.data?.groups ?? []).filter(group => group.status === "active");

  return (
    <section className="rounded-xl border border-violet-300 bg-violet-50/60 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="font-semibold text-violet-950">ジャンクまとめ出品グループ</h2>
          <p className="mt-1 text-sm text-violet-900">複数個体を選ぶと、代表する単品中央値×台数を目安にまとめ用1行を「不良在庫」シートへ作ります。</p>
        </div>
        <Button
          type="button"
          disabled={selected.length < 2 || createGroup.isPending}
          onClick={() => createGroup.mutate({ labelIds: selected, operatorName: getCurrentWorkWorkerName("検品担当") })}
        >
          {createGroup.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          選択した{selected.length}個体を1出品にまとめる
        </Button>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {(query.data?.candidates ?? []).map(candidate => {
          const checked = selected.includes(candidate.labelId);
          return (
            <label key={candidate.labelId} className="flex cursor-pointer items-start gap-3 rounded border bg-white p-3">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => setSelected(current => checked ? current.filter(id => id !== candidate.labelId) : [...current, candidate.labelId])}
                className="mt-1 h-5 w-5"
              />
              <span className="min-w-0 text-sm">
                <span className="font-mono font-bold">{candidate.labelId}</span>
                <span className="ml-2">{candidate.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{candidate.defectTags.join("、") || "その他"} / 単品中央値: {candidate.marketMedian == null ? "未取得" : `${candidate.marketMedian.toLocaleString()}円`}</span>
              </span>
            </label>
          );
        })}
      </div>
      {(query.data?.candidates.length ?? 0) === 0 ? <p className="mt-3 text-sm text-muted-foreground">グループ未所属の不良個体はありません。</p> : null}
      {activeGroups.length > 0 ? (
        <div className="mt-4 space-y-2 border-t border-violet-200 pt-3">
          <h3 className="text-sm font-semibold">有効なグループ</h3>
          {activeGroups.map(group => (
            <div key={group.id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-white p-2 text-sm">
              <div><span className="font-mono font-bold">{group.groupCode}</span><span className="ml-2">{group.memberLabelIds.join(", ")}</span></div>
              <div className="flex flex-wrap gap-2">
                {!group.sheetSyncedAt ? (
                  <Button type="button" size="sm" variant="outline" disabled={syncGroup.isPending} onClick={() => syncGroup.mutate({ id: group.id })}>
                    シートへ再送
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="outline" disabled={dissolveGroup.isPending} onClick={() => {
                  if (window.confirm(`${group.groupCode} を解除しますか？シート行は削除せず「解除済み」に更新します。`)) dissolveGroup.mutate({ id: group.id });
                }}>グループを解除</Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
