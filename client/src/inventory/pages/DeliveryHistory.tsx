import { useState, useMemo, useEffect, Fragment } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  RefreshCw,
  History,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Download,
  Pencil,
  Check,
  X,
  Undo2,
  AlertTriangle,
  AlertCircle,
  Trash2,
  ChevronDown,
  ChevronRight,
  CalendarIcon,
  ArrowUpDown,
  SortAsc,
  SortDesc,
  ArrowLeft,
  Send,
  Package,
  Edit,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { usePagination } from "@/inventory/hooks/usePagination";
import { PaginationBar } from "@/inventory/components/PaginationBar";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface HistoryItem {
  inventoryId: number;
  title: string;
  quantity: number;
}

interface CancelledItem {
  inventoryId: number;
  quantity: number;
  cancelledAt: string;
}

interface InventoryDetail {
  id: number;
  title: string;
  quantity: string;
  unit: string;
  category?: string;
  categories?: string[];
  place?: string;
  etc?: string;
  unit_price?: number;
  purchase_unit_price?: number;
  optional_attributes?: Array<{ name: string; value: string | null }>;
  item_image?: { url: string | null };
  created_at: string;
  updated_at: string;
  _fromLocalDb?: boolean;
}

// ===== サマリー用精密照合ロジック =====
function _extractColorFromCsvName(name: string): string {
  const trimmed = name.trim();
  const modelPatterns = [
    /^new\s*3ds\s*ll\s*/i, /^new\s*3ds\s*/i, /^new\s*2ds\s*ll\s*/i, /^3ds\s*ll\s*/i, /^3ds\s*/i,
    /^ps\s*vita\s*2000\s*/i, /^ps\s*vita\s*1000\s*/i, /^ps\s*vita\s*/i,
    /^vita\s*2000\s*/i, /^vita\s*1[01][0-9][0-9]\s*/i, /^vita\s*1000\s*/i, /^vita\s*/i,
    /^psp\s*3000\s*/i, /^psp\s*2000\s*/i, /^psp\s*1000\s*/i, /^psp\s*/i,
    /^ps5\s*/i, /^ps4\s*/i,
    /^switch\s*lite\s*/i, /^switch\s*/i,
  ];
  let remaining = trimmed;
  for (const pat of modelPatterns) {
    if (pat.test(remaining)) { remaining = remaining.replace(pat, "").trim(); break; }
  }
  if (remaining) return remaining;
  const lastSpaceIdx = trimmed.lastIndexOf(" ");
  return lastSpaceIdx === -1 ? trimmed : trimmed.slice(lastSpaceIdx + 1);
}
function _extractModelFromCsvName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("new 2ds ll") || n.includes("new2dsll")) return "New2DSLL";
  if (n.includes("vita 2000") || n.includes("vita2000")) return "Vita2000";
  if (n.includes("vita 1000") || n.includes("vita1000") || n.includes("vita 1100") || n.includes("vita1100") || (n.includes("vita") && !n.includes("2000"))) return "Vita1000";
  if (n.includes("new 3ds ll") || n.includes("new3dsll")) return "New3DSLL";
  if (n.includes("new 3ds") || n.includes("new3ds")) return "New3DS";
  if (n.includes("3ds ll") || n.includes("3dsll")) return "3DSLL";
  if (n.includes("3ds")) return "3DS";
  if (n.includes("switch lite") || n.includes("switchlite") || n.includes("スイッチライト")) return "SwitchLite";
  if (n.includes("switch") || n.includes("スイッチ")) return "Switch";
  if (n.includes("psp")) return "PSP";
  if (n.includes("ps5")) return "PS5";
  if (n.includes("ps4")) return "PS4";
  return "";
}
function _matchesModel(title: string, model: string): boolean {
  const t = title.toLowerCase();
  switch (model) {
    case "Vita2000": return t.includes("vita") && (t.includes("2000") || t.includes("vita2000"));
    case "Vita1000": return t.includes("vita") && !t.includes("2000");
    case "New3DSLL": return t.includes("new 3ds ll") || t.includes("new3dsll");
    case "New3DS": return (t.includes("new 3ds") || t.includes("new3ds")) && !t.includes(" ll") && !t.includes("ll");
    case "New2DSLL": return t.includes("new 2ds ll") || t.includes("new2dsll");
    case "3DSLL": return (t.includes("3ds ll") || t.includes("3dsll")) && !t.includes("new");
    case "3DS": return t.includes("3ds") && !t.includes("ll") && !t.includes("new");
    case "SwitchLite": return t.includes("switch lite") || t.includes("switchlite") || t.includes("スイッチライト");
    case "Switch": return (t.includes("switch") || t.includes("スイッチ")) && !t.includes("lite") && !t.includes("ライト");
    case "PSP": return t.includes("psp");
    case "PS5": return t.includes("ps5");
    case "PS4": return t.includes("ps4");
    default: return true;
  }
}
function _getColorKeywords(colorName: string): string[] {
  if (colorName.includes("&")) return colorName.split("&").map((p) => p.trim()).filter(Boolean);
  const keywords = [colorName];
  if (colorName.includes("ランダムカラー")) keywords.push("ランダム");
  if (colorName === "ランダム") keywords.push("ランダムカラー");
  if (colorName.includes("ホワイトベース")) keywords.push("ホワイト");
  // 黒/ブラックの相互エイリアス
  if (colorName === "ブラック" || colorName.includes("ブラック")) keywords.push("黒");
  if (colorName === "黒" || colorName.endsWith("黒")) keywords.push("ブラック");
  // 白/ホワイトの相互エイリアス
  if (colorName === "ホワイト" || colorName.includes("ホワイト")) keywords.push("白");
  if (colorName === "白" || colorName.endsWith("白")) keywords.push("ホワイト");
  // レッド/赤の相互エイリアス
  if (colorName === "レッド" || colorName.includes("レッド")) keywords.push("赤");
  if (colorName === "赤" || colorName.endsWith("赤")) keywords.push("レッド");
  // ブルー/青の相互エイリアス
  if (colorName === "ブルー" || colorName.includes("ブルー")) keywords.push("青");
  if (colorName === "青" || colorName.endsWith("青")) keywords.push("ブルー");
  return keywords;
}
function _isRandomColor(colorName: string): boolean {
  const c = colorName.toLowerCase();
  return c.includes("ランダム") || c.includes("random");
}
type _ColorEntry = { colorName: string; csvQty: number; deliveredQty: number; model: string; colorOnly: string };
function _scoreMatch(zaicoTitle: string, entry: _ColorEntry): number {
  if (entry.model && !_matchesModel(zaicoTitle, entry.model)) return -1;
  const zt = zaicoTitle.toLowerCase();
  const zaicoModel = _extractModelFromCsvName(zaicoTitle);
  if (_isRandomColor(entry.colorOnly)) {
    if (!entry.model) return (zt.includes("ランダム") || zt.includes("random")) ? 1 : -1;
    return zaicoModel === entry.model ? 3 : 2;
  } else {
    const zaicoColor = _extractColorFromCsvName(zaicoTitle);
    const csvKeywords = _getColorKeywords(entry.colorOnly);
    const allCsvKeywords = csvKeywords.flatMap((kw) =>
      kw.includes("×") ? [kw, ...kw.split("×").map((p) => p.trim()).filter(Boolean)] : [kw]
    );
    const zaicoColorParts = zaicoColor.includes("×")
      ? [zaicoColor, ...zaicoColor.split("×").map((p) => p.trim()).filter(Boolean)]
      : [zaicoColor];
    const colorMatch = allCsvKeywords.some((kw) => {
      const k = kw.toLowerCase();
      return zaicoColorParts.some((zp) => { const zc = zp.toLowerCase(); return zc.includes(k) || k.includes(zc); }) || zt.includes(k);
    });
    if (!colorMatch) return -1;
    return zaicoModel === entry.model ? 3 : 2;
  }
}
/** CSV発注商品ごとの出庫数を精密照合で集計する */
function buildGroupDeliveredSummary(
  csvProducts: Array<{ name: string; qty: number }>,
  allItems: Array<{ title: string; quantity: number }>
): Array<{ name: string; deliveredQty: number }> {
  if (csvProducts.length === 0) return [];
  const colorMap = new Map<string, _ColorEntry>();
  for (const cp of csvProducts) {
    const colorOnly = _extractColorFromCsvName(cp.name);
    const model = _extractModelFromCsvName(cp.name);
    const key = model ? `${model} ${colorOnly}` : colorOnly;
    if (!colorMap.has(key)) colorMap.set(key, { colorName: cp.name, csvQty: 0, deliveredQty: 0, model, colorOnly });
    colorMap.get(key)!.csvQty += cp.qty;
    colorMap.get(key)!.colorName = cp.name; // 最後の商品名を使用
  }
  for (const item of allItems) {
    let bestEntry: _ColorEntry | null = null;
    let bestScore = -1;
    for (const [, entry] of Array.from(colorMap.entries())) {
      const score = _scoreMatch(item.title, entry);
      if (score > bestScore) { bestScore = score; bestEntry = entry; }
    }
    if (bestEntry && bestScore >= 0) bestEntry.deliveredQty += item.quantity;
  }
  return Array.from(colorMap.values()).map((e) => ({ name: e.colorName, deliveredQty: e.deliveredQty }));
}
// ===== サマリー用精密照合ロジック END =====

/** etc フィールドから管理番号を取得する（数字始まり・在庫始まりのみ） */
function getManagementNo(etc: string | undefined): string {
  if (!etc) return "";
  const raw = etc.split(",")[0].trim();
  if (/^\d/.test(raw) || /^在庫/.test(raw)) return raw;
  return "";
}

/** etc フィールドから仕入先サイトを取得する（3番目の要素） */
function getSupplierSite(etc: string | undefined): string {
  if (!etc) return "";
  const parts = etc.split(",");
  return parts[2]?.trim() ?? "";
}

function formatPrice(price: number | undefined | null): string {
  if (price === undefined || price === null) return "-";
  return `¥${price.toLocaleString()}`;
}

