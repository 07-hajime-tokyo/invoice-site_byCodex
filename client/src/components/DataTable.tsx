/**
 * DataTable Component
 * Design: Scandinavian BI Style
 * Full-featured sortable, paginated data table with teal row hover
 */
import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  TradeRecord,
  COLUMN_LABELS,
  sortRecords,
  formatNumber,
  formatCurrency,
  SortKey,
  SortDir,
} from "@/lib/csvUtils";
import { CalendarDays, ChevronUp, ChevronDown, ChevronsUpDown, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { EditTradeDialog } from "@/components/EditTradeDialog";
import { ShipmentHistory } from "@/components/ShipmentHistory";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface DataTableProps {
  records: TradeRecord[];
  pageSize?: number;
  onRecordUpdated?: () => void;
  totalRecords?: number;
  page?: number;
  sortKey?: SortKey;
  sortDir?: SortDir;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  onSortChange?: (key: SortKey, dir: SortDir) => void;
  onInvoiceNoClick?: (invoiceNo: number) => void;
}

const VISIBLE_COLUMNS: (keyof TradeRecord)[] = [
  "month",
  "partner",
  "no",
  "paymentDate",
  "productName",
  "quantity",
  "unitPrice",
  "currency",
  "unitPriceJPY",
  "status",
  "totalSales",
  "procurementTotal",
  "shippingCost",
  "customsDuty",
  "profitWithRefund",
];

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const MOBILE_META_COLUMNS: (keyof TradeRecord)[] = [
  "quantity",
  "unitPrice",
  "currency",
  "totalSales",
  "procurementTotal",
  "shippingCost",
  "customsDuty",
  "profitWithRefund",
];

function getTradeRecordId(row: TradeRecord): number | null {
  return typeof row.id === "number" && Number.isFinite(row.id) && row.id > 0 ? row.id : null;
}

export function DataTable({
  records,
  pageSize: controlledPageSize,
  onRecordUpdated,
  totalRecords,
  page: controlledPage,
  sortKey: controlledSortKey,
  sortDir: controlledSortDir,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  onInvoiceNoClick,
}: DataTableProps) {
  const isServerPaged = totalRecords !== undefined && controlledPage !== undefined && !!onPageChange;
  const [localSortKey, setLocalSortKey] = useState<SortKey>("no");
  const [localSortDir, setLocalSortDir] = useState<SortDir>("asc");
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(controlledPageSize ?? 20);
  const sortKey = controlledSortKey ?? localSortKey;
  const sortDir = controlledSortDir ?? localSortDir;
  const page = controlledPage ?? localPage;
  const pageSize = controlledPageSize ?? localPageSize;
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkPaymentDate, setBulkPaymentDate] = useState("");
  const setPage = (next: number | ((prev: number) => number)) => {
    if (onPageChange) {
      onPageChange(typeof next === "function" ? next(page) : next);
    } else {
      setLocalPage(next);
    }
  };
  const setPageSize = (next: number) => {
    if (onPageSizeChange) onPageSizeChange(next);
    else setLocalPageSize(next);
  };
  // 発送履歴展開状態: key = `${no}-${index}`
  const [expandedShipment, setExpandedShipment] = useState<string | null>(null);
  const bulkUpdatePaymentDateMutation = trpc.trade.bulkUpdatePaymentDate.useMutation({
    onSuccess: (result) => {
      toast.success("支払日を一括登録しました", {
        description: `${result.updatedCount}件を更新しました。`,
      });
      setSelectedIds(new Set());
      setBulkPaymentDate("");
      onRecordUpdated?.();
    },
    onError: (error) => {
      toast.error("支払日の一括登録に失敗しました", {
        description: error.message,
      });
    },
  });

  const handleSort = useCallback(
    (key: SortKey) => {
      const nextDir = sortKey === key
        ? (sortDir === "asc" ? "desc" : sortDir === "desc" ? "none" : "asc")
        : "asc";
      if (onSortChange) {
        onSortChange(key, nextDir);
        return;
      }
      if (sortKey === key) {
        setLocalSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? "none" : "asc"));
      } else {
        setLocalSortKey(key);
        setLocalSortDir("asc");
      }
      setLocalPage(1);
    },
    [onSortChange, sortDir, sortKey]
  );

  const sorted = useMemo(
    () => isServerPaged ? records : sortRecords(records, sortKey, sortDir),
    [isServerPaged, records, sortKey, sortDir]
  );

  // インボイスNoごとの全商品合計数量マップ（発送完了判定に使用）
  const invoiceTotalQtyMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of records) {
      if (r.no == null) continue;
      map.set(r.no, (map.get(r.no) ?? 0) + (Number(r.quantity) || 0));
    }
    return map;
  }, [records]);

  const effectiveTotalRecords = totalRecords ?? sorted.length;
  const totalPages = Math.max(1, Math.ceil(effectiveTotalRecords / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRecords = isServerPaged
    ? sorted
    : sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectablePageIds = useMemo(
    () => pageRecords.map(getTradeRecordId).filter((id): id is number => id !== null),
    [pageRecords]
  );
  const allPageSelected = selectablePageIds.length > 0 && selectablePageIds.every((id) => selectedIds.has(id));
  const somePageSelected = selectablePageIds.some((id) => selectedIds.has(id));
  const selectedCount = selectedIds.size;

  useEffect(() => {
    const availableIds = new Set(records.map(getTradeRecordId).filter((id): id is number => id !== null));
    setSelectedIds((current) => {
      const next = new Set<number>();
      for (const id of current) {
        if (availableIds.has(id)) next.add(id);
      }
      return next.size === current.size ? current : next;
    });
  }, [records]);

  const toggleRowSelection = useCallback((id: number, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const togglePageSelection = useCallback((checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of selectablePageIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, [selectablePageIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkPaymentDateSubmit = useCallback(() => {
    const paymentDate = bulkPaymentDate.trim();
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      toast.error("更新する行を選択してください。");
      return;
    }
    if (!paymentDate) {
      toast.error("支払日を入力してください。");
      return;
    }
    const ok = window.confirm(`${ids.length}件の支払日を ${paymentDate} に更新します。よろしいですか？`);
    if (!ok) return;
    bulkUpdatePaymentDateMutation.mutate({ ids, paymentDate });
  }, [bulkPaymentDate, bulkUpdatePaymentDateMutation, selectedIds]);

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col || sortDir === "none")
      return <ChevronsUpDown size={12} className="text-muted-foreground/50 ml-1 flex-shrink-0" />;
    if (sortDir === "asc")
      return <ChevronUp size={12} className="text-primary ml-1 flex-shrink-0" />;
    return <ChevronDown size={12} className="text-primary ml-1 flex-shrink-0" />;
  };

  const formatCell = (key: keyof TradeRecord, val: unknown): React.ReactNode => {
    if (val === null || val === undefined || val === "") return <span className="text-muted-foreground/40">—</span>;
    if (key === "month") return <span className="font-medium">{String(val)}月</span>;
    if (key === "profitWithRefund") {
      const n = val as number;
      return (
        <span className={n >= 0 ? "profit-positive" : "profit-negative"}>
          {formatCurrency(n)}
        </span>
      );
    }
    if (["totalSales", "procurementTotal", "unitPriceJPY", "shippingCost", "customsDuty"].includes(key)) {
      return <span className="tabular-nums">{formatCurrency(val as number)}</span>;
    }
    if (key === "quantity") {
      return <span className="tabular-nums font-medium">{formatNumber(val as number)}</span>;
    }
    if (key === "unitPrice") {
      return <span className="tabular-nums">{formatNumber(val as number)}</span>;
    }
    if (key === "no") {
      const no = Number(val);
      if (!Number.isFinite(no) || !onInvoiceNoClick) return <span>{String(val)}</span>;
      return (
        <button
          type="button"
          className="tabular-nums font-semibold text-primary hover:underline"
          onClick={() => onInvoiceNoClick(no)}
        >
          {String(val)}
        </button>
      );
    }
    if (key === "status") {
      const s = String(val);
      const normalizedStatus = s.trim().toLowerCase();
      const isComplete = normalizedStatus === "complete" || s.trim() === "\u5b8c\u4e86";
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            isComplete
              ? "bg-teal-50 text-teal-700 border border-teal-200"
              : "bg-amber-50 text-amber-700 border border-amber-200"
          }`}
        >
          {isComplete ? "完了" : s}
        </span>
      );
    }
    return <span>{String(val)}</span>;
  };

  // Pagination range
  const getPageRange = () => {
    const delta = 2;
    const range: (number | "...")[] = [];
    const left = Math.max(1, currentPage - delta);
    const right = Math.min(totalPages, currentPage + delta);
    if (left > 1) { range.push(1); if (left > 2) range.push("..."); }
    for (let i = left; i <= right; i++) range.push(i);
    if (right < totalPages) { if (right < totalPages - 1) range.push("..."); range.push(totalPages); }
    return range;
  };

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm">
      {/* Table header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-wrap gap-2">
        <div className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{effectiveTotalRecords.toLocaleString()}</span> 件
          {records.length !== sorted.length && (
            <span className="ml-1">(ソート済み)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">表示件数:</span>
          <div className="flex gap-1">
            {PAGE_SIZE_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => { setPageSize(n); setPage(1); }}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  pageSize === n
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        {selectedCount > 0 && (
          <div className="flex w-full flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
            <span className="text-xs font-semibold text-primary">{selectedCount}件選択中</span>
            <Input
              type="date"
              value={bulkPaymentDate}
              onChange={(event) => setBulkPaymentDate(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleBulkPaymentDateSubmit();
              }}
              className="h-8 w-full bg-white text-xs sm:w-40"
              aria-label="一括登録する支払日"
            />
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={bulkUpdatePaymentDateMutation.isPending}
              onClick={handleBulkPaymentDateSubmit}
            >
              <CalendarDays size={13} />
              支払日を一括登録
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              disabled={bulkUpdatePaymentDateMutation.isPending}
              onClick={clearSelection}
            >
              選択解除
            </Button>
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="divide-y divide-border md:hidden">
        {pageRecords.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            データが見つかりませんでした
          </div>
        ) : (
          pageRecords.map((row, i) => {
            const rowKey = row.id ? `trade-${row.id}` : `${row.no}-${i}`;
            const rowId = getTradeRecordId(row);
            const isExpanded = expandedShipment === rowKey;
            return (
              <div key={rowKey} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  {rowId !== null && (
                    <Checkbox
                      checked={selectedIds.has(rowId)}
                      onCheckedChange={(checked) => toggleRowSelection(rowId, checked === true)}
                      aria-label={`No.${row.no} ${row.productName}を選択`}
                      className="mt-1"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {Number.isFinite(Number(row.no)) && onInvoiceNoClick ? (
                        <button
                          type="button"
                          className="text-sm font-semibold text-primary hover:underline"
                          onClick={() => onInvoiceNoClick(Number(row.no))}
                        >
                          No.{row.no}
                        </button>
                      ) : (
                        <span className="text-sm font-semibold text-foreground">No.{row.no}</span>
                      )}
                      {formatCell("status", row.status)}
                    </div>
                    <div className="mt-1 break-words text-sm font-medium">{formatCell("productName", row.productName)}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{formatCell("partner", row.partner)}</span>
                      <span>{formatCell("paymentDate", row.paymentDate)}</span>
                      <span>{formatCell("month", row.month)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <EditTradeDialog record={row} onSuccess={onRecordUpdated} />
                    <button
                      onClick={() => setExpandedShipment(isExpanded ? null : rowKey)}
                      title="発送履歴"
                      className={`flex h-8 w-8 items-center justify-center rounded border transition-colors ${
                        isExpanded
                          ? "border-orange-200 bg-orange-50 text-orange-600"
                          : "border-border text-muted-foreground hover:text-orange-600 hover:bg-orange-50"
                      }`}
                    >
                      <Truck size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {MOBILE_META_COLUMNS.map((col) => (
                    <div key={col} className="rounded-md bg-muted/40 px-2 py-1.5">
                      <div className="text-[10px] font-medium text-muted-foreground">{COLUMN_LABELS[col]}</div>
                      <div className="mt-0.5 text-sm font-semibold">{formatCell(col, row[col])}</div>
                    </div>
                  ))}
                </div>
                {isExpanded && (
                  <div className="mt-3 rounded-md border bg-muted/20 p-3">
                    <div className="mb-2 text-xs font-semibold text-muted-foreground">
                      No.{row.no} 発送履歴
                    </div>
                    <ShipmentHistory
                      invoiceNo={row.no}
                      orderedQty={invoiceTotalQtyMap.get(row.no) ?? row.quantity}
                      onDeleted={onRecordUpdated}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Scrollable table */}
      <div className="relative hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="w-10 px-3 py-2.5 text-left">
                <Checkbox
                  checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                  onCheckedChange={(checked) => togglePageSelection(checked === true)}
                  disabled={selectablePageIds.length === 0}
                  aria-label="表示中の取引データを選択"
                />
              </th>
              {VISIBLE_COLUMNS.map((col) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground hover:bg-muted/80 transition-colors select-none"
                >
                  <div className="flex items-center">
                    {COLUMN_LABELS[col]}
                    <SortIcon col={col} />
                  </div>
                </th>
              ))}
              <th className="sticky right-0 z-20 w-16 border-l border-border bg-muted/95 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap shadow-sm">
                編集
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRecords.length === 0 ? (
              <tr>
                <td colSpan={VISIBLE_COLUMNS.length + 2} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  データが見つかりませんでした
                </td>
              </tr>
            ) : (
              pageRecords.map((row, i) => {
                const rowKey = row.id ? `trade-${row.id}` : `${row.no}-${i}`;
                const rowId = getTradeRecordId(row);
                const isExpanded = expandedShipment === rowKey;
                return (
                  <React.Fragment key={rowKey}>
                    <tr
                      className="data-table-row animate-row"
                      style={{ animationDelay: `${Math.min(i * 15, 300)}ms` }}
                    >
                      <td className="w-10 px-3 py-2 whitespace-nowrap">
                        {rowId !== null && (
                          <Checkbox
                            checked={selectedIds.has(rowId)}
                            onCheckedChange={(checked) => toggleRowSelection(rowId, checked === true)}
                            aria-label={`No.${row.no} ${row.productName}を選択`}
                          />
                        )}
                      </td>
                      {VISIBLE_COLUMNS.map((col) => (
                        <td
                          key={col}
                          className="px-3 py-2 whitespace-nowrap text-xs md:text-sm text-foreground"
                        >
                          {formatCell(col, row[col])}
                        </td>
                      ))}
                      <td className="sticky right-0 z-10 border-l border-border bg-white px-3 py-2 whitespace-nowrap shadow-sm">
                        <div className="flex items-center gap-1">
                          <EditTradeDialog record={row} onSuccess={onRecordUpdated} />
                          <button
                            onClick={() => setExpandedShipment(isExpanded ? null : rowKey)}
                            title="発送履歴"
                            className={`p-1 rounded transition-colors ${
                              isExpanded
                                ? "text-orange-600 bg-orange-50"
                                : "text-muted-foreground hover:text-orange-600 hover:bg-orange-50"
                            }`}
                          >
                            <Truck size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-muted/20">
                        <td colSpan={VISIBLE_COLUMNS.length + 2} className="px-4 py-3">
                          <div className="text-xs font-semibold text-muted-foreground mb-2">
                            No.{row.no} 発送履歴
                          </div>
                          <ShipmentHistory
                            invoiceNo={row.no}
                            orderedQty={invoiceTotalQtyMap.get(row.no) ?? row.quantity}
                            onDeleted={onRecordUpdated}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border flex-wrap gap-2">
          <div className="text-xs text-muted-foreground">
            {((currentPage - 1) * pageSize + 1).toLocaleString()} –{" "}
            {Math.min(currentPage * pageSize, effectiveTotalRecords).toLocaleString()} /{" "}
            {effectiveTotalRecords.toLocaleString()} 件
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPage(1)}
              disabled={currentPage === 1}
            >
              «
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              ‹
            </Button>
            {getPageRange().map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p as number)}
                  className={`w-7 h-7 text-xs rounded transition-colors ${
                    currentPage === p
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  {p}
                </button>
              )
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              ›
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              »
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
