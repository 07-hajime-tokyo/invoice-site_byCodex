import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildInboundInvoiceRollups,
  groupInboundBoxes,
  invoiceAllocation,
  matchInboundLabels,
  type InboundBox,
  type InboundInvoiceRollup,
  type InboundInvoiceSummary,
  type InboundLabel,
} from "@/inventory/lib/inboundDesk";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  PackageCheck,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import {
  DefectiveInspectionDialog,
  fileAsBase64,
  type DefectTag,
  type UploadedDefectPhoto,
} from "@/inventory/components/DefectiveInspectionDialog";

type Phase = "receive" | "inspect" | "review";
type InspectionOutcome = "stocked" | "defective" | "returned";

const OutboundBoxIssuer = lazy(async () => {
  const module = await import("@/inventory/pages/PurchaseRegistration");
  return { default: module.OutboundBoxIssuer };
});

const PHASES: Array<{ value: Phase; number: string; label: string }> = [
  { value: "receive", number: "①", label: "受け取り" },
  { value: "inspect", number: "②", label: "検品" },
  { value: "review", number: "③", label: "確認" },
];

const CARRIER_LABELS: Record<string, string> = {
  yamato: "ヤマト運輸",
  sagawa: "佐川急便",
  japanpost: "日本郵便",
  amazon: "Amazon",
  ecohai: "エコ配",
  seino: "西濃運輸",
  fukuyama: "福山通運",
};


function formatDateTime(value: string | null | undefined) {
  if (!value) return "日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function carrierLabel(box: InboundBox) {
  return (
    CARRIER_LABELS[box.carrier.trim().toLowerCase()] ??
    (box.carrier.trim() || "業者不明")
  );
}

function allocationBadge(label: InboundLabel) {
  return invoiceAllocation(label.legacyManagementNo).label;
}

