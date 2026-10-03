import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildInboundInvoiceRollups,
  filterActiveInvoiceRollups,
  groupInboundBoxes,
  summarizeIncoming,
  type InboundInvoiceRollup,
  type InboundInvoiceSummary,
  type InboundLabel,
} from "@/inventory/lib/inboundDesk";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Loader2, PackageOpen, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  InvoicePrintPack,
  InvoicePrintPackStyles,
  type InvoiceProductDetail,
  type PrintPackMode,
} from "@/inventory/components/InvoicePrintPack";
import {
  type Phase,
  formatUpdatedTime,
  type InspectionOutcome,
} from "./inbound-desk/presentation";
import { PhaseNavigation } from "./inbound-desk/sharedUi";
import { ReceivePhase } from "./inbound-desk/ReceivePhase";
import { BacklogCloseCard, InspectPhase } from "./inbound-desk/InspectPhase";
import {
  ReviewPhase,
  DefectiveGroupingPanel,
} from "./inbound-desk/ReviewPhase";

const OutboundBoxIssuer = lazy(async () => {
  const module = await import("@/inventory/pages/PurchaseRegistration");
  return { default: module.OutboundBoxIssuer };
});

const ReceivedDateLabelPrint = lazy(async () => {
  const module = await import("@/inventory/pages/PurchaseRegistration");
  return { default: module.ReceivedDateLabelPrint };
});