function formatDate(date: Date | string) {
  const d = new Date(date);
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateShort(dateStr: string) {
  return dateStr.slice(0, 10);
}

/** CSV エクスポート */
function exportCSV(
  histories: Array<{
    deliveryNo: string;
    status: string;
    createdAt: Date | string;
    items: HistoryItem[];
    deletedInventoryIds: number[];
    cancelledItems: CancelledItem[];
  }>,
  fedexMap?: Map<string, Array<{ shippingDate: string; trackingNumber: string; sheetName: string }>>
) {
  const rows: string[][] = [
    ["出庫No", "ステータス", "出庫日時", "商品名", "数量", "削除済み", "取り消し済み", "FedEx発送日", "FedEx追跡番号", "シート名"],
  ];
  for (const h of histories) {
    // deliveryNoのグループキー（インボイスNo部分）を取得
    const groupKey = h.deliveryNo.includes("_") ? h.deliveryNo.split("_")[0] : h.deliveryNo;
    const shipments = fedexMap?.get(groupKey) ?? fedexMap?.get(h.deliveryNo) ?? [];
    const shippingDateStr = shipments.map((s) => s.shippingDate).join(" / ");
    const trackingNumberStr = shipments.map((s) => s.trackingNumber).join(" / ");
    const sheetNameStr = shipments.map((s) => s.sheetName).join(" / ");
    for (const item of h.items) {
      const isDeleted = h.deletedInventoryIds.includes(item.inventoryId);
      const cancelledItem = h.cancelledItems.find((c) => c.inventoryId === item.inventoryId);
      rows.push([
        h.deliveryNo,
        h.status === "success" ? "成功" : "エラー",
        formatDate(h.createdAt),
        item.title,
        String(item.quantity),
        isDeleted ? "削除済み" : "",
        cancelledItem ? formatDate(cancelledItem.cancelledAt) : "",
        shippingDateStr,
        trackingNumberStr,
        sheetNameStr,
      ]);
    }
  }
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `出庫履歴_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 商品詳細トグル（インライン展開） */
function InventoryDetailToggle({
  historyId,
  inventoryId,
  title,
  quantity,
  unit,
  isOpen,
  onToggle,
  onDeleted,
  onDeleteInventory,
  isBatchMode,
  isSelected,
  onSelectChange,
  isCancelled,
  cancelledAt,
  isDeleted: isDeletedProp,
  onCancelItem,
  isPendingCancel,
  historyStatus,
}: {
  historyId: number;
  inventoryId: number;
  title: string;
  quantity: number;
  unit: string;
  isOpen: boolean;
  onToggle: () => void;
  onDeleted?: (historyId: number, id: number) => void;
  onDeleteInventory?: (inventoryId: number, title: string) => void;
  isBatchMode?: boolean;
  isSelected?: boolean;
  onSelectChange?: (checked: boolean) => void;
  isCancelled?: boolean;
  cancelledAt?: string;
  isDeleted?: boolean;
  onCancelItem?: () => void;
  isPendingCancel?: boolean;
  historyStatus?: string;
}) {
  const { data: detail, isLoading } = trpc.inventory.zaico.getInventoryById.useQuery(
    { inventoryId },
    { enabled: isOpen }
  );
  const inv = (detail ?? null) as InventoryDetail | null;
  const isFromLocalDb = inv?._fromLocalDb === true;
  // DBフォールバックデータがある場合はZaico削除扱いにしない
  const isDeletedFromZaico = isOpen && !isLoading && inv === null;
  if (isDeletedFromZaico && onDeleted) {
    onDeleted(historyId, inventoryId);
  }
  const managementNo = getManagementNo(inv?.etc);
  const supplierSite = getSupplierSite(inv?.etc);
  const unitPrice = inv?.purchase_unit_price ?? inv?.unit_price;
  const displayCategory = inv?.categories?.[0] ?? inv?.category ?? "-";

  if (isDeletedProp) {
    return (
      <div className="w-full">
        <button
          onClick={onToggle}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors cursor-pointer group w-full ${
            isOpen
              ? "bg-muted/30 border border-muted"
              : "bg-muted/20 hover:bg-muted/30 border border-muted/50 hover:border-muted"
          }`}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <span className="text-xs bg-muted-foreground/50 text-background rounded px-1 py-0.5 font-medium leading-none flex-shrink-0">削除済</span>
          <span className="line-through text-muted-foreground flex-1 truncate text-left">{title}</span>
          <span className="text-muted-foreground/60 text-xs flex-shrink-0">x {quantity}</span>
        </button>
        {isOpen && (
          <div className="mt-1.5 ml-4 rounded-lg border bg-card/80 p-3 text-sm space-y-1.5 shadow-sm">
            {isLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-muted-foreground text-xs">読み込み中...</span>
              </div>
            ) : inv ? (
              <>
                {managementNo && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">管理番号</span>
                    <span className="font-bold text-right">{managementNo}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">カテゴリ</span>
                  <Badge variant="outline" className="text-xs">{displayCategory}</Badge>
                </div>
                {unitPrice != null && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
                    <span className="font-semibold text-right">{formatPrice(unitPrice)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">出庫数量</span>
                  <span className="font-medium text-right">{quantity} {unit}</span>
                </div>
                {supplierSite && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">仕入先</span>
                    <span className="text-right">{supplierSite}</span>
                  </div>
                )}
                {inv.optional_attributes?.map((attr) =>
                  attr.value ? (
                    <div key={attr.name} className="flex justify-between gap-2">
                      <span className="text-muted-foreground flex-shrink-0">{attr.name}</span>
                      <span className="text-right">{attr.value}</span>
                    </div>
                  ) : null
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">最終更新日</span>
                  <span className="text-right">{formatDateShort(inv.updated_at)}</span>
                </div>
                <div className="pt-1.5 border-t">
                  <a
                    href="/inventory/delivery-history"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    サイト内詳細
                  </a>
                </div>
              </>
            ) : isFromLocalDb ? (
              <>
                <div className="mb-1.5 flex items-center gap-1.5 text-amber-600">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="text-xs font-medium">削除済み（DB情報）</span>
                </div>
                {managementNo && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">管理番号</span>
                    <span className="font-bold text-right">{managementNo}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">カテゴリ</span>
                  <Badge variant="outline" className="text-xs">{displayCategory}</Badge>
                </div>
                {unitPrice != null && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
                    <span className="font-semibold text-right">{formatPrice(unitPrice)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">出庫数量</span>
                  <span className="font-medium text-right">{quantity} {unit}</span>
                </div>
                {supplierSite && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">仕入先</span>
                    <span className="text-right">{supplierSite}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">最終更新日</span>
                  <span className="text-right">{formatDateShort((inv as { updated_at?: string } | null)?.updated_at ?? "")}</span>
                </div>
                <div className="pt-1.5 border-t">
                  <a
                    href="/inventory/delivery-history"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    サイト内詳細
                  </a>
                </div>
              </>
            ) : (
              <div className="py-2 text-center space-y-1">
                <XCircle className="h-6 w-6 mx-auto text-destructive/60" />
                <p className="text-xs font-medium text-destructive">この商品は削除されています</p>
                <p className="text-xs text-muted-foreground">{title} x {quantity}</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (isCancelled) {
    return (
      <div className="w-full">
        <button
          onClick={onToggle}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors cursor-pointer group w-full ${
            isOpen
              ? "bg-blue-50/60 border border-blue-200"
              : "bg-blue-50/40 hover:bg-blue-50/60 border border-blue-200/50 hover:border-blue-200"
          }`}
          title={`取り消し済み: ${cancelledAt ? formatDate(cancelledAt) : ""}`}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
          )}
          <span className="text-xs bg-blue-500 text-white rounded px-1 py-0.5 font-medium leading-none flex-shrink-0">取消済</span>
          <span className="line-through text-muted-foreground flex-1 truncate text-left">{title}</span>
          <span className="text-muted-foreground/60 text-xs flex-shrink-0">x {quantity}</span>
        </button>
        {isOpen && (
          <div className="mt-1.5 ml-4 rounded-lg border bg-card/80 p-3 text-sm space-y-1.5 shadow-sm">
            {isLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-muted-foreground text-xs">読み込み中...</span>
              </div>
            ) : inv ? (
              <>
                <div className="mb-1.5 flex items-center gap-1.5 text-blue-600">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="text-xs font-medium">取り消し済み{cancelledAt ? ` (${formatDate(cancelledAt)})` : ""}</span>
                </div>
                {inv.item_image?.url && (
                  <div className="flex justify-center pb-1">
                    <img src={inv.item_image.url} alt={inv.title} className="h-24 w-24 object-contain rounded-lg border bg-muted/20" />
                  </div>
                )}
                {managementNo && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">管理番号</span>
                    <span className="font-bold text-right">{managementNo}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">カテゴリ</span>
                  <Badge variant="outline" className="text-xs">{displayCategory}</Badge>
                </div>
                {unitPrice != null && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
                    <span className="font-semibold text-right">{formatPrice(unitPrice)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">出庫数量</span>
                  <span className="font-medium text-right">{quantity} {unit}</span>
                </div>
                {supplierSite && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">仕入先</span>
                    <span className="text-right">{supplierSite}</span>
                  </div>
                )}
                {inv.optional_attributes?.map((attr) =>
                  attr.value ? (
                    <div key={attr.name} className="flex justify-between gap-2">
                      <span className="text-muted-foreground flex-shrink-0">{attr.name}</span>
                      <span className="text-right">{attr.value}</span>
                    </div>
                  ) : null
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">最終更新日</span>
                  <span className="text-right">{formatDateShort(inv.updated_at)}</span>
                </div>
                <div className="pt-1.5 border-t">
                  <a
                    href="/inventory/delivery-history"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    サイト内詳細
                  </a>
                </div>
              </>
            ) : (
              <div className="py-2 text-center space-y-1">
                <p className="text-xs text-muted-foreground">詳細情報を取得できませんでした</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-1">
        {isBatchMode && (
          <Checkbox
            checked={!!isSelected}
            onCheckedChange={(checked) => onSelectChange?.(!!checked)}
            className="h-4 w-4"
          />
        )}
        <button
          onClick={onToggle}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors cursor-pointer group flex-1 min-w-0 ${
            isOpen
              ? "bg-primary/10 border border-primary/30"
              : "bg-muted/40 hover:bg-primary/10 hover:border-primary/30 border border-transparent"
          }`}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary flex-shrink-0" />
          )}
          <span className={`font-medium truncate ${isOpen ? "text-primary" : "group-hover:text-primary"} transition-colors`}>
            {title}
          </span>
          {managementNo && !isOpen && (
            <span className="text-xs text-muted-foreground flex-shrink-0">({managementNo})</span>
          )}
          <span className="text-muted-foreground flex-shrink-0">x {quantity}</span>
        </button>
        {!isBatchMode && historyStatus === "success" && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
            title="この商品の出庫を取り消す"
            onClick={onCancelItem}
            disabled={isPendingCancel}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {isOpen && (
        <div className="mt-1.5 ml-4 rounded-lg border bg-card/80 p-3 text-sm space-y-1.5 shadow-sm">
          {isLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-muted-foreground text-xs">読み込み中...</span>
            </div>
          ) : isDeletedFromZaico ? (
            <div className="py-2 text-center space-y-1">
              <XCircle className="h-6 w-6 mx-auto text-destructive/60" />
              <p className="text-xs font-medium text-destructive">この商品は削除されています</p>
            </div>
          ) : inv ? (
            <>
              {inv.item_image?.url && (
                <div className="flex justify-center pb-1">
                  <img src={inv.item_image.url} alt={inv.title} className="h-24 w-24 object-contain rounded-lg border bg-muted/20" />
                </div>
              )}
              {managementNo && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">管理番号</span>
                  <span className="font-bold text-right">{managementNo}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground flex-shrink-0">カテゴリ</span>
                <Badge variant="outline" className="text-xs">{displayCategory}</Badge>
              </div>
              {unitPrice != null && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
                  <span className="font-semibold text-right">{formatPrice(unitPrice)}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground flex-shrink-0">現在の在庫数</span>
                <span className="text-right">{Math.floor(parseFloat(inv.quantity ?? "0"))} {inv.unit}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground flex-shrink-0">出庫数量</span>
                <span className="font-medium text-right">{quantity} {unit}</span>
              </div>
              {inv.place && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">保管場所</span>
                  <span className="text-right">{inv.place}</span>
                </div>
              )}
              {supplierSite && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">仕入先</span>
                  <span className="text-right">{supplierSite}</span>
                </div>
              )}
              {inv.optional_attributes?.map((attr) =>
                attr.value ? (
                  <div key={attr.name} className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">{attr.name}</span>
                    <span className="text-right">{attr.value}</span>
                  </div>
                ) : null
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground flex-shrink-0">最終更新日</span>
                <span className="text-right">{formatDateShort(inv.updated_at)}</span>
              </div>
              <div className="pt-1.5 border-t flex items-center justify-between gap-2">
                <a
                  href="/inventory/delivery-history"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  サイト内詳細
                </a>
                {onDeleteInventory && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={() => onDeleteInventory(inventoryId, title)}
                  >
                    <Trash2 className="h-3 w-3" />
                    在庫から削除
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">詳細情報を取得できませんでした</p>
          )}
        </div>
      )}
    </div>
  );
}

/** 出庫取り消し確認ダイアログ */
function CancelConfirmDialog({
  open,
  onClose,
  onConfirm,
  items,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  items: Array<{ title: string; quantity: number }>;
  isPending: boolean;
}) {
  const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isPending) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            出庫取り消しの確認
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            以下の出庫を取り消します。サイト内DBの在庫数が戻ります。
          </p>
          <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
            {items.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm">
                <span className="font-medium truncate mr-2">{item.title}</span>
                <span className="text-muted-foreground flex-shrink-0">+{item.quantity}個 戻る</span>
              </div>
            ))}
          </div>
          <p className="text-sm font-semibold text-center">
            合計 {totalQty} 個の在庫が戻ります
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending} className="flex-1">
            キャンセル
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                取り消し中...
              </>
            ) : (
              <>
                <Undo2 className="h-4 w-4 mr-1.5" />
                取り消す
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** FedEx発送登録ダイアログ */
export function FedexShipmentDialog({
  open,
  onClose,
  groupKey,
  groupItems,
  onSubmit,
  isPending,
  existingShipments,
}: {
  open: boolean;
  onClose: () => void;
  groupKey: string;
  groupItems: HistoryItem[];
  onSubmit: (data: {
    sheetName: "独発送管理" | "サミー発送管理";
    shippingDate: string;
    trackingNumber: string;
    items: Array<{ productNameJa: string; productNameEn: string; quantity: number }>;
  }) => void;
  isPending: boolean;
  existingShipments: Array<{ id: number; sheetName: string; shippingDate: string; trackingNumber: string; spreadsheetStatus: string }>;
}) {
  const today = new Date();
  const defaultDate = `${today.getMonth() + 1}/${today.getDate()}`;
  const [sheetName, setSheetName] = useState<"独発送管理" | "サミー発送管理">("独発送管理");
  const [shippingDate, setShippingDate] = useState(defaultDate);
  const [trackingNumber, setTrackingNumber] = useState("");
  // 商品ごとの発送数（inventoryId -> quantity）
  const [itemQuantities, setItemQuantities] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const item of groupItems) {
      init[item.inventoryId] = item.quantity;
    }
    return init;
  });

  // グループアイテムが変わったら発送数を初期化
  useEffect(() => {
    const init: Record<number, number> = {};
    for (const item of groupItems) {
      init[item.inventoryId] = item.quantity;
    }
    setItemQuantities(init);
  }, [groupItems]);

  function handleSubmit() {
    if (!shippingDate.trim()) {
      return;
    }
    if (!trackingNumber.trim()) {
      return;
    }
    const items = groupItems
      .filter((item) => (itemQuantities[item.inventoryId] ?? 0) > 0)
      .map((item) => ({
        productNameJa: item.title,
        productNameEn: item.title, // 英語名は日本語名と同じ（スプシ側で対応）
        quantity: itemQuantities[item.inventoryId] ?? item.quantity,
      }));
    if (items.length === 0) {
      return;
    }
    onSubmit({ sheetName, shippingDate: shippingDate.trim(), trackingNumber: trackingNumber.trim(), items });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isPending) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="h-5 w-5 text-blue-600" />
            FedEx発送登録 — No.{groupKey}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* 既存の発送記録 */}
          {existingShipments.length > 0 && (
            <div className="rounded-md border bg-blue-50/50 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-blue-700 mb-1.5">登録済み発送記録</p>
              {existingShipments.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{s.shippingDate}</span>
                  <span className="font-mono text-blue-700">{s.trackingNumber}</span>
                  <span className="text-muted-foreground">{s.sheetName}</span>
                  {s.spreadsheetStatus === "success" ? (
                    <Badge className="bg-green-100 text-green-700 border-green-200 text-xs px-1 py-0">書込済</Badge>
                  ) : s.spreadsheetStatus === "error" ? (
                    <Badge variant="destructive" className="text-xs px-1 py-0">エラー</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs px-1 py-0">保留</Badge>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* シート選択 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">書き込み先シート</Label>
            <Select value={sheetName} onValueChange={(v) => setSheetName(v as "独発送管理" | "サミー発送管理")}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="独発送管理">独発送管理</SelectItem>
                <SelectItem value="サミー発送管理">サミー発送管理</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 発送日 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">発送日</Label>
            <Input
              value={shippingDate}
              onChange={(e) => setShippingDate(e.target.value)}
              placeholder="例: 4/8"
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">スプシのヘッダー行と同じ形式（例: 4/8）</p>
          </div>

          {/* 追跡番号 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">FedEx追跡番号</Label>
            <Input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="例: 7489 1234 5678"
              className="h-9 font-mono"
            />
          </div>

          {/* 商品ごとの発送数 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">商品ごとの発送数</Label>
            <div className="rounded-md border divide-y">
              {groupItems.map((item) => (
                <div key={item.inventoryId} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-sm flex-1 truncate">{item.title}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Input
                      type="number"
                      min={0}
                      max={item.quantity}
                      value={itemQuantities[item.inventoryId] ?? item.quantity}
                      onChange={(e) => setItemQuantities((prev) => ({ ...prev, [item.inventoryId]: Number(e.target.value) }))}
                      className="h-7 w-16 text-right text-sm"
                    />
                    <span className="text-xs text-muted-foreground">/ {item.quantity}台</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={isPending} className="flex-1">
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !shippingDate.trim() || !trackingNumber.trim()}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isPending ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />登録中...</>
            ) : (
              <><Send className="h-4 w-4 mr-1.5" />スプシに登録</>  
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// FedExバッチ登録ダイアログ
// ============================================================
type GroupedHistoryEntry = [string, Array<{
  id: number;
  deliveryNo: string;
  createdAt: string | Date;
  items: unknown;
  deletedInventoryIds?: number[] | null;
  cancelledItemsJson?: string | null;
  zaicoDeliveryId?: number | null;
}>];

/**
 * 商品名がランダムカラーかどうかを判定
 * 「ランダムカラー」「Random color」「random」等を含む場合はtrue
 */
function isRandomColor(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("ランダム") || lower.includes("random");
}

/**
 * 商品名から機種名（ベース名）を抽出
 * 例: "Toynet Vita2000 アクアブルー" → "Vita2000"
 *     "PS Vita 2000 ランダムカラー" → "Vita2000"
 *     "PSP3000 ブラック" → "PSP3000 ブラック"（色明示なのでそのまま）
 *     "PSP3000 ランダムカラー" → "PSP3000"（ランダムなので機種名のみ）
 */
function extractModelName(name: string): string {
  // 正規化: 全角スペース→半角、前後空白除去
  const normalized = name.replace(/　/g, " ").trim();
  // 既知の機種パターン（長い名前を先にマッチ）
  const modelPatterns = [
    { pattern: /PS\s*Vita\s*2000|Vita\s*2000|VITA2000/i, canonical: "Vita2000" },
    { pattern: /PS\s*Vita\s*1[01][0-9][0-9]|Vita\s*1[01][0-9][0-9]|VITA1[01][0-9][0-9]/i, canonical: "Vita1000" },
    { pattern: /New\s*2DS\s*LL|2DS\s*LL/i, canonical: "New2DSLL" },
    { pattern: /New\s*3DS\s*LL|3DS\s*LL/i, canonical: "New3DSLL" },
    { pattern: /New\s*3DS(?!\s*LL)/i, canonical: "New3DS" },
    { pattern: /3DS\s*LL/i, canonical: "3DSLL" },
    { pattern: /3DS(?!\s*LL)/i, canonical: "3DS" },
    { pattern: /PSP\s*3000/i, canonical: "PSP3000" },
    { pattern: /PSP\s*2000/i, canonical: "PSP2000" },
    { pattern: /PSP\s*1000/i, canonical: "PSP1000" },
    { pattern: /Switch\s*Lite|スイッチライト/i, canonical: "SwitchLite" },
    { pattern: /Nintendo\s*Switch|スイッチ/i, canonical: "Switch" },
    { pattern: /DS\s*Lite|DSLite/i, canonical: "DSLite" },
    { pattern: /DS(?!\s*Lite)/i, canonical: "DS" },
  ];
  for (const { pattern, canonical } of modelPatterns) {
    if (pattern.test(normalized)) return canonical;
  }
  // マッチしない場合はそのまま返す
  return normalized;
}

/**
 * csvProductsのスプシ商品名リストと出庫アイテムを照合して集計する
 * - csvProductにランダムカラーが含まれる → 同じ機種の出庫アイテムを全部合算
 * - csvProductに色が1色のみ明示 → その色キーワードが出庫商品名に含まれるものを集計
 * - csvProductに複数色（「&」「×」「＆」区切り）→ いずれかの色キーワードが含まれるものを集計
 * - それ以外（機種名のみ等）→ 同じ機種名でまとめる
 */
function aggregateItemsByCsvProducts(
  csvProducts: Array<{ name: string; qty: number }>,
  deliveredItems: HistoryItem[]
): Array<{ csvName: string; csvQty: number; deliveredQty: number }> {
  if (csvProducts.length === 0) {
    // csvProductsがない場合は機種名でまとめる
    const modelMap: Record<string, number> = {};
    for (const item of deliveredItems) {
      const model = extractModelName(item.title);
      modelMap[model] = (modelMap[model] ?? 0) + item.quantity;
    }
    return Object.entries(modelMap).map(([name, qty]) => ({ csvName: name, csvQty: 0, deliveredQty: qty }));
  }

  /** csv商品名から色部分キーワードリストを抽出する */
  function extractColorKeywords(csvName: string): string[] {
    // _extractColorFromCsvName相当：機種名パターンを除いた残りを色部分とする
    const modelPats = [
      /^(toynet\s*)?new\s*2ds\s*ll\s*/i,
      /^(toynet\s*)?new\s*3ds\s*ll\s*/i,
      /^(toynet\s*)?new\s*3ds\s*/i,
      /^(toynet\s*)?3ds\s*ll\s*/i,
      /^(toynet\s*)?3ds\s*/i,
      /^(toynet\s*|toy\s*net\s*)?ps\s*vita\s*2000\s*/i,
      /^(toynet\s*|toy\s*net\s*)?ps\s*vita\s*1000\s*/i,
      /^(toynet\s*|toy\s*net\s*)?ps\s*vita\s*/i,
      /^(toynet\s*|toy\s*net\s*)?vita\s*2000\s*/i,
      /^(toynet\s*|toy\s*net\s*)?vita\s*1[01][0-9][0-9]\s*/i,
      /^(toynet\s*|toy\s*net\s*)?vita\s*/i,
      /^(toynet\s*)?psp\s*3000\s*/i,
      /^(toynet\s*)?psp\s*2000\s*/i,
      /^(toynet\s*)?psp\s*1000\s*/i,
      /^(toynet\s*)?psp\s*/i,
      /^(toynet\s*)?ps5\s*/i,
      /^(toynet\s*)?ps4\s*/i,
      /^(toynet\s*)?switch\s*lite\s*/i,
      /^(toynet\s*)?switch\s*/i,
    ];
    let remaining = csvName.trim();
    for (const pat of modelPats) {
      if (pat.test(remaining)) { remaining = remaining.replace(pat, "").trim(); break; }
    }
    if (!remaining) return [];
    // 「ランダムカラー」「ランダム」「random」は空リスト（ランダム判定は別途）
    if (isRandomColor(remaining)) return [];
    // 「◯◯ベース」の場合はベース色のみをキーワードとして返す
    // 例: "ホワイトベース" → ["ホワイト"]（ピンク×ホワイト、ミントホワイト等も一致させる）
    const baseMatch = remaining.match(/^(.+?)ベース$/i);
    if (baseMatch) {
      const baseColor = baseMatch[1].trim();
      return baseColor ? [baseColor] : [];
    }
    // 複数色区切り（&, ×, ＆, ・）で分割
    const parts = remaining.split(/[&×＆・]/).map((p) => p.trim()).filter(Boolean);
    return parts.length > 1 ? parts : [remaining];
  }

  const result = csvProducts.map((csvProd) => {
    const csvRandom = isRandomColor(csvProd.name);
    const csvModel = extractModelName(csvProd.name);
    const colorKeywords = extractColorKeywords(csvProd.name);
    let deliveredQty = 0;
    for (const item of deliveredItems) {
      const itemModel = extractModelName(item.title);
      if (itemModel !== csvModel) continue;
      if (csvRandom || colorKeywords.length === 0) {
        // ランダムカラー or 色部分なし: 同じ機種名なら全部合算
        deliveredQty += item.quantity;
      } else {
        // 色キーワードのいずれかが出庫商品名に含まれるか確認
        const titleLower = item.title.toLowerCase();
        const matched = colorKeywords.some((kw) => titleLower.includes(kw.toLowerCase()));
        if (matched) deliveredQty += item.quantity;
      }
    }
    return { csvName: csvProd.name, csvQty: csvProd.qty, deliveredQty };
  });

  // CSVに登録されていない出庫商品を「未分類」として追加
  // （どのcsvProductにもマッチしなかった出庫アイテムを集計）
  const unmatchedMap: Record<string, number> = {};
  for (const item of deliveredItems) {
    const itemModel = extractModelName(item.title);
    // いずれかのcsvProductにマッチしているか確認
    const isMatched = csvProducts.some((csvProd) => {
      const csvModel = extractModelName(csvProd.name);
      if (itemModel !== csvModel) return false;
      const csvRandom = isRandomColor(csvProd.name);
      const colorKeywords = extractColorKeywords(csvProd.name);
      if (csvRandom || colorKeywords.length === 0) return true;
      const titleLower = item.title.toLowerCase();
      return colorKeywords.some((kw) => titleLower.includes(kw.toLowerCase()));
    });
    if (!isMatched) {
      unmatchedMap[item.title] = (unmatchedMap[item.title] ?? 0) + item.quantity;
    }
  }
  const unmatchedItems = Object.entries(unmatchedMap)
    .filter(([, qty]) => qty > 0)
    .map(([name, qty]) => ({ csvName: name, csvQty: 0, deliveredQty: qty }));

  return [...result, ...unmatchedItems];
}

function FedexBatchDialog({
  open,
  onClose,
  selectedGroupKeys,
  groupedHistories,
  csvProductsMap,
  initialShippingDate,
  initialTrackingNumber,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  selectedGroupKeys: string[];
  groupedHistories: GroupedHistoryEntry[];
  csvProductsMap: Map<string, Array<{ name: string; qty: number }>>;
  initialShippingDate?: string;
  initialTrackingNumber?: string;
  onSubmit: (shippingDate: string, shipments: Array<{ deliveryNo: string; trackingNumber: string; historyId?: number; items: Array<{ productNameJa: string; productNameEn: string; quantity: number }> }>) => void;
  isPending: boolean;
}) {
  const today = new Date();
  const defaultDate = `${today.getMonth() + 1}/${today.getDate()}`;
  const [shippingDate, setShippingDate] = useState(initialShippingDate ?? defaultDate);
  const [trackingNumber, setTrackingNumber] = useState(initialTrackingNumber ?? "");

  // グループごとの編集可能な商品リスト
  type EditableItem = { productNameJa: string; productNameEn: string; quantity: number };
  type GroupItems = { deliveryNo: string; sheetLabel: string; historyId?: number; items: EditableItem[] };
  const [editableGroups, setEditableGroups] = useState<GroupItems[]>([]);

  // ダイアログが開くたびに初期値をセット
  useEffect(() => {
    if (!open) return;
    if (initialShippingDate !== undefined) setShippingDate(initialShippingDate);
    if (initialTrackingNumber !== undefined) setTrackingNumber(initialTrackingNumber);
    // 各グループの商品集計を初期化
    // 出庫Noごとにサブグループを作成（同一インボイス内の複数出庫Noを個別表示）
    const groups: GroupItems[] = [];
    for (const key of selectedGroupKeys) {
      const entry = groupedHistories.find(([k]) => k === key);
      if (!entry) {
        // エントリが見つからない場合はキーそのものをdeliveryNoとして追加
        const lower = key.toLowerCase();
        const sheetLabel = (lower.includes("samee") || lower.includes("sami") || lower.includes("sammy"))
          ? "サミー発送管理" : "独発送管理";
        groups.push({ deliveryNo: key, sheetLabel, historyId: undefined, items: [] });
        continue;
      }
      // 出庫Noごとにグループ化
      const byDeliveryNo = new Map<string, { historyId: number; items: HistoryItem[] }[]>();
      for (const h of entry[1]) {
        const dn = h.deliveryNo;
        if (!byDeliveryNo.has(dn)) byDeliveryNo.set(dn, []);
        byDeliveryNo.get(dn)!.push({ historyId: h.id, items: h.items as HistoryItem[] });
      }
      const csvProducts = csvProductsMap.get(key) ?? [];
      // 出庫Noごとにサブグループを作成
      for (const [dn, dnEntries] of Array.from(byDeliveryNo.entries())) {
        const allItems: HistoryItem[] = dnEntries.flatMap((e: { historyId: number; items: HistoryItem[] }) => e.items);
        const aggregated = aggregateItemsByCsvProducts(csvProducts, allItems);
        const items: EditableItem[] = aggregated
          .filter((a) => a.deliveredQty > 0)
          .map((a) => ({ productNameJa: a.csvName, productNameEn: a.csvName, quantity: a.deliveredQty }));
        const historyId = dnEntries[0]?.historyId;
        const lower = dn.toLowerCase();
        const sheetLabel = (lower.includes("samee") || lower.includes("sami") || lower.includes("sammy"))
          ? "サミー発送管理" : "独発送管理";
        groups.push({ deliveryNo: dn, sheetLabel, historyId, items });
      }
    }
    setEditableGroups(groups);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedGroupKeys.join(","), initialShippingDate, initialTrackingNumber]);

  function updateItemQty(groupIdx: number, itemIdx: number, qty: number) {
    setEditableGroups((prev) => {
      const next = prev.map((g, gi) =>
        gi !== groupIdx ? g : {
          ...g,
          items: g.items.map((item, ii) => ii !== itemIdx ? item : { ...item, quantity: qty }),
        }
      );
      return next;
    });
  }

  function removeItem(groupIdx: number, itemIdx: number) {
    setEditableGroups((prev) =>
      prev.map((g, gi) =>
        gi !== groupIdx ? g : { ...g, items: g.items.filter((_, ii) => ii !== itemIdx) }
      )
    );
  }

  function handleSubmit() {
    if (!shippingDate.trim() || !trackingNumber.trim()) return;
    const shipments = editableGroups
      .map((g) => ({
        deliveryNo: g.deliveryNo,
        trackingNumber: trackingNumber.trim(),
        historyId: g.historyId,
        items: g.items.filter((it) => it.quantity > 0),
      }))
      .filter((s) => s.items.length > 0);
    if (shipments.length === 0) return;
    onSubmit(shippingDate.trim(), shipments);
  }

  const totalItems = editableGroups.reduce((sum, g) => sum + g.items.length, 0);
  // 全体の合計個数（各商品の数量合計）
  const totalQty = editableGroups.reduce((sum, g) => sum + g.items.reduce((s, it) => s + it.quantity, 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isPending) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0">
        <div className="px-6 pt-5 pb-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="h-5 w-5 text-blue-600" />
            FedEx発送登録 確認（{editableGroups.length}出庫No）
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">商品の数量を確認・編集してから登録してください</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 発送日・追跡番号（編集可能） */}
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
            <div className="space-y-1">
              <label className="text-xs font-medium text-blue-700">発送日</label>
              <Input
                value={shippingDate}
                onChange={(e) => setShippingDate(e.target.value)}
                placeholder="例: 4/9"
                className="h-8 text-sm bg-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-blue-700">FedEx追跡番号</label>
              <Input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="7489 1234 5678 9"
                className="h-8 text-sm font-mono bg-white"
              />
            </div>
          </div>

          {/* グループ別商品一覧（数量編集可能） */}
          {editableGroups.map((group, groupIdx) => {
            const groupQty = group.items.reduce((s, it) => s + it.quantity, 0);
            return (
            <div key={group.deliveryNo} className="rounded-lg border overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">No.{group.deliveryNo.split("_")[0]}</span>
                  {/* 出庫Noに日付が含まれる場合は日付を表示 */}
                  {(() => {
                    const m = group.deliveryNo.match(/(\d{4})(\d{2})(\d{2})$/);
                    return m ? (
                      <span className="text-xs text-muted-foreground font-mono">{parseInt(m[2])}/{parseInt(m[3])}出庫</span>
                    ) : (
                      <span className="text-xs text-muted-foreground font-mono">{group.deliveryNo}</span>
                    );
                  })()}
                  <span className="text-xs font-bold text-foreground">{groupQty}台</span>
                </div>
                <Badge className={`text-xs border ${group.sheetLabel === "独発送管理" ? "bg-blue-100 text-blue-700 border-blue-200" : "bg-purple-100 text-purple-700 border-purple-200"}`}>
                  {group.sheetLabel}
                </Badge>
              </div>
              {group.items.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 py-3">集計できる商品がありません</p>
              ) : (
                <div className="divide-y">
                  {group.items.map((item, itemIdx) => (
                    <div key={itemIdx} className="flex items-center gap-2 px-3 py-2">
                      <span className="text-xs flex-1 truncate text-foreground">{item.productNameJa}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => updateItemQty(groupIdx, itemIdx, Math.max(0, item.quantity - 1))}
                        >
                          <span className="text-base leading-none">−</span>
                        </Button>
                        <input
                          type="number"
                          min={0}
                          value={item.quantity}
                          onChange={(e) => updateItemQty(groupIdx, itemIdx, Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-12 h-6 text-center text-sm border rounded bg-background text-foreground"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => updateItemQty(groupIdx, itemIdx, item.quantity + 1)}
                        >
                          <span className="text-base leading-none">＋</span>
                        </Button>
                        <span className="text-xs text-muted-foreground w-4">台</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                          onClick={() => removeItem(groupIdx, itemIdx)}
                          title="この行を削除"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })}

          {totalItems === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">登録できる商品がありません</p>
          )}
        </div>

        {/* 合計個数サマリー */}
        {totalQty > 0 && (
          <div className="px-6 py-2 border-t bg-muted/30 flex-shrink-0 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">全商品合計</span>
            <span className="text-sm font-bold text-foreground">{totalQty}台</span>
          </div>
        )}
        <div className="px-6 py-4 border-t flex-shrink-0 flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending} className="flex-1">
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !shippingDate.trim() || !trackingNumber.trim() || totalItems === 0}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isPending ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />登録中...</>
            ) : (
              <><Send className="h-4 w-4 mr-1.5" />{editableGroups.length}出庫Noをスプシに登録</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** deliveryNoの先頭数字を抽出（例: "378_luca20260403" → "378"） */
function extractDeliveryGroup(deliveryNo: string): string {
  const match = deliveryNo.match(/^(\d+)/);
  return match ? match[1] : deliveryNo;
}

export default function DeliveryHistory() {
  const utils = trpc.useUtils();
  const { data: histories, isLoading, refetch } = trpc.inventory.deliveryHistory.list.useQuery({ limit: 200 });
  // 在庫一覧を取得して削除済商品を自動検出
  const { data: inventories } = trpc.inventory.zaico.getInventories.useQuery();
  // 発注管理サマリー（csvProductsをグループヘッダーに表示するため）
  const { data: orderSummary } = trpc.inventory.orderManagement.getSummary.useQuery();
  // インボイスNo -> csvProductsのマップ
  const csvProductsMap = useMemo(() => {
    if (!orderSummary) return new Map<string, Array<{ name: string; qty: number }>>();
    const map = new Map<string, Array<{ name: string; qty: number }>>();
    for (const item of orderSummary as Array<{ key: string; csvProducts: Array<{ name: string; qty: number }> }>) {
      map.set(item.key, item.csvProducts);
    }
    return map;
  }, [orderSummary]);
  // CSVデータ（販売価格・通貨・取引先）
  const { data: csvRawData } = trpc.inventory.orderManagement.getCsvData.useQuery();
  // invoiceNo -> { sellingPrice, currency, partner, productName }[] のマップ
  const csvPriceMap = useMemo(() => {
    const map = new Map<string, Array<{ productName: string; sellingPrice: number | null; currency: string; partner: string }>>();
    if (!csvRawData) return map;
    for (const row of csvRawData as Array<{ invoiceNo: string; productName: string; sellingPrice: number | null; currency: string; partner: string }>) {
      const existing = map.get(row.invoiceNo) ?? [];
      existing.push({ productName: row.productName, sellingPrice: row.sellingPrice, currency: row.currency, partner: row.partner });
      map.set(row.invoiceNo, existing);
    }
    return map;
  }, [csvRawData]);
  // URLパラメータ読み取り（発注管理からのリンク用）
  const [location, setLocation] = useLocation();
  const urlParams = useMemo(() => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    return { group: params.get("group"), date: params.get("date") };
  }, [location]);

  // ソート順（desc: 新しい順, asc: 古い順）- localStorage永続化
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">(() => {
    try { return (localStorage.getItem("dh_sortOrder") as "desc" | "asc") ?? "desc"; } catch { return "desc"; }
  });
  // 日付フィルター - localStorage永続化 + URLパラメータ優先
  const [filterDate, setFilterDate] = useState<Date | undefined>(() => {
    // URLパラメータが優先
    const search = window.location.search;
    const params = new URLSearchParams(search);
    const dateParam = params.get("date");
    if (dateParam) { const d = new Date(dateParam); if (!isNaN(d.getTime())) return d; }
    // localStorage
    try {
      const saved = localStorage.getItem("dh_filterDate");
      if (saved) { const d = new Date(saved); if (!isNaN(d.getTime())) return d; }
    } catch {}
    return undefined;
  });
  const [calendarOpen, setCalendarOpen] = useState(false);
  // グループトグル展開状態（グループキー -> boolean）- URLパラメータ + localStorage永続化
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    // URLパラメータが優先
    const search = window.location.search;
    const params = new URLSearchParams(search);
    const groupParam = params.get("group");
    if (groupParam) return { [groupParam]: true };
    // localStorage
    try {
      const saved = localStorage.getItem("dh_openGroups");
      if (saved) return JSON.parse(saved) as Record<string, boolean>;
    } catch {}
    return {};
  });

  // URLパラメータが変わったときに状態を更新
  useEffect(() => {
    if (urlParams.group) {
      setOpenGroups((prev) => ({ ...prev, [urlParams.group!]: true }));
      setFilterDate(undefined);
    } else if (urlParams.date) {
      const d = new Date(urlParams.date);
      if (!isNaN(d.getTime())) setFilterDate(d);
      setOpenGroups({});
    }
  }, [urlParams.group, urlParams.date]);

  // フィルター変更時にlocalStorageに保存
  function handleSetFilterDate(d: Date | undefined) {
    setFilterDate(d);
    try {
      if (d) localStorage.setItem("dh_filterDate", d.toISOString());
      else localStorage.removeItem("dh_filterDate");
    } catch {}
  }
  function handleSetSortOrder(v: "desc" | "asc") {
    setSortOrder(v);
    try { localStorage.setItem("dh_sortOrder", v); } catch {}
  }
  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem("dh_openGroups", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // ソート・フィルター適用後の履歴
  const filteredHistories = useMemo(() => {
    let list = histories ?? [];
    // 日付フィルター
    if (filterDate) {
      const dateStr = filterDate.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
      list = list.filter((h) => {
        const d = new Date(h.createdAt);
        const hDateStr = d.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
        return hDateStr === dateStr;
      });
    }
    // ソート
    list = [...list].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return sortOrder === "desc" ? tb - ta : ta - tb;
    });
    return list;
  }, [histories, filterDate, sortOrder]);

  // deliveryNoの先頭数字でグループ化
  const groupedHistories = useMemo(() => {
    const groups: Record<string, typeof filteredHistories> = {};
    for (const h of filteredHistories) {
      const key = extractDeliveryGroup(h.deliveryNo);
      if (!groups[key]) groups[key] = [];
      groups[key].push(h);
    }
    // グループをソート順に並べる（各グループの最初の要素の日時を基準）
    let sorted = Object.entries(groups).sort((a, b) => {
      const ta = new Date(a[1][0].createdAt).getTime();
      const tb = new Date(b[1][0].createdAt).getTime();
      return sortOrder === "desc" ? tb - ta : ta - tb;
    });
    // URLパラメータで特定グループ指定時はそのグループのみ表示
    if (urlParams.group) {
      sorted = sorted.filter(([key]) => key === urlParams.group);
    }
    return sorted;
  }, [filteredHistories, sortOrder, urlParams.group]);

  // ページネーション（グループ単位）
  const {
    page: delivHistPage,
    setPage: setDelivHistPage,
    totalPages: delivHistTotalPages,
    paginatedItems: pagedGroups,
    totalItems: delivHistTotalItems,
    startIndex: delivHistStartIndex,
    endIndex: delivHistEndIndex,
  } = usePagination(groupedHistories);

  const activeInventoryIds = useMemo(() => {
    if (!inventories) return null;
    return new Set(inventories.map((inv: { id: number }) => inv.id));
  }, [inventories]);

  const markDeletedMutation = trpc.inventory.deliveryHistory.markDeleted.useMutation({
    onSuccess: () => {
      utils.inventory.deliveryHistory.list.invalidate();
    },
  });
  const updateDeliveryNoMutation = trpc.inventory.deliveryHistory.updateDeliveryNo.useMutation({
    onSuccess: () => {
      utils.inventory.deliveryHistory.list.invalidate();
      toast.success("出庫Noを更新しました");
    },
    onError: (err) => {
      toast.error(`更新に失敗しました: ${err.message}`);
    },
  });

  // 出庫No一括変更
  const bulkUpdateDeliveryNoMutation = trpc.inventory.deliveryHistory.bulkUpdateDeliveryNo.useMutation({
    onSuccess: (data) => {
      utils.inventory.deliveryHistory.list.invalidate();
      toast.success(`出庫Noを${data.updatedCount}件まとめて更新しました`);
      setBulkEditNoMode(null);
      setBulkEditNoSelected(new Set());
      setBulkEditNoValue("");
      setBulkEditNoDialogOpen(false);
    },
    onError: (err) => {
      toast.error(`一括更新に失敗しました: ${err.message}`);
    },
  });

  // 商品単位で出庫No変更
  const moveItemsMutation = trpc.inventory.deliveryHistory.moveItemsToDeliveryNo.useMutation({
    onSuccess: (data) => {
      utils.inventory.deliveryHistory.list.invalidate();
      toast.success(`${data.movedCount}商品を移動しました（元の出庫行に${data.remainingCount}商品残り）`);
      setMoveItemsMode(null);
      setMoveItemsSelected(new Set());
      setMoveItemsNewDeliveryNo("");
      setMoveItemsDialogOpen(false);
    },
    onError: (err) => {
      toast.error(`商品の移動に失敗しました: ${err.message}`);
    },
  });

  // 出庫取り消し（個別）
  const cancelItemMutation = trpc.inventory.deliveryHistory.cancelItem.useMutation({
    onSuccess: (data) => {
      utils.inventory.deliveryHistory.list.invalidate();
      utils.inventory.zaico.getInventories.invalidate();
      toast.success(`出庫を取り消しました（在庫数: ${data.newQuantity}個に更新）`);
      setCancelDialog(null);
    },
    onError: (err) => {
      toast.error(`取り消しに失敗しました: ${err.message}`);
    },
  });

  // 出庫取り消し（一括）
  const cancelItemsMutation = trpc.inventory.deliveryHistory.cancelItems.useMutation({
    onSuccess: (data) => {
      utils.inventory.deliveryHistory.list.invalidate();
      utils.inventory.zaico.getInventories.invalidate();
      if (data.failCount > 0) {
        toast.warning(`${data.successCount}件取り消し成功、${data.failCount}件失敗`);
      } else {
        toast.success(`${data.successCount}件の出庫を取り消しました`);
      }
      setCancelDialog(null);
      setBatchSelectMode(null);
      setSelectedItems({});
    },
    onError: (err) => {
      toast.error(`一括取り消しに失敗しました: ${err.message}`);
    },
  });

  // 出庫履歴グループ一括削除
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<{
    historyId: number;
    deliveryNo: string;
    inventoryIds: number[];
    titles: string[];
  } | null>(null);
  const deleteGroupMutation = trpc.inventory.deliveryHistory.deleteGroup.useMutation({
    onSuccess: (data) => {
      utils.inventory.deliveryHistory.list.invalidate();
      utils.inventory.zaico.getInventories.invalidate();
      if (data.failCount > 0) {
        toast.warning(`出庫履歴を削除しました（在庫削除: ${data.successCount}件成功, ${data.failCount}件失敗）`);
      } else {
        toast.success("出庫履歴とサイト内在庫を削除しました");
      }
      setDeleteGroupConfirm(null);
    },
    onError: (err) => {
      toast.error(`削除に失敗しました: ${err.message}`);
    },
  });

  // 在庫削除
  const deleteInventoryMutation = trpc.inventory.zaico.deleteInventory.useMutation({
    onSuccess: () => {
      utils.inventory.zaico.getInventories.invalidate();
      utils.inventory.deliveryHistory.list.invalidate();
      toast.success(`「${deleteConfirm?.title ?? "商品"}」を在庫から削除しました`);
      setDeleteConfirm(null);
    },
    onError: (err) => {
      toast.error(`削除に失敗しました: ${err.message}`);
    },
  });
  const [deleteConfirm, setDeleteConfirm] = useState<{ inventoryId: number; title: string } | null>(null);
  function handleDeleteInventory(inventoryId: number, title: string) {
    setDeleteConfirm({ inventoryId, title });
  }
  function executeDeleteInventory() {
    if (!deleteConfirm) return;
    deleteInventoryMutation.mutate({ inventoryId: deleteConfirm.inventoryId });
  }

  // 出庫No編集状態
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  function startEdit(historyId: number, currentNo: string) {
    setEditingId(historyId);
    setEditingValue(currentNo);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingValue("");
  }
  function saveEdit(historyId: number, zaicoDeliveryId: number | null) {
    if (!editingValue.trim()) {
      toast.error("出庫Noを入力してください");
      return;
    }
    updateDeliveryNoMutation.mutate({
      historyId,
      zaicoDeliveryId,
      deliveryNo: editingValue.trim(),
    });
    setEditingId(null);
    setEditingValue("");
  }

  // トグル展開状態: "historyId-inventoryId" -> boolean
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  function toggleItem(historyId: number, inventoryId: number) {
    const key = `${historyId}-${inventoryId}`;
    setOpenItems((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // 取り消し確認ダイアログ状態
  const [cancelDialog, setCancelDialog] = useState<{
    historyId: number;
    items: Array<{ inventoryId: number; title: string; quantity: number }>;
    isBatch: boolean;
  } | null>(null);

  // 一括選択モード（historyIdをキーにして管理）
  const [batchSelectMode, setBatchSelectMode] = useState<number | null>(null); // 現在一括選択中のhistoryId
  const [selectedItems, setSelectedItems] = useState<Record<number, boolean>>({}); // inventoryId -> selected
  // 出庫No一括変更モード
  const [bulkEditNoMode, setBulkEditNoMode] = useState<string | null>(null); // 現在一括変更中のgroupKey
  const [bulkEditNoSelected, setBulkEditNoSelected] = useState<Set<number>>(new Set()); // 選択中のhistoryId
  const [bulkEditNoValue, setBulkEditNoValue] = useState(""); // 新しい出庫No
  const [bulkEditNoDialogOpen, setBulkEditNoDialogOpen] = useState(false);
  // 商品単位で出庫No変更モード
  const [moveItemsMode, setMoveItemsMode] = useState<number | null>(null); // 現在変更中のhistoryId
  const [moveItemsSelected, setMoveItemsSelected] = useState<Set<number>>(new Set()); // 選択中のinventoryId
  const [moveItemsDialogOpen, setMoveItemsDialogOpen] = useState(false);
  const [moveItemsNewDeliveryNo, setMoveItemsNewDeliveryNo] = useState("");

  // FedEx発送登録ダイアログ
  const [fedexDialog, setFedexDialog] = useState<{ groupKey: string; groupItems: HistoryItem[]; historyId?: number } | null>(null);
  // FedExバッチ選択モード（グループキー -> 選択中か）
  const [fedexSelectMode, setFedexSelectMode] = useState(false);
  const [fedexSelectedGroups, setFedexSelectedGroups] = useState<Set<string>>(new Set());
  // 固定バーの入力値
  const today = new Date();
  const defaultShippingDate = `${today.getMonth() + 1}/${today.getDate()}`;
  const [fedexBarShippingDate, setFedexBarShippingDate] = useState(defaultShippingDate);
  const [fedexBarTrackingNumber, setFedexBarTrackingNumber] = useState("");
  // FedExバッチ登録ダイアログ
  const [fedexBatchDialog, setFedexBatchDialog] = useState(false);
  // FedEx発送記録（グループキー -> 記録リスト）
  const { data: fedexShipmentsData, refetch: refetchFedex } = trpc.inventory.fedex.getAll.useQuery(undefined, {
    enabled: true,
    staleTime: 30000,
  });
  const fedexShipmentsMap = useMemo(() => {
    const map = new Map<string, Array<{ id: number; sheetName: string; shippingDate: string; trackingNumber: string; spreadsheetStatus: string; itemsJson: string; historyId?: number | null }>>();
    if (!fedexShipmentsData) return map;
    for (const s of fedexShipmentsData as Array<{ id: number; deliveryNo: string; sheetName: string; shippingDate: string; trackingNumber: string; spreadsheetStatus: string; itemsJson: string; historyId?: number | null }>) {
      const key = extractDeliveryGroup(s.deliveryNo);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ id: s.id, sheetName: s.sheetName, shippingDate: s.shippingDate, trackingNumber: s.trackingNumber, spreadsheetStatus: s.spreadsheetStatus, itemsJson: s.itemsJson, historyId: s.historyId });
    }
    return map;
  }, [fedexShipmentsData]);
  // historyId -> 追跡番号リスト（各出庫行に紐付く追跡番号のみ表示するため）
  const fedexByHistoryId = useMemo(() => {
    const map = new Map<number, Array<{ id: number; sheetName: string; shippingDate: string; trackingNumber: string; spreadsheetStatus: string; itemsJson: string }>>();
    if (!fedexShipmentsData) return map;
    for (const s of fedexShipmentsData as Array<{ id: number; historyId?: number | null; sheetName: string; shippingDate: string; trackingNumber: string; spreadsheetStatus: string; itemsJson: string }>) {
      if (!s.historyId) continue;
      if (!map.has(s.historyId)) map.set(s.historyId, []);
      map.get(s.historyId)!.push({ id: s.id, sheetName: s.sheetName, shippingDate: s.shippingDate, trackingNumber: s.trackingNumber, spreadsheetStatus: s.spreadsheetStatus, itemsJson: s.itemsJson });
    }
    return map;
  }, [fedexShipmentsData]);
  const createFedexMutation = trpc.inventory.fedex.create.useMutation({
    onSuccess: (data) => {
      refetchFedex();
      if (data.success) {
        toast.success(data.message ?? "FedEx発送情報をスプシに登録しました");
      } else {
        toast.warning(data.message ?? "DBには保存しましたが、スプシへの書き込みに失敗しました");
      }
      setFedexDialog(null);
    },
    onError: (err) => {
      toast.error(`FedEx発送登録に失敗しました: ${err.message}`);
    },
  });
  const createFedexBatchMutation = trpc.inventory.fedex.createBatch.useMutation({
    onSuccess: (data) => {
      refetchFedex();
      if (data.success) {
        toast.success(data.message ?? "FedEx発送情報をスプシに登録しました");
      } else {
        // 部分失敗の場合は詳細を表示
        const failedItems = data.results.filter((r) => !r.success);
        toast.warning(`${data.message}\n失敗: ${failedItems.map((r) => `No.${r.deliveryNo}`).join(", ")}`);
      }
      setFedexBatchDialog(false);
      setFedexSelectedGroups(new Set());
      setFedexSelectMode(false);
    },
    onError: (err) => {
      toast.error(`FedExバッチ登録に失敗しました: ${err.message}`);
    },
  });

  // FedEx発送記録の編集ダイアログ状態
  const [fedexEditDialog, setFedexEditDialog] = useState<{
    id: number;
    sheetName: string;
    shippingDate: string;
    trackingNumber: string;
    items: Array<{ productNameJa: string; productNameEn: string; quantity: number }>;
  } | null>(null);
  // FedEx発送記録の削除確認ダイアログ状態
  const [fedexDeleteConfirm, setFedexDeleteConfirm] = useState<{ id: number; trackingNumber: string; sheetName: string } | null>(null);

  const updateFedexMutation = trpc.inventory.fedex.updateWithGas.useMutation({
    onSuccess: (data) => {
      refetchFedex();
      if (data.success) {
        toast.success(data.message ?? "発送情報を更新しました");
      } else {
        toast.warning(data.message ?? "スプシへの更新に失敗しました");
      }
      setFedexEditDialog(null);
    },
    onError: (err) => {
      toast.error(`FedEx発送情報の更新に失敗しました: ${err.message}`);
    },
  });

  const deleteFedexMutation = trpc.inventory.fedex.deleteWithGas.useMutation({
    onSuccess: (data) => {
      refetchFedex();
      toast.success(data.message ?? "発送記録を削除しました");
      setFedexDeleteConfirm(null);
    },
    onError: (err) => {
      toast.error(`FedEx発送記録の削除に失敗しました: ${err.message}`);
    },
  });

  const mergeByTrackingMutation = trpc.inventory.fedex.mergeByTracking.useMutation({
    onSuccess: (data) => {
      refetchFedex();
      if (data.success) toast.success(data.message ?? "合算しました");
      else toast.error(data.message ?? "合算に失敗しました");
    },
    onError: (err) => toast.error(`合算に失敗しました: ${err.message}`),
  });

  function handleDeleted(historyId: number, inventoryId: number) {
    const history = histories?.find((h) => h.id === historyId);
    if (!history) return;
    const currentDeleted = history.deletedInventoryIds ?? [];
    if (currentDeleted.includes(inventoryId)) return;
    const newDeleted = [...currentDeleted, inventoryId];
    markDeletedMutation.mutate({ historyId, deletedIds: newDeleted });
    toast.info(`「${history.items.find((i) => i.inventoryId === inventoryId)?.title ?? "商品"}」は削除済みとして記録しました`);
    // トグルを閉じる
    setOpenItems((prev) => { const next = { ...prev }; delete next[`${historyId}-${inventoryId}`]; return next; });
  }

  // 個別取り消しボタンクリック
  function handleCancelItem(historyId: number, item: HistoryItem) {
    setCancelDialog({
      historyId,
      items: [{ inventoryId: item.inventoryId, title: item.title, quantity: item.quantity }],
      isBatch: false,
    });
  }

  // 一括取り消し確認
  function handleBatchCancel(historyId: number, allItems: HistoryItem[], cancelledIds: Set<number>) {
    const selectedIds = Object.entries(selectedItems)
      .filter(([, v]) => v)
      .map(([k]) => Number(k));
    const targetItems = allItems.filter(
      (item) => selectedIds.includes(item.inventoryId) && !cancelledIds.has(item.inventoryId)
    );
    if (targetItems.length === 0) {
      toast.error("取り消し可能な商品が選択されていません");
      return;
    }
    setCancelDialog({
      historyId,
      items: targetItems.map((item) => ({ inventoryId: item.inventoryId, title: item.title, quantity: item.quantity })),
      isBatch: true,
    });
  }

  // 取り消し実行
  function executeCancelConfirm() {
    if (!cancelDialog) return;
    if (cancelDialog.isBatch || cancelDialog.items.length > 1) {
      cancelItemsMutation.mutate({
        historyId: cancelDialog.historyId,
        items: cancelDialog.items.map((i) => ({ inventoryId: i.inventoryId, quantity: i.quantity })),
      });
    } else {
      const item = cancelDialog.items[0];
      cancelItemMutation.mutate({
        historyId: cancelDialog.historyId,
        inventoryId: item.inventoryId,
        quantity: item.quantity,
      });
    }
  }

  const isPendingCancel = cancelItemMutation.isPending || cancelItemsMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">履歴を読み込み中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          {urlParams.group ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground hover:text-foreground"
                onClick={() => setLocation("/inventory/history")}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                一覧に戻る
              </Button>
              <h1 className="text-xl font-bold text-foreground">
                No.{urlParams.group}
                {csvProductsMap.get(urlParams.group) && csvProductsMap.get(urlParams.group)!.length > 0 && (
                  <span className="text-base font-normal text-muted-foreground ml-1">
                    ({csvProductsMap.get(urlParams.group)!.map((p) => p.name).join(" ・ ")})
                  </span>
                )}
              </h1>
            </div>
          ) : (
            <h1 className="text-xl font-bold text-foreground">出庫履歴</h1>
          )}
          <p className="text-sm text-muted-foreground mt-0.5">
            過去の出庫処理履歴 ({histories?.length ?? 0} 件)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {histories && histories.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCSV(
                histories.map((h) => ({
                  ...h,
                  cancelledItems: h.cancelledItemsJson
                    ? (JSON.parse(h.cancelledItemsJson as string) as CancelledItem[])
                    : [],
                })),
                fedexShipmentsMap
              )}
            >
              <Download className="h-4 w-4 mr-1.5" />
              CSV
            </Button>
          )}
          {/* 日付フィルター */}
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant={filterDate ? "default" : "outline"}
                size="sm"
                className="h-8 gap-1.5"
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                {filterDate
                  ? filterDate.toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" })
                  : "日付"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={filterDate}
                onSelect={(d) => { handleSetFilterDate(d); setCalendarOpen(false); setDelivHistPage(1); }}
                initialFocus
              />
              {filterDate && (
                <div className="p-2 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => { handleSetFilterDate(undefined); setCalendarOpen(false); setDelivHistPage(1); }}
                  >
                    フィルターをクリア
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
          {/* ソートボタン */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => handleSetSortOrder(sortOrder === "desc" ? "asc" : "desc")}
          >
            {sortOrder === "desc" ? <SortDesc className="h-3.5 w-3.5" /> : <SortAsc className="h-3.5 w-3.5" />}
            {sortOrder === "desc" ? "新しい順" : "古い順"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            更新
          </Button>
          {/* FedExバッチ登録ボタン */}
          <Button
            variant={fedexSelectMode ? "default" : "outline"}
            size="sm"
            className={`h-8 gap-1.5 ${fedexSelectMode ? "bg-blue-600 hover:bg-blue-700 text-white" : "text-blue-600 border-blue-300 hover:bg-blue-50"}`}
            onClick={() => {
              if (fedexSelectMode) {
                setFedexSelectMode(false);
                setFedexSelectedGroups(new Set());
              } else {
                setFedexSelectMode(true);
              }
            }}
          >
            <Package className="h-3.5 w-3.5" />
            {fedexSelectMode ? "選択モード中" : "FedEx発送"}
          </Button>
        </div>
      </div>

      {/* 履歴なし */}
      {!histories || histories.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <History className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">出庫履歴はありません</p>
          <p className="text-sm text-muted-foreground mt-1">
            出庫処理を行うと履歴が記録されます
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pagedGroups.map(([groupKey, groupHistories], groupIdx) => {
            const isGroupOpen = !!openGroups[groupKey];
            const groupDate = new Date(groupHistories[0].createdAt).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
            const prevGroupDate = groupIdx > 0 ? new Date(pagedGroups[groupIdx - 1][1][0].createdAt).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }) : null;
            const showDateHeader = groupDate !== prevGroupDate;
            const groupHasDeleted = groupHistories.some((h) => (h.deletedInventoryIds ?? []).length > 0);
            const groupTotalItems = groupHistories.reduce((sum, h) => sum + (h.items as HistoryItem[]).length, 0);
            // CSV発注商品名（グループヘッダーに表示）
            const groupCsvProducts = csvProductsMap.get(groupKey) ?? [];
            // 全グループの全アイテムを結合
            const allGroupItems: HistoryItem[] = groupHistories.flatMap((h) => h.items as HistoryItem[]);
            // 精密照合ロジックでCSV発注商品ごとの出庫数を集計
            const _groupDeliveredByProduct = buildGroupDeliveredSummary(groupCsvProducts, allGroupItems);
            // CSV商品がない場合は実際の出庫商品名でサマリーを作成
            const _groupItemCountMap: Record<string, number> = {};
            allGroupItems.forEach((item) => {
              const name = item.title?.replace(/\s*[（(][^）)]*[）)]\s*/g, "").trim() ?? "不明";
              _groupItemCountMap[name] = (_groupItemCountMap[name] ?? 0) + item.quantity;
            });
            const groupItemSummary = groupCsvProducts.length > 0
              ? _groupDeliveredByProduct.map(({ name, deliveredQty }) => `${name} ${deliveredQty}台`).join("　")
              : Object.entries(_groupItemCountMap).map(([name, qty]) => `${name} ${qty}台`).join("　");
            // 販売価格計算: CSVの商品別単価 × 出庫数を合算
            const csvPriceRows = csvPriceMap.get(groupKey) ?? [];
            const groupPartner = csvPriceRows[0]?.partner ?? "";
            const isSamee = groupPartner.toLowerCase().includes("samee") || groupPartner.toLowerCase().includes("sami") || groupPartner.toLowerCase().includes("sammy");
            const groupCurrency = isSamee ? "$" : "€";
            let groupSellingTotal: number | null = null;
            if (csvPriceRows.length > 0) {
              // CSV商品別に単価×出庫数を合算
              let total = 0;
              let hasPrice = false;
              for (const csvRow of csvPriceRows) {
                if (csvRow.sellingPrice == null) continue;
                // 出庫履歴から商品名で照合して出庫数を取得
                const matched = _groupDeliveredByProduct.find((d) => {
                  const dLower = d.name.toLowerCase();
                  const cLower = csvRow.productName.toLowerCase();
                  return dLower.includes(cLower) || cLower.includes(dLower);
                });
                const qty = matched ? matched.deliveredQty : 0;
                total += csvRow.sellingPrice * qty;
                hasPrice = true;
              }
              if (hasPrice) groupSellingTotal = total;
            }
            // 日付ごとの合計金額を計算
            let dateTotalEuro = 0;
            let dateTotalDollar = 0;
            if (showDateHeader) {
              for (const [gKey, gHistories] of pagedGroups) {
                const gDate = new Date(gHistories[0].createdAt).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
                if (gDate !== groupDate) continue;
                const gCsvPriceRows = csvPriceMap.get(gKey) ?? [];
                const gPartner = gCsvPriceRows[0]?.partner ?? "";
                const gIsSamee = gPartner.toLowerCase().includes("samee") || gPartner.toLowerCase().includes("sami") || gPartner.toLowerCase().includes("sammy");
                const gAllItems: HistoryItem[] = gHistories.flatMap((h) => h.items as HistoryItem[]);
                const gCsvProducts = csvProductsMap.get(gKey) ?? [];
                const gDelivered = buildGroupDeliveredSummary(gCsvProducts, gAllItems);
                for (const csvRow of gCsvPriceRows) {
                  if (csvRow.sellingPrice == null) continue;
                  const matched = gDelivered.find((d) => { const dL = d.name.toLowerCase(); const cL = csvRow.productName.toLowerCase(); return dL.includes(cL) || cL.includes(dL); });
                  const qty = matched ? matched.deliveredQty : 0;
                  if (gIsSamee) dateTotalDollar += csvRow.sellingPrice * qty;
                  else dateTotalEuro += csvRow.sellingPrice * qty;
                }
              }
            }
            return (
              <Fragment key={groupKey}>
              {showDateHeader && (
                <div className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1 bg-border" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">{groupDate}</span>
                    {dateTotalEuro > 0 && <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">{dateTotalEuro}€</span>}
                    {dateTotalDollar > 0 && <span className="text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">{dateTotalDollar}$</span>}
                  </div>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
                {/* グループヘッダー */}
                <button
                  type="button"
                  className="w-full flex items-start justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                  onClick={() => toggleGroup(groupKey)}
                >
                  <div className="flex flex-col items-start gap-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isGroupOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <span className="font-bold text-base">
                        No.{groupKey}
                        {groupCsvProducts.length > 0 && (
                          <span className="font-normal text-sm text-muted-foreground ml-1">
                            ({groupCsvProducts.map((p) => p.name).join("・")})
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{groupDate}</span>
                      {groupHasDeleted && <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">削除済み商品あり</Badge>}
                      <Badge variant="secondary" className="text-xs">{groupTotalItems}商品</Badge>
                      {groupSellingTotal !== null && groupSellingTotal > 0 && (
                        <Badge className={`text-xs font-bold ${isSamee ? "bg-purple-100 text-purple-700 border-purple-200" : "bg-blue-100 text-blue-700 border-blue-200"} border`}>
                          {groupSellingTotal}{groupCurrency}
                        </Badge>
                      )}
                    </div>
                    {groupItemSummary && (
                      <p className="text-xs text-muted-foreground pl-6 truncate max-w-[600px]">{groupItemSummary}</p>
                    )}
                  </div>
                </button>
                {/* グループヘッダーのFedEx発送ボタン */}
                <div className="flex items-center justify-between px-4 py-1.5 border-t bg-muted/10">
                  <div className="flex items-center gap-2">
                    {/* 出庫No一括変更モードのチェックボックス（トグル展開時のみ表示） */}
                    {isGroupOpen && bulkEditNoMode === groupKey && (
                      <label className="flex items-center gap-1.5 cursor-pointer select-none" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={groupHistories.every((h) => bulkEditNoSelected.has(h.id))}
                          onCheckedChange={(checked) => {
                            setBulkEditNoSelected((prev) => {
                              const next = new Set(prev);
                              for (const h of groupHistories) {
                                if (checked) next.add(h.id);
                                else next.delete(h.id);
                              }
                              return next;
                            });
                          }}
                          className="h-4 w-4"
                        />
                        <span className="text-xs text-orange-700 font-medium">全選択</span>
                      </label>
                    )}
                    {isGroupOpen && (
                      isGroupOpen && bulkEditNoMode === groupKey ? (
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <span className="text-xs text-orange-700 font-medium">{bulkEditNoSelected.size}件選択中</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs px-2 text-orange-700 border-orange-300 hover:bg-orange-50"
                            disabled={bulkEditNoSelected.size === 0}
                            onClick={() => setBulkEditNoDialogOpen(true)}
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            出庫No変更
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs px-2 text-muted-foreground"
                            onClick={() => { setBulkEditNoMode(null); setBulkEditNoSelected(new Set()); }}
                          >
                            キャンセル
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs px-2 text-muted-foreground hover:text-orange-700"
                          onClick={(e) => { e.stopPropagation(); setBulkEditNoMode(groupKey); setBulkEditNoSelected(new Set()); }}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          出庫No一括変更
                        </Button>
                      )
                    )}
                    {fedexSelectMode && (
                      <label className="flex items-center gap-1.5 cursor-pointer select-none" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={fedexSelectedGroups.has(groupKey)}
                          onCheckedChange={(checked) => {
                            setFedexSelectedGroups((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(groupKey);
                              else next.delete(groupKey);
                              return next;
                            });
                          }}
                          className="h-4 w-4"
                        />
                        <span className="text-xs text-blue-700 font-medium">
                          {fedexSelectedGroups.has(groupKey) ? "選択済み" : "FedEx発送に選択"}
                        </span>
                      </label>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 個別FedEx発送登録ボタンは削除（バッチ選択モードのみ使用） */}
                  </div>
                </div>
                {/* グループ内の各履歴 */}
                {isGroupOpen && groupHistories.map((history) => {
            const deletedIds = new Set(history.deletedInventoryIds ?? []);
            const hasDeletedItems = deletedIds.size > 0;
            const cancelledItems: CancelledItem[] = history.cancelledItemsJson
              ? (JSON.parse(history.cancelledItemsJson as string) as CancelledItem[])
              : [];
            const cancelledIds = new Set(cancelledItems.map((c) => c.inventoryId));
            const allItems = history.items as HistoryItem[];
            const cancelableItems = allItems.filter(
              (item) => !deletedIds.has(item.inventoryId) && !cancelledIds.has(item.inventoryId)
            );
            const hasCancelledItems = cancelledIds.size > 0;
            const isBatchMode = batchSelectMode === history.id;

            return (
              <div key={history.id} className="border-t bg-card overflow-hidden">
                {/* 履歴ヘッダー */}
                <div className={`flex items-center justify-between px-4 py-3 border-b ${hasDeletedItems ? "bg-amber-50/60" : hasCancelledItems ? "bg-blue-50/40" : "bg-muted/20"}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* 出庫No一括変更モード時のチェックボックス */}
                    {bulkEditNoMode === groupKey && (
                      <Checkbox
                        checked={bulkEditNoSelected.has(history.id)}
                        onCheckedChange={(checked) => {
                          setBulkEditNoSelected((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(history.id);
                            else next.delete(history.id);
                            return next;
                          });
                        }}
                        className="h-4 w-4 mr-1"
                      />
                    )}
                    {editingId === history.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-muted-foreground">出庫No:</span>
                        <Input
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          className="h-7 text-sm w-48"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit(history.id, history.zaicoDeliveryId ?? null);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          autoFocus
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-green-600 hover:text-green-700"
                          onClick={() => saveEdit(history.id, history.zaicoDeliveryId ?? null)}
                          disabled={updateDeliveryNoMutation.isPending}
                        >
                          {updateDeliveryNoMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={cancelEdit}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 group">
                        <span className="font-semibold text-sm">出庫No: {history.deliveryNo}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => startEdit(history.id, history.deliveryNo)}
                          title="出庫Noを編集"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    {history.status === "success" ? (
                      <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        成功
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-xs">
                        <XCircle className="h-3 w-3 mr-1" />
                        エラー
                      </Badge>
                    )}
                    {hasDeletedItems && (
                      <Badge className="bg-red-100 text-red-700 border-red-200 text-xs border">
                        ⚠ 削除済み商品あり
                      </Badge>
                    )}
                    {hasCancelledItems && (
                      <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs border">
                        <Undo2 className="h-3 w-3 mr-1" />
                        {cancelledIds.size}件取り消し済み
                      </Badge>
                    )}
                    {history.zaicoDeliveryId && (
                      <span className="text-xs text-muted-foreground">
                        出庫ID: {history.zaicoDeliveryId}
                      </span>
                    )}
                    {/* 各出庫レコードに紐付く追跡番号 */}
                    {(() => {
                      // historyIdで紐付けられたもの（優先）
                      const byHistoryId = fedexByHistoryId.get(history.id) ?? [];
                      // historyIdで紐付けられたものがある場合はそのみ表示
                      // ない場合のみdeliveryNoベース（historyId未設定のもの）を表示
                      let shipments: Array<{ id: number; sheetName: string; shippingDate: string; trackingNumber: string; spreadsheetStatus: string; itemsJson: string }>;
                      if (byHistoryId.length > 0) {
                        shipments = byHistoryId;
                      } else {
                        // historyId未設定のdeliveryNoベースのもの（既存データ）
                        // deliveryNoが完全一致するものだけ表示（グループキーではなく完全一致）
                        shipments = (fedexShipmentsData as Array<{ id: number; deliveryNo: string; sheetName: string; shippingDate: string; trackingNumber: string; spreadsheetStatus: string; itemsJson: string; historyId?: number | null }> ?? [])
                          .filter((s) => !s.historyId && s.deliveryNo === history.deliveryNo);
                      }
                      if (shipments.length === 0) return null;
                      return (
                        <div className="flex items-center gap-1 flex-wrap">
                          {shipments.map((s) => {
                            const items = (() => { try { return JSON.parse(s.itemsJson) as Array<{productNameJa:string;productNameEn:string;quantity:number}>; } catch { return []; } })();
                            return (
                              <div
                                key={s.id}
                                className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border font-mono ${
                                  s.spreadsheetStatus === "success" ? "bg-blue-50 text-blue-700 border-blue-200" :
                                  s.spreadsheetStatus === "error" ? "bg-red-50 text-red-600 border-red-200" :
                                  "bg-gray-50 text-gray-600 border-gray-200"
                                }`}
                              >
                                <Package className="h-2.5 w-2.5 flex-shrink-0" />
                                <a
                                  href={`https://www.fedex.com/fedextrack/?trknbr=${s.trackingNumber}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                  title={`FedEx追跡: ${s.trackingNumber} (発送日: ${s.shippingDate})`}
                                >
                                  {s.trackingNumber}
                                </a>
                                <button
                                  className="ml-0.5 p-0.5 rounded hover:bg-blue-200 text-blue-600"
                                  title="編集"
                                  onClick={(e) => { e.stopPropagation(); setFedexEditDialog({ id: s.id, sheetName: s.sheetName, shippingDate: s.shippingDate, trackingNumber: s.trackingNumber, items }); }}
                                >
                                  <Edit className="h-2.5 w-2.5" />
                                </button>
                                <button
                                  className="p-0.5 rounded hover:bg-red-200 text-red-600"
                                  title="削除"
                                  onClick={(e) => { e.stopPropagation(); setFedexDeleteConfirm({ id: s.id, trackingNumber: s.trackingNumber, sheetName: s.sheetName }); }}
                                >
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(history.createdAt)}
                    </span>
                    {/* まとめて削除ボタン */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => setDeleteGroupConfirm({
                        historyId: history.id,
                        deliveryNo: history.deliveryNo,
                        inventoryIds: allItems
                          .filter((item) => !deletedIds.has(item.inventoryId))
                          .map((item) => item.inventoryId),
                        titles: allItems
                          .filter((item) => !deletedIds.has(item.inventoryId))
                          .map((item) => item.title),
                      })}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      まとめて削除
                    </Button>
                    {/* 一括取り消しボタン */}
                    {history.status === "success" && cancelableItems.length > 1 && (
                      isBatchMode ? (
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs px-2"
                            onClick={() => handleBatchCancel(history.id, allItems, cancelledIds)}
                            disabled={isPendingCancel}
                          >
                            <Undo2 className="h-3 w-3 mr-1" />
                            取り消す
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs px-2"
                            onClick={() => {
                              setBatchSelectMode(null);
                              setSelectedItems({});
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-2"
                          onClick={() => {
                            setBatchSelectMode(history.id);
                            setSelectedItems({});
                          }}
                        >
                          <Undo2 className="h-3 w-3 mr-1" />
                          まとめて取り消し
                        </Button>
                      )
                      )}
                    {/* 商品単位で出庫No変更ボタン */}
                    {moveItemsMode === history.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-blue-700 font-medium">{moveItemsSelected.size}商品選択中</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-2 text-blue-700 border-blue-300 hover:bg-blue-50"
                          disabled={moveItemsSelected.size === 0}
                          onClick={() => setMoveItemsDialogOpen(true)}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          出庫No変更
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs px-2"
                          onClick={() => { setMoveItemsMode(null); setMoveItemsSelected(new Set()); }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2 text-blue-700 border-blue-300 hover:bg-blue-50"
                        onClick={() => { setMoveItemsMode(history.id); setMoveItemsSelected(new Set()); }}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        商品単位で出庫No変更
                      </Button>
                    )}
                  </div>
                </div>

                {/* エラーメッセージ */}
                {history.status === "error" && history.errorMessage && (
                  <div className="px-4 py-2 bg-destructive/10 border-b text-sm text-destructive">
                    <XCircle className="h-3.5 w-3.5 inline mr-1" />
                    {history.errorMessage}
                  </div>
                )}

                {/* 出庫商品一覧 */}
                <div className="px-4 py-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    出庫商品（クリックで詳細表示）
                  </p>
                  <div className="space-y-1.5">
                    {allItems.map((item, idx) => {
                      const isManualDeleted = deletedIds.has(item.inventoryId);
                      // Zaicoから削除されている場合もisDeletedとして扱う（ただしDBフォールバックがあれば詳細表示可能）
                      const isAutoDeleted = activeInventoryIds !== null && !activeInventoryIds.has(item.inventoryId);
                      const isDeleted = isManualDeleted || isAutoDeleted;
                      const cancelledItem = cancelledItems.find((c) => c.inventoryId === item.inventoryId);
                      const isCancelled = !!cancelledItem;
                      const itemKey = `${history.id}-${item.inventoryId}`;
                      const isMoveMode = moveItemsMode === history.id;
                      return (
                        <div key={idx} className="flex items-center gap-1">
                          {isMoveMode && (
                            <Checkbox
                              checked={moveItemsSelected.has(item.inventoryId)}
                              onCheckedChange={(checked) => {
                                setMoveItemsSelected((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(item.inventoryId);
                                  else next.delete(item.inventoryId);
                                  return next;
                                });
                              }}
                              className="h-4 w-4 flex-shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <InventoryDetailToggle
                              historyId={history.id}
                              inventoryId={item.inventoryId}
                              title={item.title}
                              quantity={item.quantity}
                              unit=""
                              isOpen={!!openItems[itemKey]}
                              onToggle={() => toggleItem(history.id, item.inventoryId)}
                              onDeleted={handleDeleted}
                              onDeleteInventory={handleDeleteInventory}
                              isBatchMode={isBatchMode}
                              isSelected={!!selectedItems[item.inventoryId]}
                              onSelectChange={(checked) => setSelectedItems((prev) => ({ ...prev, [item.inventoryId]: checked }))}
                              isCancelled={isCancelled}
                              cancelledAt={cancelledItem?.cancelledAt}
                              isDeleted={isDeleted}
                              onCancelItem={() => handleCancelItem(history.id, item)}
                              isPendingCancel={isPendingCancel}
                              historyStatus={history.status}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
              </div>
            </Fragment>
            );
          })}
           <PaginationBar
            page={delivHistPage}
            totalPages={delivHistTotalPages}
            onPageChange={setDelivHistPage}
            totalItems={delivHistTotalItems}
            startIndex={delivHistStartIndex}
            endIndex={delivHistEndIndex}
          />
        </div>
      )}
      {/* トグル形式に変更したためダイアログは不要 */}

      {/* 出庫履歴グループ一括削除確認ダイアログ */}
      {deleteGroupConfirm && (
        <Dialog open={!!deleteGroupConfirm} onOpenChange={(v) => { if (!v && !deleteGroupMutation.isPending) setDeleteGroupConfirm(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Trash2 className="h-5 w-5 text-destructive" />
                出庫履歴をまとめて削除
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <strong>{deleteGroupConfirm.deliveryNo}</strong> の出庫履歴と在庫内の全商品を削除します。この操作は元に戻せません。
              </p>
              {deleteGroupConfirm.titles.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-1 max-h-40 overflow-y-auto">
                  {deleteGroupConfirm.titles.map((title, i) => (
                    <p key={i} className="text-sm">{title}</p>
                  ))}
                </div>
              )}
              <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">
                ※ 出庫履歴のDBレコードとサイト内在庫が両方削除されます
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteGroupConfirm(null)}
                disabled={deleteGroupMutation.isPending}
              >
                キャンセル
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteGroupMutation.mutate({
                  historyId: deleteGroupConfirm.historyId,
                  inventoryIds: deleteGroupConfirm.inventoryIds,
                })}
                disabled={deleteGroupMutation.isPending}
              >
                {deleteGroupMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />削除中...</>
                ) : (
                  <><Trash2 className="h-4 w-4 mr-1.5" />まとめて削除する</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 出庫No一括変更ダイアログ */}
      <Dialog open={bulkEditNoDialogOpen} onOpenChange={(v) => { if (!v) setBulkEditNoDialogOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Pencil className="h-5 w-5 text-orange-600" />
              出庫No一括変更
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              選択した <strong>{bulkEditNoSelected.size}件</strong> の出庫履歴の出庫Noを以下に変更します。
            </p>
            <div>
              <Label className="text-sm font-medium">新しい出庫No</Label>
              <Input
                value={bulkEditNoValue}
                onChange={(e) => setBulkEditNoValue(e.target.value)}
                placeholder="例: 376_luca20260415"
                className="mt-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && bulkEditNoValue.trim() && bulkEditNoSelected.size > 0) {
                    bulkUpdateDeliveryNoMutation.mutate({ historyIds: Array.from(bulkEditNoSelected), deliveryNo: bulkEditNoValue.trim() });
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkEditNoDialogOpen(false)}
              disabled={bulkUpdateDeliveryNoMutation.isPending}
            >
              キャンセル
            </Button>
            <Button
              size="sm"
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={() => {
                if (!bulkEditNoValue.trim()) { toast.error("出庫Noを入力してください"); return; }
                bulkUpdateDeliveryNoMutation.mutate({ historyIds: Array.from(bulkEditNoSelected), deliveryNo: bulkEditNoValue.trim() });
              }}
              disabled={bulkUpdateDeliveryNoMutation.isPending || !bulkEditNoValue.trim() || bulkEditNoSelected.size === 0}
            >
              {bulkUpdateDeliveryNoMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />更新中...</>
              ) : (
                <><Check className="h-4 w-4 mr-1.5" />{bulkEditNoSelected.size}件を一括変更</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 商品単位で出庫No変更ダイアログ */}
      <Dialog open={moveItemsDialogOpen} onOpenChange={(v) => { if (!v) setMoveItemsDialogOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Pencil className="h-5 w-5 text-blue-600" />
              商品単位で出庫No変更
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              選択した <strong>{moveItemsSelected.size}商品</strong> を新しい出庫Noの出庫行に移動します。
            </p>
            <div>
              <Label className="text-sm font-medium">新しい出庫No</Label>
              <Input
                value={moveItemsNewDeliveryNo}
                onChange={(e) => setMoveItemsNewDeliveryNo(e.target.value)}
                placeholder="例: 376_luca20260415"
                className="mt-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && moveItemsNewDeliveryNo.trim() && moveItemsSelected.size > 0 && moveItemsMode !== null) {
                    moveItemsMutation.mutate({ historyId: moveItemsMode, inventoryIds: Array.from(moveItemsSelected), newDeliveryNo: moveItemsNewDeliveryNo.trim() });
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMoveItemsDialogOpen(false)}
              disabled={moveItemsMutation.isPending}
            >
              キャンセル
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => {
                if (!moveItemsNewDeliveryNo.trim()) { toast.error("出庫Noを入力してください"); return; }
                if (moveItemsMode === null) return;
                moveItemsMutation.mutate({ historyId: moveItemsMode, inventoryIds: Array.from(moveItemsSelected), newDeliveryNo: moveItemsNewDeliveryNo.trim() });
              }}
              disabled={moveItemsMutation.isPending || !moveItemsNewDeliveryNo.trim() || moveItemsSelected.size === 0}
            >
              {moveItemsMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />移動中...</>
              ) : (
                <><Check className="h-4 w-4 mr-1.5" />{moveItemsSelected.size}商品を移動</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 在庫削除確認ダイアログ */}
      {deleteConfirm && (
        <Dialog open={!!deleteConfirm} onOpenChange={(v) => { if (!v && !deleteInventoryMutation.isPending) setDeleteConfirm(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Trash2 className="h-5 w-5 text-destructive" />
                在庫削除の確認
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                以下の商品を在庫から削除します。この操作は取り消せません。
              </p>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-medium">{deleteConfirm.title}</p>
                <p className="text-xs text-muted-foreground mt-1">ID: {deleteConfirm.inventoryId}</p>
              </div>
              <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">
                ※ 月次棚卸しの仕入単価は削除後も保持されます
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleteInventoryMutation.isPending}
              >
                キャンセル
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={executeDeleteInventory}
                disabled={deleteInventoryMutation.isPending}
              >
                {deleteInventoryMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />削除中...</>
                ) : (
                  <><Trash2 className="h-4 w-4 mr-1.5" />削除する</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 取り消し確認ダイアログ */}
      {cancelDialog && (
        <CancelConfirmDialog
          open={!!cancelDialog}
          onClose={() => setCancelDialog(null)}
          onConfirm={executeCancelConfirm}
          items={cancelDialog.items}
          isPending={isPendingCancel}
        />
      )}

      {/* FedEx発送登録ダイアログ */}
      {fedexDialog && (
        <FedexShipmentDialog
          open={!!fedexDialog}
          onClose={() => setFedexDialog(null)}
          groupKey={fedexDialog.groupKey}
          groupItems={fedexDialog.groupItems}
          onSubmit={(data) => createFedexMutation.mutate({
            deliveryNo: fedexDialog.groupKey,
            sheetName: data.sheetName,
            shippingDate: data.shippingDate,
            trackingNumber: data.trackingNumber,
            items: data.items,
            historyId: fedexDialog.historyId,
          })}
          isPending={createFedexMutation.isPending}
          existingShipments={fedexShipmentsMap.get(fedexDialog.groupKey) ?? []}
        />
      )}

      {/* FedExバッチ登録ダイアログ */}
      <FedexBatchDialog
        open={fedexBatchDialog}
        onClose={() => { setFedexBatchDialog(false); }}
        selectedGroupKeys={Array.from(fedexSelectedGroups)}
        groupedHistories={groupedHistories}
        csvProductsMap={csvProductsMap}
        initialShippingDate={fedexBarShippingDate}
        initialTrackingNumber={fedexBarTrackingNumber}
        onSubmit={(shippingDate, shipments) => {
          createFedexBatchMutation.mutate({ shippingDate, shipments });
        }}
        isPending={createFedexBatchMutation.isPending}
      />

      {/* FedEx発送記録 編集ダイアログ */}
      {fedexEditDialog && (
        <Dialog open={!!fedexEditDialog} onOpenChange={(v) => { if (!v && !updateFedexMutation.isPending) setFedexEditDialog(null); }}>
          <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Edit className="h-5 w-5 text-blue-600" />
                FedEx発送情報の編集
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 overflow-y-auto flex-1 pr-1">
              <div className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1">シート: {fedexEditDialog.sheetName}</div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">発送日</Label>
                <Input
                  value={fedexEditDialog.shippingDate}
                  onChange={(e) => setFedexEditDialog((prev) => prev ? { ...prev, shippingDate: e.target.value } : null)}
                  placeholder="例: 4/8"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">FedEx追跡番号</Label>
                <Input
                  value={fedexEditDialog.trackingNumber}
                  onChange={(e) => setFedexEditDialog((prev) => prev ? { ...prev, trackingNumber: e.target.value } : null)}
                  placeholder="例: 7489 1234 5678"
                  className="h-9 font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">商品ごとの発送数</Label>
                <div className="rounded-md border divide-y">
                  {fedexEditDialog.items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 px-3 py-2">
                      <span className="text-sm flex-1 truncate">{item.productNameJa}</span>
                      <Input
                        type="number"
                        min={0}
                        value={item.quantity}
                        onChange={(e) => setFedexEditDialog((prev) => {
                          if (!prev) return null;
                          const newItems = [...prev.items];
                          newItems[idx] = { ...newItems[idx], quantity: Number(e.target.value) };
                          return { ...prev, items: newItems };
                        })}
                        className="h-7 w-16 text-right text-sm"
                      />
                      <span className="text-xs text-muted-foreground">台</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2 mt-2">
              <Button variant="outline" onClick={() => setFedexEditDialog(null)} disabled={updateFedexMutation.isPending} className="flex-1">
                キャンセル
              </Button>
              <Button
                onClick={() => {
                  if (!fedexEditDialog.shippingDate.trim() || !fedexEditDialog.trackingNumber.trim()) return;
                  updateFedexMutation.mutate({
                    id: fedexEditDialog.id,
                    trackingNumber: fedexEditDialog.trackingNumber.trim(),
                    shippingDate: fedexEditDialog.shippingDate.trim(),
                    items: fedexEditDialog.items.filter((i) => i.quantity > 0),
                  });
                }}
                disabled={updateFedexMutation.isPending || !fedexEditDialog.shippingDate.trim() || !fedexEditDialog.trackingNumber.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {updateFedexMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />更新中...</>
                ) : (
                  <><Check className="h-4 w-4 mr-1.5" />スプシに反映</>  
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* FedEx選択モード 固定バー */}
      {fedexSelectMode && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-blue-700 text-white shadow-2xl border-t-2 border-blue-500">
          <div className="max-w-screen-xl mx-auto px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* 左側: モード表示・選択件数 */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Package className="h-4 w-4" />
                <span className="font-semibold text-sm">FedEx発送</span>
                {fedexSelectedGroups.size > 0 ? (
                  <span className="bg-white text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
                    {fedexSelectedGroups.size}件選択中
                  </span>
                ) : (
                  <span className="text-blue-200 text-xs">グループを選択してください</span>
                )}
              </div>

              {/* 中央: 発送日・追跡番号入力 */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <label className="text-xs text-blue-200 whitespace-nowrap">発送日</label>
                  <input
                    type="text"
                    value={fedexBarShippingDate}
                    onChange={(e) => setFedexBarShippingDate(e.target.value)}
                    placeholder="4/9"
                    className="h-8 w-16 rounded px-2 text-sm text-gray-900 bg-white border-0 focus:ring-2 focus:ring-white/50 outline-none"
                  />
                </div>
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <label className="text-xs text-blue-200 whitespace-nowrap">追跡番号</label>
                  <input
                    type="text"
                    value={fedexBarTrackingNumber}
                    onChange={(e) => setFedexBarTrackingNumber(e.target.value)}
                    placeholder="7489 1234 5678 9"
                    className="h-8 flex-1 min-w-0 rounded px-2 text-sm text-gray-900 bg-white border-0 focus:ring-2 focus:ring-white/50 outline-none font-mono"
                  />
                </div>
              </div>

              {/* 右側: 確認・キャンセル */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {fedexSelectedGroups.size > 0 && (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 bg-white text-blue-700 hover:bg-blue-50 font-semibold"
                    disabled={!fedexBarShippingDate.trim() || !fedexBarTrackingNumber.trim()}
                    onClick={() => setFedexBatchDialog(true)}
                  >
                    <Send className="h-3.5 w-3.5" />
                    確認・登録
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-white hover:bg-blue-600"
                  onClick={() => {
                    setFedexSelectMode(false);
                    setFedexSelectedGroups(new Set());
                    setFedexBarTrackingNumber("");
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                  キャンセル
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FedEx発送記録 削除確認ダイアログ */}
      {fedexDeleteConfirm && (
        <Dialog open={!!fedexDeleteConfirm} onOpenChange={(v) => { if (!v && !deleteFedexMutation.isPending) setFedexDeleteConfirm(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base text-red-600">
                <Trash2 className="h-5 w-5" />
                発送記録の削除
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm">以下の発送記録を削除します。スプシからも該当列のデータがクリアされます。</p>
              <div className="rounded-md border bg-red-50/50 p-3 space-y-1 text-sm">
                <div className="flex gap-2">
                  <span className="text-muted-foreground">追跡番号:</span>
                  <span className="font-mono font-semibold">{fedexDeleteConfirm.trackingNumber}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground">シート:</span>
                  <span>{fedexDeleteConfirm.sheetName}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">※この操作は元に戻せません。</p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setFedexDeleteConfirm(null)} disabled={deleteFedexMutation.isPending} className="flex-1">
                キャンセル
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteFedexMutation.mutate({ id: fedexDeleteConfirm.id })}
                disabled={deleteFedexMutation.isPending}
                className="flex-1"
              >
                {deleteFedexMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />削除中...</>
                ) : (
                  <><Trash2 className="h-4 w-4 mr-1.5" />削除する</>  
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
