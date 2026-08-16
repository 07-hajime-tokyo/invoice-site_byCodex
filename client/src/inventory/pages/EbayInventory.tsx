import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  Minus,
  PackageCheck,
  PackageMinus,
  PackageSearch,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Save,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import { EbayListingUrlEditor, EbayOrderStatusEditor } from "@/inventory/components/EbayListingUrlEditor";
import {
  extractManagementNo,
  getEbayOrderStatusLabel,
  getEbayStockType,
  getEbayStockTypeLabel,
  isEbayManagementNo,
  normalizeEbayOrderStatus,
  type EbayOrderStatus,
  type EbayStockType,
} from "@shared/ebayInventory";

const NINJA_MASTER_URL =
  "https://docs.google.com/spreadsheets/d/1xfiDJnNqnc12N-jJDGZavEEzsi-j_BCBxXHzZwzsaHo/edit?gid=1727357177#gid=1727357177";
const YAHOO_AUCTION_SALES_URL = "https://salesmanagement.yahoo.co.jp/list";

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
  ebayOrderUrl?: string | null;
  ebayOrderStatus?: EbayOrderStatus | string | null;
  last_purchase_date?: string | null;
  updated_at?: string | null;
};

type EbayInventoryItem = InventoryItem & {
  managementNo: string;
  ebayStockType: EbayStockType | null;
};

type ShaftSale = {
  id: number;
  inventoryId?: number | null;
  managementNo: string;
  title: string;
  category?: string | null;
  quantity: number;
  unitPrice?: string | number | null;
  saleAmount: string | number;
  saleUrl?: string | null;
  profitAmount?: string | number | null;
  soldAt?: string | null;
  supplierName?: string | null;
  supplierUrl?: string | null;
  updatedAt?: string | null;
};

type EditForm = {
  title: string;
  quantity: string;
  unit: string;
  category: string;
  unitPrice: string;
  place: string;
  managementNo: string;
  supplierName: string;
  supplierUrl: string;
  ebayListingUrl: string;
  ebayOrderUrl: string;
  ebayOrderStatus: EbayOrderStatus;
};

const stockTypeOptions: Array<{ value: EbayStockType; label: string }> = [
  { value: "stocked", label: "有在庫" },
  { value: "dropship", label: "無在庫" },
  { value: "shaft", label: "シャフト" },
];

type ShaftSalesSort = "soldAtDesc" | "saleAmountDesc" | "saleAmountAsc";

function formatYen(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  const rounded = Math.round(value);
  if (rounded < 0) return `-¥${Math.abs(rounded).toLocaleString()}`;
  return `¥${rounded.toLocaleString()}`;
}

