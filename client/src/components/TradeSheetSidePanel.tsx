import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Save, Table2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function columnName(index: number) {
  let n = index;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

const ROW_HEADER_WIDTH = 40;
const CELL_WIDTH = 88;
const ROW_HEIGHT = 28;

type EditingCell = {
  row: number;
  column: number;
  value: string;
};

type SheetJumpTarget = {
  invoiceNo: number;
  nonce: number;
};

type HighlightedCell = {
  sheetName: string;
  row: number;
  column: number;
  invoiceNo: number;
  nonce: number;
};

export function TradeSheetSidePanel({ jumpTarget }: { jumpTarget?: SheetJumpTarget | null }) {
  const utils = trpc.useUtils();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [activeSheet, setActiveSheet] = useState("独発送管理");
  const [maxRows, setMaxRows] = useState(140);
  const [startRow, setStartRow] = useState(1);
  const [focusColumn, setFocusColumn] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [highlightedCell, setHighlightedCell] = useState<HighlightedCell | null>(null);

  const tabsQuery = trpc.trade.getSheetTabs.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const tabs = tabsQuery.data?.tabs ?? [];

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((tab) => tab.title === activeSheet)) {
      setActiveSheet(tabs[0].title);
      setStartRow(1);
      setMaxRows(140);
      setFocusColumn(null);
      setHighlightedCell(null);
    }
  }, [activeSheet, tabs]);

  const sheetQuery = trpc.trade.getSheetView.useQuery(
    { sheetName: activeSheet, startRow, maxRows, maxColumns: 160, focusColumn: focusColumn ?? undefined },
    { enabled: !!activeSheet, staleTime: 30 * 1000 }
  );

  const updateMutation = trpc.trade.updateSheetCell.useMutation({
    onSuccess: async (data) => {
      toast.success(`${data.cell} を保存しました`);
      setEditing(null);
      await utils.trade.getSheetView.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "セルの保存に失敗しました");
    },
  });

  useEffect(() => {
    if (!jumpTarget) return;
    let cancelled = false;
    void utils.trade.findTradeViewInvoiceCell.fetch({ invoiceNo: String(jumpTarget.invoiceNo) })
      .then((result) => {
        if (cancelled) return;
        if (!result.found) {
          toast.error(`No.${jumpTarget.invoiceNo} は発送管理シート内に見つかりませんでした`);
          return;
        }
        const foundResult = result as {
          found: true;
          sheetName: string;
          row: number;
          column: number;
          focusColumn?: number | null;
        };
        const nextStartRow = Math.max(1, foundResult.row - 40);
        const nextFocusColumn = foundResult.focusColumn ?? foundResult.column;
        setActiveSheet(foundResult.sheetName);
        setStartRow(nextStartRow);
        setMaxRows(120);
        setFocusColumn(nextFocusColumn);
        setHighlightedCell({
          sheetName: foundResult.sheetName,
          row: foundResult.row,
          column: nextFocusColumn,
          invoiceNo: jumpTarget.invoiceNo,
          nonce: jumpTarget.nonce,
        });
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Noの検索に失敗しました");
      });
    return () => {
      cancelled = true;
    };
  }, [jumpTarget, utils]);

  const rows = sheetQuery.data?.rows ?? [];
  const frozenRows = sheetQuery.data?.frozenRows ?? [];
  const columnCount = sheetQuery.data?.columnCount ?? 8;
  const columnIndexes = sheetQuery.data?.columnIndexes ?? Array.from({ length: columnCount }, (_, index) => index + 1);
  const columns = useMemo(
    () => columnIndexes.map((columnIndex) => columnName(columnIndex)),
    [columnIndexes]
  );
  const visibleStartRow = sheetQuery.data?.startRow ?? startRow;
  const visibleRowCount = sheetQuery.data?.rowCount ?? rows.length;
  const visibleEndRow = visibleRowCount > 0 ? visibleStartRow + visibleRowCount - 1 : visibleStartRow;
  const totalRowCount = sheetQuery.data?.totalRowCount ?? visibleRowCount;
  const displayRows = useMemo(
    () => [
      ...frozenRows.map((values, index) => ({ rowNumber: index + 1, values, frozenIndex: index })),
      ...rows
        .map((values, index) => ({ rowNumber: visibleStartRow + index, values, frozenIndex: null as number | null }))
        .filter((row) => row.rowNumber > frozenRows.length),
    ],
    [frozenRows, rows, visibleStartRow]
  );

  const handleSheetChange = (sheetName: string) => {
    setActiveSheet(sheetName);
    setStartRow(1);
    setMaxRows(140);
    setFocusColumn(null);
    setEditing(null);
    setHighlightedCell(null);
  };

  useEffect(() => {
    if (!highlightedCell || highlightedCell.sheetName !== activeSheet || sheetQuery.isLoading || sheetQuery.isFetching) return;
    const id = window.setTimeout(() => {
      const target = scrollAreaRef.current?.querySelector<HTMLElement>(
        `[data-cell-row="${highlightedCell.row}"][data-cell-column="${highlightedCell.column}"]`
      );
      target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 80);
    return () => window.clearTimeout(id);
  }, [activeSheet, highlightedCell, rows, sheetQuery.isFetching, sheetQuery.isLoading]);

  const startEditing = (row: number, column: number, value: string) => {
    setEditing({ row, column, value });
  };

  const getCellValue = (row: number, column: number) => {
    const columnOffset = columnIndexes.indexOf(column);
    if (columnOffset < 0) return "";
    if (row <= frozenRows.length) return frozenRows[row - 1]?.[columnOffset] ?? "";
    return rows[row - visibleStartRow]?.[columnOffset] ?? "";
  };

  const saveEditing = () => {
    if (!editing || !activeSheet || updateMutation.isPending) return;
    const currentValue = getCellValue(editing.row, editing.column);
    if (editing.value === currentValue) {
      setEditing(null);
      return;
    }
    updateMutation.mutate({
      sheetName: activeSheet,
      row: editing.row,
      column: editing.column,
      value: editing.value,
    });
  };

  if (tabsQuery.data && !tabsQuery.data.configured) {
    return (
      <aside className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Google Sheets API が未設定です。
      </aside>
    );
  }

  if (tabsQuery.error) {
    return (
      <aside className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive">
        {tabsQuery.error.message}
      </aside>
    );
  }

  return (
    <aside className="rounded-lg border border-border bg-card shadow-sm min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Table2 className="h-4 w-4 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">スプシビュー</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {activeSheet || "読み込み中"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {tabsQuery.data?.spreadsheetUrl && (
            <Button asChild variant="ghost" size="icon" className="h-8 w-8">
              <a href={tabsQuery.data.spreadsheetUrl} target="_blank" rel="noreferrer" title="Google Sheetsを開く">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => sheetQuery.refetch()}
            disabled={sheetQuery.isFetching}
            title="再読み込み"
          >
            <RefreshCw className={`h-4 w-4 ${sheetQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Select value={activeSheet} onValueChange={handleSheetChange} disabled={tabsQuery.isLoading || tabs.length === 0}>
          <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
            <SelectValue placeholder="シート" />
          </SelectTrigger>
          <SelectContent>
            {tabs.map((tab) => (
              <SelectItem key={tab.title} value={tab.title}>
                {tab.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {editing && (
          <Button
            size="sm"
            className="h-8 gap-1"
            onClick={saveEditing}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            保存
          </Button>
        )}
      </div>

      <div ref={scrollAreaRef} className="h-[430px] overflow-auto bg-white">
        {tabsQuery.isLoading || sheetQuery.isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            読み込み中
          </div>
        ) : sheetQuery.error ? (
          <div className="p-4 text-sm text-destructive">{sheetQuery.error.message}</div>
        ) : (
          <table className="border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 h-7 w-10 min-w-10 border-b border-r border-border bg-muted text-[10px] text-muted-foreground" />
                {columns.map((col, visibleColIndex) => {
                  const columnIndex = columnIndexes[visibleColIndex];
                  const isFrozenColumn = columnIndex <= 7;
                  return (
                  <th
                    key={col}
                    className={`sticky top-0 h-7 min-w-[88px] border-b border-r border-border bg-muted px-2 text-center text-[10px] font-semibold text-muted-foreground ${
                      isFrozenColumn ? "z-40" : "z-20"
                    }`}
                    style={isFrozenColumn ? { left: `${ROW_HEADER_WIDTH + visibleColIndex * CELL_WIDTH}px` } : undefined}
                  >
                    {col}
                  </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayRows.map(({ rowNumber, values, frozenIndex }) => {
                const isFrozenRow = frozenIndex !== null;
                const frozenTop = isFrozenRow ? ROW_HEIGHT + frozenIndex * ROW_HEIGHT : undefined;
                return (
                  <tr key={rowNumber}>
                    <th
                      className={`sticky left-0 h-7 border-b border-r border-border bg-muted px-1 text-right text-[10px] font-medium text-muted-foreground ${
                        isFrozenRow ? "z-50" : "z-10"
                      }`}
                      style={isFrozenRow ? { top: `${frozenTop}px` } : undefined}
                    >
                      {rowNumber}
                    </th>
                    {columns.map((_, visibleColIndex) => {
                      const colNumber = columnIndexes[visibleColIndex];
                      const value = values[visibleColIndex] ?? "";
                      const isFrozenColumn = colNumber <= 7;
                      const isEditing = editing?.row === rowNumber && editing.column === colNumber;
                      const isHighlightedRow = highlightedCell?.sheetName === activeSheet && highlightedCell.row === rowNumber;
                      const isHighlightedCell = isHighlightedRow && highlightedCell.column === colNumber;
                      const stickyStyle = {
                        ...(isFrozenColumn ? { left: `${ROW_HEADER_WIDTH + visibleColIndex * CELL_WIDTH}px` } : {}),
                        ...(isFrozenRow ? { top: `${frozenTop}px` } : {}),
                      };
                      return (
                        <td
                          key={`${rowNumber}-${colNumber}`}
                          data-cell-row={rowNumber}
                          data-cell-column={colNumber}
                          className={`h-7 min-w-[88px] max-w-[180px] border-b border-r border-border px-1 align-middle ${
                            isFrozenColumn || isFrozenRow ? "sticky" : ""
                          } ${
                            isFrozenColumn && isFrozenRow ? "z-40" : isFrozenColumn ? "z-20" : isFrozenRow ? "z-30" : ""
                          } ${
                            isEditing
                              ? "bg-amber-50"
                              : isHighlightedCell
                                ? "bg-emerald-100 ring-2 ring-primary ring-inset"
                                : isHighlightedRow
                                  ? "bg-emerald-50"
                                  : rowNumber <= 3 ? "bg-slate-50" : "bg-white hover:bg-teal-50/70"
                          }`}
                          style={isFrozenColumn || isFrozenRow ? stickyStyle : undefined}
                          onDoubleClick={() => startEditing(rowNumber, colNumber, value)}
                        >
                          {isEditing ? (
                            <Input
                              autoFocus
                              className="h-6 min-w-[120px] border-amber-300 bg-white px-1 text-xs"
                              value={editing.value}
                              onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                              onBlur={saveEditing}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") saveEditing();
                                if (event.key === "Escape") setEditing(null);
                              }}
                            />
                          ) : (
                            <span className="block truncate whitespace-nowrap tabular-nums" title={value}>
                              {value}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span>
          {sheetQuery.data
            ? `${visibleStartRow}-${visibleEndRow}行 / 全${totalRowCount}行・${sheetQuery.data.columnCount}列`
            : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setMaxRows((value) => Math.min(value + 80, 300))}
          disabled={maxRows >= 300}
        >
          さらに表示
        </Button>
      </div>
    </aside>
  );
}
