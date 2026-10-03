import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  boxShippedLabel,
  matchInboundLabels,
  type InboundBox,
  type InboundInvoiceRollup,
  type InboundLabel,
  type IncomingSummary,
} from "@/inventory/lib/inboundDesk";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Loader2,
  PackageOpen,
  RefreshCw,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import { allocationBadge } from "./presentation";
import { UndoButton, InboundBoxCard, InvoiceRollupTable } from "./sharedUi";

/**
 * 到着予定＝追跡番号が登録済みで、まだ荷受けしていない荷物。
 * ここが見えないと「今日は何箱来るのか」「読んだのに当たらないのは何か」が分からない。
 */
export function IncomingSection({
  incoming,
  onRefresh,
}: {
  incoming: IncomingSummary;
  onRefresh: () => Promise<void>;
}) {
  const { boxes, labelCount, untrackedLabels } = incoming;
  const utils = trpc.useUtils();
  // 現物はもう届いていて棚卸しで在庫も合わせ済み、という記録だけが残ることがある。
  // ここで入庫処理を通すと在庫が二重に増えるので、記録だけ閉じる。
  const closeBacklog = trpc.inventory.inboundDesk.closeArrivingBacklog.useMutation({
    onSuccess: async result => {
      toast.success(`${result.closedPurchases}件の記録を閉じました（在庫は動かしていません）`);
      await utils.inventory.inboundDesk.snapshot.invalidate();
      await onRefresh();
    },
    onError: error => toast.error(`閉じられませんでした: ${error.message}`),
  });
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">到着予定</h2>
        <Badge variant="secondary">
          {boxes.length.toLocaleString()}箱 / {labelCount.toLocaleString()}台
        </Badge>
        <span className="text-xs text-muted-foreground">
          追跡番号が登録済みで、まだ荷受けしていないぶん
        </span>
      </div>

      {untrackedLabels.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm text-amber-950">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">
                追跡番号が未登録：{untrackedLabels.length.toLocaleString()}台
              </div>
              <p className="mt-1 text-xs">
                この個体は伝票を読んでも当たりません。発注登録の「追跡番号を編集」で登録すると、到着予定に出てきます。
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {untrackedLabels.slice(0, 12).map(label => (
                  <Badge key={label.labelId} variant="outline">
                    {label.labelId} / {label.legacyManagementNo || label.title}
                  </Badge>
                ))}
                {untrackedLabels.length > 12 ? (
                  <span className="text-xs">
                    ほか {untrackedLabels.length - 12}台
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {boxes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          到着予定はありません
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[940px] text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">発送 / 登録</th>
                <th className="px-3 py-2">追跡番号</th>
                <th className="px-3 py-2">仕入先</th>
                <th className="px-3 py-2 text-right">台数</th>
                <th className="px-3 py-2">引当先</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...boxes]
                .sort((a, b) => (boxShippedLabel(b).ageDays ?? -1) - (boxShippedLabel(a).ageDays ?? -1))
                .map(box => {
                const allocations = Array.from(
                  new Set(box.labels.map(label => allocationBadge(label)))
                );
                const shipped = boxShippedLabel(box);
                return (
                  <tr key={box.key}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={cn(shipped.ageDays !== null && shipped.ageDays >= 14 && "font-semibold text-amber-700")}>
                        {shipped.text}
                      </span>
                      {shipped.ageDays !== null && shipped.ageDays >= 14 ? (
                        <span className="ml-1 text-xs text-amber-700">{shipped.ageDays}日前</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {box.trackingNumber}
                    </td>
                    <td className="px-3 py-2">{box.supplierName || "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {box.labels.length}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {allocations.map(value => (
                          <Badge key={value} variant="outline">
                            {value}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={closeBacklog.isPending}
                        title="現物はもう届いていて在庫も合っている場合に、この記録だけを閉じます。在庫と入庫履歴は動かしません"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `${box.trackingNumber} の記録を閉じます。
対象 ${box.labels.length}台
在庫と入庫履歴は動かしません。`
                            )
                          )
                            return;
                          closeBacklog.mutate({
                            trackingNumber: box.trackingNumber,
                            labelIds: box.labels.map(label => label.labelId),
                            reason: `到着予定の取り残し（${shipped.text}）`,
                            operatorName: getCurrentWorkWorkerName("荷受担当"),
                          });
                        }}
                      >
                        届いている
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * 荷受けの場で追跡番号を登録する。
 *
 * 仕入れ側の追跡番号登録が追いついていないと、伝票を読んでも当たらず荷受けに進めない。
 * 現物は目の前にあるので、開封して商品IDを読み、その場で番号を結び付けられるようにする。
 * 登録すると到着予定に出てきて、伝票スキャンが当たるようになる。
 */
export function TrackingRegisterForm({
  trackingNumber,
  labels,
  onDone,
}: {
  trackingNumber: string;
  labels: InboundLabel[];
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [picked, setPicked] = useState<InboundLabel[]>([]);
  const [busy, setBusy] = useState(false);
  const upsert = trpc.inventory.purchaseExtra.upsert.useMutation();

  const byLabelId = useMemo(
    () => new Map(labels.map(label => [label.labelId.trim().toUpperCase(), label])),
    [labels]
  );

  function add(raw: string) {
    const labelId = raw.normalize("NFKC").trim().toUpperCase();
    if (!labelId) return;
    const label = byLabelId.get(labelId);
    if (!label) {
      toast.error(`${labelId} は追跡番号が未登録の一覧にありません`);
      return;
    }
    setPicked(current => (current.some(row => row.labelId === label.labelId) ? current : [...current, label]));
    setScanValue("");
  }

  async function submit() {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    let done = 0;
    try {
      for (const label of picked) {
        if (!label.purchaseId) {
          toast.error(`${label.labelId} は仕入れ行に紐付いていません。発注登録から登録してください`);
          continue;
        }
        await upsert.mutateAsync({
          zaicoId: label.purchaseId,
          trackingNumber,
          inventoryId: label.localInventoryId ?? undefined,
          managementNo: label.legacyManagementNo || undefined,
          labelId: label.labelId,
        });
        done += 1;
      }
      if (done > 0) {
        toast.success(`${done}台に追跡番号 ${trackingNumber} を登録しました`);
        setPicked([]);
        setOpen(false);
        await onDone();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "追跡番号の登録に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setOpen(true)}>
        この番号を商品IDに登録
      </Button>
    );
  }

  return (
    <div className="mt-2 w-full rounded border border-amber-400 bg-white p-2">
      <p className="text-xs text-amber-950">
        箱を開けて、中身の商品IDラベルを読んでください。複数まとめて登録できます。
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          value={scanValue}
          onChange={event => setScanValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") add(scanValue);
          }}
          placeholder="商品ID（英字7文字）をスキャン"
          autoComplete="off"
          className="h-9 w-64 font-mono"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => add(scanValue)}>
          追加
        </Button>
        <Button type="button" size="sm" disabled={picked.length === 0 || busy} onClick={() => void submit()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {picked.length}台に登録
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setPicked([]); }}>
          やめる
        </Button>
      </div>
      {picked.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {picked.map(label => (
            <Badge key={label.labelId} variant="outline">
              {label.labelId} / {label.legacyManagementNo || label.title}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** スキャン結果の区分。「0台」と「照合できなかった」を混ぜないために分ける。 */
export type ScanOutcome = "received" | "already" | "unregistered" | "not-a-tracking";

export type ScanResult = {
  raw: string;
  outcome: ScanOutcome;
  matches: InboundLabel[];
  message: string;
  hint?: string;
};

export function ReceivePhase({
  labels,
  boxes,
  incoming,
  rollups,
  isRefreshing,
  onRefresh,
}: {
  labels: InboundLabel[];
  boxes: InboundBox[];
  incoming: IncomingSummary;
  rollups: InboundInvoiceRollup[];
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  // 当たらなかった読み取りは消さずに積む。あとで発注登録側を直すときの手掛かりになる。
  const [unmatchedScans, setUnmatchedScans] = useState<string[]>([]);
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
      // 「0台」ではなく「照合できなかった」と言い切る。
      // 追跡番号が発注登録に入っていないと、何度スキャンしても永久に当たらない。
      const looksLikeLabelId = /^[A-Za-z]{7}$/.test(raw);
      setLastScan(
        looksLikeLabelId
          ? {
              raw,
              outcome: "not-a-tracking",
              matches: [],
              message: "これは商品IDです。この画面は配送伝票の追跡番号を読みます",
              hint: "商品IDを読むのは「② 動作確認待ち」の画面です。",
            }
          : {
              raw,
              outcome: "unregistered",
              matches: [],
              message: "この追跡番号は取引ハブに登録されていません",
              hint: "発注登録 → 該当行の「追跡番号を編集」で登録してから、もう一度スキャンしてください。登録するまで何度読んでも当たりません。",
            }
      );
      if (!looksLikeLabelId) {
        setUnmatchedScans(current =>
          current.includes(raw) ? current : [raw, ...current].slice(0, 20)
        );
      }
      setScanValue("");
      focusScanInput();
      return;
    }
    const receivable = matches.filter(label => label.status === "ordered");
    if (receivable.length === 0) {
      setLastScan({
        raw,
        outcome: "already",
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
        outcome: "received",
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
              lastScan.outcome === "received" &&
                "border-emerald-300 bg-emerald-50 text-emerald-950",
              lastScan.outcome === "already" &&
                "border-slate-300 bg-muted/40",
              lastScan.outcome === "unregistered" &&
                "border-amber-400 bg-amber-50 text-amber-950",
              lastScan.outcome === "not-a-tracking" &&
                "border-sky-300 bg-sky-50 text-sky-950"
            )}
          >
            <div className="font-mono text-xs">読取: {lastScan.raw}</div>
            <div className="mt-1 flex items-start gap-2 font-semibold">
              {lastScan.outcome === "unregistered" ? (
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              ) : null}
              <span>{lastScan.message}</span>
            </div>
            {lastScan.hint ? (
              <p className="mt-1 text-xs opacity-90">{lastScan.hint}</p>
            ) : null}
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
        {unmatchedScans.length > 0 ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm text-amber-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                登録されていなかった読取 {unmatchedScans.length}件
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setUnmatchedScans([])}
              >
                消す
              </Button>
            </div>
            <p className="mt-1 text-xs">
              仕入れ側の登録が追いついていないだけのことがあります。箱を開けて中身の商品IDを読めば、
              ここから追跡番号を登録できます。登録すると到着予定に出て、ラベルも印刷できるようになります。
            </p>
            <div className="mt-2 space-y-2">
              {unmatchedScans.map(value => (
                <div key={value} className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">{value}</code>
                  <TrackingRegisterForm
                    trackingNumber={value}
                    labels={incoming.untrackedLabels}
                    onDone={async () => {
                      setUnmatchedScans(current => current.filter(row => row !== value));
                      await onRefresh();
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <IncomingSection incoming={incoming} onRefresh={onRefresh} />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">荷受け済み・動作確認待ち</h2>
          <Badge variant="secondary">
            {boxes.length.toLocaleString()}箱 /{" "}
            {boxes
              .reduce((sum, box) => sum + box.labels.length, 0)
              .toLocaleString()}
            台
          </Badge>
          {boxes.length ? (
            <UndoButton
              kind="receive"
              labelIds={boxes.flatMap(box => box.labels.map(label => label.labelId))}
              label="表示中を一括取消"
              onDone={onRefresh}
            />
          ) : null}
        </div>
        {boxes.length > 0 ? (
          boxes.map(box => (
            <InboundBoxCard
              key={box.key}
              box={box}
              undoLabelIds={
                box.trackingNumber
                  ? matchInboundLabels(box.trackingNumber, labels).map(
                      label => label.labelId
                    )
                  : box.labels.map(label => label.labelId)
              }
              onRefresh={onRefresh}
            />
          ))
        ) : (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            動作確認待ちの箱はありません
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">インボイス別の埋まり具合</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            動作確認待ちがすべて合格した場合の見込みです。
          </p>
        </div>
        <InvoiceRollupTable rollups={rollups} projected />
      </section>
    </div>
  );
}
