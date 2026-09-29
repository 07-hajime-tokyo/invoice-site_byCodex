import { ProductQrCode } from "./ProductQrCode";
import { openEcohaiTracking } from "./trackingNavigation";
import { EmptyState } from "./EmptyState";
import { isShippableLabelStatus, mergeLabelViewsById } from "./labelMerging";
import { buildLabelViews } from "./registrationLabelViews";
import { labelStatusLabel, labelBadgeClass } from "./labelStatus";
import { normalizedLabelStatus } from "./rowStatus";
import type { PurchaseRow } from "./dataTypes";
import type { LabelView } from "./viewTypes";
import { TRACKING_CARRIER_LABELS, normalizedTrackingNumber, getPurchaseTrackingMeta } from "./tracking";
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { getCarrierColor } from "@/inventory/lib/tracking";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CheckCircle2, ClipboardCheck, ExternalLink, Loader2, PackageCheck, ScanLine, Search } from "lucide-react";
import { useQrCameraScanner, extractScannedLabelId } from "./scanInput";

/** 入庫スキャンの履歴。QR印刷や動作確認ページへ移動して戻っても残るよう端末に保存する。 */
export const SCAN_HISTORY_STORAGE_KEY = "purchase-registration-scan-history-v1";

export const SCAN_HISTORY_LIMIT = 50;

export type ScanHistoryEntry = {
  labelId: string;
  title: string;
  legacyManagementNo: string;
  allocationLabel: string;
  supplierName: string;
  scannedAt: string;
};

export function loadScanHistory(): ScanHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SCAN_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is ScanHistoryEntry => {
      return Boolean(entry) && typeof (entry as ScanHistoryEntry).labelId === "string";
    });
  } catch {
    return [];
  }
}

export function saveScanHistory(entries: ScanHistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCAN_HISTORY_STORAGE_KEY, JSON.stringify(entries.slice(0, SCAN_HISTORY_LIMIT)));
  } catch {
    // 保存できなくてもスキャン作業自体は続けられるので握りつぶす
  }
}

export function formatScanTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function isReceivableScanCandidate(label: LabelView): boolean {
  const status = normalizedLabelStatus(label.rawStatus);
  return (
    Boolean(label.labelId.trim()) &&
    !isShippableLabelStatus(status) &&
    status !== "shipped" &&
    status !== "returned" &&
    status !== "cancelled"
  );
}

