import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Boxes,
  CalendarDays,
  ExternalLink,
  Loader2,
  PackageCheck,
  PackagePlus,
  Printer,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";

interface InventoryItemLabel {
  id?: number;
  labelId: string;
  status?: string | null;
  legacyManagementNo?: string | null;
}

interface PurchaseItem {
  id: number;
  inventory_id?: number | null;
  title: string;
  quantity: string;
  unit?: string;
  unit_price?: string | number | null;
  status?: string;
  purchase_date?: string | null;
  estimated_purchase_date?: string | null;
  etc?: string | null;
  category?: string | null;
  itemLabels?: InventoryItemLabel[];
}

interface PurchaseRow {
  id: number;
  num?: string | null;
  purchase_date?: string | null;
  status?: string | null;
  csvSupplierName?: string | null;
  csvSupplierUrl?: string | null;
  purchase_items: PurchaseItem[];
}

type StatusFilter = "all" | "ordered" | "received";

function parseEtc(etc?: string | null): { managementNo: string; supplierSite: string } {
  if (!etc) return { managementNo: "", supplierSite: "" };
  const parts = etc.split(",").map((part) => part.trim());
  return {
    managementNo: parts[0] ?? "",
    supplierSite: parts[2] ?? "",
  };
}

function formatCurrency(value: unknown): string {
  const numberValue = Number(value ?? 0);
  if (!Number.isFinite(numberValue)) return "-";
  return `¥${numberValue.toLocaleString()}`;
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  return value.slice(0, 10);
}

