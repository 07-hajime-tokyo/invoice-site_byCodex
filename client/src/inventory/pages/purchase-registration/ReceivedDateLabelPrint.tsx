import { loadLabelStartPosition, saveLabelStartPosition, todayInTokyo } from "./labelPrintSettings";
import { LabelPrintStyles } from "./LabelPrintStyles";
import { PrintableLabelSheet } from "./PrintableLabelSheet";
import { isStockProposalAccessory } from "./stockProposalRules";
import { stockModelName } from "./productPresentation";
import { labelStatusLabel } from "./labelStatus";
import { labelAllocationLabel, formatLabelPrintTitle } from "./labelTitles";
import { LABELS_PER_SHEET, clampLabelStartPosition, nextLabelStartPosition } from "./labelPrintLayout";
import type { LabelView } from "./viewTypes";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer } from "lucide-react";

export function ReceivedDateLabelPrint() {
  const [receivedDate, setReceivedDate] = useState<string>(() => todayInTokyo());
  const [excludeAccessories, setExcludeAccessories] = useState(true);
  const [startPosition, setStartPosition] = useState<number>(() => loadLabelStartPosition());
  const [labelsToPrint, setLabelsToPrint] = useState<LabelView[]>([]);
  const [printedStartPosition, setPrintedStartPosition] = useState(1);
  const [printJobId, setPrintJobId] = useState(0);

  const receivedQuery = trpc.inventory.inboundDesk.receivedLabelsOn.useQuery(
    { date: receivedDate },
    { enabled: /^\d{4}-\d{2}-\d{2}$/.test(receivedDate), staleTime: 30_000 },
  );

  const labels = useMemo<LabelView[]>(() => {
    const rows = receivedQuery.data?.labels ?? [];
    return rows.flatMap((row) => {
      // 消耗品（ケーブル・バッテリー等）はラベルを貼らない方針のため既定で外す
      if (excludeAccessories && isStockProposalAccessory(row.title, row.category)) return [];
      const view: LabelView = {
        key: `received-${row.labelId}`,
        labelId: row.labelId,
        rawStatus: row.status,
        status: labelStatusLabel(row.status),
        title: row.title,
        printTitle: formatLabelPrintTitle(row.title),
        category: row.category || stockModelName(row.title),
        legacyManagementNo: row.legacyManagementNo || "-",
        assignedInvoiceNo: row.assignedInvoiceNo ?? null,
        allocationLabel: labelAllocationLabel(row.legacyManagementNo || ""),
        unitPrice: 0,
        supplier: { name: "", url: "" },
        purchaseDate: "",
        rowId: 0,
        itemId: 0,
        inventoryId: null,
        trackingNumber: null,
        carrier: null,
      };
      return [view];
    });
  }, [excludeAccessories, receivedQuery.data]);

  useEffect(() => {
    if (printJobId === 0 || labelsToPrint.length === 0) return;
    const timer = window.setTimeout(() => window.print(), 100);
    return () => window.clearTimeout(timer);
  }, [labelsToPrint, printJobId]);

  // 刷り終わったら印刷ルートを空にする。残しておくと次の印刷に混ざる。
  useEffect(() => {
    const clear = () => setLabelsToPrint([]);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  const changeStartPosition = (value: number) => {
    const next = clampLabelStartPosition(value);
    setStartPosition(next);
    saveLabelStartPosition(next);
  };

  const print = () => {
    if (labels.length === 0) return;
    const start = clampLabelStartPosition(startPosition);
    setPrintedStartPosition(start);
    setLabelsToPrint(labels);
    setPrintJobId((current) => current + 1);
    const nextStart = nextLabelStartPosition(start, labels.length);
    changeStartPosition(nextStart);
    toast.success(`${labels.length}枚を${start}面目から印刷します。次回の開始位置を${nextStart}面目にしました`);
  };

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <LabelPrintStyles />
      <PrintableLabelSheet labels={labelsToPrint} startPosition={printedStartPosition} />
      <h2 className="font-semibold text-emerald-950">ラベル印刷</h2>
      <p className="mt-1 text-sm text-emerald-900">
        配送伝票のバーコードを読んだ日で数えます。引当先に関係なく、その日に届いたぶんを全部刷ります。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="inbound-label-date" className="text-sm font-medium">荷受日</label>
        <Input
          id="inbound-label-date"
          type="date"
          value={receivedDate}
          onChange={(event) => setReceivedDate(event.target.value)}
          className="h-9 w-40 bg-white"
        />
        <label htmlFor="inbound-label-start" className="text-sm font-medium">開始位置</label>
        <Input
          id="inbound-label-start"
          type="number"
          min={1}
          max={LABELS_PER_SHEET}
          value={startPosition}
          onChange={(event) => changeStartPosition(Number(event.target.value))}
          onFocus={(event) => event.currentTarget.select()}
          className="h-9 w-20 bg-white"
        />
        <Button
          type="button"
          variant="outline"
          className="gap-2 border-emerald-300 bg-white"
          disabled={receivedQuery.isLoading || labels.length === 0}
          onClick={print}
        >
          <Printer className="h-4 w-4" />
          {receivedQuery.isLoading ? "荷受分を確認中…" : `この日の荷受分 ${labels.length}件を印刷`}
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-emerald-900">
          <input
            type="checkbox"
            checked={excludeAccessories}
            onChange={(event) => setExcludeAccessories(event.target.checked)}
            className="h-3.5 w-3.5 accent-emerald-700"
          />
          消耗品（ケーブル・バッテリー等）を除く
        </label>
      </div>
      <p className="mt-2 text-xs text-emerald-900">
        印刷ダイアログは「用紙 A4・倍率 100%・余白なし」で刷ってください。倍率が既定のままだと縮んで面がずれます。
      </p>
    </section>
  );
}