function numberFromValue(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const num = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

function amountInputText(value: number | null | undefined) {
  if (value == null || value === 0) return "";
  return String(Math.round(value));
}

function stockQuantity(item: InventoryItem) {
  return Math.max(0, Math.floor(Number(item.quantity) || 0));
}

function compareShaftSalesByDateDesc(a: ShaftSale, b: ShaftSale) {
  const dateA = a.soldAt?.slice(0, 10) ?? "";
  const dateB = b.soldAt?.slice(0, 10) ?? "";
  const dateDiff = dateB.localeCompare(dateA);
  if (dateDiff !== 0) return dateDiff;
  return b.id - a.id;
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

function stockTypeBadgeClass(type: EbayStockType) {
  if (type === "shaft") return "bg-zinc-700 text-white";
  if (type === "stocked") return "bg-emerald-600 text-white";
  return "bg-sky-600 text-white";
}

function orderStatusBadgeClass(status: string | null | undefined) {
  const normalized = normalizeEbayOrderStatus(status);
  if (normalized === "cancelled") return "border-red-200 bg-red-50 text-red-700";
  if (normalized === "returned") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-muted bg-muted/40 text-muted-foreground";
}

export default function EbayInventory() {
  const utils = trpc.useUtils();
  const [stockType, setStockType] = useState<EbayStockType>("stocked");
  const [query, setQuery] = useState("");
  const [deliveryTarget, setDeliveryTarget] = useState<EbayInventoryItem | null>(null);
  const [deliveryQty, setDeliveryQty] = useState(1);
  const [deliveryNo, setDeliveryNo] = useState("");
  const [editTarget, setEditTarget] = useState<EbayInventoryItem | null>(null);
  const [isShaftSalesOpen, setIsShaftSalesOpen] = useState(false);
  const [shaftSalesSort, setShaftSalesSort] = useState<ShaftSalesSort>("soldAtDesc");
  const [shaftSaleInputs, setShaftSaleInputs] = useState<Record<number, string>>({});
  const [shaftSaleUrlInputs, setShaftSaleUrlInputs] = useState<Record<number, string>>({});
  const [shaftSaleTitleInputs, setShaftSaleTitleInputs] = useState<Record<number, string>>({});
  const [shaftSaleRowInputs, setShaftSaleRowInputs] = useState<Record<number, string>>({});
  const [shaftSaleRowTitleInputs, setShaftSaleRowTitleInputs] = useState<Record<number, string>>({});
  const [shaftSaleRowUrlInputs, setShaftSaleRowUrlInputs] = useState<Record<number, string>>({});
  const [shaftSaleDateInputs, setShaftSaleDateInputs] = useState<Record<number, string>>({});
  const [editingShaftInventoryId, setEditingShaftInventoryId] = useState<number | null>(null);
  const [editingShaftSaleId, setEditingShaftSaleId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    title: "",
    quantity: "0",
    unit: "個",
    category: "",
    unitPrice: "",
    place: "",
    managementNo: "",
    supplierName: "",
    supplierUrl: "",
    ebayListingUrl: "",
    ebayOrderUrl: "",
    ebayOrderStatus: "normal",
  });

  const { data, isLoading, refetch, isFetching } = trpc.inventory.zaico.getInventories.useQuery();
  const shaftSalesQuery = trpc.inventory.zaico.getShaftSales.useQuery(undefined, { enabled: stockType === "shaft" });
  const createDeliveryMutation = trpc.inventory.zaico.createDelivery.useMutation();
  const updateInventoryMutation = trpc.inventory.zaico.updateInventory.useMutation();
  const createOrderedPurchaseMutation = trpc.inventory.zaico.createOrderedPurchase.useMutation();
  const deleteInventoryMutation = trpc.inventory.zaico.deleteInventory.useMutation();
  const upsertShaftSaleMutation = trpc.inventory.zaico.upsertShaftSale.useMutation();
  const updateShaftSaleDateMutation = trpc.inventory.zaico.updateShaftSaleDate.useMutation();

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
    const result: Record<EbayStockType, number> = { stocked: 0, dropship: 0, shaft: 0 };
    for (const item of (data ?? []) as InventoryItem[]) {
      const type = getEbayStockType(item.etc);
      if (type) result[type] += 1;
    }
    return result;
  }, [data]);

  const totalQuantity = items.reduce((sum, item) => sum + stockQuantity(item), 0);
  const shaftSales = ((shaftSalesQuery.data ?? []) as unknown as ShaftSale[]);
  const sortedShaftSales = useMemo(() => {
    const sorted = [...shaftSales];
    sorted.sort((a, b) => {
      if (shaftSalesSort === "saleAmountDesc" || shaftSalesSort === "saleAmountAsc") {
        const amountA = numberFromValue(a.saleAmount) ?? 0;
        const amountB = numberFromValue(b.saleAmount) ?? 0;
        const amountDiff = shaftSalesSort === "saleAmountDesc" ? amountB - amountA : amountA - amountB;
        if (amountDiff !== 0) return amountDiff;
      }
      return compareShaftSalesByDateDesc(a, b);
    });
    return sorted;
  }, [shaftSales, shaftSalesSort]);
  const shaftSaleMap = useMemo(() => {
    const map = new Map<string, ShaftSale>();
    for (const sale of shaftSales) {
      if (sale.inventoryId != null) map.set(`id:${sale.inventoryId}`, sale);
      map.set(`no:${sale.managementNo}`, sale);
    }
    return map;
  }, [shaftSales]);
  const shaftSummary = useMemo(() => {
    return shaftSales.reduce((summary, sale) => {
      const saleAmount = numberFromValue(sale.saleAmount) ?? 0;
      return {
        count: summary.count + 1,
        saleAmount: summary.saleAmount + saleAmount,
      };
    }, { count: 0, saleAmount: 0 });
  }, [shaftSales]);

  function getShaftSale(item: EbayInventoryItem) {
    return shaftSaleMap.get(`id:${item.id}`) ?? shaftSaleMap.get(`no:${item.managementNo}`) ?? null;
  }

  function getShaftSaleInput(item: EbayInventoryItem) {
    const draft = shaftSaleInputs[item.id];
    if (draft !== undefined) return draft;
    const existing = getShaftSale(item);
    const amount = numberFromValue(existing?.saleAmount);
    return amount == null || amount === 0 ? "" : String(Math.round(amount));
  }

  function getShaftSaleDateInput(sale: ShaftSale) {
    const draft = shaftSaleDateInputs[sale.id];
    if (draft !== undefined) return draft;
    return sale.soldAt?.slice(0, 10) ?? "";
  }

  function getShaftSaleUrlInput(item: EbayInventoryItem) {
    const draft = shaftSaleUrlInputs[item.id];
    if (draft !== undefined) return draft;
    return getShaftSale(item)?.saleUrl ?? "";
  }

  function getShaftSaleTitleInput(item: EbayInventoryItem) {
    const draft = shaftSaleTitleInputs[item.id];
    if (draft !== undefined) return draft;
    return getShaftSale(item)?.title ?? item.title;
  }

  function getShaftSaleRowUrlInput(sale: ShaftSale) {
    const draft = shaftSaleRowUrlInputs[sale.id];
    if (draft !== undefined) return draft;
    return sale.saleUrl ?? "";
  }

  function getShaftSaleRowTitleInput(sale: ShaftSale) {
    const draft = shaftSaleRowTitleInputs[sale.id];
    if (draft !== undefined) return draft;
    return sale.title;
  }

  function getShaftSaleRowInput(sale: ShaftSale) {
    const draft = shaftSaleRowInputs[sale.id];
    if (draft !== undefined) return draft;
    const amount = numberFromValue(sale.saleAmount) ?? 0;
    return amountInputText(amount);
  }

  async function handleShaftSaleSave(item: EbayInventoryItem) {
    const raw = getShaftSaleInput(item).replace(/,/g, "").trim();
    const saleAmount = raw ? Number(raw) : 0;
    if (!Number.isFinite(saleAmount)) {
      toast.error("売上は数字で入力してください");
      return;
    }
    const unitPrice = item.purchase_unit_price ?? item.unit_price ?? null;
    const quantity = Math.max(1, stockQuantity(item));
    const existingProfit = numberFromValue(getShaftSale(item)?.profitAmount);
    const saleUrl = getShaftSaleUrlInput(item).trim();
    const title = getShaftSaleTitleInput(item).trim();
    if (!title) {
      toast.error("商品名を入力してください");
      return;
    }
    try {
      await upsertShaftSaleMutation.mutateAsync({
        inventoryId: item.id,
        managementNo: item.managementNo,
        title,
        category: item.category ?? item.categories?.[0] ?? null,
        quantity,
        unitPrice,
        saleAmount,
        saleUrl: saleUrl || null,
        profitAmount: existingProfit,
        soldAt: todayJst(),
        supplierName: item.supplierName ?? null,
        supplierUrl: item.supplierUrl ?? null,
        snapshot: {
          inventoryId: item.id,
          title,
          quantity: item.quantity,
          unit: item.unit,
          category: item.category ?? item.categories?.[0] ?? null,
          unitPrice,
          managementNo: item.managementNo,
          supplierName: item.supplierName ?? null,
          supplierUrl: item.supplierUrl ?? null,
        },
      });
      toast.success("シャフト売上を保存しました");
      setShaftSaleInputs((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setShaftSaleUrlInputs((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setShaftSaleTitleInputs((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setEditingShaftInventoryId(null);
      await shaftSalesQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "売上の保存に失敗しました");
    }
  }

  async function handleShaftSaleRowSave(sale: ShaftSale) {
    const raw = getShaftSaleRowInput(sale).replace(/,/g, "").trim();
    const saleAmount = raw ? Number(raw) : 0;
    if (!Number.isFinite(saleAmount)) {
      toast.error("売上は数字で入力してください");
      return;
    }
    const title = getShaftSaleRowTitleInput(sale).trim();
    if (!title) {
      toast.error("商品名を入力してください");
      return;
    }
    try {
      const saleUrl = getShaftSaleRowUrlInput(sale).trim();
      await upsertShaftSaleMutation.mutateAsync({
        inventoryId: sale.inventoryId ?? null,
        managementNo: sale.managementNo,
        title,
        category: sale.category ?? null,
        quantity: Math.max(1, Math.floor(Number(sale.quantity) || 1)),
        unitPrice: numberFromValue(sale.unitPrice),
        saleAmount,
        saleUrl: saleUrl || null,
        profitAmount: numberFromValue(sale.profitAmount),
        soldAt: sale.soldAt?.slice(0, 10) ?? todayJst(),
        supplierName: sale.supplierName ?? null,
        supplierUrl: sale.supplierUrl ?? null,
      });
      toast.success("シャフト売上を保存しました");
      setShaftSaleRowInputs((current) => {
        const next = { ...current };
        delete next[sale.id];
        return next;
      });
      setShaftSaleRowUrlInputs((current) => {
        const next = { ...current };
        delete next[sale.id];
        return next;
      });
      setShaftSaleRowTitleInputs((current) => {
        const next = { ...current };
        delete next[sale.id];
        return next;
      });
      setEditingShaftSaleId(null);
      await shaftSalesQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "売上の保存に失敗しました");
    }
  }

  async function handleShaftSaleDateSave(sale: ShaftSale) {
    const soldAt = getShaftSaleDateInput(sale).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(soldAt)) {
      toast.error("売上日はYYYY-MM-DD形式で入力してください");
      return;
    }
    try {
      await updateShaftSaleDateMutation.mutateAsync({ id: sale.id, soldAt });
      toast.success("売上日を保存しました");
      setShaftSaleDateInputs((current) => {
        const next = { ...current };
        delete next[sale.id];
        return next;
      });
      await shaftSalesQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "売上日の保存に失敗しました");
    }
  }

  async function refreshAfterInventoryChange() {
    await Promise.all([
      refetch(),
      utils.inventory.zaico.getInventories.invalidate(),
      utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
      utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
    ]);
    if (stockType === "shaft") {
      await shaftSalesQuery.refetch();
    }
  }

  async function handleMarkOrdered(item: EbayInventoryItem) {
    const quantity = Math.max(1, stockQuantity(item));
    const unitPrice = item.purchase_unit_price ?? item.unit_price ?? undefined;
    try {
      await createOrderedPurchaseMutation.mutateAsync({
        inventoryId: item.id,
        title: item.title,
        quantity,
        unitPrice: unitPrice ?? undefined,
        customerName: item.supplierName ?? undefined,
        supplierName: item.supplierName ?? undefined,
        supplierUrl: item.supplierUrl ?? undefined,
        num: item.managementNo || undefined,
        managementNo: item.managementNo || undefined,
      });
      toast.success("発注済みとして登録しました");
      await refreshAfterInventoryChange();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "発注済み登録に失敗しました");
    }
  }

  async function handleDeleteInventory(item: EbayInventoryItem) {
    const ok = window.confirm(`「${item.title}」を削除しますか？`);
    if (!ok) return;
    try {
      await deleteInventoryMutation.mutateAsync({ inventoryId: item.id });
      toast.success("在庫を削除しました");
      await refreshAfterInventoryChange();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "削除に失敗しました");
    }
  }

  function openEditDialog(item: EbayInventoryItem) {
    setEditTarget(item);
    setEditForm({
      title: item.title,
      quantity: String(stockQuantity(item)),
      unit: item.unit || "個",
      category: item.category ?? item.categories?.[0] ?? "",
      unitPrice: item.purchase_unit_price != null ? String(item.purchase_unit_price) : item.unit_price != null ? String(item.unit_price) : "",
      place: item.place ?? "",
      managementNo: item.managementNo,
      supplierName: item.supplierName ?? "",
      supplierUrl: item.supplierUrl ?? "",
      ebayListingUrl: item.ebayListingUrl ?? "",
      ebayOrderUrl: item.ebayOrderUrl ?? "",
      ebayOrderStatus: normalizeEbayOrderStatus(item.ebayOrderStatus),
    });
  }

  async function handleEditSave() {
    if (!editTarget) return;
    if (!editForm.title.trim()) {
      toast.error("商品名を入力してください");
      return;
    }
    const price = editForm.unitPrice.trim() ? Number(editForm.unitPrice.replace(/,/g, "")) : undefined;
    if (price !== undefined && !Number.isFinite(price)) {
      toast.error("仕入単価は数字で入力してください");
      return;
    }
    try {
      await updateInventoryMutation.mutateAsync({
        inventoryId: editTarget.id,
        title: editForm.title.trim(),
        quantity: editForm.quantity.trim() || "0",
        unit: editForm.unit.trim() || "個",
        category: editForm.category.trim() || undefined,
        place: editForm.place.trim() || undefined,
        etc: editForm.managementNo.trim() || undefined,
        purchase_unit_price: price,
        supplierName: editForm.supplierName.trim() || undefined,
        supplierUrl: editForm.supplierUrl.trim() || undefined,
        ebayListingUrl: getEbayStockType(editForm.managementNo) === "stocked" ? (editForm.ebayListingUrl.trim() || null) : undefined,
        ebayOrderUrl: isEbayManagementNo(editForm.managementNo) ? (editForm.ebayOrderUrl.trim() || null) : undefined,
        ebayOrderStatus: isEbayManagementNo(editForm.managementNo) ? editForm.ebayOrderStatus : undefined,
      });
      toast.success("在庫情報を更新しました");
      setEditTarget(null);
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存に失敗しました");
    }
  }

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
        operatorName: getCurrentWorkWorkerName("野田"),
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

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">eBay在庫</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            E0618形式は有在庫、その他のE始まりは無在庫、シャフト始まりはシャフトに表示します。
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          更新
        </Button>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <a
            href={NINJA_MASTER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-2 font-semibold text-foreground transition-colors hover:text-primary"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
            <span>忍者マスターファイル</span>
          </a>
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
          <p className="text-2xl font-semibold">{getEbayStockTypeLabel(stockType)}</p>
        </div>
      </div>

      {stockType === "shaft" && (
        <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 font-semibold">
                <TrendingUp className="h-4 w-4 text-emerald-700" />
                シャフト売上一覧
                <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs font-normal">
                  <a href={YAHOO_AUCTION_SALES_URL} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    ヤフオク売上金管理
                  </a>
                </Button>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">在庫カードを削除しても、ここに保存した売上は残ります。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">並び順</Label>
                <Select value={shaftSalesSort} onValueChange={(value) => setShaftSalesSort(value as ShaftSalesSort)}>
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="soldAtDesc">売上日 新しい順</SelectItem>
                    <SelectItem value="saleAmountDesc">売上額 大きい順</SelectItem>
                    <SelectItem value="saleAmountAsc">売上額 小さい順</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsShaftSalesOpen((open) => !open)}
                aria-expanded={isShaftSalesOpen}
              >
                {isShaftSalesOpen ? (
                  <ChevronDown className="mr-2 h-4 w-4" />
                ) : (
                  <ChevronRight className="mr-2 h-4 w-4" />
                )}
                {isShaftSalesOpen ? "売上一覧を閉じる" : "売上一覧を開く"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => shaftSalesQuery.refetch()} disabled={shaftSalesQuery.isFetching}>
                <RefreshCw className={`mr-2 h-4 w-4 ${shaftSalesQuery.isFetching ? "animate-spin" : ""}`} />
                売上一覧を更新
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">売上件数</p>
              <p className="text-lg font-semibold">{shaftSummary.count}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">売上合計</p>
              <p className="text-lg font-semibold">{formatYen(shaftSummary.saleAmount)}</p>
            </div>
          </div>

          {isShaftSalesOpen && (
            shaftSalesQuery.isLoading ? (
            <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">売上一覧を読み込み中...</div>
          ) : shaftSales.length === 0 ? (
            <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">まだ売上登録はありません。</div>
          ) : (
            <div className="max-h-80 overflow-auto rounded-md border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="sticky top-0 bg-muted/40">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">売上日</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">管理番号</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">商品名</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">売上</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">編集</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedShaftSales.map((sale) => {
                    const saleAmount = numberFromValue(sale.saleAmount) ?? 0;
                    const saleInput = getShaftSaleRowInput(sale);
                    const isEditingSale = editingShaftSaleId === sale.id;
                    const soldAtInput = getShaftSaleDateInput(sale);
                    const saleUrlInput = getShaftSaleRowUrlInput(sale);
                    const saleTitleInput = getShaftSaleRowTitleInput(sale);
                    return (
                      <tr key={sale.id} className="border-b last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="date"
                              value={soldAtInput}
                              onChange={(event) => setShaftSaleDateInputs((current) => ({ ...current, [sale.id]: event.target.value }))}
                              className="h-8 w-36 text-xs"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleShaftSaleDateSave(sale)}
                              disabled={updateShaftSaleDateMutation.isPending || soldAtInput === (sale.soldAt?.slice(0, 10) ?? "")}
                              title="売上日を保存"
                            >
                              <Save className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{sale.managementNo}</td>
                        <td className="px-3 py-2">
                          <div className="flex min-w-[220px] flex-wrap items-center gap-2">
                            <span>{sale.title}</span>
                            {sale.saleUrl && (
                              <a
                                href={sale.saleUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" />
                                URL
                              </a>
                            )}
                          </div>
                          {isEditingSale && (
                            <div className="mt-2 space-y-2">
                              <div className="space-y-1">
                                <Label htmlFor={`shaft-sale-title-${sale.id}`} className="text-[11px] text-muted-foreground">
                                  商品名
                                </Label>
                                <Input
                                  id={`shaft-sale-title-${sale.id}`}
                                  value={saleTitleInput}
                                  onChange={(event) => setShaftSaleRowTitleInputs((current) => ({ ...current, [sale.id]: event.target.value }))}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") handleShaftSaleRowSave(sale);
                                  }}
                                  className="h-8 min-w-[260px] text-xs"
                                />
                              </div>
                              <div className="space-y-1">
                              <Label htmlFor={`shaft-sale-url-${sale.id}`} className="text-[11px] text-muted-foreground">
                                売上URL
                              </Label>
                              <Input
                                id={`shaft-sale-url-${sale.id}`}
                                value={saleUrlInput}
                                onChange={(event) => setShaftSaleRowUrlInputs((current) => ({ ...current, [sale.id]: event.target.value }))}
                                placeholder="https://..."
                                className="h-8 min-w-[260px] text-xs"
                              />
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isEditingSale ? (
                            <Input
                              inputMode="numeric"
                              value={saleInput}
                              onChange={(event) => setShaftSaleRowInputs((current) => ({ ...current, [sale.id]: event.target.value }))}
                              onFocus={(event) => event.currentTarget.select()}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") handleShaftSaleRowSave(sale);
                              }}
                              className={`ml-auto h-8 w-28 text-right font-semibold ${saleAmount < 0 ? "text-red-600" : ""}`}
                            />
                          ) : (
                            <span className={`font-semibold ${saleAmount < 0 ? "text-red-600" : ""}`}>
                              {formatYen(saleAmount)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1.5">
                            {isEditingSale && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={() => {
                                  setEditingShaftSaleId(null);
                                  setShaftSaleRowInputs((current) => {
                                    const next = { ...current };
                                    delete next[sale.id];
                                    return next;
                                  });
                                  setShaftSaleRowUrlInputs((current) => {
                                    const next = { ...current };
                                    delete next[sale.id];
                                    return next;
                                  });
                                  setShaftSaleRowTitleInputs((current) => {
                                    const next = { ...current };
                                    delete next[sale.id];
                                    return next;
                                  });
                                }}
                              >
                                キャンセル
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size={isEditingSale ? "icon" : "sm"}
                              className={isEditingSale ? "h-8 w-8" : "h-8"}
                              onClick={() => {
                                if (isEditingSale) {
                                  handleShaftSaleRowSave(sale);
                                } else {
                                  setEditingShaftSaleId(sale.id);
                                  setShaftSaleRowInputs((current) => ({ ...current, [sale.id]: amountInputText(saleAmount) }));
                                  setShaftSaleRowTitleInputs((current) => ({ ...current, [sale.id]: sale.title }));
                                  setShaftSaleRowUrlInputs((current) => ({ ...current, [sale.id]: sale.saleUrl ?? "" }));
                                }
                              }}
                              disabled={upsertShaftSaleMutation.isPending}
                              title={isEditingSale ? "売上を保存" : "売上を編集"}
                            >
                              {upsertShaftSaleMutation.isPending && isEditingSale ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : isEditingSale ? (
                                <Save className="h-3.5 w-3.5" />
                              ) : (
                                <>
                                  <Pencil className="mr-1 h-3.5 w-3.5" />
                                  編集
                                </>
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )
          )}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">読み込み中...</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <PackageSearch className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
          <p className="font-medium">該当する在庫はありません</p>
          <p className="mt-1 text-sm text-muted-foreground">E始まり、またはシャフト始まりの管理番号が対象です。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const category = item.category ?? item.categories?.[0] ?? "未分類";
            const unitPrice = item.purchase_unit_price ?? item.unit_price ?? null;
            const qty = stockQuantity(item);
            const stockValue = unitPrice != null && qty > 0 ? unitPrice * qty : null;
            const purchaseDate = item.last_purchase_date?.slice(0, 10) ?? item.updated_at?.slice(0, 10) ?? "-";
            const shaftSale = stockType === "shaft" ? getShaftSale(item) : null;
            const shaftSaleInput = stockType === "shaft" ? getShaftSaleInput(item) : "";
            const shaftSaleUrlInput = stockType === "shaft" ? getShaftSaleUrlInput(item) : "";
            const shaftSaleTitleInput = stockType === "shaft" ? getShaftSaleTitleInput(item) : "";
            const shaftSaleAmount = numberFromValue(shaftSaleInput) ?? numberFromValue(shaftSale?.saleAmount);
            const isEditingShaftInventorySale = editingShaftInventoryId === item.id;
            return (
              <div key={item.id} className="overflow-hidden rounded-lg border bg-card shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                    <Checkbox checked={false} disabled className="shrink-0" />
                    <span className="text-sm font-bold">管理番号: {item.managementNo || "―"}</span>
                    {normalizeEbayOrderStatus(item.ebayOrderStatus) !== "normal" && (
                      <Badge variant="outline" className={`text-xs ${orderStatusBadgeClass(item.ebayOrderStatus)}`}>
                        {getEbayOrderStatusLabel(item.ebayOrderStatus)}
                      </Badge>
                    )}
                    {qty <= 0 && <Badge variant="outline" className="text-xs text-muted-foreground">在庫なし</Badge>}
                    {item.ebayStockType && (
                      <Badge className={`text-xs ${stockTypeBadgeClass(item.ebayStockType)}`}>
                        {getEbayStockTypeLabel(item.ebayStockType)}
                      </Badge>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleMarkOrdered(item)}
                      disabled={createOrderedPurchaseMutation.isPending}
                      className="border-amber-400 text-amber-600 hover:bg-amber-50"
                    >
                      {createOrderedPurchaseMutation.isPending ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <PackageCheck className="mr-1 h-3.5 w-3.5" />
                      )}
                      発注済登録
                    </Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground" title="在庫数変更履歴">
                      <Clock className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditDialog(item)}
                      className="border-blue-400 text-blue-600 hover:bg-blue-50"
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      編集
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={qty <= 0}
                      onClick={() => openDeliveryDialog(item)}
                      className="border-primary/40 text-primary hover:bg-primary/10"
                    >
                      <PackageMinus className="mr-1 h-3.5 w-3.5" />
                      出庫
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteInventory(item)}
                      disabled={deleteInventoryMutation.isPending}
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      title="削除"
                    >
                      {deleteInventoryMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/20">
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">商品名</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">カテゴリ</th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">仕入単価</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">入庫日</th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">在庫金額</th>
                        {stockType === "shaft" && (
                          <th className="px-4 py-2 text-right font-medium text-muted-foreground">売上</th>
                        )}
                        <th className="px-4 py-2 text-center font-medium text-muted-foreground">在庫数</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-start gap-2">
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <div className="font-medium">{item.title}</div>
                              {stockType === "shaft" && isEditingShaftInventorySale && (
                                <div className="mt-2 max-w-md space-y-1">
                                  <Label htmlFor={`shaft-inventory-sale-title-${item.id}`} className="text-[11px] text-muted-foreground">
                                    商品名
                                  </Label>
                                  <Input
                                    id={`shaft-inventory-sale-title-${item.id}`}
                                    value={shaftSaleTitleInput}
                                    onChange={(event) => setShaftSaleTitleInputs((current) => ({ ...current, [item.id]: event.target.value }))}
                                    onFocus={(event) => event.currentTarget.select()}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") handleShaftSaleSave(item);
                                    }}
                                    className="h-8 text-xs"
                                  />
                                </div>
                              )}
                              {(item.supplierName || item.supplierUrl) && (
                                <div className="mt-1 text-xs">
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
                                    <span className="text-muted-foreground">{item.supplierName}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Badge variant="outline" className="font-normal">{category}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right align-top">{formatYen(unitPrice)}</td>
                        <td className="px-4 py-3 align-top">{purchaseDate}</td>
                        <td className="px-4 py-3 text-right align-top">{formatYen(stockValue)}</td>
                        {stockType === "shaft" && (
                          <td className="px-4 py-3 align-top">
                            <div className="flex flex-wrap justify-end gap-2">
                              {isEditingShaftInventorySale ? (
                                <Input
                                  value={shaftSaleUrlInput}
                                  onChange={(event) => setShaftSaleUrlInputs((current) => ({ ...current, [item.id]: event.target.value }))}
                                  placeholder="売上URL"
                                  className="h-8 w-56 text-xs"
                                />
                              ) : shaftSale?.saleUrl ? (
                                <a
                                  href={shaftSale.saleUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 self-center text-xs text-primary hover:underline"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  URL
                                </a>
                              ) : null}
                              {isEditingShaftInventorySale ? (
                                <Input
                                  inputMode="numeric"
                                  value={shaftSaleInput}
                                  onChange={(event) => setShaftSaleInputs((current) => ({ ...current, [item.id]: event.target.value }))}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") handleShaftSaleSave(item);
                                  }}
                                  placeholder="売上"
                                  className="h-8 w-28 text-right"
                                />
                              ) : (
                                <span className={`self-center font-semibold ${shaftSaleAmount != null && shaftSaleAmount < 0 ? "text-red-600" : ""}`}>
                                  {formatYen(shaftSaleAmount)}
                                </span>
                              )}
                              {isEditingShaftInventorySale && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setEditingShaftInventoryId(null);
                                    setShaftSaleInputs((current) => {
                                      const next = { ...current };
                                      delete next[item.id];
                                      return next;
                                    });
                                    setShaftSaleUrlInputs((current) => {
                                      const next = { ...current };
                                      delete next[item.id];
                                      return next;
                                    });
                                    setShaftSaleTitleInputs((current) => {
                                      const next = { ...current };
                                      delete next[item.id];
                                      return next;
                                    });
                                  }}
                                  className="h-8"
                                >
                                  キャンセル
                                </Button>
                              )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                onClick={() => {
                                  if (isEditingShaftInventorySale) {
                                    handleShaftSaleSave(item);
                                  } else {
                                    setEditingShaftInventoryId(item.id);
                                    setShaftSaleInputs((current) => ({
                                      ...current,
                                      [item.id]: amountInputText(shaftSaleAmount ?? 0),
                                    }));
                                    setShaftSaleUrlInputs((current) => ({
                                      ...current,
                                      [item.id]: shaftSale?.saleUrl ?? "",
                                    }));
                                    setShaftSaleTitleInputs((current) => ({
                                      ...current,
                                      [item.id]: shaftSale?.title ?? item.title,
                                    }));
                                  }
                                }}
                                disabled={upsertShaftSaleMutation.isPending}
                                  className="h-8"
                                >
                                {upsertShaftSaleMutation.isPending && isEditingShaftInventorySale ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : isEditingShaftInventorySale ? (
                                  <Save className="h-3.5 w-3.5" />
                                  ) : (
                                  <>
                                    <Pencil className="mr-1 h-3.5 w-3.5" />
                                    編集
                                  </>
                                  )}
                                </Button>
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center justify-center gap-2">
                            <Button size="icon" variant="outline" className="h-7 w-7" disabled>
                              <Minus className="h-3.5 w-3.5" />
                            </Button>
                            <span className="w-8 text-center font-medium">{qty}</span>
                            <Button size="icon" variant="outline" className="h-7 w-7" disabled>
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap justify-end gap-x-5 gap-y-2 border-t bg-muted/10 px-4 py-2">
                  <EbayListingUrlEditor
                    inventoryId={item.id}
                    managementNo={item.managementNo}
                    value={item.ebayListingUrl}
                  />
                  <EbayListingUrlEditor
                    inventoryId={item.id}
                    managementNo={item.managementNo}
                    value={item.ebayOrderUrl}
                    type="order"
                  />
                  <EbayOrderStatusEditor
                    inventoryId={item.id}
                    managementNo={item.managementNo}
                    value={item.ebayOrderStatus}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              在庫情報を編集
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="ebay-edit-title">商品名</Label>
              <Input id="ebay-edit-title" value={editForm.title} onChange={(event) => setEditForm((form) => ({ ...form, title: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ebay-edit-category">カテゴリ</Label>
              <Input id="ebay-edit-category" value={editForm.category} onChange={(event) => setEditForm((form) => ({ ...form, category: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ebay-edit-price">仕入単価</Label>
              <Input id="ebay-edit-price" inputMode="decimal" value={editForm.unitPrice} onChange={(event) => setEditForm((form) => ({ ...form, unitPrice: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ebay-edit-quantity">在庫数</Label>
              <Input id="ebay-edit-quantity" inputMode="numeric" value={editForm.quantity} onChange={(event) => setEditForm((form) => ({ ...form, quantity: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ebay-edit-unit">単位</Label>
              <Input id="ebay-edit-unit" value={editForm.unit} onChange={(event) => setEditForm((form) => ({ ...form, unit: event.target.value }))} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="ebay-edit-management-no">管理番号</Label>
              <Input id="ebay-edit-management-no" value={editForm.managementNo} onChange={(event) => setEditForm((form) => ({ ...form, managementNo: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ebay-edit-supplier-name">仕入先名</Label>
              <Input id="ebay-edit-supplier-name" value={editForm.supplierName} onChange={(event) => setEditForm((form) => ({ ...form, supplierName: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ebay-edit-supplier-url">仕入先URL</Label>
              <Input id="ebay-edit-supplier-url" value={editForm.supplierUrl} onChange={(event) => setEditForm((form) => ({ ...form, supplierUrl: event.target.value }))} />
            </div>
            {isEbayManagementNo(editForm.managementNo) && (
              <>
                {getEbayStockType(editForm.managementNo) === "stocked" && (
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="ebay-edit-listing-url">自社出品ページ</Label>
                    <Input id="ebay-edit-listing-url" value={editForm.ebayListingUrl} onChange={(event) => setEditForm((form) => ({ ...form, ebayListingUrl: event.target.value }))} />
                  </div>
                )}
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="ebay-edit-order-url">Orderページ</Label>
                  <Input id="ebay-edit-order-url" value={editForm.ebayOrderUrl} onChange={(event) => setEditForm((form) => ({ ...form, ebayOrderUrl: event.target.value }))} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="ebay-edit-order-status">Order状態</Label>
                  <Select
                    value={editForm.ebayOrderStatus}
                    onValueChange={(value) => setEditForm((form) => ({ ...form, ebayOrderStatus: normalizeEbayOrderStatus(value) }))}
                  >
                    <SelectTrigger id="ebay-edit-order-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["normal", "cancelled", "returned"] as EbayOrderStatus[]).map((status) => (
                        <SelectItem key={status} value={status}>
                          {getEbayOrderStatusLabel(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={updateInventoryMutation.isPending}>
              キャンセル
            </Button>
            <Button onClick={handleEditSave} disabled={updateInventoryMutation.isPending || !editForm.title.trim()}>
              {updateInventoryMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <Button type="button" variant="outline" size="icon" onClick={() => setDeliveryQty((qty) => Math.max(1, qty - 1))}>
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
                  <Button type="button" variant="outline" size="icon" onClick={() => setDeliveryQty((qty) => Math.min(stockQuantity(deliveryTarget), qty + 1))}>
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
