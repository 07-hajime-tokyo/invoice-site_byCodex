/**
 * FilterPanel Component
 * Design: Scandinavian BI Style
 * Collapsible filter panel with year, month range, partner, currency, status filters
 * + "未完了のみ表示" toggle
 * + Q1〜Q4 quarter shortcut buttons
 * Supports optional filterOptions from DB (overrides CSV-derived options)
 */
import { useMemo } from "react";
import { TradeRecord, COLUMN_LABELS, getUniqueValues } from "@/lib/csvUtils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { X, SlidersHorizontal, AlertCircle } from "lucide-react";

type FilterableKey = "year" | "monthFrom" | "monthTo" | "partner" | "currency" | "status";

interface FilterPanelProps {
  allRecords: TradeRecord[];
  filters: Partial<Record<FilterableKey, string>>;
  onFilterChange: (key: FilterableKey, value: string) => void;
  onClearAll: () => void;
  activeCount: number;
  showIncompleteOnly: boolean;
  onToggleIncomplete: (val: boolean) => void;
  /** DB から取得したフィルター選択肢（指定時はCSV由来の選択肢を上書き） */
  filterOptions?: {
    years: string[];
    partners: string[];
    currencies: string[];
    statuses: string[];
  };
}

// 四半期定義
const QUARTERS = [
  { label: "Q1", from: "1", to: "3", months: "1〜3月" },
  { label: "Q2", from: "4", to: "6", months: "4〜6月" },
  { label: "Q3", from: "7", to: "9", months: "7〜9月" },
  { label: "Q4", from: "10", to: "12", months: "10〜12月" },
] as const;

