import { ProductQrCode } from "./ProductQrCode";
import { LabelChecklistView } from "./LabelChecklists";
import { EmptyState } from "./EmptyState";
import { isStockProposalAccessory } from "./stockProposalRules";
import { stockModelName } from "./productPresentation";
import { labelStatusLabel } from "./labelStatus";
import { labelAllocationLabel, formatLabelPrintTitle } from "./labelTitles";
import type { LabelTitleOverrideState } from "./labelTitleOverrides";
import { normalizeLabelTitleKey, applyLabelTitleOverride } from "./labelTitleOverrides";
import { LABELS_PER_SHEET, buildLabelPrintGroups } from "./labelPrintLayout";
import type { LabelView, LabelPrintRequest } from "./viewTypes";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ClipboardList, Printer, Tag } from "lucide-react";
import { loadLabelTitleOverrides, saveLabelTitleOverrides, todayInTokyo } from "./labelPrintSettings";

export function LabelPrintPanel({
  labels,
  allLabels,
  onPrintLabels,
  onPrintChecklist,
  startPosition,
  onStartPositionChange,
}: {
  labels: LabelView[];
  allLabels: LabelView[];
  onPrintLabels: LabelPrintRequest;
  onPrintChecklist: LabelPrintRequest;
  startPosition: number;
  onStartPositionChange: (value: number) => void;
}) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [labelTitleOverrides, setLabelTitleOverrides] = useState<LabelTitleOverrideState>(() =>
    loadLabelTitleOverrides(),
  );
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const editableLabels = useMemo(
    () => labels.map((label) => applyLabelTitleOverride(label, labelTitleOverrides)),
    [labelTitleOverrides, labels],
  );
  const editableAllLabels = useMemo(
    () => allLabels.map((label) => applyLabelTitleOverride(label, labelTitleOverrides)),
    [allLabels, labelTitleOverrides],
  );
  const selectedLabels = useMemo(
    () => editableLabels.filter((label) => selectedKeySet.has(label.key)),
    [editableLabels, selectedKeySet],
  );
  const currentPrintLabels = selectedLabels.length > 0 ? selectedLabels : editableLabels;
  const selectedCount = selectedLabels.length;
  const labelPrintGroups = useMemo(() => buildLabelPrintGroups(editableLabels), [editableLabels]);
  const [showChecklist, setShowChecklist] = useState(false);
  // カテゴリ別ブロックは既定で閉じておく。開いたブロックのぶんだけQRを描く。
  // 在庫一覧グループは数百枚あり、全部を一度に描くとブラウザが固まるため（2026-08-15 実測）。
  const [openGroupNames, setOpenGroupNames] = useState<string[]>([]);
  const openGroupNameSet = useMemo(() => new Set(openGroupNames), [openGroupNames]);

  // 「今日の荷受分」。荷受日＝配送伝票のバーコードを読んだ時点で、入庫日とは別物。
  const [receivedDate, setReceivedDate] = useState<string>(() => todayInTokyo());
  const [excludeAccessories, setExcludeAccessories] = useState(true);
  const receivedQuery = trpc.inventory.inboundDesk.receivedLabelsOn.useQuery(
    { date: receivedDate },
    { enabled: /^\d{4}-\d{2}-\d{2}$/.test(receivedDate), staleTime: 30_000 },
  );
  // その日に届いたものは引当先をまたぐうえ、在庫用や、発注一覧のページから外れたものも混ざる。
  // 画面が持っているラベルから引き直すと取りこぼすので、サーバーが返した行から組み立てる。
  const receivedDateLabels = useMemo(() => {
    const rows = receivedQuery.data?.labels ?? [];
    if (rows.length === 0) return [];
    const knownByLabelId = new Map(
      editableAllLabels.map((label) => [label.labelId.trim().toUpperCase(), label]),
    );
    return rows.flatMap((row) => {
      // 消耗品（ケーブル・バッテリー等）はラベルを貼らない方針のため既定で外す
      if (excludeAccessories && isStockProposalAccessory(row.title, row.category)) return [];
      const known = knownByLabelId.get(row.labelId);
      if (known) return [known];
      // 画面に無いものは、印刷に要る項目だけを組み立てて出す
      const fallback: LabelView = {
        key: `received-${row.labelId}`,
        labelId: row.labelId,
        rawStatus: row.status,
        status: labelStatusLabel(row.status),
        title: row.title,
        printTitle: formatLabelPrintTitle(row.title),
        category: row.category || stockModelName(row.title),
        legacyManagementNo: row.legacyManagementNo || "-",
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
      return [applyLabelTitleOverride(fallback, labelTitleOverrides)];
    });
  }, [editableAllLabels, excludeAccessories, labelTitleOverrides, receivedQuery.data]);

  const toggleGroupOpen = (name: string) => {
    setOpenGroupNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  const toggleGroup = (keys: string[], checked: boolean) => {
    setSelectedKeys((current) => {
      if (checked) return Array.from(new Set([...current, ...keys]));
      const removing = new Set(keys);
      return current.filter((key) => !removing.has(key));
    });
  };

  useEffect(() => {
    const visibleKeys = new Set(labels.map((label) => label.key));
    setSelectedKeys((current) => current.filter((key) => visibleKeys.has(key)));
  }, [labels]);

  useEffect(() => {
    saveLabelTitleOverrides(labelTitleOverrides);
  }, [labelTitleOverrides]);

  const toggleLabel = (key: string, checked: boolean) => {
    setSelectedKeys((current) => {
      if (checked) return current.includes(key) ? current : [...current, key];
      return current.filter((item) => item !== key);
    });
  };

  const updateLabelTitle = (label: LabelView, value: string) => {
    const titleKey = normalizeLabelTitleKey(label.title || label.printTitle);
    setLabelTitleOverrides((current) => {
      const next: LabelTitleOverrideState = {
        byLabelId: { ...current.byLabelId },
        byTitleKey: { ...current.byTitleKey },
      };
      if (value.trim()) {
        next.byLabelId[label.labelId] = value;
        if (titleKey) next.byTitleKey[titleKey] = value;
      } else {
        delete next.byLabelId[label.labelId];
        if (titleKey) delete next.byTitleKey[titleKey];
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">ラベル印刷</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              チェックした商品IDだけを印刷できます。未選択の場合は表示中のラベルを印刷します。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="label-start-position" className="text-sm font-medium">
                開始位置
              </label>
              <Input
                id="label-start-position"
                type="number"
                min={1}
                max={LABELS_PER_SHEET}
                value={startPosition}
                onChange={(event) => onStartPositionChange(Number(event.target.value))}
                // 既存の値が残ったまま打つと 1 -> 19 になる。触った時点で選択しておく。
                onFocus={(event) => event.currentTarget.select()}
                className="h-9 w-20"
              />
              <span className="text-xs text-muted-foreground">
                面目から（左上が1・右へ2・3、次の段が4）。使いかけのシートの続きから刷るときに変える
              </span>
            </div>
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="label-received-date" className="text-sm font-medium">
                  荷受日
                </label>
                <Input
                  id="label-received-date"
                  type="date"
                  value={receivedDate}
                  onChange={(event) => setReceivedDate(event.target.value)}
                  className="h-9 w-40"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit gap-2 border-emerald-300 bg-white"
                  disabled={receivedQuery.isLoading || receivedDateLabels.length === 0}
                  onClick={() => onPrintLabels(receivedDateLabels)}
                >
                  <Printer className="h-4 w-4" />
                  {receivedQuery.isLoading
                    ? "荷受分を確認中…"
                    : `この日の荷受分 ${receivedDateLabels.length}件を印刷`}
                </Button>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={excludeAccessories}
                    onChange={(event) => setExcludeAccessories(event.target.checked)}
                    className="h-3.5 w-3.5 accent-emerald-700"
                  />
                  消耗品（ケーブル・バッテリー等）を除く
                </label>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                配送伝票のバーコードを読んだ日で数えます（動作確認の前後は問いません）。
                <strong>引当先の選択に関係なく、その日に届いたぶんを全部</strong>刷ります。
                貼るのは動作確認を通ってからで、不良になったぶんの紙は捨ててください。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={editableLabels.length === 0}
              onClick={() => setSelectedKeys(editableLabels.map((label) => label.key))}
            >
              全選択
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={selectedCount === 0}
              onClick={() => setSelectedKeys([])}
            >
              選択解除
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-fit gap-2"
              disabled={currentPrintLabels.length === 0}
              onClick={() => onPrintLabels(currentPrintLabels)}
            >
              <Printer className="h-4 w-4" />
              ラベルを印刷
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-fit gap-2"
              disabled={editableAllLabels.length === 0}
              onClick={() => onPrintLabels(editableAllLabels)}
            >
              <Printer className="h-4 w-4" />
              全インボイスを印刷
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-fit gap-2"
              onClick={() => setShowChecklist((current) => !current)}
            >
              <ClipboardList className="h-4 w-4" />
              {showChecklist ? "ラベル表示に戻す" : "確認シート"}
            </Button>
            {showChecklist ? (
              <Button
                type="button"
                variant="outline"
                className="w-fit gap-2"
                disabled={currentPrintLabels.length === 0}
                onClick={() => onPrintChecklist(currentPrintLabels)}
              >
                <Printer className="h-4 w-4" />
                確認シートを印刷
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {editableLabels.length === 0 ? (
        <EmptyState icon={Tag} title="印刷できる商品IDがありません" />
      ) : showChecklist ? (
        <LabelChecklistView labels={currentPrintLabels} />
      ) : (
        <div className="space-y-4">
          {labelPrintGroups.map((group) => {
            const groupKeys = group.labels.map((label) => label.key);
            const checkedCount = groupKeys.filter((key) => selectedKeySet.has(key)).length;
            const allChecked = checkedCount === groupKeys.length;
            const isOpen = openGroupNameSet.has(group.name);
            return (
              <section key={group.name} className="overflow-hidden rounded-md border bg-background">
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`${group.name} をまとめて選択`}
                    checked={allChecked}
                    ref={(node) => {
                      // 一部だけ選ばれている状態を見せる
                      if (node) node.indeterminate = !allChecked && checkedCount > 0;
                    }}
                    onChange={(event) => toggleGroup(groupKeys, event.target.checked)}
                    className="h-4 w-4 accent-emerald-700"
                  />
                  <button
                    type="button"
                    className="flex flex-1 flex-wrap items-center gap-2 text-left"
                    aria-expanded={isOpen}
                    onClick={() => toggleGroupOpen(group.name)}
                  >
                    <ChevronDown
                      className={cn("h-4 w-4 shrink-0 transition-transform", !isOpen && "-rotate-90")}
                    />
                    <span className="text-sm font-semibold">{group.name}</span>
                    <Badge variant="outline">{group.labels.length}枚</Badge>
                    {checkedCount > 0 ? <Badge variant="secondary">選択 {checkedCount}</Badge> : null}
                    {!isOpen ? (
                      <span className="text-xs text-muted-foreground">開くと1枚ずつ確認できます</span>
                    ) : null}
                  </button>
                </div>
                {!isOpen ? null : (
                <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                  {group.labels.map((label) => {
                    const checked = selectedKeySet.has(label.key);
                    return (
                      <div
                        key={label.key}
                        className={cn(
                          "rounded-md border bg-white p-4 shadow-sm",
                          checked && "border-emerald-500 ring-1 ring-emerald-500",
                        )}
                      >
                        <label className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => toggleLabel(label.key, event.target.checked)}
                            className="h-4 w-4 accent-emerald-700"
                          />
                          印刷対象
                        </label>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-mono text-2xl font-bold tracking-wide text-slate-950">{label.labelId}</div>
                            {label.allocationLabel ? (
                              <div className="mt-1 text-sm font-semibold text-slate-700">{label.allocationLabel}</div>
                            ) : null}
                          </div>
                          <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded border bg-white p-2">
                            <ProductQrCode value={label.labelId} />
                          </div>
                        </div>
                        <label
                          className="mt-3 block text-xs font-medium text-muted-foreground"
                          htmlFor={`label-title-${label.key}`}
                        >
                          ラベル商品名
                        </label>
                        <Input
                          id={`label-title-${label.key}`}
                          className="mt-1"
                          value={label.printTitle}
                          onChange={(event) => updateLabelTitle(label, event.target.value)}
                        />
                      </div>
                    );
                  })}
                </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
