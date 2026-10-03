import { LabelPrintStyles } from "./LabelPrintStyles";
import { PrintableLabelSheet } from "./PrintableLabelSheet";
import type { AllocationGroup, LabelView } from "./viewTypes";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { invoiceNoFromManagementNo } from "@shared/invoiceKey";
import { classifyOutboundScan, normalizeOutboundScan, SHIPMENT_SHEET_NAMES, type ShipmentSheetName } from "@shared/outboundBoxes";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import { Check, ClipboardCopy, Loader2, PackageCheck, Printer, RotateCcw, ScanLine, Send, Trash2, Truck } from "lucide-react";
import { useQrCameraScanner } from "./scanInput";
import { fieldClass } from "./fieldStyles";
import { invoiceDisplayLabel, labelTargetInvoiceNo, labelTargetShipmentSheetName, todayShipmentDate } from "./shippingRules";

export type OutboundBoxView = {
  id: number;
  boxCode: string;
  status: "open" | "sealed" | "shipped";
  deliveryHistoryId: number | null;
  trackingNumber: string | null;
  fedexShipmentId: number | null;
  destinationSheetName: ShipmentSheetName | null;
  openedAt: string | Date;
  sealedAt: string | Date | null;
  linkedAt: string | Date | null;
  items: Array<{
    id: number;
    labelId: string;
    title: string;
    status: string;
    legacyManagementNo: string | null;
    localInventoryId: number | null;
    assignedInvoiceNo: string | null;
  }>;
};

export function localDateInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function outboundBoxPrintLabel(boxCode: string): LabelView {
  return {
    key: `outbound-box-${boxCode}`,
    labelId: boxCode,
    rawStatus: "open",
    status: "箱",
    title: "海外直取 出庫箱",
    printTitle: "海外直取 出庫箱",
    category: "出庫箱",
    legacyManagementNo: "",
    assignedInvoiceNo: null,
    allocationLabel: "箱ID / OUTBOUND BOX",
    unitPrice: 0,
    supplier: { name: "", url: "" },
    purchaseDate: localDateInputValue(),
    rowId: 0,
    itemId: 0,
  };
}