export default function InboundDesk() {
  const [phase, setPhase] = useState<Phase>("receive");
  // 紙に出す用。押した時だけ描いて印刷ダイアログを開く。
  const [printPackMode, setPrintPackMode] = useState<PrintPackMode | null>(null);
  const [printPackJobId, setPrintPackJobId] = useState(0);
  const [printPackAt, setPrintPackAt] = useState("");
  const [packDetails, setPackDetails] = useState<Record<string, InvoiceProductDetail | null>>({});
  const utils = trpc.useUtils();
  const [packDate, setPackDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
  );
  const snapshotQuery = trpc.inventory.inboundDesk.snapshot.useQuery(
    undefined,
    {
      refetchInterval: 300_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    }
  );
  const summaryQuery = trpc.inventory.orderManagement.getSummary.useQuery(
    undefined,
    {
      refetchInterval: 300_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    }
  );
  const isRefreshing = snapshotQuery.isFetching || summaryQuery.isFetching;
  const lastUpdatedAt = Math.max(snapshotQuery.dataUpdatedAt, summaryQuery.dataUpdatedAt);
  const lastUpdatedLabel = formatUpdatedTime(lastUpdatedAt);

  const labels = (snapshotQuery.data?.labels ?? []) as InboundLabel[];
  const pendingLabels = useMemo(
    () => labels.filter(label => label.status === "received"),
    [labels]
  );
  const boxes = useMemo(
    () => groupInboundBoxes(pendingLabels),
    [pendingLabels]
  );
  const rollupsAll = useMemo(
    () =>
      buildInboundInvoiceRollups(
        (summaryQuery.data ?? []) as InboundInvoiceSummary[],
        pendingLabels
      ),
    [pendingLabels, summaryQuery.data]
  );
  // 画面も紙と同じ基準で終わった取引を隠す。
  // 以前は画面だけフィルタが無く、No.123まで200件以上が並んでいた。
  const rollups = useMemo(
    () => filterActiveInvoiceRollups(rollupsAll),
    [rollupsAll]
  );
  const incoming = useMemo(() => summarizeIncoming(labels), [labels]);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const isToday = packDate === today;

  const activityQuery = trpc.inventory.inboundDesk.dailyActivity.useQuery(
    { date: packDate },
    { enabled: /^\d{4}-\d{2}-\d{2}$/.test(packDate), staleTime: 30_000 }
  );
  const savedSnapshotQuery = trpc.inventory.inboundDesk.fulfillmentSnapshot.useQuery(
    { date: packDate },
    { enabled: !isToday && /^\d{4}-\d{2}-\d{2}$/.test(packDate), staleTime: 30_000 }
  );
  const saveSnapshot = trpc.inventory.inboundDesk.saveFulfillmentSnapshot.useMutation({
    onSuccess: result => toast.success(`${result.date} の充足状況を保存しました（${result.count}件）`),
    onError: error => toast.error(`保存に失敗しました: ${error.message}`),
  });

  // 過去日は保存済みの記録だけを使う。今の状態で代用すると別物の数字が紙に出る。
  const packRollupsAll = isToday
    ? rollupsAll
    : ((savedSnapshotQuery.data?.rollups ?? []) as InboundInvoiceRollup[]);
  // 紙も画面も、進行中の取引だけを出す。判定は lib/inboundDesk.ts に集約した。
  const packRollups = useMemo(
    () => filterActiveInvoiceRollups(packRollupsAll),
    [packRollupsAll]
  );
  const hiddenCompletedCount = packRollupsAll.length - packRollups.length;
  const canPrintFulfillment = packRollups.length > 0;

  async function refresh() {
    await Promise.all([snapshotQuery.refetch(), summaryQuery.refetch()]);
  }

  async function openPrintPack(mode: PrintPackMode) {
    // 内訳は品目ごとの発注数・出庫済・残りを見せたい。押した時だけ取りに行く。
    if (mode === "full") {
      try {
        const fetched = await Promise.all(
          packRollups.map(rollup =>
            utils.inventory.orderManagement.getInvoiceProducts
              .fetch({ invoiceNo: rollup.key })
              .catch(() => null)
          )
        );
        const next: Record<string, InvoiceProductDetail | null> = {};
        packRollups.forEach((rollup, index) => {
          next[rollup.key] = (fetched[index] as InvoiceProductDetail | null) ?? null;
        });
        setPackDetails(next);
      } catch {
        setPackDetails({});
      }
    }
    setPrintPackAt(
      new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date())
    );
    setPrintPackMode(mode);
    setPrintPackJobId(id => id + 1);
  }

  useEffect(() => {
    if (printPackJobId === 0 || !printPackMode) return;
    // 描画が終わってから印刷ダイアログを開く
    const timer = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(timer);
  }, [printPackJobId, printPackMode]);

  /**
   * 印刷が終わったら一覧の印刷ルートを外す。
   *
   * 出したままにしておくと、そのあと「箱を作る・1枚印刷」を押したときに
   * 箱シールではなく一覧が刷られる（印刷ルートが2つとも body に残るため）。
   */
  useEffect(() => {
    const clear = () => setPrintPackMode(null);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  if (snapshotQuery.isLoading || summaryQuery.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-3 md:p-6">
      <InvoicePrintPackStyles />
      <InvoicePrintPack
        rollups={packRollups}
        mode={printPackMode}
        printedAt={printPackAt}
        activity={activityQuery.data ?? null}
        details={packDetails}
      />
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <PackageOpen className="h-4 w-4" />
              取引ハブ
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">荷受け</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              段ボールを開ける前に中身と引当先を確認し、動作確認を通ったものだけ在庫にします。
            </p>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="pack-date" className="text-sm font-medium">
                対象日
              </label>
              <Input
                id="pack-date"
                type="date"
                value={packDate}
                max={today}
                onChange={event => setPackDate(event.target.value)}
                className="h-9 w-40"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={!canPrintFulfillment}
                onClick={() => openPrintPack("summary")}
              >
                <Printer className="h-4 w-4" />
                一覧
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={!canPrintFulfillment}
                onClick={() => openPrintPack("full")}
              >
                <Printer className="h-4 w-4" />
                一覧＋内訳（4面）
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={activityQuery.isLoading}
                onClick={() => openPrintPack("daily")}
              >
                <Printer className="h-4 w-4" />
                その日の作業（荷受け{activityQuery.data?.receipts.length ?? 0}・動作確認
                {activityQuery.data?.inspections.length ?? 0}）
              </Button>
              {isToday ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={saveSnapshot.isPending || rollupsAll.length === 0}
                  onClick={() => saveSnapshot.mutate({ date: today, rollups: rollupsAll as unknown as Record<string, unknown>[] })}
                >
                  今日の充足状況を保存
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={isRefreshing}
                onClick={() => void refresh()}
              >
                <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                更新
              </Button>
              <span className="text-xs text-muted-foreground">
                最終更新 {lastUpdatedLabel}
              </span>
            </div>
            {hiddenCompletedCount > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                進行中の取引だけを出しています（完了済み {hiddenCompletedCount} 件は紙にも画面にも出しません。
                No.399以下と、受注数まで出庫し終えたもの）。
              </p>
            ) : null}
            {!isToday && !canPrintFulfillment ? (
              <p className="mt-2 text-xs text-muted-foreground">
                この日の充足状況は保存されていません。充足状況は今の在庫から毎回計算しているため、
                過去日は後から再現できません。「その日の作業」は保存が無くても出せます。
                以後のために、区切りのついた日に「今日の充足状況を保存」を押しておいてください。
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <section className="rounded-xl border-2 border-indigo-300 bg-indigo-50/50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold text-indigo-950">出庫箱を先に発番・印刷</h2>
            <p className="mt-1 text-sm text-indigo-900">検品前・入荷0件の日でも発番できます。空の箱は出庫画面の「開いたままの箱」に残ります。</p>
          </div>
          <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin text-indigo-700" />}>
            <OutboundBoxIssuer operatorRole="荷受け担当" />
          </Suspense>
        </div>
      </section>

      <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin text-emerald-700" />}>
        <ReceivedDateLabelPrint />
      </Suspense>

      <PhaseNavigation
        phase={phase}
        onChange={setPhase}
        incomingBoxCount={incoming.boxes.length}
        incomingLabelCount={incoming.labelCount}
        pendingCount={pendingLabels.length}
        recentCount={snapshotQuery.data?.recent.length ?? 0}
      />

      {snapshotQuery.error || summaryQuery.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          最新データを取得できませんでした。
          {snapshotQuery.error?.message ?? summaryQuery.error?.message}
        </div>
      ) : null}

      {phase === "receive" ? (
        <ReceivePhase
          labels={labels}
          boxes={boxes}
          incoming={incoming}
          rollups={rollups}
          isRefreshing={isRefreshing}
          onRefresh={refresh}
        />
      ) : null}
      {phase === "inspect" ? (
        <>
          <BacklogCloseCard pendingLabels={pendingLabels} onDone={refresh} />
          <InspectPhase boxes={boxes} onRefresh={refresh} />
        </>
      ) : null}
      {phase === "review" ? (
        <>
          <ReviewPhase
            pendingCount={pendingLabels.length}
            recent={
              (snapshotQuery.data?.recent ?? []) as Array<
                InboundLabel & {
                  outcome: InspectionOutcome;
                  actionItemId: number | null;
                  requestReplacement: boolean;
                  processedAt: string;
                  workerName: string;
                }
              >
            }
            actionItems={snapshotQuery.data?.actionItems ?? []}
            rollups={rollups}
            onRefresh={refresh}
          />
          <DefectiveGroupingPanel />
        </>
      ) : null}
    </div>
  );
}
