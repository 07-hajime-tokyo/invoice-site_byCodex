import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  invoiceAllocation,
  type InboundBox,
  type InboundLabel,
} from "@/inventory/lib/inboundDesk";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  PackageCheck,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  DefectiveInspectionDialog,
  fileAsBase64,
  type DefectTag,
} from "@/inventory/components/DefectiveInspectionDialog";
import {
  InspectionDraft,
  loadInspectionDraft,
  InspectionDecision,
  saveInspectionDraft,
} from "./inspectionDraft";
import {
  carrierLabel,
  OUTCOME_LABELS,
  DEFECT_DESTINATIONS,
} from "./presentation";
import { LabelDetails } from "./sharedUi";

/**
 * 動作確認フェーズが開発の途中から入ったため、それ以前に荷受けした個体が検品待ちに残っている。
 * 既に出庫済みのものも混ざるので、遡って動作確認はせず待ち行列から外すだけにする。
 * 在庫は動かさない。
 */
export function BacklogCloseCard({
  pendingLabels,
  onDone,
}: {
  pendingLabels: InboundLabel[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [cutoff, setCutoff] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
  );
  const utils = trpc.useUtils();
  const close = trpc.inventory.inboundDesk.closeInspectionBacklog.useMutation({
    onSuccess: result => {
      toast.success(`${result.closed}件を動作確認済みにしました（在庫は動かしていません）`);
      void utils.inventory.inboundDesk.snapshot.invalidate();
      setOpen(false);
      onDone();
    },
    onError: error => toast.error(`失敗しました: ${error.message}`),
  });

  const targets = useMemo(
    () => pendingLabels.filter(label => (label.receivedAt ?? "") < `${cutoff}T00:00:00`),
    [cutoff, pendingLabels]
  );
  const olderThanToday = pendingLabels.length - targets.length;

  if (pendingLabels.length === 0) return null;

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50/60 p-3">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-amber-900">
            過去に荷受けしたぶんが検品待ちに残っています（現在 {pendingLabels.length}台）。
            遡って動作確認しないものは、まとめて外せます。
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            まとめて動作確認済みにする
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="backlog-cutoff" className="text-sm font-medium">
              この日より前の荷受け分
            </label>
            <Input
              id="backlog-cutoff"
              type="date"
              value={cutoff}
              onChange={event => setCutoff(event.target.value)}
              className="h-9 w-40"
            />
            <span className="text-sm font-semibold">対象 {targets.length}台</span>
            <span className="text-xs text-muted-foreground">（残す {olderThanToday}台）</span>
          </div>
          <p className="text-xs text-amber-900">
            在庫・入庫履歴・やることには一切触れません。待ち行列から外すだけです。
            すでに出庫済みの個体が混ざっていても在庫は増えません。作業ログに残ります。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={close.isPending || targets.length === 0}
              onClick={() => {
                if (
                  !window.confirm(
                    `${cutoff} より前に荷受けした ${targets.length}台を動作確認済みにします。\n在庫は動かしません。よろしいですか。`
                  )
                )
                  return;
                close.mutate({ receivedBefore: cutoff, dryRun: false });
              }}
            >
              {close.isPending ? "処理中…" : `${targets.length}台を動作確認済みにする`}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              やめる
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function InspectPhase({
  boxes,
  onRefresh,
}: {
  boxes: InboundBox[];
  onRefresh: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [draft, setDraft] = useState<InspectionDraft>(() =>
    loadInspectionDraft()
  );
  const [defectiveTarget, setDefectiveTarget] = useState<InboundLabel | null>(
    null
  );
  const [isCommitting, setIsCommitting] = useState(false);
  const inspectMutation = trpc.inventory.inboundDesk.inspect.useMutation();
  const uploadMutation =
    trpc.inventory.inboundDesk.uploadDefectPhotos.useMutation();
  const utils = trpc.useUtils();
  const pendingLabels = useMemo(
    () => boxes.flatMap(box => box.labels),
    [boxes]
  );

  // 判定済みだが未登録のものだけを数える。登録済みは一覧から消えるので下書きからも落とす。
  const draftEntries = useMemo(
    () =>
      pendingLabels
        .map(label => ({ label, decision: draft[label.labelId] }))
        .filter(
          (
            entry
          ): entry is { label: InboundLabel; decision: InspectionDecision } =>
            Boolean(entry.decision?.outcome)
        ),
    [draft, pendingLabels]
  );

  const focusScanInput = () => {
    if (window.matchMedia("(hover: none)").matches) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    focusScanInput();
  }, []);

  function defaultReplacement(label: InboundLabel) {
    return Boolean(invoiceAllocation(label.legacyManagementNo).invoiceNo);
  }

  function updateDraft(label: InboundLabel, patch: Partial<InspectionDecision>) {
    setDraft(current => {
      const currentDecision = current[label.labelId] ?? {
        outcome: null,
        requestReplacement: defaultReplacement(label),
      };
      const next = {
        ...current,
        [label.labelId]: { ...currentDecision, ...patch },
      };
      saveInspectionDraft(next);
      return next;
    });
  }

  /** 一覧から消えた（＝登録済みの）商品の下書きを掃除する */
  function pruneDraft(labelIds: string[]) {
    setDraft(current => {
      const next = { ...current };
      for (const labelId of labelIds) delete next[labelId];
      saveInspectionDraft(next);
      return next;
    });
  }

  /** 下書きの判定をまとめて入庫登録する */
  async function commitDraft() {
    if (isCommitting || draftEntries.length === 0) return;
    const defectCount = draftEntries.filter(
      entry => entry.decision.outcome !== "stocked"
    ).length;
    const confirmMessage = defectCount
      ? `${draftEntries.length}台を入庫登録します。うち${defectCount}台は不良として仕分けます。よろしいですか？`
      : `${draftEntries.length}台を入庫登録します。よろしいですか？`;
    if (!window.confirm(confirmMessage)) return;

    setIsCommitting(true);
    const done: string[] = [];
    const failed: string[] = [];
    let actionItemCount = 0;
    try {
      for (const entry of draftEntries) {
        try {
          const result = await inspectMutation.mutateAsync({
            labelId: entry.label.labelId,
            outcome: entry.decision.outcome!,
            requestReplacement: entry.decision.requestReplacement,
            defectTags: entry.decision.defectTags,
            defectNote: entry.decision.defectNote,
            defectPhotos: entry.decision.defectPhotos,
          });
          if (result.actionItemId) actionItemCount += 1;
          done.push(entry.label.labelId);
        } catch (error) {
          failed.push(entry.label.labelId);
          toast.error(
            `${entry.label.labelId}: ${
              error instanceof Error ? error.message : "登録できませんでした"
            }`
          );
        }
      }
      if (done.length) {
        pruneDraft(done);
        toast.success(
          actionItemCount
            ? `${done.length}台を入庫登録し、代替品の仕入れ依頼を${actionItemCount}件作成しました`
            : `${done.length}台を入庫登録しました`
        );
        await Promise.all([
          utils.inventory.inboundDesk.snapshot.invalidate(),
          utils.inventory.orderManagement.getSummary.invalidate(),
          utils.inventory.actionItems.list.invalidate(),
          utils.inventory.zaico.getInventories.invalidate(),
        ]);
        await onRefresh();
      }
      if (failed.length)
        toast.error(`${failed.length}台は登録できませんでした（下書きに残しています）`);
    } finally {
      setIsCommitting(false);
      focusScanInput();
    }
  }

  /** スキャンした商品を「動作確認OK」として下書きに入れる */
  function submitAcceptedScan() {
    const normalized = scanValue.normalize("NFKC").trim().toUpperCase();
    if (!normalized) return;
    const label = pendingLabels.find(
      candidate => candidate.labelId.trim().toUpperCase() === normalized
    );
    if (!label) {
      toast.error("動作確認待ちの商品IDに一致しません");
      setScanValue("");
      focusScanInput();
      return;
    }
    updateDraft(label, {
      outcome: "stocked",
      requestReplacement: false,
      defectTags: undefined,
      defectNote: undefined,
      defectPhotos: undefined,
    });
    toast.success(`${label.labelId} を動作確認OKにしました`);
    setScanValue("");
    focusScanInput();
  }

  async function submitDefective(value: {
    defectTags: DefectTag[];
    defectNote: string;
    files: File[];
  }) {
    if (!defectiveTarget) return;
    try {
      const kinds = ["whole", "defect", "accessory"] as const;
      const uploadFiles = await Promise.all(
        value.files.map(async (file, index) => ({
          base64: await fileAsBase64(file),
          mimeType: file.type || "image/heic",
          kind: kinds[index] ?? "defect",
        }))
      );
      const photos = uploadFiles.length
        ? (
            await uploadMutation.mutateAsync({
              labelId: defectiveTarget.labelId,
              files: uploadFiles,
            })
          ).photos
        : [];
      updateDraft(defectiveTarget, {
        outcome: "junk",
        defectTags: value.defectTags,
        defectNote: value.defectNote,
        defectPhotos: photos,
      });
      setDefectiveTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "不良写真を登録できませんでした"
      );
    }
  }

  return (
    <div className="space-y-5">
      <DefectiveInspectionDialog
        label={defectiveTarget}
        busy={inspectMutation.isPending || uploadMutation.isPending}
        onClose={() => setDefectiveTarget(null)}
        onSubmit={submitDefective}
      />
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-950">
          <CheckCircle2 className="h-5 w-5" />
          一つずつ動作確認して合否を入れる
        </h2>
        <p className="mt-1 text-sm text-emerald-900">
          合格品にラベルを貼って商品IDをスキャンすると「動作確認OK」に入ります。
          不良は下のカードから仕分け先を選んでください。判定は一時保存され、
          「入庫登録」を押すまで在庫には反映されません。
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            ref={inputRef}
            value={scanValue}
            onChange={event => setScanValue(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") submitAcceptedScan();
            }}
            placeholder="合格品に貼った7文字の商品IDをスキャン"
            autoComplete="off"
            className="h-12 bg-white font-mono text-base"
          />
          <Button
            type="button"
            className="h-12"
            onClick={() => submitAcceptedScan()}
            disabled={!scanValue.trim() || isCommitting}
          >
            <PackageCheck className="mr-2 h-4 w-4" />
            動作確認OK
          </Button>
        </div>
      </section>

      <section
        className={cn(
          "sticky top-2 z-10 rounded-xl border p-4 shadow-sm",
          draftEntries.length
            ? "border-blue-200 bg-blue-50"
            : "border-dashed bg-background"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-muted-foreground">
              判定済み（一時保存）
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {draftEntries.length.toLocaleString()}
              <span className="ml-1 text-base font-normal text-muted-foreground">
                / {pendingLabels.length.toLocaleString()}台
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (!draftEntries.length) return;
                if (!window.confirm("入力した判定をすべて取り消しますか？")) return;
                pruneDraft(draftEntries.map(entry => entry.label.labelId));
              }}
              disabled={!draftEntries.length || isCommitting}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              判定を取り消す
            </Button>
            <Button
              type="button"
              className="h-11"
              onClick={() => void commitDraft()}
              disabled={!draftEntries.length || isCommitting}
            >
              {isCommitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ClipboardCheck className="mr-2 h-4 w-4" />
              )}
              入庫登録（{draftEntries.length}台）
            </Button>
          </div>
        </div>
        {draftEntries.length ? (
          <p className="mt-2 text-xs text-blue-900">
            この判定は端末に保存されています。QR印刷などへ移動して戻ってきても消えません。
          </p>
        ) : null}
      </section>

      {boxes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <ClipboardCheck className="mx-auto h-8 w-8 text-emerald-600" />
          <div className="mt-2 font-semibold">動作確認待ちは0台です</div>
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
              {box.labels.map(label => {
                const decision = draft[label.labelId];
                const decided = decision?.outcome ?? null;
                const replacementChecked =
                  decision?.requestReplacement ?? defaultReplacement(label);
                return (
                  <div
                    key={label.labelId}
                    className={cn(
                      "rounded-lg border bg-background p-3",
                      decided === "stocked" && "border-emerald-300 bg-emerald-50/60",
                      decided && decided !== "stocked" && "border-amber-300 bg-amber-50/60"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <LabelDetails label={label} />
                      {decided ? (
                        <Badge
                          variant={decided === "stocked" ? "default" : "secondary"}
                          className="shrink-0"
                        >
                          {OUTCOME_LABELS[decided]}
                          {decided !== "stocked" && replacementChecked
                            ? "＋代替品仕入"
                            : ""}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Button
                        type="button"
                        variant={decided === "stocked" ? "default" : "outline"}
                        className={cn(
                          decided !== "stocked" &&
                            "border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                        )}
                        onClick={() =>
                          updateDraft(label, {
                            outcome: "stocked",
                            requestReplacement: false,
                          })
                        }
                        disabled={isCommitting}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        動作確認OK
                      </Button>
                      {decided ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            updateDraft(label, {
                              outcome: null,
                              defectTags: undefined,
                              defectNote: undefined,
                              defectPhotos: undefined,
                            })
                          }
                          disabled={isCommitting}
                        >
                          判定をやり直す
                        </Button>
                      ) : null}
                    </div>
                    <div className="mt-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        不良のときの仕分け先
                      </div>
                      <div className="mt-1 grid gap-2 sm:grid-cols-2">
                        {DEFECT_DESTINATIONS.map(destination => (
                          <Button
                            key={destination.value}
                            type="button"
                            size="sm"
                            variant={
                              decided === destination.value ? "default" : "outline"
                            }
                            className={cn(
                              decided !== destination.value &&
                                "border-amber-300 text-amber-800 hover:bg-amber-50"
                            )}
                            title={destination.hint}
                            onClick={() => {
                              if (destination.value === "junk") {
                                setDefectiveTarget(label);
                                return;
                              }
                              updateDraft(label, {
                                outcome: "returned",
                                defectTags: undefined,
                                defectNote: undefined,
                                defectPhotos: undefined,
                              });
                            }}
                            disabled={isCommitting}
                          >
                            {destination.value === "returned" ? (
                              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                            ) : (
                              <TriangleAlert className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            {destination.label}
                          </Button>
                        ))}
                      </div>
                      {decided !== "stocked" ? (
                        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
                          <Checkbox
                            checked={replacementChecked}
                            onCheckedChange={checked =>
                              updateDraft(label, {
                                requestReplacement: checked === true,
                              })
                            }
                            disabled={isCommitting}
                          />
                          <span>
                            代替品を仕入れる（野田さんへ依頼）
                            <span className="block text-xs text-blue-800">
                              {invoiceAllocation(label.legacyManagementNo).invoiceNo
                                ? "インボイス引当のため初期値ON"
                                : "在庫用のため初期値OFF"}
                            </span>
                          </span>
                        </label>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