function sumQuantity(items: PurchaseItem[]): number {
  return items.reduce((total, item) => {
    const quantity = Number(item.quantity);
    return total + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getItemLabels(items: PurchaseItem[]): InventoryItemLabel[] {
  return items.flatMap((item) => item.itemLabels ?? []).filter((label) => label.labelId);
}

function getManagementNos(items: PurchaseItem[]): string[] {
  return unique(
    items.flatMap((item) => {
      const parsed = parseEtc(item.etc);
      const labelNos = (item.itemLabels ?? []).map((label) => label.legacyManagementNo ?? "");
      return [parsed.managementNo, ...labelNos];
    }),
  );
}

function getSupplier(row: PurchaseRow): { name: string; url: string } {
  const firstItem = row.purchase_items[0];
  const parsed = parseEtc(firstItem?.etc);
  return {
    name: row.csvSupplierName?.trim() || parsed.supplierSite || "-",
    url: row.csvSupplierUrl?.trim() || "",
  };
}

function isReceived(row: PurchaseRow): boolean {
  return row.status === "purchased" || row.purchase_items.some((item) => item.status === "purchased");
}

function matchesStatus(row: PurchaseRow, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "received") return isReceived(row);
  return !isReceived(row);
}

function buildSearchText(row: PurchaseRow): string {
  const labels = getItemLabels(row.purchase_items).map((label) => label.labelId);
  const managementNos = getManagementNos(row.purchase_items);
  const supplier = getSupplier(row);
  return [
    row.num ?? "",
    supplier.name,
    supplier.url,
    ...labels,
    ...managementNos,
    ...row.purchase_items.flatMap((item) => [item.title, item.category ?? "", item.etc ?? ""]),
  ]
    .join("\n")
    .toLowerCase();
}

function statusLabel(row: PurchaseRow): string {
  return isReceived(row) ? "入庫済み" : "発注済み / 未入庫";
}

function statusClass(row: PurchaseRow): string {
  return isReceived(row)
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

function PurchaseRegistrationCard({ row }: { row: PurchaseRow }) {
  const labels = getItemLabels(row.purchase_items);
  const managementNos = getManagementNos(row.purchase_items);
  const supplier = getSupplier(row);
  const totalQuantity = sumQuantity(row.purchase_items);
  const firstItem = row.purchase_items[0];
  const displayItems = row.purchase_items.slice(0, 4);
  const hiddenItemCount = Math.max(0, row.purchase_items.length - displayItems.length);
  const unitPrice = firstItem?.unit_price;

  return (
    <section className="rounded-lg border bg-background shadow-sm">
      <div className="flex flex-col gap-4 border-b p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {labels.length > 0 ? (
              labels.slice(0, 8).map((label) => (
                <span
                  key={label.labelId}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-lg font-semibold tracking-wide text-emerald-800"
                >
                  {label.labelId}
                </span>
              ))
            ) : (
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm font-medium text-slate-600">
                個体ID未発行
              </span>
            )}
            {labels.length > 8 ? (
              <Badge variant="outline">他{labels.length - 8}件</Badge>
            ) : null}
            <Badge variant="outline" className={statusClass(row)}>
              {statusLabel(row)}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>旧管理番号: {managementNos.length > 0 ? managementNos.join(" / ") : "-"}</span>
            <span>発注No: {row.num || "-"}</span>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" className="w-fit gap-2">
          <Printer className="h-4 w-4" />
          ラベル印刷
        </Button>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-2">
          <div className="text-xs text-muted-foreground">商品名</div>
          <div className="mt-1 space-y-1">
            {displayItems.map((item) => (
              <div key={`${row.id}-${item.id}`} className="truncate text-sm font-medium">
                {item.title || "-"}
              </div>
            ))}
            {hiddenItemCount > 0 ? (
              <div className="text-xs text-muted-foreground">他{hiddenItemCount}件</div>
            ) : null}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">数量</div>
          <div className="mt-1 text-sm font-semibold">{totalQuantity.toLocaleString()}個</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">仕入単価</div>
          <div className="mt-1 text-sm font-semibold">{formatCurrency(unitPrice)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">発注日</div>
          <div className="mt-1 flex items-center gap-1 text-sm font-medium">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {formatDate(row.purchase_date ?? firstItem?.estimated_purchase_date)}
          </div>
        </div>
        <div className="min-w-0 md:col-span-2 xl:col-span-5">
          <div className="text-xs text-muted-foreground">仕入先</div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="truncate font-medium">{supplier.name}</span>
            {supplier.url ? (
              <a
                href={supplier.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                開く
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {labels.length > 0 ? (
        <details className="border-t px-4 py-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">個体ID一覧</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {labels.map((label) => (
              <div key={`${label.id ?? label.labelId}-${label.labelId}`} className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="font-mono text-base font-semibold text-emerald-800">{label.labelId}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {label.status || "-"}
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

export default function PurchaseRegistration() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const normalizedSearch = search.trim();

  const queryInput = useMemo(
    () => ({
      page: 1,
      pageSize: 100,
      category: null,
      status: null,
      search: normalizedSearch || null,
      inboundClass: null,
    }),
    [normalizedSearch],
  );

  const { data, isLoading, isFetching, refetch } = trpc.inventory.zaico.getPurchasesWithCategoryPage.useQuery(queryInput, {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const rows = (data?.items ?? []) as PurchaseRow[];
  const searchText = normalizedSearch.toLowerCase();

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!matchesStatus(row, statusFilter)) return false;
      if (!searchText) return true;
      return buildSearchText(row).includes(searchText);
    });
  }, [rows, searchText, statusFilter]);

  const counts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.all += 1;
        if (isReceived(row)) acc.received += 1;
        else acc.ordered += 1;
        acc.labels += getItemLabels(row.purchase_items).length;
        acc.quantity += sumQuantity(row.purchase_items);
        return acc;
      },
      { all: 0, ordered: 0, received: 0, labels: 0, quantity: 0 },
    );
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">発注登録</h1>
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge variant="outline" className="gap-1">
              <PackagePlus className="h-3 w-3" />
              仕入れ {counts.all.toLocaleString()}件
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Tag className="h-3 w-3" />
              個体ID {counts.labels.toLocaleString()}件
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Boxes className="h-3 w-3" />
              数量 {counts.quantity.toLocaleString()}個
            </Badge>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={() => refetch()} disabled={isFetching} className="w-fit gap-2">
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          更新
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-background p-4 md:flex-row md:items-center md:justify-between">
        <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">すべて {counts.all}</TabsTrigger>
            <TabsTrigger value="ordered">未入庫 {counts.ordered}</TabsTrigger>
            <TabsTrigger value="received">入庫済み {counts.received}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full md:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="商品名・個体ID・旧管理番号で検索"
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex min-h-[220px] items-center justify-center rounded-lg border bg-background text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          読み込み中
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border bg-background text-muted-foreground">
          <PackageCheck className="mb-2 h-6 w-6" />
          表示できる発注登録がありません
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRows.map((row) => (
            <PurchaseRegistrationCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