export function OutboundBoxIssuer({
  onCreated,
  operatorRole = "出荷担当",
}: {
  onCreated?: (boxes: OutboundBoxView[]) => void;
  operatorRole?: string;
}) {
  const utils = trpc.useUtils();
  const [boxCount, setBoxCount] = useState(1);
  const [printLabels, setPrintLabels] = useState<LabelView[]>([]);
  const [printJobId, setPrintJobId] = useState(0);
  // 発番は成功したのに印刷が失敗する（プリンタ未接続など）ことがある。
  // 番号は戻らないので、発番済みで中身が空の箱を刷り直せるようにしておく。
  const boxListQuery = trpc.inventory.outboundBoxes.list.useQuery(undefined, {
    staleTime: 10_000,
  });
  const unusedBoxes = useMemo(
    () =>
      ((boxListQuery.data ?? []) as OutboundBoxView[]).filter(
        box => box.status === "open" && box.items.length === 0
      ),
    [boxListQuery.data]
  );
  const createBoxes = trpc.inventory.outboundBoxes.create.useMutation({
    onSuccess: created => {
      void utils.inventory.outboundBoxes.list.invalidate();
      const createdBoxes = created as OutboundBoxView[];
      setPrintLabels(createdBoxes.map(box => outboundBoxPrintLabel(box.boxCode)));
      setPrintJobId(value => value + 1);
      onCreated?.(createdBoxes);
      toast.success(`${createdBoxes.length}箱を発番しました。印刷画面を開きます`);
    },
    onError: error => toast.error(`箱の発番に失敗しました: ${error.message}`),
  });

  useEffect(() => {
    const clear = () => setPrintLabels([]);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  useEffect(() => {
    if (printJobId === 0 || printLabels.length === 0) return;
    const timer = window.setTimeout(() => window.print(), 100);
    return () => window.clearTimeout(timer);
  }, [printJobId, printLabels]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <LabelPrintStyles />
      <PrintableLabelSheet labels={printLabels} />
      <Input
        type="number"
        min={1}
        max={20}
        value={boxCount}
        onChange={event => setBoxCount(Math.min(20, Math.max(1, Number(event.target.value) || 1)))}
        className="h-11 w-20"
        aria-label="作る箱数"
      />
      <Button
        type="button"
        className="min-h-11 gap-2 bg-indigo-700 text-white hover:bg-indigo-800"
        disabled={createBoxes.isPending}
        onClick={() => createBoxes.mutate({ count: boxCount, operatorName: getCurrentWorkWorkerName(operatorRole) })}
      >
        {createBoxes.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
        箱を作る・{boxCount}枚印刷
      </Button>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 gap-2"
        disabled={unusedBoxes.length === 0}
        title="発番済みで中身が空の箱を刷り直します。新しい番号は増えません"
        onClick={() => {
          setPrintLabels(unusedBoxes.map(box => outboundBoxPrintLabel(box.boxCode)));
          setPrintJobId(value => value + 1);
        }}
      >
        <Printer className="h-4 w-4" />
        発番済みの空箱 {unusedBoxes.length}枚を刷り直す
      </Button>
      {/* 箱番号の羅列は毎回読む必要がないので出さない。番号ごとの刷り直しは「開いたままの箱」から行える。 */}
      {unusedBoxes.length > 0 ? (
        <span className="w-full text-xs text-muted-foreground">
          印刷が失敗しても番号は戻りません。新しく作らず、ここから刷り直してください。
        </span>
      ) : null}
    </div>
  );
}

export function formatDeclarationAmount(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * 在庫から充てた個体の引当先インボイスを指定する。
 * 同じ箱に入っている他インボイスを候補に出しつつ、手入力も受ける
 * （別インボイス宛の在庫を回したときは候補に無い番号になる）。
 */
export function AssignInvoiceControl({
  labelId,
  candidates,
  onDone,
}: {
  labelId: string;
  candidates: string[];
  onDone: () => void;
}) {
  const [manual, setManual] = useState("");
  const utils = trpc.useUtils();
  const assign = trpc.inventory.outboundBoxes.assignInvoice.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.labelId} を No.${result.invoiceNo} 宛にしました`);
      setManual("");
      void utils.inventory.outboundBoxes.list.invalidate();
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = (invoiceNo: string) => {
    if (!invoiceNo.trim() || assign.isPending) return;
    assign.mutate({ labelId, invoiceNo: invoiceNo.trim(), operatorName: getCurrentWorkWorkerName("出荷担当") });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {candidates.map((invoiceNo) => (
        <Button
          key={invoiceNo}
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2"
          disabled={assign.isPending}
          onClick={() => submit(invoiceNo)}
        >
          No.{invoiceNo} 宛にする
        </Button>
      ))}
      <Input
        className="h-7 w-24 font-mono"
        placeholder="他のNo."
        value={manual}
        onChange={(event) => setManual(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit(manual);
        }}
      />
    </span>
  );
}

/**
 * 箱の中身一覧から、個体の引当先インボイスNoを直接直す。
 *
 * 別インボイス宛に仕入れた在庫を流用して発送することがあるため、
 * 管理番号から番号が読めている個体でも人が上書きできる必要がある。
 * 空にして確定すると指定が外れ、自動判定（出庫No→管理番号）へ戻る。
 */
export function BoxItemInvoiceField({
  labelId,
  assignedInvoiceNo,
  legacyManagementNo,
}: {
  labelId: string;
  assignedInvoiceNo: string | null;
  legacyManagementNo: string | null;
}) {
  const utils = trpc.useUtils();
  const [localAssignedInvoiceNo, setLocalAssignedInvoiceNo] = useState<string | null>(assignedInvoiceNo ?? null);
  const [value, setValue] = useState(assignedInvoiceNo ?? "");
  // 申告明細側や別端末で変わったときに追従する
  useEffect(() => {
    setLocalAssignedInvoiceNo(assignedInvoiceNo ?? null);
    setValue(assignedInvoiceNo ?? "");
  }, [assignedInvoiceNo]);
  const autoInvoiceNo = invoiceNoFromManagementNo(legacyManagementNo);
  const assign = trpc.inventory.outboundBoxes.assignInvoice.useMutation({
    onSuccess: (result) => {
      setLocalAssignedInvoiceNo(result.invoiceNo ?? null);
      setValue(result.invoiceNo ?? "");
      if (result.changed) {
        toast.success(
          result.invoiceNo
            ? `${result.labelId} を No.${result.invoiceNo} 宛にしました`
            : `${result.labelId} の指定を外しました（管理番号からの自動判定に戻ります）`,
        );
      }
      void utils.inventory.outboundBoxes.list.invalidate();
      void utils.inventory.orderManagement.boxDeclaration.invalidate();
      void utils.inventory.zaico.getInventories.invalidate();
      void utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate();
      void utils.inventory.zaico.getPurchasesWithCategory.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
      setValue(localAssignedInvoiceNo ?? "");
    },
  });

  const commit = () => {
    const next = value.trim();
    if (assign.isPending || next === (localAssignedInvoiceNo ?? "")) return;
    assign.mutate({
      labelId,
      invoiceNo: next === "" ? null : next,
      operatorName: getCurrentWorkWorkerName("出荷担当"),
    });
  };

  const isDirty = value.trim() !== (localAssignedInvoiceNo ?? "");
  const effectiveInvoiceNo = localAssignedInvoiceNo ?? autoInvoiceNo;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-xs text-muted-foreground">宛先No.</span>
      <Input
        className="h-8 w-20 font-mono"
        value={value}
        placeholder={autoInvoiceNo ?? "未定"}
        disabled={assign.isPending}
        aria-label={`${labelId} の引当先インボイスNo`}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        title="宛先No.を保存"
        disabled={!isDirty || assign.isPending}
        onMouseDown={(event) => event.preventDefault()}
        onClick={commit}
      >
        <Check className="h-3.5 w-3.5" />
      </Button>
      {assign.isPending ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : null}
      {localAssignedInvoiceNo && localAssignedInvoiceNo !== autoInvoiceNo ? (
        <span
          className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-900"
          title={`管理番号からは No.${autoInvoiceNo ?? "不明"}。人の指定で上書きしています`}
        >
          流用
        </span>
      ) : !effectiveInvoiceNo ? (
        <span className="text-[10px] font-semibold text-destructive">未定</span>
      ) : null}
    </span>
  );
}

/**
 * FedExの送り状に手打ちする申告内容を、箱の中身から組み立てて出す。
 * 品名・数量・単価・通貨は取引データ（インボイス）の値をそのまま使う。
 */
export function BoxDeclarationPanel({ boxCode }: { boxCode: string }) {
  const [copied, setCopied] = useState(false);
  const declaration = trpc.inventory.orderManagement.boxDeclaration.useQuery(
    { boxCode },
    { enabled: Boolean(boxCode), staleTime: 5_000 },
  );

  const copyText = useMemo(() => {
    const data = declaration.data;
    if (!data) return "";
    const lines: string[] = [`${data.boxCode}${data.trackingNumber ? ` / ${data.trackingNumber}` : ""}`];
    let currentInvoice: string | null | undefined;
    for (const line of data.lines) {
      if (line.invoiceNo !== currentInvoice) {
        currentInvoice = line.invoiceNo;
        lines.push("", `[No.${line.invoiceNo} ${line.partner}]`);
      }
      const unit = line.unitPrice == null ? "単価なし" : `${line.currency} ${formatDeclarationAmount(line.unitPrice)}`;
      const subtotal = line.subtotal == null ? "" : ` = ${line.currency} ${formatDeclarationAmount(line.subtotal)}`;
      const estimated = line.estimatedQuantity > 0 ? `（うち${line.estimatedQuantity}点は推定）` : "";
      lines.push(`${line.productName}\t${line.quantity}\t${unit}${subtotal}${estimated}`);
    }
    if (data.totals.length > 0) {
      lines.push("");
      for (const total of data.totals) {
        lines.push(
          `合計 ${total.quantity}点 ${total.currency} ${formatDeclarationAmount(total.amount)}${total.incomplete ? "（単価なしの行あり）" : ""}`,
        );
      }
    }
    return lines.join("\n");
  }, [declaration.data]);

  async function copyDeclaration() {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("コピーできませんでした。テキストを選択して手動でコピーしてください");
    }
  }

  if (declaration.isLoading) {
    return <p className="mt-3 text-sm text-muted-foreground">申告明細を計算中…</p>;
  }
  if (declaration.error) {
    return <p className="mt-3 text-sm text-destructive">申告明細を出せませんでした: {declaration.error.message}</p>;
  }
  const data = declaration.data;
  if (!data) return null;

  return (
    <section className="mt-4 rounded-md border-2 border-slate-300 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">FedEx申告明細</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            取引データの品名・単価・通貨をそのまま出しています。送り状の入力欄へ貼れます。
            「推定」は旧管理番号にインボイスNoが無く、この箱の他インボイスから引き当てたぶんです。
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={!copyText} onClick={() => void copyDeclaration()}>
          {copied ? <Check className="mr-2 h-4 w-4" /> : <ClipboardCopy className="mr-2 h-4 w-4" />}
          {copied ? "コピーしました" : "コピー"}
        </Button>
      </div>

      {data.lines.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">申告できる行がありません。</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded border bg-white">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">インボイス</th>
                <th className="px-3 py-2">品名</th>
                <th className="px-3 py-2 text-right">数量</th>
                <th className="px-3 py-2 text-right">単価</th>
                <th className="px-3 py-2 text-right">小計</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.lines.map((line) => (
                <tr key={line.key}>
                  <td className="px-3 py-2 whitespace-nowrap">No.{line.invoiceNo} {line.partner}</td>
                  <td className="px-3 py-2">
                    {line.productName}
                    {line.estimatedQuantity > 0 ? (
                      <Badge variant="outline" className="ml-2 border-amber-400 text-amber-700">
                        うち{line.estimatedQuantity}点は推定
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {line.unitPrice == null ? <span className="text-destructive">単価なし</span> : `${line.currency} ${formatDeclarationAmount(line.unitPrice)}`}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {line.subtotal == null ? "—" : `${line.currency} ${formatDeclarationAmount(line.subtotal)}`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 bg-muted/40">
              {data.totals.map((total) => (
                <tr key={total.currency}>
                  <td className="px-3 py-2 font-semibold" colSpan={2}>合計</td>
                  <td className="px-3 py-2 text-right tabular-nums">{total.quantity}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {total.currency} {formatDeclarationAmount(total.amount)}
                    {total.incomplete ? <span className="ml-1 text-xs font-normal text-destructive">※単価なしの行あり</span> : null}
                  </td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}

      {data.unmatched.length > 0 ? (
        <div className="mt-3 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-950">
          <div className="font-semibold">引当先が決まっていない個体 {data.unmatched.length}点</div>
          <p className="mt-1 text-xs">
            この分は上の合計に入っていません。在庫から充てたものは、どのインボイス宛かを選んでください。
          </p>
          <ul className="mt-2 space-y-2 text-xs">
            {data.unmatched.map((item) => (
              <li key={item.labelId} className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{item.labelId}</span>
                <span>{item.title}</span>
                <span className="text-amber-800">— {item.reason}</span>
                <AssignInvoiceControl
                  labelId={item.labelId}
                  candidates={item.invoiceCandidates}
                  onDone={() => void declaration.refetch()}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

type OutboundBoxDestinationConflict = {
  boxCode: string;
  labelId: string;
  title: string;
  legacyManagementNo: string | null;
  assignedInvoiceNo: string | null;
  itemInvoiceNo: string | null;
  itemSheetName: ShipmentSheetName;
  boxDestinationSheetName: ShipmentSheetName;
};

export function OutboundBoxPanel({
  invoiceOptions,
  onOpenBoxChange,
}: {
  invoiceOptions: AllocationGroup[];
  onOpenBoxChange?: (boxCode: string | null) => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.inventory.outboundBoxes.list.useQuery(undefined, {
    staleTime: 10_000,
    refetchOnMount: "always",
  });
  const boxes = (data ?? []) as OutboundBoxView[];
  const [currentBoxCode, setCurrentBoxCode] = useState("");
  // 発番済みの箱シールの刷り直し用（印刷が失敗しても番号は戻らないため）
  const [boxPrintLabels, setBoxPrintLabels] = useState<LabelView[]>([]);
  const [boxPrintJobId, setBoxPrintJobId] = useState(0);
  // 箱モードを使わずに従来経路で出庫してしまったぶんを、後から箱へ紐づける
  const [attachBoxCode, setAttachBoxCode] = useState<string | null>(null);
  const [attachDeliveryNo, setAttachDeliveryNo] = useState("");
  const attachDelivery = trpc.inventory.outboundBoxes.attachDelivery.useMutation({
    onSuccess: (result) => {
      void utils.inventory.outboundBoxes.list.invalidate();
      setAttachBoxCode(null);
      setAttachDeliveryNo("");
      toast.success(
        `${result.boxCode} に 出庫No ${result.deliveryNos.join("・")} を紐づけました（個体${result.attachedLabels}件${
          result.trackingNumber ? ` / 追跡 ${result.trackingNumber}` : " / 追跡番号は未登録"
        }）`,
      );
    },
    onError: (error) => toast.error(`紐付けに失敗しました: ${error.message}`),
  });
  const [scanValue, setScanValue] = useState("");
  const [linkBoxCode, setLinkBoxCode] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shippingDate, setShippingDate] = useState(todayShipmentDate());
  const [traceLabelId, setTraceLabelId] = useState("");
  const [destinationConflict, setDestinationConflict] = useState<OutboundBoxDestinationConflict | null>(null);
  const currentBox = boxes.find((box) => box.boxCode === currentBoxCode) ?? null;
  const sealedBoxes = boxes.filter((box) => box.status === "sealed");
  // 封をすると currentBox から外れるため、追跡番号を待っている箱の中身はここから見せる
  // （宛先No.を直せる最後の機会。紐付けの時点で発送管理シートが取引先ごとに割れる）
  const shippedBoxes = boxes.filter((box) => box.status === "shipped");
  const openBoxes = boxes.filter((box) => box.status === "open");
  const linkSelectedBox = sealedBoxes.find((box) => box.boxCode === linkBoxCode) ?? null;
  const normalizedTraceLabel = normalizeOutboundScan(traceLabelId);
  const traceQuery = trpc.inventory.outboundBoxes.traceByLabel.useQuery(
    { labelId: normalizedTraceLabel },
    { enabled: /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{7}$/.test(normalizedTraceLabel) },
  );

  const refreshBoxes = () => void utils.inventory.outboundBoxes.list.invalidate();
  const mutationError = (label: string) => (error: { message: string }) => toast.error(`${label}: ${error.message}`);
  const openBox = trpc.inventory.outboundBoxes.open.useMutation({
    onSuccess: (box) => {
      refreshBoxes();
      if (box) setCurrentBoxCode(box.boxCode);
      toast.success(`${box?.boxCode ?? "箱"}を開きました`);
    },
    onError: mutationError("箱を開けませんでした"),
  });
  const setDestination = trpc.inventory.outboundBoxes.setDestination.useMutation({
    onSuccess: (box) => {
      refreshBoxes();
      toast.success(`${box?.boxCode ?? "箱"}の出荷先を更新しました`);
    },
    onError: mutationError("出荷先を更新できませんでした"),
  });
  const addItem = trpc.inventory.outboundBoxes.addItem.useMutation({
    onSuccess: (box) => {
      refreshBoxes();
      if (box) setCurrentBoxCode(box.boxCode);
      toast.success("個体を箱に追加しました");
    },
    onError: mutationError("個体を追加できませんでした"),
  });
  const removeItem = trpc.inventory.outboundBoxes.removeItem.useMutation({
    onSuccess: refreshBoxes,
    onError: mutationError("個体を取り消せませんでした"),
  });
  const discardBox = trpc.inventory.outboundBoxes.discard.useMutation({
    onSuccess: () => {
      refreshBoxes();
      setCurrentBoxCode("");
      toast.success("未使用の箱を破棄しました");
    },
    onError: mutationError("箱を破棄できませんでした"),
  });
  const sealBox = trpc.inventory.outboundBoxes.seal.useMutation({
    onSuccess: (box) => {
      refreshBoxes();
      void utils.inventory.zaico.getInventories.invalidate();
      void utils.inventory.deliveryHistory.list.invalidate();
      setLinkBoxCode(box?.boxCode ?? "");
      setCurrentBoxCode("");
      toast.success(`${box?.boxCode ?? "箱"}を封じ、出庫登録しました`);
    },
    onError: mutationError("封箱に失敗しました"),
  });
  const linkTracking = trpc.inventory.outboundBoxes.linkTracking.useMutation({
    onSuccess: (box) => {
      refreshBoxes();
      void utils.inventory.fedex.getAll.invalidate();
      setTrackingNumber("");
      setLinkBoxCode("");
      if (box.spreadsheetSuccess) toast.success(`${box.boxCode}に追跡番号を登録し、スプレッドシートへ書き込みました`);
      else toast.warning(`${box.boxCode}への紐付けは完了しました。スプレッドシート: ${"spreadsheetError" in box ? box.spreadsheetError ?? "要確認" : "要確認"}`);
    },
    onError: mutationError("追跡番号を紐付けできませんでした"),
  });
  const unlinkTracking = trpc.inventory.outboundBoxes.unlinkTracking.useMutation({
    onSuccess: box => {
      refreshBoxes();
      void utils.inventory.fedex.getAll.invalidate();
      toast.success(`${box?.boxCode ?? "箱"} の追跡番号を解除しました。続けて「封を解く」を実行してください`);
    },
    onError: mutationError("追跡番号を解除できませんでした"),
  });
  const unsealBox = trpc.inventory.outboundBoxes.unseal.useMutation({
    onSuccess: result => {
      refreshBoxes();
      void utils.inventory.zaico.getInventories.invalidate();
      void utils.inventory.deliveryHistory.list.invalidate();
      if (result.boxCode) setCurrentBoxCode(result.boxCode);
      toast.success(`${result.boxCode} の封を解き、${result.restoredCount}点を在庫へ戻しました`);
    },
    onError: mutationError("封を解けませんでした"),
  });

  function submitAddItem(labelId: string, options?: { force?: boolean }) {
    if (!currentBoxCode) {
      toast.error("先に箱IDをスキャンしてください");
      return;
    }
    addItem.mutate({
      boxCode: currentBoxCode,
      labelId,
      force: options?.force,
      operatorName: getCurrentWorkWorkerName("出荷担当"),
    });
  }

  async function addLabelToBox(labelId: string) {
    if (!currentBoxCode) {
      toast.error("先に箱IDをスキャンしてください");
      return;
    }
    const box = boxes.find((row) => row.boxCode === currentBoxCode) ?? null;
    if (!box?.destinationSheetName) {
      toast.error("先にこの箱の出荷先を選んでください");
      return;
    }
    try {
      const result = await utils.inventory.outboundBoxes.traceByLabel.fetch({ labelId });
      const label = result.label;
      if (label) {
        const itemInvoiceNo = labelTargetInvoiceNo(label);
        const itemSheetName = labelTargetShipmentSheetName(label, invoiceOptions);
        if (itemSheetName && itemSheetName !== box.destinationSheetName) {
          setDestinationConflict({
            boxCode: box.boxCode,
            labelId,
            title: String(label.title ?? ""),
            legacyManagementNo: label.legacyManagementNo ?? null,
            assignedInvoiceNo: label.assignedInvoiceNo ?? null,
            itemInvoiceNo,
            itemSheetName,
            boxDestinationSheetName: box.destinationSheetName,
          });
          return;
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "商品IDの確認に失敗しました");
      return;
    }
    submitAddItem(labelId);
  }

  const handleScan = (rawValue: string) => {
    const normalized = normalizeOutboundScan(rawValue);
    setScanValue(normalized);
    const kind = classifyOutboundScan(normalized);
    if (kind === "box") {
      const found = boxes.find((box) => box.boxCode === normalized);
      if (found?.status === "sealed") {
        setLinkBoxCode(found.boxCode);
        toast.info(`${found.boxCode}を追跡番号待ちとして選択しました`);
      } else if (found?.status === "shipped") {
        toast.info(`${found.boxCode}は${found.trackingNumber ?? "追跡番号登録済み"}で発送済みです`);
      } else {
        openBox.mutate({ boxCode: normalized, operatorName: getCurrentWorkWorkerName("出荷担当") });
      }
    } else if (kind === "label") {
      void addLabelToBox(normalized);
    } else if (kind === "tracking") {
      if (!linkBoxCode) toast.error("先に封済みの箱IDをスキャンしてください");
      else setTrackingNumber(normalized);
    } else {
      toast.error("箱ID・個体ラベル・追跡番号のどれにも判定できませんでした");
    }
    setScanValue("");
  };
  const qrScanner = useQrCameraScanner(handleScan);

  const busy = openBox.isPending || addItem.isPending || sealBox.isPending || linkTracking.isPending || unlinkTracking.isPending || unsealBox.isPending;

  useEffect(() => {
    if (boxPrintJobId === 0 || boxPrintLabels.length === 0) return;
    const timer = window.setTimeout(() => window.print(), 100);
    return () => window.clearTimeout(timer);
  }, [boxPrintJobId, boxPrintLabels]);

  useEffect(() => {
    const clear = () => setBoxPrintLabels([]);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  // 開いている箱を親へ伝える。従来の出庫パネルを伏せるため。
  useEffect(() => {
    onOpenBoxChange?.(currentBoxCode || null);
  }, [currentBoxCode, onOpenBoxChange]);

  return (
    <section className="rounded-md border-2 border-indigo-300 bg-indigo-50/40 p-3 sm:p-4">
      <LabelPrintStyles />
      <PrintableLabelSheet labels={boxPrintLabels} />
      {attachBoxCode ? (
        <div className="mb-3 rounded-md border-2 border-indigo-400 bg-white p-3">
          <h4 className="text-sm font-semibold">{attachBoxCode} に登録済みの出庫を紐づける</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            箱モードを使わずに出庫してしまったぶんを、後からこの箱に結び付けます。
            <strong>在庫は動かしません</strong>（出庫はもう済んでいるため）。
            追跡番号がFedExに登録済みならそれも取り込みます。
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              className="h-9 w-72 font-mono"
              placeholder="出庫No（複数可・スペースや読点で区切る）"
              value={attachDeliveryNo}
              onChange={(event) => setAttachDeliveryNo(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={attachDelivery.isPending || attachDeliveryNo.trim().length === 0}
              onClick={() => attachDelivery.mutate({ boxCode: attachBoxCode, deliveryNos: attachDeliveryNo.split(/[\s,、・]+/).map(v => v.trim()).filter(Boolean), operatorName: getCurrentWorkWorkerName("出荷担当") })}
            >
              {attachDelivery.isPending ? "紐付け中…" : "紐づける"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAttachBoxCode(null)}>
              やめる
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">海外直取：箱モード</h2>
            <Badge className="bg-indigo-700 text-white hover:bg-indigo-700">FedEx</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">箱ID→個体ラベル→封箱。後日、箱ID→FedExラベルの2スキャンで紐付けます。</p>
        </div>
        <OutboundBoxIssuer onCreated={created => {
          if (created[0]) setCurrentBoxCode(created[0].boxCode);
        }} />
      </div>

      <div className="mt-4 rounded-md border bg-white p-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="gap-2" disabled={qrScanner.cameraActive} onClick={qrScanner.startCamera}><ScanLine className="h-4 w-4" />QR読取</Button>
          {qrScanner.cameraActive ? <Button type="button" variant="outline" onClick={qrScanner.stopCamera}>停止</Button> : null}
          <Badge variant="outline">選択箱: {currentBoxCode || "なし"}</Badge>
          <Badge variant="outline">追跡待ち: {linkBoxCode || "なし"}</Badge>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
          <span className="text-sm font-medium text-slate-700">この箱の出荷先</span>
          <select
            className={fieldClass}
            value={currentBox?.destinationSheetName ?? ""}
            disabled={!currentBox || setDestination.isPending}
            onChange={(event) => {
              if (!currentBox) return;
              const value = event.target.value as ShipmentSheetName | "";
              setDestination.mutate({
                boxCode: currentBox.boxCode,
                destinationSheetName: value || null,
                operatorName: getCurrentWorkWorkerName("出荷担当"),
              });
            }}
          >
            <option value="">未設定（商品追加前に選択）</option>
            {SHIPMENT_SHEET_NAMES.map((sheetName) => (
              <option key={sheetName} value={sheetName}>{sheetName}</option>
            ))}
          </select>
        </div>
        {currentBox && !currentBox.destinationSheetName ? (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            商品を入れる前に、この箱の出荷先を選んでください。充当先が違う商品をスキャンしたときに警告します。
          </p>
        ) : null}
        <div className={cn("mt-3 overflow-hidden rounded-md border bg-black", qrScanner.cameraActive ? "block" : "hidden")}>
          <video ref={qrScanner.videoRef} className="h-[50vh] min-h-[260px] max-h-[480px] w-full object-cover" muted playsInline />
        </div>
        {qrScanner.cameraError ? <p className="mt-2 text-sm text-destructive">{qrScanner.cameraError}</p> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input value={scanValue} onChange={(event) => setScanValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleScan(scanValue); }} placeholder="箱ID・個体ラベル・FedEx追跡番号をスキャン／入力" autoComplete="off" className="h-11 font-mono" />
          <Button type="button" disabled={!scanValue.trim() || busy} onClick={() => handleScan(scanValue)}>自動判定</Button>
        </div>
      </div>

      {currentBox ? (
        <div className="mt-4 rounded-md border border-indigo-300 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><span className="font-mono text-xl font-bold">{currentBox.boxCode}</span><Badge variant="secondary" className="ml-2">{currentBox.items.length}点</Badge></div>
            {currentBox.destinationSheetName ? (
              <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">
                出荷先 {currentBox.destinationSheetName}
              </Badge>
            ) : null}
            <Button type="button" className="bg-emerald-700 text-white hover:bg-emerald-800" disabled={currentBox.items.length === 0 || sealBox.isPending} onClick={() => sealBox.mutate({ boxCode: currentBox.boxCode, deliveryDate: localDateInputValue(), operatorName: getCurrentWorkWorkerName("出荷担当") })}>
              {sealBox.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}封をする
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {currentBox.items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
                <div className="min-w-0"><span className="font-mono font-bold">{item.labelId}</span><span className="ml-2">{item.title}</span><span className="ml-2 text-xs text-muted-foreground">{item.legacyManagementNo}</span></div>
                <div className="flex items-center gap-1">
                  <BoxItemInvoiceField labelId={item.labelId} assignedInvoiceNo={item.assignedInvoiceNo} legacyManagementNo={item.legacyManagementNo} />
                  <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => removeItem.mutate({ boxCode: currentBox.boxCode, labelId: item.labelId })}>取り消す</Button>
                </div>
              </div>
            ))}
          </div>
          <BoxDeclarationPanel boxCode={currentBox.boxCode} />
        </div>
      ) : null}

      {sealedBoxes.length > 0 ? (
        <div className="mt-4 rounded-md border-2 border-amber-400 bg-amber-50 p-3">
          <h3 className="font-semibold text-amber-950">発送登録待ちの箱（{sealedBoxes.length}箱）</h3>
          <div className="mt-2 space-y-2">{sealedBoxes.map(box => (
            <div key={box.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-white p-2">
              <Button type="button" variant={linkBoxCode === box.boxCode ? "default" : "outline"} onClick={() => setLinkBoxCode(box.boxCode)}>
                <span className="font-mono">{box.boxCode}</span><Badge variant="secondary" className="ml-2">{box.items.length}点</Badge>
              </Button>
              <Button type="button" variant="outline" disabled={unsealBox.isPending} onClick={() => {
                const ids = box.items.map(item => item.labelId).join(", ");
                if (window.confirm(`${box.boxCode} の封を解きます。\n戻る在庫: ${box.items.length}点\n対象個体ID: ${ids}\n出庫履歴は削除せず取消として残します。`)) {
                  unsealBox.mutate({ boxCode: box.boxCode, operatorName: getCurrentWorkWorkerName("出荷担当") });
                }
              }}><RotateCcw className="mr-2 h-4 w-4" />封を解く</Button>
            </div>
          ))}</div>
          <div className="mt-3 grid gap-2 lg:grid-cols-[150px_minmax(0,1fr)_110px_auto]">
            <Input value={linkBoxCode} onChange={(event) => setLinkBoxCode(normalizeOutboundScan(event.target.value))} placeholder="B000001" className="font-mono" />
            <Input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="FedEx追跡番号（手入力可）" className="font-mono" />
            <Input value={shippingDate} onChange={(event) => setShippingDate(event.target.value)} placeholder="M/D" />
            <Button type="button" className="bg-blue-700 text-white hover:bg-blue-800" disabled={!linkBoxCode || !trackingNumber.trim() || linkTracking.isPending} onClick={() => linkTracking.mutate({ boxCode: linkBoxCode, trackingNumber, shippingDate, operatorName: getCurrentWorkWorkerName("出荷担当") })}>{linkTracking.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}追跡番号を紐付け</Button>
          </div>
          <p className="mt-2 text-xs text-amber-900">送信先シートはインボイスNoの取引先から自動決定します。不明な取引先は登録を止めます。</p>
          {linkSelectedBox ? (
            <>
              <div className="mt-3 rounded border border-amber-300 bg-white p-2">
                <div className="text-sm font-semibold">{linkSelectedBox.boxCode} の中身（{linkSelectedBox.items.length}点）</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  別インボイス宛の在庫を流用した個体は、紐付ける前に宛先No.を直してください。
                </p>
                <div className="mt-2 space-y-1">
                  {linkSelectedBox.items.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
                      <div className="min-w-0"><span className="font-mono font-bold">{item.labelId}</span><span className="ml-2">{item.title}</span><span className="ml-2 text-xs text-muted-foreground">{item.legacyManagementNo}</span></div>
                      <BoxItemInvoiceField labelId={item.labelId} assignedInvoiceNo={item.assignedInvoiceNo} legacyManagementNo={item.legacyManagementNo} />
                    </div>
                  ))}
                </div>
              </div>
              <BoxDeclarationPanel boxCode={linkSelectedBox.boxCode} />
            </>
          ) : null}
        </div>
      ) : null}

      {shippedBoxes.length > 0 ? (
        <div className="mt-4 rounded-md border border-sky-300 bg-sky-50 p-3">
          <h3 className="font-semibold text-sky-950">追跡番号紐付け済みの箱</h3>
          <div className="mt-2 space-y-2">{shippedBoxes.map(box => (
            <div key={box.id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-white p-2">
              <div><span className="font-mono font-bold">{box.boxCode}</span><span className="ml-2 font-mono text-sm">{box.trackingNumber}</span><Badge variant="secondary" className="ml-2">{box.items.length}点</Badge></div>
              <Button type="button" variant="outline" disabled={unlinkTracking.isPending} onClick={() => {
                if (window.confirm(`${box.boxCode} の追跡番号を解除します。\nGoogleスプレッドシートの該当行も消えます。\nこの操作後、別途「封を解く」の確認が必要です。`)) {
                  unlinkTracking.mutate({ boxCode: box.boxCode, operatorName: getCurrentWorkWorkerName("出荷担当") });
                }
              }}><RotateCcw className="mr-2 h-4 w-4" />追跡番号を解除</Button>
            </div>
          ))}</div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border bg-white p-3">
          <h3 className="font-semibold">開いたままの箱</h3>
          {isLoading ? <p className="mt-2 text-sm text-muted-foreground">読み込み中…</p> : openBoxes.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">ありません</p> : <div className="mt-2 space-y-2">{openBoxes.map((box) => <div key={box.id} className="flex items-center justify-between gap-2 rounded border p-2"><Button type="button" variant="ghost" className="font-mono" onClick={() => setCurrentBoxCode(box.boxCode)}>{box.boxCode}（{box.items.length}点）</Button><div className="flex items-center gap-1"><Button type="button" size="sm" variant="outline" title="この箱のシールを刷り直します。新しい番号は増えません" onClick={() => { setBoxPrintLabels([outboundBoxPrintLabel(box.boxCode)]); setBoxPrintJobId((value) => value + 1); }}><Printer className="mr-1 h-4 w-4" />刷り直す</Button>{box.items.length === 0 ? <Button type="button" size="sm" variant="outline" title="箱を使わずに登録済みの出庫を、この箱へ後から紐づけます" onClick={() => { setAttachBoxCode(box.boxCode); setAttachDeliveryNo(""); }}>出庫を紐づけ</Button> : null}{box.items.length === 0 ? <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => { if (window.confirm(`${box.boxCode}を破棄しますか？`)) discardBox.mutate({ boxCode: box.boxCode }); }}><Trash2 className="mr-1 h-4 w-4" />破棄</Button> : null}</div></div>)}</div>}
        </div>
        <div className="rounded-md border bg-white p-3">
          <h3 className="font-semibold">個体IDから発送を追跡</h3>
          <Input className="mt-2 font-mono" value={traceLabelId} onChange={(event) => setTraceLabelId(event.target.value)} placeholder="英字7文字の個体ID" />
          {traceQuery.data?.label ? <div className="mt-2 rounded border p-2 text-sm"><div><span className="font-mono font-bold">{traceQuery.data.label.labelId}</span> / {traceQuery.data.label.title}</div><div className="mt-1">箱: <span className="font-mono font-semibold">{traceQuery.data.box?.boxCode ?? "未割当"}</span> → 追跡番号: <span className="font-mono font-semibold">{traceQuery.data.box?.trackingNumber ?? "未登録"}</span></div></div> : normalizedTraceLabel.length === 7 && !traceQuery.isFetching ? <p className="mt-2 text-sm text-muted-foreground">個体が見つかりません</p> : null}
        </div>
      </div>
      <Dialog open={Boolean(destinationConflict)} onOpenChange={(open) => { if (!open) setDestinationConflict(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Truck className="h-5 w-5 text-amber-600" />
              出荷先が違う可能性があります
            </DialogTitle>
          </DialogHeader>
          {destinationConflict ? (
            <div className="space-y-3 text-sm">
              <div className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-950">
                この商品は <strong>{destinationConflict.itemSheetName}</strong> 向けですが、
                現在の箱は <strong>{destinationConflict.boxDestinationSheetName}</strong> に設定されています。
              </div>
              <div className="rounded border bg-muted/30 p-3">
                <div className="font-mono text-base font-semibold">{destinationConflict.labelId}</div>
                <div className="mt-1 font-medium">{destinationConflict.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">旧管理番号: {destinationConflict.legacyManagementNo ?? "-"}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  充当先: {destinationConflict.itemInvoiceNo ? invoiceDisplayLabel(invoiceOptions, destinationConflict.itemInvoiceNo) : "未設定"}
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setDestinationConflict(null)}>
              追加しない
            </Button>
            <Button
              type="button"
              className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={() => {
                if (!destinationConflict) return;
                submitAddItem(destinationConflict.labelId, { force: true });
                setDestinationConflict(null);
              }}
            >
              例外として追加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