function PhaseNavigation({
  phase,
  onChange,
  boxCount,
  pendingCount,
  recentCount,
}: {
  phase: Phase;
  onChange: (phase: Phase) => void;
  boxCount: number;
  pendingCount: number;
  recentCount: number;
}) {
  const counts: Record<Phase, string> = {
    receive: `${boxCount.toLocaleString()}箱`,
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

function LabelDetails({ label }: { label: InboundLabel }) {
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

function InvoiceRollupTable({
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

function InboundBoxCard({ box }: { box: InboundBox }) {
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
        <div className="text-xs text-muted-foreground">
          荷受け {formatDateTime(box.receivedAt)}
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {box.labels.map(label => (
          <div
            key={label.labelId}
            className="rounded-lg border bg-background p-3"
          >
            <LabelDetails label={label} />
          </div>
        ))}
      </div>
    </article>
  );
}

function ReceivePhase({
  labels,
  boxes,
  rollups,
  isRefreshing,
  onRefresh,
}: {
  labels: InboundLabel[];
  boxes: InboundBox[];
  rollups: InboundInvoiceRollup[];
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [lastScan, setLastScan] = useState<{
    raw: string;
    matches: InboundLabel[];
    message: string;
  } | null>(null);
  const receiveMutation = trpc.inventory.inboundDesk.receive.useMutation();
  const utils = trpc.useUtils();

  const focusScanInput = () => {
    if (window.matchMedia("(hover: none)").matches) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    focusScanInput();
  }, []);

  async function submitScan() {
    const raw = scanValue.trim();
    if (!raw || receiveMutation.isPending) return;
    const matches = matchInboundLabels(raw, labels);
    if (matches.length === 0) {
      setLastScan({
        raw,
        matches: [],
        message: "該当なし（作業は継続できます）",
      });
      setScanValue("");
      focusScanInput();
      return;
    }
    const receivable = matches.filter(label => label.status === "ordered");
    if (receivable.length === 0) {
      setLastScan({
        raw,
        matches,
        message: "すでに荷受け済み、または処理済みです",
      });
      setScanValue("");
      focusScanInput();
      return;
    }
    try {
      const result = await receiveMutation.mutateAsync({
        labelIds: receivable.map(label => label.labelId),
      });
      setLastScan({
        raw,
        matches,
        message: `${result.received.length.toLocaleString()}台を荷受け済みにしました`,
      });
      setScanValue("");
      await Promise.all([
        utils.inventory.inboundDesk.snapshot.invalidate(),
        utils.inventory.orderManagement.getSummary.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      ]);
      await onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "荷受け登録に失敗しました"
      );
    } finally {
      focusScanInput();
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-background p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ScanLine className="h-5 w-5" />
              配送伝票をスキャン
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              追跡番号以外のバーコードは黙って無視します。読み取りだけでは在庫数は増えません。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onRefresh()}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")}
            />
            最新化
          </Button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            ref={inputRef}
            value={scanValue}
            onChange={event => setScanValue(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") void submitScan();
            }}
            placeholder="配送伝票のバーコードをスキャン"
            autoComplete="off"
            className="h-12 font-mono text-base"
          />
          <Button
            type="button"
            className="h-12"
            onClick={() => void submitScan()}
            disabled={!scanValue.trim() || receiveMutation.isPending}
          >
            {receiveMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PackageOpen className="mr-2 h-4 w-4" />
            )}
            荷受け
          </Button>
        </div>
        {lastScan ? (
          <div
            className={cn(
              "mt-3 rounded-lg border p-3 text-sm",
              lastScan.matches.length > 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : "bg-muted/40"
            )}
          >
            <div className="font-mono text-xs">読取: {lastScan.raw}</div>
            <div className="mt-1 font-semibold">{lastScan.message}</div>
            {lastScan.matches.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {lastScan.matches.map(label => (
                  <Badge key={label.labelId} variant="outline">
                    {label.labelId} / {allocationBadge(label)}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">荷受け済み・未検品</h2>
          <Badge variant="secondary">
            {boxes.length.toLocaleString()}箱 /{" "}
            {boxes
              .reduce((sum, box) => sum + box.labels.length, 0)
              .toLocaleString()}
            台
          </Badge>
        </div>
        {boxes.length > 0 ? (
          boxes.map(box => <InboundBoxCard key={box.key} box={box} />)
        ) : (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            検品待ちの箱はありません
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">インボイス別の埋まり具合</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            検品待ちがすべて合格した場合の見込みです。
          </p>
        </div>
        <InvoiceRollupTable rollups={rollups} projected />
      </section>
    </div>
  );
}

function InspectPhase({
  boxes,
  onRefresh,
}: {
  boxes: InboundBox[];
  onRefresh: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [defectiveLabel, setDefectiveLabel] = useState<InboundLabel | null>(
    null
  );
  const inspectMutation = trpc.inventory.inboundDesk.inspect.useMutation();
  const uploadMutation =
    trpc.inventory.inboundDesk.uploadDefectPhotos.useMutation();
  const utils = trpc.useUtils();
  const pendingLabels = useMemo(
    () => boxes.flatMap(box => box.labels),
    [boxes]
  );

  const focusScanInput = () => {
    if (window.matchMedia("(hover: none)").matches) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    focusScanInput();
  }, []);

  async function processLabel(
    label: InboundLabel,
    outcome: InspectionOutcome,
    defect?: {
      defectTags: DefectTag[];
      defectNote: string;
      defectPhotos: UploadedDefectPhoto[];
    }
  ) {
    if (inspectMutation.isPending) return;
    if (
      outcome === "returned" &&
      !window.confirm(`${label.labelId} を仕入先返品に回しますか？`)
    )
      return;
    try {
      const result = await inspectMutation.mutateAsync({
        labelId: label.labelId,
        outcome,
        ...defect,
      });
      if (outcome === "stocked")
        toast.success(`${label.labelId} を在庫化しました`);
      if (outcome === "defective") {
        toast.success(
          result.actionItemId
            ? "不良在庫へ移し、野田さんへの代替品依頼を作成しました"
            : "不良在庫へ移しました"
        );
        setDefectiveLabel(null);
      }
      if (outcome === "returned")
        toast.success(`${label.labelId} を仕入先返品に回しました`);
      setScanValue("");
      await Promise.all([
        utils.inventory.inboundDesk.snapshot.invalidate(),
        utils.inventory.orderManagement.getSummary.invalidate(),
        utils.inventory.actionItems.list.invalidate(),
        utils.inventory.zaico.getInventories.invalidate(),
      ]);
      await onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "検品結果を登録できませんでした"
      );
    } finally {
      focusScanInput();
    }
  }

  async function submitDefective(value: {
    defectTags: DefectTag[];
    defectNote: string;
    files: File[];
  }) {
    if (!defectiveLabel) return;
    try {
      const kinds = ["whole", "defect", "accessory"] as const;
      const uploadFiles = await Promise.all(
        value.files.map(async (file, index) => ({
          base64: await fileAsBase64(file),
          mimeType: file.type || "image/heic",
          kind: kinds[index] ?? "defect",
        }))
      );
      const photos =
        uploadFiles.length > 0
          ? (
              await uploadMutation.mutateAsync({
                labelId: defectiveLabel.labelId,
                files: uploadFiles,
              })
            ).photos
          : [];
      await processLabel(defectiveLabel, "defective", {
        defectTags: value.defectTags,
        defectNote: value.defectNote,
        defectPhotos: photos,
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "不良写真を登録できませんでした"
      );
    }
  }

  async function submitAcceptedScan() {
    const normalized = scanValue.normalize("NFKC").trim().toUpperCase();
    if (!normalized) return;
    const label = pendingLabels.find(
      candidate => candidate.labelId.trim().toUpperCase() === normalized
    );
    if (!label) {
      toast.error("検品待ちの商品IDに一致しません");
      setScanValue("");
      focusScanInput();
      return;
    }
    await processLabel(label, "stocked");
  }

  return (
    <div className="space-y-5">
      <DefectiveInspectionDialog
        label={defectiveLabel}
        busy={inspectMutation.isPending || uploadMutation.isPending}
        onClose={() => setDefectiveLabel(null)}
        onSubmit={submitDefective}
      />
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-950">
          <CheckCircle2 className="h-5 w-5" />
          合格した商品だけラベルを貼る
        </h2>
        <p className="mt-1 text-sm text-emerald-900">
          合格品にラベルを貼り、商品IDをスキャンすると在庫化します。不良品にはラベルを貼りません。
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            ref={inputRef}
            value={scanValue}
            onChange={event => setScanValue(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") void submitAcceptedScan();
            }}
            placeholder="合格品に貼った7文字の商品IDをスキャン"
            autoComplete="off"
            className="h-12 bg-white font-mono text-base"
          />
          <Button
            type="button"
            className="h-12"
            onClick={() => void submitAcceptedScan()}
            disabled={!scanValue.trim() || inspectMutation.isPending}
          >
            {inspectMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PackageCheck className="mr-2 h-4 w-4" />
            )}
            合格・在庫化
          </Button>
        </div>
      </section>

      {boxes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <ClipboardCheck className="mx-auto h-8 w-8 text-emerald-600" />
          <div className="mt-2 font-semibold">検品待ちは0台です</div>
        </div>
      ) : (
        boxes.map(box => (
          <article
            key={box.key}
            className="rounded-xl border bg-card p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-mono font-bold">
                  {box.trackingNumber || "追跡番号なし"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {carrierLabel(box)} / {box.supplierName || "仕入先不明"}
                </div>
              </div>
              <Badge>{box.labels.length.toLocaleString()}台</Badge>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {box.labels.map(label => (
                <div
                  key={label.labelId}
                  className="rounded-lg border bg-background p-3"
                >
                  <LabelDetails label={label} />
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 border-amber-300 text-amber-800 hover:bg-amber-50"
                      onClick={() => setDefectiveLabel(label)}
                      disabled={
                        inspectMutation.isPending || uploadMutation.isPending
                      }
                    >
                      <TriangleAlert className="mr-2 h-4 w-4" />
                      不良（国内販売）
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void processLabel(label, "returned")}
                      disabled={inspectMutation.isPending}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      仕入先へ返品
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))
      )}
    </div>
  );
}

function ReviewPhase({
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
  const outcomeLabel: Record<InspectionOutcome, string> = {
    stocked: "在庫化",
    defective: "不良在庫",
    returned: "仕入先返品",
  };
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
            <div className="text-sm font-medium">検品待ち</div>
            <div className="text-3xl font-bold tabular-nums">
              {pendingCount.toLocaleString()}台
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">直近の処理結果</h2>
        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            荷受けデスクでの検品結果はまだありません
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
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(item.processedAt)}
                  </span>
                </div>
                <div className="mt-3">
                  <LabelDetails label={item} />
                </div>
                {item.outcome === "defective" ? (
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

function DefectiveMarketRefresh({
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

function DefectiveGroupingPanel() {
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

export default function InboundDesk() {
  const [phase, setPhase] = useState<Phase>("receive");
  const snapshotQuery = trpc.inventory.inboundDesk.snapshot.useQuery(
    undefined,
    {
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    }
  );
  const summaryQuery = trpc.inventory.orderManagement.getSummary.useQuery(
    undefined,
    {
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    }
  );

  const labels = (snapshotQuery.data?.labels ?? []) as InboundLabel[];
  const pendingLabels = useMemo(
    () => labels.filter(label => label.status === "received"),
    [labels]
  );
  const boxes = useMemo(
    () => groupInboundBoxes(pendingLabels),
    [pendingLabels]
  );
  const rollups = useMemo(
    () =>
      buildInboundInvoiceRollups(
        (summaryQuery.data ?? []) as InboundInvoiceSummary[],
        pendingLabels
      ),
    [pendingLabels, summaryQuery.data]
  );

  async function refresh() {
    await Promise.all([snapshotQuery.refetch(), summaryQuery.refetch()]);
  }

  if (snapshotQuery.isLoading || summaryQuery.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-3 md:p-6">
      <header>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <PackageOpen className="h-4 w-4" />
          取引ハブ
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">荷受け</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          段ボールを開ける前に中身と引当先を確認し、検品を通ったものだけ在庫にします。
        </p>
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

      <PhaseNavigation
        phase={phase}
        onChange={setPhase}
        boxCount={boxes.length}
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
          rollups={rollups}
          isRefreshing={snapshotQuery.isFetching || summaryQuery.isFetching}
          onRefresh={refresh}
        />
      ) : null}
      {phase === "inspect" ? (
        <InspectPhase boxes={boxes} onRefresh={refresh} />
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