export function ScannedLabelPreview({ label }: { label: LabelView }) {
  const trackingNumber = label.trackingNumber?.trim();
  const trackingInfo = trackingNumber ? getPurchaseTrackingMeta(trackingNumber, label.carrier) : null;

  return (
    <div className="mt-3 flex flex-col gap-4 rounded-md border border-emerald-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="font-mono text-3xl font-bold tracking-wide text-slate-950">{label.labelId}</div>
        {label.allocationLabel ? (
          <div className="mt-2 text-sm font-semibold text-slate-700">{label.allocationLabel}</div>
        ) : null}
        <div className="mt-1 text-xs text-muted-foreground">旧管理番号: {label.legacyManagementNo}</div>
        <div className="mt-3 text-base font-semibold text-slate-950">{label.title}</div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{label.status}</Badge>
          <Badge variant="outline">{label.supplier.name}</Badge>
        </div>
        {trackingNumber && trackingInfo ? (
          <div className="mt-3 inline-flex max-w-full flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-sm font-semibold text-blue-900">
            <span className={`rounded px-1.5 py-0.5 text-xs ${getCarrierColor(trackingInfo.carrier)}`}>
              {TRACKING_CARRIER_LABELS[trackingInfo.carrier]}
            </span>
            <span className="text-xs text-blue-700">追跡番号</span>
            <span className="font-mono text-base font-bold text-slate-950">{trackingNumber}</span>
            {trackingInfo.isEcohai ? (
              <button
                type="button"
                onClick={() => openEcohaiTracking(trackingNumber)}
                className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <ExternalLink className="h-3 w-3" />
                追跡
              </button>
            ) : trackingInfo.trackingUrl ? (
              <a
                href={trackingInfo.trackingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <ExternalLink className="h-3 w-3" />
                追跡
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded border bg-white p-2">
        <ProductQrCode value={label.labelId} />
      </div>
    </div>
  );
}

export function ScanPanel({
  labels,
  onReceivedLabel,
}: {
  labels: LabelView[];
  onReceivedLabel?: (label: LabelView) => void;
}) {
  const utils = trpc.useUtils();
  const [scanValue, setScanValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(() => new Set());
  const [bulkReceivePending, setBulkReceivePending] = useState(false);
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>(() => loadScanHistory());
  const resumeCameraAfterConfirmRef = useRef(false);

  function pushScanHistory(entry: ScanHistoryEntry) {
    setScanHistory((current) => {
      // 同じ商品IDを読み直したときは最新の1件だけ残す
      const next = [entry, ...current.filter((item) => item.labelId !== entry.labelId)].slice(0, SCAN_HISTORY_LIMIT);
      saveScanHistory(next);
      return next;
    });
  }

  function clearScanHistory() {
    if (scanHistory.length === 0) return;
    if (!window.confirm("スキャン履歴を消しますか？")) return;
    setScanHistory([]);
    saveScanHistory([]);
  }
  // バーコードリーダーはキーボードとして打ち込むので、入力欄に常にフォーカスを戻す
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const focusScanInput = () => {
    if (window.matchMedia("(hover: none)").matches) return; // スマホでキーボードが出るのを防ぐ
    window.setTimeout(() => scanInputRef.current?.focus(), 0);
  };
  const receiveMutation = trpc.inventory.orderManagement.receivePurchaseLabel.useMutation();
  type ReceivePurchaseLabelResult = Awaited<ReturnType<typeof receiveMutation.mutateAsync>>;
  const qrScanner = useQrCameraScanner((rawValue) => {
    openReceiveConfirm(rawValue, { resumeCameraAfterSuccess: true });
  });
  const scanSearchValue = scanValue.trim();
  const { data: serverScanData } = trpc.inventory.zaico.getPurchasesWithCategoryPage.useQuery(
    {
      page: 1,
      pageSize: 100,
      category: null,
      status: null,
      search: scanSearchValue || null,
      inboundClass: null,
    },
    {
      enabled: scanSearchValue.length >= 4,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  );
  const serverScanLabels = useMemo(
    () => buildLabelViews((serverScanData?.items ?? []) as PurchaseRow[]),
    [serverScanData?.items],
  );
  const scanLabels = useMemo(() => mergeLabelViewsById(labels, serverScanLabels), [labels, serverScanLabels]);

  function getScanTarget(value: string) {
    const normalizedValue = value.trim().normalize("NFKC").toLowerCase();
    const scannedId = extractScannedLabelId(value);
    const normalizedTrackingValue = normalizedTrackingNumber(value).toLowerCase();
    const exactLabel = normalizedValue
      ? scanLabels.find(
          (candidate) =>
            candidate.labelId.toLowerCase() === normalizedValue ||
            (scannedId && candidate.labelId.toLowerCase() === scannedId.toLowerCase()),
        )
      : null;
    const candidates = normalizedValue
      ? mergeLabelViewsById(
          scanLabels.filter((candidate) => {
            const labelId = candidate.labelId.trim().toLowerCase();
            const managementNo = candidate.legacyManagementNo.toLowerCase();
            const trackingNumber = normalizedTrackingNumber(candidate.trackingNumber ?? "").toLowerCase();
            return (
              labelId === normalizedValue ||
              (scannedId && labelId === scannedId.toLowerCase()) ||
              managementNo.includes(normalizedValue) ||
              (normalizedTrackingValue.length >= 4 &&
                trackingNumber.length > 0 &&
                (trackingNumber.includes(normalizedTrackingValue) || normalizedTrackingValue.includes(trackingNumber)))
            );
          }),
        )
      : null;
    return {
      matched: exactLabel ?? null,
      candidates: (candidates ?? []).sort((a, b) => {
        const aReceived = isShippableLabelStatus(a.rawStatus) ? 1 : 0;
        const bReceived = isShippableLabelStatus(b.rawStatus) ? 1 : 0;
        if (aReceived !== bReceived) return aReceived - bReceived;
        return a.labelId.localeCompare(b.labelId, "ja", { numeric: true });
      }),
      receiveLabelId: exactLabel?.labelId ?? scannedId,
    };
  }

  const scanTarget = getScanTarget(scanValue);
  const confirmTarget = getScanTarget(confirmValue);
  const matched = scanTarget.matched;
  const candidateLabels = scanTarget.candidates;
  const receiveLabelId = scanTarget.receiveLabelId;
  const receivableCandidateLabels = candidateLabels.filter(isReceivableScanCandidate);
  const selectedCandidateLabels = candidateLabels.filter(
    (label) => selectedCandidateIds.has(label.labelId) && isReceivableScanCandidate(label),
  );
  const selectedCandidateCount = selectedCandidateLabels.length;
  const allReceivableCandidatesSelected =
    receivableCandidateLabels.length > 0 &&
    receivableCandidateLabels.every((label) => selectedCandidateIds.has(label.labelId));
  const isReceiving = receiveMutation.isPending || bulkReceivePending;

  useEffect(() => {
    setSelectedCandidateIds((current) => (current.size === 0 ? current : new Set()));
  }, [scanSearchValue]);

  // リーダーによってはEnterを付けずに打ち込むので、商品ID（英字7文字）が末尾に揃った時点で
  // 入庫確認を自動で開く。打ち込みは一瞬で終わるため、短い猶予を置いてから判定する。
  const autoConfirmedScanRef = useRef("");
  useEffect(() => {
    const trimmed = scanValue.trim();
    const scannedId = extractScannedLabelId(trimmed);
    if (!scannedId || !trimmed.normalize("NFKC").toUpperCase().endsWith(scannedId)) {
      autoConfirmedScanRef.current = "";
      return;
    }
    if (confirmValue || isReceiving) return;
    // 一度自動で開いたものを閉じた直後に開き直さないよう、同じ入力では二度発火させない
    if (autoConfirmedScanRef.current === trimmed) return;
    const timer = window.setTimeout(() => {
      autoConfirmedScanRef.current = trimmed;
      openReceiveConfirm(trimmed);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [scanValue, confirmValue, isReceiving]);

  function markReceivedLabel(label: LabelView | null | undefined, result: ReceivePurchaseLabelResult) {
    if (!label) return;
    pushScanHistory({
      labelId: result.labelId ?? label.labelId,
      title: result.title ?? label.title,
      legacyManagementNo: result.legacyManagementNo ?? label.legacyManagementNo,
      allocationLabel: label.allocationLabel,
      supplierName: label.supplier.name,
      scannedAt: new Date().toISOString(),
    });
    onReceivedLabel?.({
      ...label,
      rawStatus: "received",
      status: labelStatusLabel("received"),
      title: result.title ?? label.title,
      legacyManagementNo: result.legacyManagementNo ?? label.legacyManagementNo,
      inventoryId: result.localInventoryId ?? label.inventoryId ?? null,
    });
  }

  async function refreshPurchaseRegistrationData() {
    await Promise.all([
      utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
      utils.inventory.zaico.getInventories.invalidate(),
      utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
    ]);
  }

  function toggleCandidateSelection(labelId: string, checked: boolean | "indeterminate") {
    setSelectedCandidateIds((current) => {
      const next = new Set(current);
      if (checked === true) {
        next.add(labelId);
      } else {
        next.delete(labelId);
      }
      return next;
    });
  }

  function toggleAllReceivableCandidates() {
    setSelectedCandidateIds((current) => {
      const next = new Set(current);
      if (allReceivableCandidatesSelected) {
        for (const label of receivableCandidateLabels) next.delete(label.labelId);
      } else {
        for (const label of receivableCandidateLabels) next.add(label.labelId);
      }
      return next;
    });
  }

  function openReceiveConfirm(
    value: string,
    options?: { resumeCameraAfterSuccess?: boolean; preserveSearchValue?: boolean },
  ) {
    const nextValue = value.trim();
    if (!nextValue) return;
    if (!options?.preserveSearchValue) {
      setScanValue(nextValue);
    }
    const target = getScanTarget(nextValue);
    if (!target.receiveLabelId) return;
    resumeCameraAfterConfirmRef.current = Boolean(options?.resumeCameraAfterSuccess);
    setConfirmValue(nextValue);
  }

  function closeReceiveConfirm() {
    resumeCameraAfterConfirmRef.current = false;
    setConfirmValue("");
    focusScanInput();
  }

  async function receiveMatchedLabel(targetValue = scanValue) {
    const target = getScanTarget(targetValue);
    if (!target.receiveLabelId || isReceiving) return;
    const shouldResumeCamera = resumeCameraAfterConfirmRef.current;
    const shouldKeepSearchValue = targetValue.trim() !== scanValue.trim();
    try {
      const result = await receiveMutation.mutateAsync({ labelId: target.receiveLabelId });
      if (result.alreadyReceived) {
        toast.info(`${result.labelId} はすでに入庫済みです`);
      } else {
        toast.success("登録しました。");
      }
      markReceivedLabel(target.matched, result);
      setSelectedCandidateIds((current) => {
        if (!current.has(result.labelId)) return current;
        const next = new Set(current);
        next.delete(result.labelId);
        return next;
      });
      if (!shouldKeepSearchValue) {
        setScanValue("");
      }
      closeReceiveConfirm();
      await refreshPurchaseRegistrationData();
      if (shouldResumeCamera) {
        window.setTimeout(() => {
          void qrScanner.startCamera();
        }, 250);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "入庫登録に失敗しました");
    }
  }

  async function receiveSelectedCandidates() {
    if (isReceiving || selectedCandidateLabels.length === 0) return;
    const targets = selectedCandidateLabels;
    const completedIds = new Set<string>();
    let receivedCount = 0;
    let alreadyReceivedCount = 0;
    let failedCount = 0;
    let firstErrorMessage: string | null = null;

    setBulkReceivePending(true);
    try {
      for (const label of targets) {
        try {
          const result = await receiveMutation.mutateAsync({ labelId: label.labelId });
          completedIds.add(result.labelId);
          if (result.alreadyReceived) {
            alreadyReceivedCount += 1;
          } else {
            receivedCount += 1;
          }
          markReceivedLabel(label, result);
        } catch (error) {
          failedCount += 1;
          firstErrorMessage ??= error instanceof Error ? error.message : null;
        }
      }

      if (receivedCount > 0) {
        toast.success(`${receivedCount.toLocaleString()}件を入庫登録しました`);
      }
      if (alreadyReceivedCount > 0) {
        toast.info(`${alreadyReceivedCount.toLocaleString()}件はすでに入庫済みです`);
      }
      if (failedCount > 0) {
        toast.error(
          firstErrorMessage
            ? `${failedCount.toLocaleString()}件の入庫登録に失敗しました: ${firstErrorMessage}`
            : `${failedCount.toLocaleString()}件の入庫登録に失敗しました`,
        );
      }

      setSelectedCandidateIds((current) => {
        if (completedIds.size === 0) return current;
        const next = new Set(current);
        for (const labelId of completedIds) next.delete(labelId);
        return next;
      });
      await refreshPurchaseRegistrationData();
    } finally {
      setBulkReceivePending(false);
    }
  }

  return (
    <div className="grid gap-3 md:gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3 md:space-y-4">
      <section className="rounded-md border bg-background p-3 md:p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold">入庫スキャン</h2>
          <div className={cn("grid gap-2 md:flex md:flex-wrap", qrScanner.cameraActive ? "grid-cols-2" : "grid-cols-1")}>
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2 md:h-9"
              onClick={qrScanner.startCamera}
              disabled={qrScanner.cameraActive}
            >
              <ScanLine className="h-4 w-4" />
              QR読取
            </Button>
            {qrScanner.cameraActive ? (
              <Button type="button" variant="outline" className="h-11 md:h-9" onClick={qrScanner.stopCamera}>
                停止
              </Button>
            ) : null}
          </div>
        </div>

        <div className={cn("mt-3 overflow-hidden rounded-md border bg-black", qrScanner.cameraActive ? "block" : "hidden")}>
          <video
            ref={qrScanner.videoRef}
            className="h-[58vh] min-h-[260px] max-h-[520px] w-full object-cover md:h-80 md:min-h-0"
            muted
            playsInline
          />
        </div>
        {qrScanner.cameraError ? <p className="mt-2 text-sm text-destructive">{qrScanner.cameraError}</p> : null}

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input
            ref={scanInputRef}
            value={scanValue}
            onChange={(event) => {
              setScanValue(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") openReceiveConfirm(scanValue);
            }}
            placeholder="商品ID・旧管理番号・追跡番号をスキャン/入力"
            autoComplete="off"
            className="h-12 font-mono text-base sm:h-9 sm:text-sm"
          />
          <Button
            type="button"
            className="h-12 gap-2 sm:h-9"
            disabled={!receiveLabelId || isReceiving}
            onClick={() => openReceiveConfirm(scanValue)}
          >
            {receiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            入庫確認
          </Button>
        </div>
      </section>

      <Dialog
        open={Boolean(confirmValue)}
        onOpenChange={(open) => {
          if (!open && !isReceiving) closeReceiveConfirm();
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-emerald-700" />
              入庫しますか？
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div className="text-xs text-muted-foreground">読み取りID</div>
              <div className="font-mono text-lg font-bold">{confirmTarget.receiveLabelId || confirmValue}</div>
            </div>
            {confirmTarget.matched ? (
              <ScannedLabelPreview label={confirmTarget.matched} />
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                画面上の候補には一致していません。商品IDとしてサーバーで確認して入庫します。
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isReceiving}
              onClick={() => closeReceiveConfirm()}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              className="gap-2"
              disabled={!confirmTarget.receiveLabelId || isReceiving}
              onClick={() => receiveMatchedLabel(confirmValue)}
            >
              {receiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              入庫する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {matched ? (
        <section className="rounded-md border border-emerald-200 bg-emerald-50 p-3 md:p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            対象IDを確認しました
          </div>
          <ScannedLabelPreview label={matched} />
        </section>
      ) : candidateLabels.length > 0 ? (
        <section className="rounded-md border border-blue-200 bg-blue-50 p-3 md:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
              <Search className="h-4 w-4" />
              追跡番号の候補 {candidateLabels.length.toLocaleString()}件
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 bg-white"
                disabled={receivableCandidateLabels.length === 0 || isReceiving}
                onClick={toggleAllReceivableCandidates}
              >
                <Checkbox checked={allReceivableCandidatesSelected} className="pointer-events-none h-4 w-4" aria-hidden />
                {allReceivableCandidatesSelected ? "選択解除" : "全選択"}
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-2"
                disabled={selectedCandidateCount === 0 || isReceiving}
                onClick={receiveSelectedCandidates}
              >
                {bulkReceivePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                {selectedCandidateCount > 0
                  ? `選択した${selectedCandidateCount.toLocaleString()}件を入庫`
                  : "選択した商品を入庫"}
              </Button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {candidateLabels.map((label) => {
              const disabled = !isReceivableScanCandidate(label);
              const isSelected = selectedCandidateIds.has(label.labelId) && !disabled;
              return (
                <div
                  key={label.labelId}
                  className={cn(
                    "rounded-md border bg-white p-3 shadow-sm",
                    isSelected && "border-blue-500 bg-blue-50/70 ring-1 ring-blue-200",
                    disabled && "opacity-70",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={isSelected}
                      disabled={disabled || isReceiving}
                      onCheckedChange={(checked) => toggleCandidateSelection(label.labelId, checked)}
                      aria-label={`${label.labelId}を選択`}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="break-all font-mono text-xl font-bold text-slate-950">{label.labelId}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-950">{label.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">旧管理番号: {label.legacyManagementNo}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <Badge className={labelBadgeClass(label.rawStatus)}>{label.status}</Badge>
                        {label.trackingNumber ? <Badge variant="outline" className="font-mono">{label.trackingNumber}</Badge> : null}
                      </div>
                    </div>
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border bg-white p-1.5">
                      <ProductQrCode value={label.labelId} />
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3 w-full gap-2"
                    disabled={disabled || isReceiving}
                    onClick={() => openReceiveConfirm(label.labelId, { preserveSearchValue: true })}
                  >
                    <PackageCheck className="h-4 w-4" />
                    この商品を入庫
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      ) : scanValue.trim() ? (
        <section className="rounded-md border bg-amber-50 p-4 text-sm text-amber-900">
          画面上では一致候補が見つかっていません。7文字の商品IDとして読めている場合は、サーバー側で確認して入庫登録します。
        </section>
      ) : (
        <EmptyState icon={ScanLine} title="スキャン待ちです" />
      )}
      </div>

      <ScanHistorySidebar entries={scanHistory} onClear={clearScanHistory} />
    </div>
  );
}

/** スキャンした商品を右側にためておくサイドバー。QR印刷や動作確認へ移動しても残る。 */
export function ScanHistorySidebar({ entries, onClear }: { entries: ScanHistoryEntry[]; onClear: () => void }) {
  return (
    <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
      <section className="rounded-md border bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">スキャンしたデータ</h3>
          <Badge variant="outline">{entries.length.toLocaleString()}件</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          この端末に保存されます。QR印刷や動作確認ページへ移動しても残ります。
        </p>
        <a
          href="/inventory/inbound"
          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ClipboardCheck className="h-4 w-4" />
          動作確認に移る
        </a>
        {entries.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" className="mt-2 w-full" onClick={onClear}>
            履歴を消す
          </Button>
        ) : null}
      </section>

      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          まだスキャンしていません
        </div>
      ) : (
        <section className="space-y-2">
          {entries.map((entry) => (
            <div key={`${entry.labelId}-${entry.scannedAt}`} className="rounded-md border bg-card p-2.5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-base font-bold tracking-wide text-slate-950">{entry.labelId}</div>
                  <div className="mt-0.5 truncate text-xs font-medium text-slate-700">{entry.title}</div>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatScanTime(entry.scannedAt)}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {entry.allocationLabel ? (
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {entry.allocationLabel}
                  </Badge>
                ) : null}
                {entry.supplierName ? (
                  <Badge variant="outline" className="text-[11px]">
                    {entry.supplierName}
                  </Badge>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}
