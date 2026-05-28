/**
 * DataTable Component
 * Design: Scandinavian BI Style
 * Full-featured sortable, paginated data table with teal row hover
 */
import React, { useState, useMemo, useCallback } from "react";
import {
  TradeRecord,
  COLUMN_LABELS,
  sortRecords,
  formatNumber,
  formatCurrency,
  SortKey,
  SortDir,
} from "@/lib/csvUtils";
import { ChevronUp, ChevronDown, ChevronsUpDown, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditTradeDialog } from "@/components/EditTradeDialog";
import { ShipmentHistory } from "@/components/ShipmentHistory";

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
  "profitWithRefund",
];

const PAGE_SIZE_OPTIONS = [20, 50, 100];

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
    if (["totalSales", "procurementTotal", "unitPriceJPY"].includes(key)) {
      return <span className="tabular-nums">{formatCurrency(val as number)}</span>;
    }
    if (key === "quantity") {
      return <span className="tabular-nums font-medium">{formatNumber(val as number)}</span>;
    }
    if (key === "unitPrice") {
      return <span className="tabular-nums">{formatNumber(val as number)}</span>;
    }
    if (key === "status") {
      const s = String(val);
      const isComplete = s === "complete";
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
      </div>

      {/* Scrollable table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
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
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap w-8">
                編集
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRecords.length === 0 ? (
              <tr>
                <td colSpan={VISIBLE_COLUMNS.length} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  データが見つかりませんでした
                </td>
              </tr>
            ) : (
              pageRecords.map((row, i) => {
                const rowKey = `${row.no}-${i}`;
                const isExpanded = expandedShipment === rowKey;
                return (
                  <React.Fragment key={rowKey}>
                    <tr
                      className="data-table-row animate-row"
                      style={{ animationDelay: `${Math.min(i * 15, 300)}ms` }}
                    >
                      {VISIBLE_COLUMNS.map((col) => (
                        <td
                          key={col}
                          className="px-3 py-2 whitespace-nowrap text-xs md:text-sm text-foreground"
                        >
                          {formatCell(col, row[col])}
                        </td>
                      ))}
                      <td className="px-3 py-2 whitespace-nowrap">
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
                        <td colSpan={VISIBLE_COLUMNS.length + 1} className="px-4 py-3">
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
