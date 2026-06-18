import { useMemo, useState } from "react";
import {
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  Minus,
  PackageMinus,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { EbayListingUrlEditor } from "@/inventory/components/EbayListingUrlEditor";
import {
  extractManagementNo,
  getEbayStockType,
  type EbayStockType,
} from "@shared/ebayInventory";

const NINJA_MASTER_URL =
  "https://docs.google.com/spreadsheets/d/1xfiDJnNqnc12N-jJDGZavEEzsi-j_BCBxXHzZwzsaHo/edit?gid=1727357177#gid=1727357177";

type InventoryItem = {
  id: number;
  title: string;
  quantity: string;
  unit?: string | null;
  category?: string | null;
  categories?: string[];
  place?: string | null;
  etc?: string | null;
  unit_price?: number | null;
  purchase_unit_price?: number | null;
  supplierUrl?: string | null;
  supplierName?: string | null;
  ebayListingUrl?: string | null;
  last_purchase_date?: string | null;
  updated_at?: string | null;
};

type EbayInventoryItem = InventoryItem & {
  managementNo: string;
  ebayStockType: EbayStockType | null;
};

const stockTypeOptions: Array<{ value: EbayStockType; label: string }> = [
  { value: "stocked", label: "有在庫" },
  { value: "dropship", label: "無在庫" },
];

function formatYen(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `¥${Math.round(value).toLocaleString()}`;
}

function stockQuantity(item: InventoryItem) {
  return Math.max(0, Math.floor(Number(item.quantity) || 0));
}

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function compactDate() {
  return todayJst().replace(/-/g, "");
}

function extractNinjaCatalogCode(managementNo: string) {
  const firstPart = managementNo.split(",")[0]?.trim() ?? managementNo;
  const parts = firstPart.split("_").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.at(-1) ?? "";
  return firstPart.replace(/^E/i, "").trim();
}

export default function EbayInventory() {
  const [stockType, setStockType] = useState<EbayStockType>("stocked");
  const [query, setQuery] = useState("");
  const [deliveryTarget, setDeliveryTarget] = useState<EbayInventoryItem | null>(null);
  const [deliveryQty, setDeliveryQty] = useState(1);
  const [deliveryNo, setDeliveryNo] = useState("");

  const { data, isLoading, refetch, isFetching } = trpc.inventory.zaico.getInventories.useQuery();
  const createDeliveryMutation = trpc.inventory.zaico.createDelivery.useMutation();
  const findNinjaCatalogMutation = trpc.trade.findNinjaMasterCatalogCode.useMutation();

  const items = useMemo<EbayInventoryItem[]>(() => {
    const q = query.trim().toLowerCase();
    return ((data ?? []) as InventoryItem[])
      .map((item) => ({
        ...item,
        managementNo: extractManagementNo(item.etc),
        ebayStockType: getEbayStockType(item.etc),
      }))
      .filter((item) => item.ebayStockType === stockType)
      .filter((item) => {
        if (!q) return true;
        return (
          item.title.toLowerCase().includes(q) ||
          item.managementNo.toLowerCase().includes(q) ||
          (item.category ?? item.categories?.[0] ?? "").toLowerCase().includes(q) ||
          (item.supplierName ?? "").toLowerCase().includes(q)
        );
      });
  }, [data, query, stockType]);

  const counts = useMemo(() => {
    const result: Record<EbayStockType, number> = { stocked: 0, dropship: 0 };
    for (const item of (data ?? []) as InventoryItem[]) {
      const type = getEbayStockType(item.etc);
      if (type) result[type] += 1;
    }
    return result;
  }, [data]);

  const totalQuantity = items.reduce((sum, item) => sum + stockQuantity(item), 0);

  function openDeliveryDialog(item: EbayInventoryItem) {
    const maxQty = stockQuantity(item);
    if (maxQty <= 0) {
      toast.error("在庫数が0のため出庫できません");
      return;
    }
    setDeliveryTarget(item);
    setDeliveryQty(1);
    setDeliveryNo(`ebay${compactDate()}`);
  }

  async function handleDelivery() {
    if (!deliveryTarget) return;
    const maxQty = stockQuantity(deliveryTarget);
    const qty = Math.min(Math.max(1, Math.floor(deliveryQty || 1)), maxQty);
    const no = deliveryNo.trim();
    if (!no) {
      toast.error("出庫Noを入力してください");
      return;
    }
    try {
      await createDeliveryMutation.mutateAsync({
        deliveryNo: no,
        deliveryDate: todayJst(),
        items: [{
          inventoryId: deliveryTarget.id,
          title: deliveryTarget.title,
          quantity: qty,
        }],
      });
      toast.success(`「${deliveryTarget.title}」を出庫しました`);
      setDeliveryTarget(null);
      setDeliveryNo("");
      setDeliveryQty(1);
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "出庫登録に失敗しました");
    }
  }

  async function openNinjaCatalog(managementNo: string) {
    const code = extractNinjaCatalogCode(managementNo);
    if (!code) {
      window.open(NINJA_MASTER_URL, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const result = await findNinjaCatalogMutation.mutateAsync({ code });
      if (!result.found) {
        toast.info(`商品カタログで ${code} が見つからなかったため、マスターファイルを開きます`);
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "商品カタログを検索できませんでした");
      window.open(NINJA_MASTER_URL, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">eBay在庫</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            E始まりの管理番号を表示します。E0618形式は有在庫、それ以外は無在庫です。
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          更新
        </Button>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold">
              <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
              忍者マスターファイル
            </div>
            <a
              href={NINJA_MASTER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-sm text-primary hover:underline"
            >
              {NINJA_MASTER_URL}
            </a>
          </div>
          <Button asChild variant="outline" className="w-fit">
            <a href={NINJA_MASTER_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              開く
            </a>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 md:flex-row md:items-center md:justify-between">
        <div className="inline-flex w-fit rounded-md border bg-background p-1">
          {stockTypeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStockType(option.value)}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                stockType === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
              <span className="ml-1 opacity-80">{counts[option.value]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="商品名・管理番号・仕入先で検索"
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">表示件数</p>
          <p className="text-2xl font-semibold">{items.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">在庫数合計</p>
          <p className="text-2xl font-semibold">{totalQuantity}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">種別</p>
          <p className="text-2xl font-semibold">{stockTypeOptions.find((option) => option.value === stockType)?.label}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">読み込み中...</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <PackageSearch className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
          <p className="font-medium">該当するeBay在庫はありません</p>
          <p className="mt-1 text-sm text-muted-foreground">管理番号がE始まりの商品が対象です。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const category = item.category ?? item.categories?.[0] ?? "未分類";
            const unitPrice = item.purchase_unit_price ?? item.unit_price ?? null;
            const qty = stockQuantity(item);
            const catalogCode = extractNinjaCatalogCode(item.managementNo);
            return (
              <div key={item.id} className="overflow-hidden rounded-lg border bg-card shadow-sm">
                <div className="flex flex-col gap-3 border-b bg-muted/20 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openNinjaCatalog(item.managementNo)}
                      className="rounded border bg-background px-2 py-1 font-mono text-xs font-semibold text-primary hover:bg-primary/5"
                      title={catalogCode ? `商品カタログのCode # ${catalogCode} を開く` : "忍者マスターファイルを開く"}
                    >
                      管理番号: {item.managementNo}
                    </button>
                    <Badge className={stockType === "stocked" ? "bg-emerald-600" : "bg-sky-600"}>
                      {stockTypeOptions.find((option) => option.value === stockType)?.label}
                    </Badge>
                    <Badge variant="secondary">{category}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <EbayListingUrlEditor
                      inventoryId={item.id}
                      managementNo={item.managementNo}
                      value={item.ebayListingUrl}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openDeliveryDialog(item)}
                      disabled={qty <= 0}
                      className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
                    >
                      <PackageMinus className="mr-1.5 h-4 w-4" />
                      出庫
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-y-3 px-4 py-3 text-sm md:grid-cols-[minmax(260px,1.5fr)_120px_140px_120px_minmax(220px,1fr)] md:items-center">
                  <div className="col-span-2 md:col-span-1">
                    <div className="text-xs text-muted-foreground">商品名</div>
                    <div className="font-semibold">{item.title}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">仕入単価</div>
                    <div>{formatYen(unitPrice)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">在庫数</div>
                    <div className="font-semibold">{qty}{item.unit ?? ""}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">入庫日</div>
                    <div>{item.last_purchase_date ?? item.updated_at?.slice(0, 10) ?? "-"}</div>
                  </div>
                  <div className="col-span-2 min-w-0 md:col-span-1">
                    <div className="text-xs text-muted-foreground">仕入先</div>
                    {item.supplierUrl ? (
                      <a
                        href={item.supplierUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1 truncate text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{item.supplierName || item.supplierUrl}</span>
                      </a>
                    ) : (
                      <span>{item.supplierName || "-"}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(deliveryTarget)} onOpenChange={(open) => !open && setDeliveryTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageMinus className="h-5 w-5 text-primary" />
              出庫登録
            </DialogTitle>
          </DialogHeader>
          {deliveryTarget && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                <div className="font-semibold">{deliveryTarget.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{deliveryTarget.managementNo}</div>
              </div>

              <div className="space-y-2">
                <Label>出庫数量 <span className="text-xs font-normal text-muted-foreground">在庫: {stockQuantity(deliveryTarget)}{deliveryTarget.unit ?? ""}</span></Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setDeliveryQty((qty) => Math.max(1, qty - 1))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    max={stockQuantity(deliveryTarget)}
                    value={deliveryQty}
                    onChange={(event) => setDeliveryQty(Math.min(stockQuantity(deliveryTarget), Math.max(1, Number(event.target.value) || 1)))}
                    className="w-24 text-center"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setDeliveryQty((qty) => Math.min(stockQuantity(deliveryTarget), qty + 1))}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ebay-delivery-no">出庫No</Label>
                <Input
                  id="ebay-delivery-no"
                  value={deliveryNo}
                  onChange={(event) => setDeliveryNo(event.target.value)}
                  placeholder="例: ebay20260618"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleDelivery();
                  }}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliveryTarget(null)} disabled={createDeliveryMutation.isPending}>
              キャンセル
            </Button>
            <Button onClick={handleDelivery} disabled={createDeliveryMutation.isPending}>
              {createDeliveryMutation.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <PackageMinus className="mr-1.5 h-4 w-4" />
              )}
              出庫する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