export function FilterPanel({
  allRecords,
  filters,
  onFilterChange,
  onClearAll,
  activeCount,
  showIncompleteOnly,
  onToggleIncomplete,
  filterOptions,
}: FilterPanelProps) {
  // 年フィルター選択時、月の選択肢を絞り込む
  const selectedYear = filters["year"];
  const filteredByYear = useMemo(() => {
    if (!selectedYear || selectedYear === "__all__") return allRecords;
    return allRecords.filter((r) => r.year === selectedYear);
  }, [allRecords, selectedYear]);

  const yearOptions = useMemo(
    () => filterOptions?.years ?? getUniqueValues(allRecords, "year"),
    [allRecords, filterOptions]
  );

  const monthOptions = useMemo(
    () =>
      getUniqueValues(filteredByYear, "month").sort(
        (a, b) => parseInt(a) - parseInt(b)
      ),
    [filteredByYear]
  );

  const partnerOptions = useMemo(
    () => filterOptions?.partners ?? getUniqueValues(allRecords, "partner"),
    [allRecords, filterOptions]
  );

  const currencyOptions = useMemo(
    () => filterOptions?.currencies ?? getUniqueValues(allRecords, "currency"),
    [allRecords, filterOptions]
  );

  const statusOptions = useMemo(
    () => filterOptions?.statuses ?? getUniqueValues(allRecords, "status"),
    [allRecords, filterOptions]
  );

  const totalActiveCount = activeCount + (showIncompleteOnly ? 1 : 0);

  const monthFromVal = filters["monthFrom"] ?? "__all__";
  const monthToVal = filters["monthTo"] ?? "__all__";

  // 終了月の選択肢は開始月以降に絞る
  const monthToOptions = useMemo(() => {
    if (!monthFromVal || monthFromVal === "__all__") return monthOptions;
    return monthOptions.filter((m) => parseInt(m) >= parseInt(monthFromVal));
  }, [monthOptions, monthFromVal]);

  // 開始月の選択肢は終了月以前に絞る
  const monthFromOptions = useMemo(() => {
    if (!monthToVal || monthToVal === "__all__") return monthOptions;
    return monthOptions.filter((m) => parseInt(m) <= parseInt(monthToVal));
  }, [monthOptions, monthToVal]);

  // 現在選択中の四半期を判定
  const activeQuarter = useMemo(() => {
    if (monthFromVal === "__all__" || monthToVal === "__all__") return null;
    return QUARTERS.find(
      (q) => q.from === monthFromVal && q.to === monthToVal
    )?.label ?? null;
  }, [monthFromVal, monthToVal]);

  // 四半期ボタンクリック処理
  const handleQuarterClick = (quarter: typeof QUARTERS[number]) => {
    if (activeQuarter === quarter.label) {
      // 同じ四半期をもう一度クリックしたら解除
      onFilterChange("monthFrom", "__all__");
      onFilterChange("monthTo", "__all__");
    } else {
      onFilterChange("monthFrom", quarter.from);
      onFilterChange("monthTo", quarter.to);
    }
  };

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-primary" />
          <span className="text-sm font-semibold text-foreground">フィルター</span>
          {totalActiveCount > 0 && (
            <span className="bg-primary text-primary-foreground text-xs font-bold px-1.5 py-0.5 rounded-full">
              {totalActiveCount}
            </span>
          )}
        </div>
        {totalActiveCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { onClearAll(); onToggleIncomplete(true); }}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
          >
            <X size={12} className="mr-1" />
            クリア
          </Button>
        )}
      </div>

      {/* 四半期ショートカットボタン */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-muted-foreground flex-shrink-0">四半期:</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {QUARTERS.map((q) => (
            <button
              key={q.label}
              onClick={() => handleQuarterClick(q)}
              title={q.months}
              className={`h-7 px-2.5 rounded text-xs font-semibold border transition-colors ${
                activeQuarter === q.label
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
              }`}
            >
              {q.label}
              <span className="ml-1 font-normal opacity-70 hidden sm:inline">
                ({q.months})
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-3">
        {/* 年 */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            {COLUMN_LABELS["year"]}
          </label>
          <Select
            value={filters["year"] ?? "__all__"}
            onValueChange={(v) => {
              onFilterChange("year", v);
              // 年が変わったら月フィルターをリセット
              onFilterChange("monthFrom", "__all__");
              onFilterChange("monthTo", "__all__");
            }}
          >
            <SelectTrigger className="h-8 text-xs bg-muted/40 border-border">
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">すべて</SelectItem>
              {yearOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}年
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 月（開始〜終了） */}
        <div className="flex flex-col gap-1 col-span-1 sm:col-span-1 md:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">
            月（範囲）
          </label>
          <div className="flex items-center gap-1">
            <Select
              value={monthFromVal}
              onValueChange={(v) => {
                onFilterChange("monthFrom", v);
                // 開始月が終了月より後になったら終了月をリセット
                if (v !== "__all__" && monthToVal !== "__all__" && parseInt(v) > parseInt(monthToVal)) {
                  onFilterChange("monthTo", "__all__");
                }
              }}
            >
              <SelectTrigger className="h-8 text-xs bg-muted/40 border-border flex-1">
                <SelectValue placeholder="開始" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">すべて</SelectItem>
                {monthFromOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}月
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground flex-shrink-0">〜</span>
            <Select
              value={monthToVal}
              onValueChange={(v) => {
                onFilterChange("monthTo", v);
                // 終了月が開始月より前になったら開始月をリセット
                if (v !== "__all__" && monthFromVal !== "__all__" && parseInt(v) < parseInt(monthFromVal)) {
                  onFilterChange("monthFrom", "__all__");
                }
              }}
            >
              <SelectTrigger className="h-8 text-xs bg-muted/40 border-border flex-1">
                <SelectValue placeholder="終了" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">すべて</SelectItem>
                {monthToOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}月
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 取引相手 */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            {COLUMN_LABELS["partner"]}
          </label>
          <Select
            value={filters["partner"] ?? "__all__"}
            onValueChange={(v) => onFilterChange("partner", v)}
          >
            <SelectTrigger className="h-8 text-xs bg-muted/40 border-border">
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">すべて</SelectItem>
              {partnerOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 通貨 */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            {COLUMN_LABELS["currency"]}
          </label>
          <Select
            value={filters["currency"] ?? "__all__"}
            onValueChange={(v) => onFilterChange("currency", v)}
          >
            <SelectTrigger className="h-8 text-xs bg-muted/40 border-border">
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">すべて</SelectItem>
              {currencyOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 状況 */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            {COLUMN_LABELS["status"]}
          </label>
          <Select
            value={filters["status"] ?? "__all__"}
            onValueChange={(v) => onFilterChange("status", v)}
          >
            <SelectTrigger className="h-8 text-xs bg-muted/40 border-border">
              <SelectValue placeholder="すべて" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">すべて</SelectItem>
              {statusOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 未完了のみ表示トグル */}
      <div className="flex items-center gap-3 pt-3 border-t border-border">
        <Switch
          id="incomplete-toggle"
          checked={showIncompleteOnly}
          onCheckedChange={onToggleIncomplete}
          className="data-[state=checked]:bg-amber-500"
        />
        <label
          htmlFor="incomplete-toggle"
          className="flex items-center gap-1.5 text-sm font-medium cursor-pointer select-none"
        >
          <AlertCircle size={13} className={showIncompleteOnly ? "text-amber-500" : "text-muted-foreground"} />
          <span className={showIncompleteOnly ? "text-amber-600" : "text-foreground"}>
            未完了のみ表示
          </span>
          {showIncompleteOnly && (
            <span className="text-xs text-muted-foreground font-normal">
              (complete 以外)
            </span>
          )}
        </label>
      </div>
    </div>
  );
}
