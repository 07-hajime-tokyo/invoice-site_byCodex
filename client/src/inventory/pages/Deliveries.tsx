import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  RefreshCw,
  PackageMinus,
  Loader2,
  Search,
  ShoppingCart,
  AlertCircle,
  Trash2,
  TrendingUp,
  X,
  Download,
  Pencil,
  Plus,
  Minus,
  PackageCheck,
  Clock,
  ExternalLink,
  XCircle,
  Info,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildSupplierDisplay } from "@/inventory/lib/supplier";
import { usePagination } from "@/inventory/hooks/usePagination";
import { PaginationBar } from "@/inventory/components/PaginationBar";
import { EbayListingUrlEditor } from "@/inventory/components/EbayListingUrlEditor";
import { getEbayStockType } from "@shared/ebayInventory";
import { suggestCsvProduct } from "@shared/productMatching";

interface InventoryItem {
  id: number;
  title: string;
  quantity: string;
  unit: string;
  category?: string;
  categories?: string[];
  place?: string;
  etc?: string;
  code?: string;
  unit_price?: number;
  purchase_unit_price?: number;
  last_purchase_date?: string | null;
  updated_at?: string;
  created_at?: string;
  supplierUrl?: string | null;
  supplierName?: string | null;
  ebayListingUrl?: string | null;
}

/** 在庫一覧CSVエクスポート */
function exportInventoryCSV(inventories: InventoryItem[]) {
  const rows: string[][] = [
    ["管理番号", "商品名", "カテゴリ", "仕入単価", "在庫数", "単位", "入庫日", "在庫金額", "保管場所"],
  ];
  for (const inv of inventories) {
    const managementNo = getManagementNo(inv.etc);
    const cat = inv.categories?.[0] ?? inv.category ?? "";
    const unitPrice = inv.purchase_unit_price ?? inv.unit_price;
    const stockQty = parseFloat(inv.quantity ?? "0");
    const stockValue = unitPrice != null && stockQty > 0 ? unitPrice * stockQty : null;
    rows.push([
      managementNo || "-",
      inv.title,
      cat,
      unitPrice != null ? String(unitPrice) : "-",
      inv.quantity ?? "0",
      inv.unit ?? "",
      inv.last_purchase_date ?? inv.updated_at?.slice(0, 10) ?? "-",
      stockValue != null ? String(stockValue) : "-",
      inv.place ?? "",
    ]);
  }
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `在庫一覧_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 入庫日または最終更新日からの経過日数を返す */
function calcDaysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/** 経過日数に応じたバッジの色を返す */
function daysBadgeClass(days: number): string {
  if (days <= 14) return "bg-green-100 text-green-800 border-green-200";
  if (days <= 30) return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (days <= 60) return "bg-orange-100 text-orange-800 border-orange-200";
  return "bg-red-100 text-red-800 border-red-200";
}

interface DeliveryItem {
  inventoryId: number;
  title: string;
  quantity: number;
  unit: string;
  checked: boolean;
  etc?: string; // 管理番号（取引先自動判別用）
  unitPrice?: number; // 仕入価格（unit_price）
  sellingPrice?: number | null; // ユーロ建て販売価格（CSVから取得）
  currency?: string; // 通貨（例: EUR）
  tradeRecordId?: number | null; // 確定した取引データ行
  csvProductName?: string | null; // 確定した注文行の商品名。nullは紐づけなし
}

function formatPrice(price: number | undefined | null): string {
  if (price === undefined || price === null || !Number.isFinite(price)) return "-";
  return `¥${price.toLocaleString()}`;
}

/** etc フィールドから管理番号を取得する（数字・在庫・ebay始まりのみ表示） */
function getManagementNo(etc: string | undefined): string {
  if (!etc) return "";
  // カンマ区切りまたはスペース区切りの先頭部分を管理番号として取得
  const firstPart = etc.split(",")[0].trim();
  const raw = firstPart.split(" ")[0].trim();
  if (/^\d/.test(raw) || /^在庫/.test(raw) || /^ebay/i.test(raw) || /^E/i.test(raw) || /^シャフト/i.test(raw)) return raw;
  return "";
}

// ============================================================
// 在庫編集フォームの型
// ============================================================
interface InventoryFormData {
  title: string;
  quantity: string;
  unit: string;
  category: string;
  place: string;
  etc: string;
  purchase_unit_price: string;
  supplierUrl: string;
  supplierName: string;
  ebayListingUrl: string;
}

const emptyForm: InventoryFormData = {
  title: "",
  quantity: "0",
  unit: "個",
  category: "",
  place: "",
  etc: "",
  purchase_unit_price: "",
  supplierUrl: "",
  supplierName: "",
  ebayListingUrl: "",
};

export default function Deliveries() {
  const [location] = useLocation();
  const utils = trpc.useUtils();
  const [loadSecondaryData, setLoadSecondaryData] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLoadSecondaryData(true), 900);
    return () => window.clearTimeout(timer);
  }, []);
  const { data: inventories, isLoading, refetch } = trpc.inventory.zaico.getInventories.useQuery();
  const createDeliveryMutation = trpc.inventory.zaico.createDelivery.useMutation();
  const deleteInventoryMutation = trpc.inventory.zaico.deleteInventory.useMutation();
  const updateInventoryMutation = trpc.inventory.zaico.updateInventory.useMutation();
  const createInventoryMutation = trpc.inventory.zaico.createInventory.useMutation();
  const createOrderedPurchaseMutation = trpc.inventory.zaico.createOrderedPurchase.useMutation();
  const addCategoryMutation = trpc.inventory.zaico.addCategory.useMutation();
  const deleteCategoryMutation = trpc.inventory.zaico.deleteCategory.useMutation();
  const { data: operators } = trpc.inventory.zaico.getOperators.useQuery();
  const { data: nextPurchaseNumData, refetch: refetchNextNum } = trpc.inventory.zaico.getNextPurchaseNum.useQuery(undefined, { enabled: false });
  const { data: currentUser } = trpc.auth.me.useQuery();
  const { data: customers } = trpc.inventory.customer.list.useQuery();
  const { data: incompleteInvoices } = trpc.inventory.orderManagement.getIncompleteInvoices.useQuery(undefined, { enabled: loadSecondaryData });
  const { data: todayTrackingNumbers } = trpc.inventory.fedex.getTodayTrackingNumbers.useQuery(undefined, { enabled: loadSecondaryData });
  const { data: csvRows } = trpc.inventory.orderManagement.getCsvData.useQuery(undefined, { enabled: loadSecondaryData });
  const { data: managedCategories } = trpc.inventory.zaico.getCategories.useQuery();

  /** 管理番号の2番目の部分（_区切り）から取引先を判別する */
  function detectCustomerFromManagementNo(etc: string | undefined): { code: string; displayName: string } | null {
    if (!etc || !customers) return null;
    const managementNo = getManagementNo(etc);
    if (!managementNo) return null;
    // 管理番号の_区切り2番目の部分を取引先名として判別
    const parts = managementNo.split("_");
    const partToMatch = parts.length >= 2 ? parts[1] : parts[0];
    for (const customer of customers) {
      const keywords = customer.keywords.split(",").map((k: string) => k.trim().toLowerCase());
      if (keywords.some((kw: string) => kw === partToMatch.toLowerCase())) {
        return { code: customer.code, displayName: customer.displayName };
      }
    }
    return null;
  }

  /** 出庫Noを自動生成する: {prefix_}{code}{YYYYMMDD} */
  function generateDeliveryNo(customerCode: string, prefix?: string): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const base = `${customerCode}${y}${m}${d}`;
    return prefix ? `${prefix}_${base}` : base;
  }

  function generateYahooAuctionDeliveryNo(): string {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `ヤフオク${m}${d}`;
  }

  function isShaftManagementNo(etc: string | undefined): boolean {
    return getManagementNo(etc).includes("シャフト");
  }

  /** 管理番号から先頭の数字部分を抽出する（例: "371_ルカ_New3DS_8/10" → "371"） */
  function extractPrefixFromManagementNo(etc: string | undefined): string | undefined {
    const managementNo = getManagementNo(etc);
    if (!managementNo) return undefined;
    const match = managementNo.match(/^(\d+)/);
    return match ? match[1] : undefined;
  }

  // 発注済み登録用state
  const [showOrderedDialog, setShowOrderedDialog] = useState(false);
  const [orderedTargetInv, setOrderedTargetInv] = useState<InventoryItem | null>(null);
  const [orderedQty, setOrderedQty] = useState("1");
  const [orderedUnitPrice, setOrderedUnitPrice] = useState("");
  const [orderedNum, setOrderedNum] = useState("");
  const [orderedDate, setOrderedDate] = useState("");
  const [orderedSupplier, setOrderedSupplier] = useState("");
  const [orderedMemo, setOrderedMemo] = useState("");
  const [isOrderedSubmitting, setIsOrderedSubmitting] = useState(false);
  const [isLoadingNextNum, setIsLoadingNextNum] = useState(false);

  // 仕入先プルダウン用
  const DEFAULT_SUPPLIERS = ["\u30a2\u30de\u30be\u30f3", "\u99ff\u6cb3\u5c4b", "\u30e1\u30eb\u30ab\u30ea", "\u30da\u30a4\u30da\u30a4\u30d5\u30ea\u30de", "\u30e4\u30d5\u30aa\u30af"];
  const [customSuppliers, setCustomSuppliers] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("zaico_custom_suppliers") ?? "[]"); } catch { return []; }
  });
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplierInput, setNewSupplierInput] = useState("");

  const allSuppliers = [...DEFAULT_SUPPLIERS, ...customSuppliers];

  function addCustomSupplier() {
    const name = newSupplierInput.trim();
    if (!name || allSuppliers.includes(name)) return;
    const updated = [...customSuppliers, name];
    setCustomSuppliers(updated);
    localStorage.setItem("zaico_custom_suppliers", JSON.stringify(updated));
    setOrderedSupplier(name);
    setNewSupplierInput("");
    setShowAddSupplier(false);
  }
  const [selectedOperatorKey, setSelectedOperatorKey] = useState<string>(
    () => typeof window !== 'undefined' ? (localStorage.getItem("zaico_operator_key") ?? "default") : "default"
  );

  function handleOperatorChange(key: string) {
    setSelectedOperatorKey(key);
    if (typeof window !== 'undefined') localStorage.setItem("zaico_operator_key", key);
  }

  // ログインユーザーに応じて操作者を自動選択
  useEffect(() => {
    if (!operators || !currentUser?.email) return;
    const matched = operators.find(
      (op) => op.email && op.email.toLowerCase() === currentUser.email!.toLowerCase()
    );
    if (matched) {
      setSelectedOperatorKey(matched.key);
      if (typeof window !== 'undefined') localStorage.setItem("zaico_operator_key", matched.key);
    }
  }, [operators, currentUser?.email]);

  const selectedOperatorName = operators?.find((o) => o.key === selectedOperatorKey)?.name ?? "野田";

  async function openOrderedDialogForInv(inv: InventoryItem) {
    setOrderedTargetInv(inv);
    setOrderedQty("1");
    setOrderedUnitPrice(inv.unit_price != null ? String(inv.unit_price) : (inv.purchase_unit_price != null ? String(inv.purchase_unit_price) : ""));
    setOrderedNum("");
    setOrderedDate("");
    setOrderedSupplier("");
    setOrderedMemo("");
    setShowAddSupplier(false);
    setNewSupplierInput("");
    setShowOrderedDialog(true);
    // 発注Noを自動取得
    setIsLoadingNextNum(true);
    try {
      const result = await refetchNextNum();
      if (result.data?.nextNum) {
        setOrderedNum(String(result.data.nextNum));
      }
    } catch {
      // 失敗しても空のままにする
    } finally {
      setIsLoadingNextNum(false);
    }
  }

  async function handleOrderedSubmit() {
    if (isOrderedSubmitting || !orderedTargetInv) return;
    const qty = parseFloat(orderedQty);
    if (!qty || qty <= 0) { toast.error("数量は1以上を入力してください"); return; }
    setIsOrderedSubmitting(true);
    try {
      const managementNo = getManagementNo(orderedTargetInv.etc);
      // 仕入先はサイト内DBに保存する
      await createOrderedPurchaseMutation.mutateAsync({
        inventoryId: orderedTargetInv.id,
        title: orderedTargetInv.title,
        quantity: qty,
        unitPrice: orderedUnitPrice ? parseFloat(orderedUnitPrice) : undefined,
        customerName: undefined,
        num: orderedNum || undefined,
        estimatedPurchaseDate: orderedDate || undefined,
        memo: orderedMemo || undefined,
        managementNo: managementNo || undefined,
        operatorKey: (selectedOperatorKey as "default" | "A" | "B"),
      });
      toast.success(`「${orderedTargetInv.title}」を発注済みとして登録しました`);
      setShowOrderedDialog(false);
      setOrderedTargetInv(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "登録に失敗しました";
      toast.error(msg);
    } finally {
      setIsOrderedSubmitting(false);
    }
  }

  const urlSearchQuery = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  }, [location]);
  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  useEffect(() => {
    if (!urlSearchQuery || urlSearchQuery === searchQuery) return;
    setSearchQuery(urlSearchQuery);
  }, [searchQuery, urlSearchQuery]);
  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    return typeof window !== 'undefined' ? (localStorage.getItem('deliveries-selectedCategory') ?? 'すべて') : 'すべて';
  });
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<string | null>(null);

  const handleSetSelectedCategory = useCallback((cat: string) => {
    setSelectedCategory(cat);
    localStorage.setItem('deliveries-selectedCategory', cat);
  }, []);
  const [deliveryItems, setDeliveryItems] = useState<Map<number, DeliveryItem>>(new Map());
  const [deliveryNo, setDeliveryNo] = useState("");
  const [bulkCustomerCode, setBulkCustomerCode] = useState(""); // まとめて出庫用取引先コード
  const [bulkInvoiceNo, setBulkInvoiceNo] = useState(""); // まとめて出庫用インボイスNo（管理番号なしの場合）
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  // 在庫削除連動発注削除用state
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);
  const [alsoDeletePurchaseIds, setAlsoDeletePurchaseIds] = useState<number[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { data: relatedPurchases, isLoading: isLoadingRelatedPurchases } = trpc.inventory.zaico.getPurchasesByInventoryId.useQuery(
    { inventoryId: deleteTarget?.id ?? 0, operatorKey: (selectedOperatorKey as "default" | "A" | "B") },
    { enabled: !!deleteTarget }
  );
  const [hideZeroStock, setHideZeroStock] = useState<boolean>(() => {
    const saved = sessionStorage.getItem("inventory_hideZeroStock");
    return saved !== null ? saved === "true" : true; // デフォルトtrue（非表示）
  });
  const [showTotals, setShowTotals] = useState(true);
  const [showDeliveryConfirm, setShowDeliveryConfirm] = useState(false);
  // 個別出庫用state
  const [singleDeliveryItem, setSingleDeliveryItem] = useState<{inv: InventoryItem; qty: number} | null>(null);
  const [singleDeliveryNo, setSingleDeliveryNo] = useState("");
  const [singleCustomerCode, setSingleCustomerCode] = useState(""); // 選択中の取引先コード
  const [singleInvoiceNo, setSingleInvoiceNo] = useState(""); // 選択中のインボイスNo（管理番号なしの場合）
  const [singleOrderLineValue, setSingleOrderLineValue] = useState("__auto__");
  const [showSingleDeliveryDialog, setShowSingleDeliveryDialog] = useState(false);
  const [isSingleSubmitting, setIsSingleSubmitting] = useState(false);
  // FedEx発送情報（出庫登録フォーム内）
  const [singleTrackingNumber, setSingleTrackingNumber] = useState("");
  type ShipmentSheetName = "独発送管理" | "サミー発送管理" | "サイモン発送管理";
  const [singleSheetName, setSingleSheetName] = useState<ShipmentSheetName>("独発送管理");
  const [bulkTrackingNumber, setBulkTrackingNumber] = useState("");
  const [bulkSheetName, setBulkSheetName] = useState<ShipmentSheetName>("独発送管理");
  const bulkInvoiceNoForOrder = useMemo(() => {
    return deliveryNo.trim().match(/^(\d+)/)?.[1] ?? bulkInvoiceNo.trim();
  }, [deliveryNo, bulkInvoiceNo]);
  const { data: bulkInvoiceProducts } = trpc.inventory.orderManagement.getInvoiceProducts.useQuery(
    { invoiceNo: bulkInvoiceNoForOrder },
    { enabled: showDeliveryConfirm && !!bulkInvoiceNoForOrder }
  );
  const singleInvoiceNoForOrder = useMemo(() => {
    return singleDeliveryNo.trim().match(/^(\d+)/)?.[1] ?? singleInvoiceNo.trim();
  }, [singleDeliveryNo, singleInvoiceNo]);
  const { data: singleInvoiceProducts } = trpc.inventory.orderManagement.getInvoiceProducts.useQuery(
    { invoiceNo: singleInvoiceNoForOrder },
    { enabled: showSingleDeliveryDialog && !!singleInvoiceNoForOrder }
  );

  function getAutoOrderLineLabel(
    title: string,
    managementNo: string | null | undefined,
    products: Array<{ productName: string; orderQty: number }>,
  ) {
    const autoProductName = suggestCsvProduct(
      title,
      managementNo ?? "",
      products.map((product) => ({ name: product.productName, qty: product.orderQty })),
    )?.name;
    return autoProductName ? `自動判定（${autoProductName}）` : "自動判定";
  }

  const singleAutoOrderLineLabel = singleDeliveryItem
    ? getAutoOrderLineLabel(
        singleDeliveryItem.inv.title,
        getManagementNo(singleDeliveryItem.inv.etc),
        singleInvoiceProducts?.products ?? [],
      )
    : "自動判定";

  // 在庫編集ダイアログ
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editForm, setEditForm] = useState<InventoryFormData>(emptyForm);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);

  // 新規登録ダイアログ
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState<InventoryFormData>(emptyForm);
  const [isCreateSubmitting, setIsCreateSubmitting] = useState(false);

  // 在庫数増減確認ダイアログ
  const [stockChangeConfirm, setStockChangeConfirm] = useState<{
    inv: InventoryItem;
    newQty: number;
    delta: number;
  } | null>(null);
  const [isStockChanging, setIsStockChanging] = useState(false);
  const [stockChangeMemo, setStockChangeMemo] = useState("");
  const createInventoryMemoMutation = trpc.inventory.inventoryMemo.create.useMutation();
  // 商品詳細トグル（インライン展開）
  const [openDetailId, setOpenDetailId] = useState<number | null>(null);
  function toggleDetailId(id: number) {
    setOpenDetailId((prev) => prev === id ? null : id);
  }
  // 詳細トグル用クエリ（展開中のアイテムのみ取得）
  const { data: detailZaico, isLoading: isDetailLoading } = trpc.inventory.zaico.getInventoryById.useQuery(
    { inventoryId: openDetailId ?? 0 },
    { enabled: openDetailId !== null }
  );
  const { data: detailMemos } = trpc.inventory.inventoryMemo.list.useQuery(
    { zaicoInventoryId: openDetailId ?? 0, limit: 50 },
    { enabled: openDetailId !== null }
  );
  // 後方互換のためのdetailItem（ダイアログ部分で使用）
  const [detailItem, setDetailItem] = useState<InventoryItem | null>(null);

  // 一括削除モード
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [bulkDeleteSelected, setBulkDeleteSelected] = useState<Set<number>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  function toggleBulkDeleteMode() {
    setBulkDeleteMode((v) => !v);
    setBulkDeleteSelected(new Set());
  }

  function toggleBulkDeleteSelect(id: number) {
    setBulkDeleteSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBulkDeleteAll() {
    const pageIds = pagedInventories.map((inv) => inv.id);
    const allPageSelected = pageIds.every((id) => bulkDeleteSelected.has(id));
    if (allPageSelected) {
      // 表示中の全商品を解除
      setBulkDeleteSelected((prev) => {
        const next = new Set(prev);
        pageIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      // 表示中の商品のみを全選択
      setBulkDeleteSelected((prev) => {
        const next = new Set(prev);
        pageIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  async function handleBulkDelete() {
    if (isBulkDeleting || bulkDeleteSelected.size === 0) return;
    setIsBulkDeleting(true);
    setShowBulkDeleteConfirm(false);
    let successCount = 0;
    let failCount = 0;
    for (const id of Array.from(bulkDeleteSelected)) {
      try {
        await deleteInventoryMutation.mutateAsync({
          inventoryId: id,
          operatorKey: (selectedOperatorKey as "default" | "A" | "B"),
        });
        successCount++;
      } catch {
        failCount++;
      }
    }
    if (successCount > 0) toast.success(`${successCount}件の在庫を削除しました`);
    if (failCount > 0) toast.error(`${failCount}件の削除に失敗しました`);
    setBulkDeleteSelected(new Set());
    setBulkDeleteMode(false);
    setIsBulkDeleting(false);
    await utils.inventory.zaico.getInventories.invalidate();
    refetch();
  }

  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) {
      toast.error("カテゴリ名を入力してください");
      return;
    }
    if (name === "すべて" || name === "未分類") {
      toast.error("このカテゴリ名は使用できません");
      return;
    }
    try {
      await addCategoryMutation.mutateAsync({ name });
      setNewCategoryName("");
      await utils.inventory.zaico.getCategories.invalidate();
      toast.success(`「${name}」を追加しました`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "カテゴリの追加に失敗しました";
      toast.error(msg);
    }
  }

  async function handleDeleteCategory() {
    if (!categoryDeleteTarget) return;
    const name = categoryDeleteTarget;
    try {
      await deleteCategoryMutation.mutateAsync({ name });
      if (selectedCategory === name) handleSetSelectedCategory("すべて");
      setCategoryDeleteTarget(null);
      await Promise.all([
        utils.inventory.zaico.getCategories.invalidate(),
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      ]);
      refetch();
      toast.success(`「${name}」を削除しました`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "カテゴリの削除に失敗しました";
      toast.error(msg);
    }
  }

  // 在庫メモ履歴ダイアログ
  const [memoHistoryItem, setMemoHistoryItem] = useState<InventoryItem | null>(null);
  const { data: memoHistoryData } = trpc.inventory.inventoryMemo.list.useQuery(
    { zaicoInventoryId: memoHistoryItem?.id ?? 0, limit: 50 },
    { enabled: !!memoHistoryItem }
  );

  // 在庫数直接入力
  const [editingStockId, setEditingStockId] = useState<number | null>(null);
  const [editingStockValue, setEditingStockValue] = useState("");

  function startEditStock(inv: InventoryItem) {
    setEditingStockId(inv.id);
    setEditingStockValue(String(Math.floor(parseFloat(inv.quantity ?? "0"))));
  }

  function commitEditStock(inv: InventoryItem) {
    const newQty = parseInt(editingStockValue, 10);
    setEditingStockId(null);
    if (isNaN(newQty) || newQty < 0) return;
    const current = Math.floor(parseFloat(inv.quantity ?? "0"));
    if (newQty === current) return;
    const delta = newQty - current;
    setStockChangeConfirm({ inv, newQty, delta });
  }

  const today = new Date().toISOString().split("T")[0];

  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    for (const cat of managedCategories ?? []) {
      if (cat && cat !== "すべて" && cat !== "未分類") cats.add(cat);
    }
    for (const inv of (inventories ?? []) as InventoryItem[]) {
      if (inv.quantity === null || inv.quantity === undefined) continue;
      const cat = (inv.categories?.[0] ?? inv.category ?? "").trim();
      if (cat && cat !== "未分類") cats.add(cat);
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b, "ja"));
  }, [inventories, managedCategories]);

  // カテゴリ一覧を集計
  const categories = useMemo(() => ["すべて", "未分類", ...categoryOptions], [categoryOptions]);

  // カテゴリ + 検索フィルター
  const filteredInventories = useMemo(() => {
    if (!inventories) return [];
    // 検索クエリのスペースを除去（「PSP2000」→「PSP 2000」もマッチ）
    const q = searchQuery.toLowerCase().replace(/\s+/g, "");
    return (inventories as InventoryItem[])
      .filter((inv) => {
        if (inv.quantity === null || inv.quantity === undefined) return false;
        if (hideZeroStock && parseFloat(inv.quantity ?? "0") <= 0) return false;
        const cat = inv.categories?.[0] ?? inv.category ?? "未分類";
        if (selectedCategory !== "すべて" && cat !== selectedCategory) return false;
        if (q) {
          const managementNo = getManagementNo(inv.etc).toLowerCase().replace(/\s+/g, "");
          return (
            inv.title.toLowerCase().replace(/\s+/g, "").includes(q) ||
            (inv.category ?? "").toLowerCase().replace(/\s+/g, "").includes(q) ||
            (inv.place ?? "").toLowerCase().replace(/\s+/g, "").includes(q) ||
            managementNo.includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const da = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
        const db = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
        return db - da;
      });
   }, [inventories, searchQuery, selectedCategory, hideZeroStock]);

  // 在庫一覧ページネーション
  const {
    page: invPage,
    setPage: setInvPage,
    totalPages: invTotalPages,
    paginatedItems: pagedInventories,
    totalItems: invTotalItems,
    startIndex: invStartIndex,
    endIndex: invEndIndex,
  } = usePagination(filteredInventories);

  // チェック済み商品
  const checkedItems = useMemo(
    () => Array.from(deliveryItems.values()).filter((item) => item.checked),
    [deliveryItems]
  );

  // まとめて出庫: checkedItemsが変わったときに共通取引先を自動判別
  useEffect(() => {
    if (!customers || checkedItems.length === 0) {
      if (checkedItems.length === 0) setBulkInvoiceNo(""); // チェック解除時にリセット
      return;
    }
    // 全チェック商品の取引先を判別し、共通する取引先が1つのみなら自動設定
    const detectedCodes = checkedItems
      .map((item) => {
        const parts = getManagementNo(item.etc).split("_");
        const partToMatch = parts.length >= 2 ? parts[1] : parts[0];
        if (!partToMatch) return null;
        for (const customer of customers) {
          const keywords = customer.keywords.split(",").map((k: string) => k.trim().toLowerCase());
          if (keywords.some((kw: string) => kw === partToMatch.toLowerCase())) return customer.code;
        }
        return null;
      })
      .filter(Boolean);
    const uniqueCodes = Array.from(new Set(detectedCodes));
    // 全商品が同じ取引先の場合のみ自動設定（ユーザーが手動変更した場合は上書きしない）
    if (uniqueCodes.length === 1 && !bulkCustomerCode) {
      const code = uniqueCodes[0] as string;
      setBulkCustomerCode(code);
      // 先頭数字（prefix）を全チェック商品から抽出（共通の場合のみ使用）
      const prefixes = checkedItems
        .map((item) => extractPrefixFromManagementNo(item.etc))
        .filter(Boolean);
      const uniquePrefixes = Array.from(new Set(prefixes));
      const prefix = uniquePrefixes.length === 1 ? uniquePrefixes[0] : undefined;
      setDeliveryNo(generateDeliveryNo(code, prefix));
    }
  }, [checkedItems, customers]); // eslint-disable-line react-hooks/exhaustive-deps

  // カテゴリ別合計金額
  const categoryTotals = useMemo(() => {
    if (!inventories) return new Map<string, number>();
    const totals = new Map<string, number>();
    for (const inv of inventories as InventoryItem[]) {
      if (inv.quantity === null || inv.quantity === undefined) continue;
      const stockQty = parseFloat(inv.quantity ?? "0");
      if (stockQty <= 0) continue;
      const price = inv.purchase_unit_price ?? inv.unit_price ?? 0;
      if (!price) continue;
      const cat = inv.categories?.[0] ?? inv.category ?? "未分類";
      totals.set(cat, (totals.get(cat) ?? 0) + price * stockQty);
    }
    return totals;
  }, [inventories]);

  const grandTotal = useMemo(() => {
    let total = 0;
    Array.from(categoryTotals.values()).forEach((v) => { total += v; });
    return total;
  }, [categoryTotals]);

  const currentCategoryTotal = useMemo(() => {
    if (selectedCategory === "すべて") return grandTotal;
    return categoryTotals.get(selectedCategory) ?? 0;
  }, [selectedCategory, categoryTotals, grandTotal]);

  /**
   * 管理番号またはインボイスNoからCSVのユーロ建て販売価格を照合する
   * @param inv 在庫アイテム
   * @param invoiceNoOverride 管理番号がない場合に使用するインボイスNo
   */
  function lookupSellingPrice(inv: InventoryItem, invoiceNoOverride?: string): { sellingPrice: number | null; currency: string } {
    if (!csvRows || csvRows.length === 0) return { sellingPrice: null, currency: "" };
    // 管理番号からインボイスNoを抽出
    const prefix = extractPrefixFromManagementNo(inv.etc);
    const targetInvoiceNo = prefix ?? invoiceNoOverride;
    if (!targetInvoiceNo) return { sellingPrice: null, currency: "" };
    // 同じインボイスNoのCSV行を絞り込み
    const invoiceRows = csvRows.filter((r) => r.invoiceNo === targetInvoiceNo);
    if (invoiceRows.length === 0) return { sellingPrice: null, currency: "" };
    // 商品名で照合（部分一致: CSVの商品名がinv.titleに含まれるか、またはその逆）
    const titleLower = inv.title.toLowerCase();
    const matched = invoiceRows.find((r) => {
      if (!r.productName) return false;
      const csvNameLower = r.productName.toLowerCase();
      return titleLower.includes(csvNameLower) || csvNameLower.includes(titleLower);
    });
    if (matched && matched.sellingPrice != null) {
      return { sellingPrice: matched.sellingPrice, currency: matched.currency };
    }
    // 部分一致で見つからない場合: 同インボイスの最初の行を使用（フォールバック）
    const first = invoiceRows.find((r) => r.sellingPrice != null);
    if (first) return { sellingPrice: first.sellingPrice, currency: first.currency };
    return { sellingPrice: null, currency: "" };
  }

  function toggleCheck(inv: InventoryItem) {
    const stockQty = parseFloat(inv.quantity ?? "0");
    if (stockQty <= 0) return;
    const { sellingPrice, currency } = lookupSellingPrice(inv, bulkInvoiceNo || undefined);
    setDeliveryItems((prev) => {
      const next = new Map(prev);
      const existing = next.get(inv.id);
      if (existing) {
        next.set(inv.id, { ...existing, checked: !existing.checked });
      } else {
        next.set(inv.id, {
          inventoryId: inv.id,
          title: inv.title,
          quantity: 1,
          unit: inv.unit,
          checked: true,
          etc: inv.etc,
          unitPrice: inv.unit_price ?? undefined,
          sellingPrice: sellingPrice,
          currency: currency || "EUR",
        });
      }
      return next;
    });
  }

  function setQuantity(invId: number, qty: number, inv: InventoryItem) {
    setDeliveryItems((prev) => {
      const next = new Map(prev);
      const existing = next.get(invId);
      if (existing) {
        next.set(invId, { ...existing, quantity: qty });
      } else {
        next.set(invId, {
          inventoryId: invId,
          title: inv.title,
          quantity: qty,
          unit: inv.unit,
          etc: inv.etc,
          checked: false,
        });
      }
      return next;
    });
  }

  function setOrderLineSelection(invId: number, value: string) {
    setDeliveryItems((prev) => {
      const next = new Map(prev);
      const existing = next.get(invId);
      if (!existing) return prev;
      if (value === "__auto__") {
        const { tradeRecordId: _tradeRecordId, csvProductName: _csvProductName, ...rest } = existing;
        next.set(invId, rest);
        return next;
      }
      if (value === "__none__") {
        next.set(invId, { ...existing, tradeRecordId: null, csvProductName: null });
        return next;
      }

      const selectedProduct = bulkInvoiceProducts?.products.find((product) => {
        const optionValue = product.tradeRecordId ? `id:${product.tradeRecordId}` : `name:${product.productName}`;
        return optionValue === value;
      });
      if (!selectedProduct) return prev;
      next.set(invId, {
        ...existing,
        tradeRecordId: selectedProduct.tradeRecordId,
        csvProductName: selectedProduct.productName,
      });
      return next;
    });
  }

  function requestStockChange(inv: InventoryItem, delta: number) {
    const current = parseFloat(inv.quantity ?? "0");
    const newQty = Math.max(0, current + delta);
    setStockChangeConfirm({ inv, newQty, delta });
  }

  async function handleStockChange() {
    if (!stockChangeConfirm || isStockChanging) return;
    setIsStockChanging(true);
    const { inv, newQty, delta } = stockChangeConfirm;
    const quantityBefore = Math.floor(parseFloat(inv.quantity ?? "0"));
    try {
      await updateInventoryMutation.mutateAsync({
        inventoryId: inv.id,
        title: inv.title,
        quantity: String(newQty),
        unit: inv.unit ?? "個",
        category: inv.categories?.[0] ?? inv.category ?? "",
        place: inv.place ?? "",
        etc: inv.etc ?? "",
        purchase_unit_price: inv.purchase_unit_price ?? undefined,
        operatorKey: (selectedOperatorKey as "default" | "A" | "B"),
      });
      // 在庫メモをDBに保存する
      const changeType = delta > 0 ? "increase" : delta < 0 ? "decrease" : "set";
      const operatorName = operators?.find((o) => o.key === selectedOperatorKey)?.name;
      await createInventoryMemoMutation.mutateAsync({
        zaicoInventoryId: inv.id,
        title: inv.title,
        changeType,
        quantityBefore,
        quantityAfter: newQty,
        quantityDelta: delta,
        memo: stockChangeMemo.trim() || undefined,
        operatorName: operatorName ?? undefined,
      });
      toast.success(`在庫数を ${quantityBefore} → ${newQty} に変更しました`);
      setStockChangeConfirm(null);
      setStockChangeMemo("");
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "在庫数の変更に失敗しました";
      toast.error(msg);
    } finally {
      setIsStockChanging(false);
    }
  }

  function openSingleDelivery(inv: InventoryItem) {
    const stockQty = parseFloat(inv.quantity ?? "0");
    if (stockQty <= 0) { toast.error("在庫がありません"); return; }
    setSingleDeliveryItem({ inv, qty: 1 });
    setSingleInvoiceNo(""); // インボイスNoをリセット
    setSingleOrderLineValue("__auto__");
    // 管理番号から取引先を自動判別
    const detected = detectCustomerFromManagementNo(inv.etc);
    const prefix = extractPrefixFromManagementNo(inv.etc);
    if (isShaftManagementNo(inv.etc)) {
      setSingleCustomerCode("");
      setSingleDeliveryNo(generateYahooAuctionDeliveryNo());
    } else if (detected) {
      setSingleCustomerCode(detected.code);
      setSingleDeliveryNo(generateDeliveryNo(detected.code, prefix));
    } else {
      setSingleCustomerCode("");
      setSingleDeliveryNo("");
    }
    setShowSingleDeliveryDialog(true);
  }

  async function handleSingleDelivery() {
    if (!singleDeliveryItem || isSingleSubmitting) return;
    if (!singleDeliveryNo.trim()) { toast.error("出庫Noを入力してください"); return; }
    if (singleDeliveryItem.qty <= 0) { toast.error("出庫数量は1以上を入力してください"); return; }
    setIsSingleSubmitting(true);
    try {
      const selectedSingleProduct = singleInvoiceProducts?.products.find((product) => {
        const optionValue = product.tradeRecordId ? `id:${product.tradeRecordId}` : `name:${product.productName}`;
        return optionValue === singleOrderLineValue;
      });
      const orderLineFields = singleOrderLineValue === "__none__"
        ? { tradeRecordId: null, csvProductName: null }
        : selectedSingleProduct
          ? { tradeRecordId: selectedSingleProduct.tradeRecordId, csvProductName: selectedSingleProduct.productName }
          : {};
      const singleResult = await createDeliveryMutation.mutateAsync({
        deliveryNo: singleDeliveryNo.trim(),
        deliveryDate: today,
        operatorName: getCurrentWorkWorkerName(selectedOperatorName),
        items: [{
          inventoryId: singleDeliveryItem.inv.id,
          title: singleDeliveryItem.inv.title,
          quantity: singleDeliveryItem.qty,
          ...orderLineFields,
        }],
        ...(singleTrackingNumber.trim() ? {
          trackingNumber: singleTrackingNumber.trim(),
          sheetName: singleSheetName,
          invoiceNo: singleDeliveryNo.trim().match(/^(\d+)/)?.[1] ?? singleDeliveryNo.trim(),
        } : {}),
      });
      if (singleTrackingNumber.trim() && singleResult.fedexResult) {
        if (singleResult.fedexResult.success) {
          toast.success(`「${singleDeliveryItem.inv.title}」を出庫し、スプシに発送情報を登録しました`);
        } else {
          toast.success(`「${singleDeliveryItem.inv.title}」を出庫しました（スプシ書き込み失敗: ${singleResult.fedexResult.message}）`);
        }
      } else {
        toast.success(`「${singleDeliveryItem.inv.title}」を出庫しました`);
      }
      setShowSingleDeliveryDialog(false);
      setSingleDeliveryItem(null);
      setSingleOrderLineValue("__auto__");
      setSingleTrackingNumber("");
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "出庫処理に失敗しました";
      toast.error(msg);
    } finally {
      setIsSingleSubmitting(false);
    }
  }

  function openDeliveryConfirm() {
    if (!deliveryNo.trim()) {
      toast.error("出庫Noを入力してください");
      return;
    }
    if (checkedItems.length === 0) {
      toast.error("出庫する商品をチェックしてください");
      return;
    }
    const invalidItems = checkedItems.filter((item) => item.quantity <= 0);
    if (invalidItems.length > 0) {
      toast.error("出庫数量は1以上を入力してください");
      return;
    }
    setShowDeliveryConfirm(true);
  }

  async function handleBulkDelivery() {
    if (isSubmitting) return;
    setShowDeliveryConfirm(false);
    setIsSubmitting(true);
    try {
      const bulkResult = await createDeliveryMutation.mutateAsync({
        deliveryNo: deliveryNo.trim(),
        deliveryDate: today,
        operatorName: getCurrentWorkWorkerName(selectedOperatorName),
        items: checkedItems.map((item) => ({
          inventoryId: item.inventoryId,
          title: item.title,
          quantity: item.quantity,
          ...(item.tradeRecordId !== undefined ? { tradeRecordId: item.tradeRecordId } : {}),
          ...(item.csvProductName !== undefined ? { csvProductName: item.csvProductName } : {}),
        })),
        ...(bulkTrackingNumber.trim() ? {
          trackingNumber: bulkTrackingNumber.trim(),
          sheetName: bulkSheetName,
          invoiceNo: deliveryNo.trim().match(/^(\d+)/)?.[1] ?? deliveryNo.trim(),
        } : {}),
      });
      if (bulkTrackingNumber.trim() && bulkResult.fedexResult) {
        if (bulkResult.fedexResult.success) {
          toast.success(`出庫No「${deliveryNo}」の出庫処理が完了し、スプシに発送情報を登録しました（${checkedItems.length}件）`);
        } else {
          toast.success(`出庫No「${deliveryNo}」の出庫処理が完了しました（${checkedItems.length}件）（スプシ書き込み失敗: ${bulkResult.fedexResult.message}）`);
        }
      } else {
        toast.success(`出庫No「${deliveryNo}」の出庫処理が完了しました（${checkedItems.length}件）`);
      }
      setDeliveryNo("");
      setDeliveryItems(new Map());
      setBulkTrackingNumber("");
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "出庫処理に失敗しました";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  function openDeleteDialog(inventoryId: number, title: string) {
    setDeleteTarget({ id: inventoryId, title });
    setAlsoDeletePurchaseIds([]);
    setShowDeleteDialog(true);
  }

  async function handleDeleteInventory() {
    if (!deleteTarget || deletingIds.has(deleteTarget.id)) return;
    const { id: inventoryId, title } = deleteTarget;
    setShowDeleteDialog(false);
    setDeletingIds((prev) => new Set(prev).add(inventoryId));
    try {
      await deleteInventoryMutation.mutateAsync({
        inventoryId,
        operatorKey: (selectedOperatorKey as "default" | "A" | "B"),
        alsoDeletePurchaseIds: alsoDeletePurchaseIds.length > 0 ? alsoDeletePurchaseIds : undefined,
      });
      const purchaseMsg = alsoDeletePurchaseIds.length > 0
        ? `（発注データ ${alsoDeletePurchaseIds.length}件も削除）`
        : "";
      toast.success(`「${title}」を削除しました${purchaseMsg}`);
      setDeliveryItems((prev) => {
        const next = new Map(prev);
        next.delete(inventoryId);
        return next;
      });
      setDeleteTarget(null);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "削除に失敗しました";
      toast.error(msg);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(inventoryId);
        return next;
      });
    }
  }

  // ============================================================
  // 在庫編集
  // ============================================================
  function openEditDialog(inv: InventoryItem) {
    setEditingItem(inv);
    setEditForm({
      title: inv.title,
      quantity: inv.quantity ?? "0",
      unit: inv.unit ?? "個",
      category: inv.categories?.[0] ?? inv.category ?? "",
      place: inv.place ?? "",
      etc: inv.etc ?? "",
      purchase_unit_price: inv.purchase_unit_price != null ? String(inv.purchase_unit_price) : "",
      supplierUrl: inv.supplierUrl ?? "",
      supplierName: inv.supplierName ?? "",
      ebayListingUrl: inv.ebayListingUrl ?? "",
    });
  }

  async function handleEditSubmit() {
    if (!editingItem || isEditSubmitting) return;
    if (!editForm.title.trim()) { toast.error("商品名を入力してください"); return; }
    setIsEditSubmitting(true);
    try {
      const priceNum = editForm.purchase_unit_price.trim() !== ""
        ? parseFloat(editForm.purchase_unit_price)
        : undefined;
      await updateInventoryMutation.mutateAsync({
        inventoryId: editingItem.id,
        title: editForm.title.trim(),
        quantity: editForm.quantity,
        unit: editForm.unit || undefined,
        category: editForm.category || undefined,
        place: editForm.place || undefined,
        etc: editForm.etc || undefined,
        purchase_unit_price: priceNum,
        operatorKey: (selectedOperatorKey as "default" | "A" | "B"),
        supplierUrl: editForm.supplierUrl || undefined,
        supplierName: editForm.supplierName || undefined,
        ebayListingUrl: getEbayStockType(editForm.etc) === "stocked" ? (editForm.ebayListingUrl || null) : undefined,
      });
      toast.success(`「${editForm.title}」を更新しました`);
      setEditingItem(null);
      await utils.inventory.zaico.getInventories.invalidate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "更新に失敗しました";
      toast.error(msg);
    } finally {
      setIsEditSubmitting(false);
    }
  }

  // ============================================================
  // 新規登録
  // ============================================================
  function openCreateDialog() {
    setCreateForm(emptyForm);
    setShowCreateDialog(true);
  }

  async function handleCreateSubmit() {
    if (isCreateSubmitting) return;
    if (!createForm.title.trim()) { toast.error("商品名を入力してください"); return; }
    setIsCreateSubmitting(true);
    try {
      const priceNum = createForm.purchase_unit_price.trim() !== ""
        ? parseFloat(createForm.purchase_unit_price)
        : undefined;
      await createInventoryMutation.mutateAsync({
        title: createForm.title.trim(),
        quantity: createForm.quantity || "0",
        unit: createForm.unit || undefined,
        category: createForm.category || undefined,
        place: createForm.place || undefined,
        etc: createForm.etc || undefined,
        purchase_unit_price: priceNum,
        operatorKey: (selectedOperatorKey as "default" | "A" | "B"),
        supplierUrl: createForm.supplierUrl || undefined,
        supplierName: createForm.supplierName || undefined,
        ebayListingUrl: getEbayStockType(createForm.etc) === "stocked" ? (createForm.ebayListingUrl || null) : undefined,
      });
      toast.success(`「${createForm.title}」を登録しました`);
      setShowCreateDialog(false);
      setCreateForm(emptyForm);
      await utils.inventory.zaico.getInventories.invalidate();
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "登録に失敗しました";
      toast.error(msg);
    } finally {
      setIsCreateSubmitting(false);
    }
  }

  if (isLoading && !inventories) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">在庫データを読み込み中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-32">
      {/* ヘッダー（スクロール固定） */}
      <div className="-mx-4 px-4 pb-2 pt-1">
      <div className="rounded-xl border bg-card shadow-sm px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">在庫一覧</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              在庫一覧 ({filteredInventories.length} 件)
              {checkedItems.length > 0 && (
                <span className="ml-2 text-primary font-medium">
                  {checkedItems.length} 件選択中
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button variant="outline" size="sm" onClick={openCreateDialog} className="border-green-500 text-green-700 hover:bg-green-50">
              <Plus className="h-4 w-4 mr-1.5" />
              新規登録
            </Button>
            <button
              onClick={toggleBulkDeleteMode}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                bulkDeleteMode
                  ? "bg-destructive text-destructive-foreground border-destructive"
                  : "bg-background text-muted-foreground border-border hover:bg-muted/50"
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="text-xs">{bulkDeleteMode ? `削除モード: ON${bulkDeleteSelected.size > 0 ? ` (${bulkDeleteSelected.size})` : ""}` : "削除モード"}</span>
            </button>
            <button
              onClick={() => setShowTotals((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                showTotals
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-muted/50"
              }`}
            >
              <span className="text-xs">{showTotals ? "合計: ON" : "合計: OFF"}</span>
            </button>
            <button
              onClick={() => setHideZeroStock((v) => {
                const next = !v;
                sessionStorage.setItem("inventory_hideZeroStock", String(next));
                return next;
              })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                !hideZeroStock
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-muted/50"
              }`}
            >
              <span className="text-xs">{hideZeroStock ? "在庫0: OFF" : "在庫0: ON"}</span>
            </button>
            <Button variant="outline" size="sm" onClick={() => exportInventoryCSV(filteredInventories)}>
              <Download className="h-4 w-4 mr-1.5" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={async () => { await utils.inventory.zaico.getInventories.invalidate(); await refetch(); }}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              更新
            </Button>
          </div>
        </div>
        {/* 検索バー */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="管理番号・商品名・カテゴリ・保管場所で検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      </div>

      {/* 合計金額サマリー */}
      {showTotals && grandTotal > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">在庫合計金額（在庫数1以上）</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {Array.from(categoryTotals.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([cat, total]) => {
                const isActive = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => handleSetSelectedCategory(isActive ? "すべて" : cat)}
                    className={`rounded-md px-3 py-2 text-left transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground ring-2 ring-primary"
                        : "bg-muted/30 hover:bg-muted/60"
                    }`}
                  >
                    <p className={`text-xs truncate ${isActive ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{cat}</p>
                    <p className={`text-sm font-semibold ${isActive ? "text-primary-foreground" : "text-foreground"}`}>¥{total.toLocaleString()}</p>
                  </button>
                );
              })}
          </div>
          <div className="mt-3 pt-3 border-t flex items-center justify-between">
            <span className="text-sm text-muted-foreground">全カテゴリ合計</span>
            <span className="text-lg font-bold text-primary">¥{grandTotal.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* カテゴリプルダウン */}
      {categories.length > 1 && (
        <div className="flex items-center gap-3">
          <Select value={selectedCategory} onValueChange={handleSetSelectedCategory}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="カテゴリーを選択" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => {
                const count = cat === "すべて"
                  ? (inventories as InventoryItem[] | undefined)?.filter(
                      (inv) => inv.quantity !== null && inv.quantity !== undefined
                    ).length ?? 0
                  : (inventories as InventoryItem[] | undefined)?.filter((inv) => {
                      if (inv.quantity === null || inv.quantity === undefined) return false;
                      const c = inv.categories?.[0] ?? inv.category ?? "未分類";
                      return c === cat;
                    }).length ?? 0;
                return (
                  <SelectItem key={cat} value={cat}>
                    {cat} ({count})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setShowCategoryDialog(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            カテゴリ管理
          </Button>
          {selectedCategory !== "すべて" && (
            <button
              onClick={() => handleSetSelectedCategory("すべて")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="h-3.5 w-3.5" />
              解除
            </button>
          )}
        </div>
      )}

      {/* 現在のカテゴリの合計（カテゴリ選択時のみ） */}
      {selectedCategory !== "すべて" && currentCategoryTotal > 0 && (
        <div className="flex items-center justify-between rounded-md bg-primary/5 border border-primary/20 px-4 py-2">
          <span className="text-sm text-muted-foreground">「{selectedCategory}」の在庫合計</span>
          <span className="text-base font-bold text-primary">¥{currentCategoryTotal.toLocaleString()}</span>
        </div>
      )}

      {/* 在庫一覧（カード形式・入庫管理と同じスタイル） */}
      {filteredInventories.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <PackageMinus className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">在庫データがありません</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
          {pagedInventories.map((inv) => {
            const item = deliveryItems.get(inv.id);
            const isChecked = item?.checked ?? false;
            const qty = item?.quantity ?? 1;
            const stockQty = parseFloat(inv.quantity ?? "0");
            const isZeroStock = stockQty <= 0;
            const displayCategory = inv.categories?.[0] ?? inv.category ?? "-";
            const unitPrice = inv.purchase_unit_price ?? inv.unit_price;
            const stockValue = unitPrice != null && stockQty > 0 ? unitPrice * stockQty : null;
            const managementNo = getManagementNo(inv.etc);

            // 経過日数の計算
            const baseDateStr = inv.last_purchase_date ?? inv.updated_at ?? null;
            const daysSince = calcDaysSince(baseDateStr);
            const isFromPurchase = !!inv.last_purchase_date;

            // 入庫日の表示用文字列
            const lastPurchaseDateDisplay = inv.last_purchase_date
              ? inv.last_purchase_date.slice(0, 10)
              : null;

            return (
              <div key={inv.id} className="rounded-lg border bg-card shadow-sm overflow-hidden">
                {/* カードヘッダー（入庫管理と同じスタイル） */}
                <div className={`flex items-center justify-between px-4 py-3 border-b ${
                  bulkDeleteMode
                    ? bulkDeleteSelected.has(inv.id) ? "bg-destructive/10" : "bg-muted/30"
                    : isChecked ? "bg-primary/10" : "bg-muted/30"
                }`}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* 削除モード時は削除選択チェックボックス、通常時は出庫チェックボックス */}
                    {bulkDeleteMode ? (
                      <Checkbox
                        checked={bulkDeleteSelected.has(inv.id)}
                        onCheckedChange={() => toggleBulkDeleteSelect(inv.id)}
                        className="flex-shrink-0 border-destructive data-[state=checked]:bg-destructive data-[state=checked]:border-destructive"
                      />
                    ) : (
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleCheck(inv)}
                        disabled={isZeroStock}
                        className="flex-shrink-0"
                      />
                    )}
                    {/* チェック済み時の出庫数量選択 */}
                    {isChecked && (
                      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setQuantity(inv.id, Math.max(1, qty - 1), inv)}
                          className="w-6 h-6 rounded border border-orange-300 flex items-center justify-center text-orange-600 hover:bg-orange-50 transition-colors font-bold text-sm"
                          title="出庫数を減らす"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={Math.floor(stockQty)}
                          value={qty}
                          onChange={(e) => {
                            const v = Math.min(Math.floor(stockQty), Math.max(1, Number(e.target.value)));
                            setQuantity(inv.id, v, inv);
                          }}
                          className="w-12 text-center text-sm font-semibold border border-orange-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white text-orange-700"
                          title="出庫数量"
                        />
                        <button
                          type="button"
                          onClick={() => setQuantity(inv.id, Math.min(Math.floor(stockQty), qty + 1), inv)}
                          className="w-6 h-6 rounded border border-orange-300 flex items-center justify-center text-orange-600 hover:bg-orange-50 transition-colors font-bold text-sm"
                          title="出庫数を増やす"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">/{Math.floor(stockQty)}{inv.unit}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {/* 管理番号（太字・左上） */}
                      <span className="font-bold text-sm">
                        管理番号: {managementNo || "―"}
                      </span>
                      {/* 経過日数バッジ */}
                      {daysSince !== null && (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${daysBadgeClass(daysSince)}`}
                          title={isFromPurchase ? `入庫日: ${inv.last_purchase_date}` : `最終更新: ${inv.updated_at?.slice(0, 10)}`}
                        >
                          {daysSince}日{!isFromPurchase && <span className="ml-0.5 opacity-60">*</span>}
                        </span>
                      )}
                      {isZeroStock && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">在庫なし</Badge>
                      )}
                    </div>
                  </div>
                  {/* 発注済みボタン */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openOrderedDialogForInv(inv)}
                    className="flex-shrink-0 text-xs border-amber-400 text-amber-600 hover:bg-amber-50 mr-1"
                  >
                    <PackageCheck className="h-3.5 w-3.5 mr-1" />
                    発注済
                  </Button>
                  {/* メモ履歴ボタン */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setMemoHistoryItem(inv)}
                    className="flex-shrink-0 text-xs text-muted-foreground hover:text-foreground mr-1"
                    title="在庫数変更履歴"
                  >
                    <Clock className="h-3.5 w-3.5" />
                  </Button>
                  {/* 編集ボタン */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEditDialog(inv)}
                    className="flex-shrink-0 text-xs border-blue-400 text-blue-600 hover:bg-blue-50 mr-1"
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    編集
                  </Button>
                  {/* 個別出庫ボタン */}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isZeroStock}
                    onClick={() => openSingleDelivery(inv)}
                    className="flex-shrink-0 text-xs border-primary/40 text-primary hover:bg-primary/10 mr-1"
                  >
                    <PackageMinus className="h-3.5 w-3.5 mr-1" />
                    出庫
                  </Button>
                  {/* 削除ボタン */}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={deletingIds.has(inv.id)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                    onClick={() => openDeleteDialog(inv.id, inv.title)}
                  >
                    {deletingIds.has(inv.id) ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>

                {/* 詳細テーブル（入庫管理の商品一覧テーブルと同じスタイル） */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm mobile-card-table">
                    <thead>
                      <tr className="border-b bg-muted/20">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">商品名</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">カテゴリ</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">仕入単価</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">入庫日</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">在庫金額</th>
                        <th className="text-center px-4 py-2 font-medium text-muted-foreground">在庫数</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="hover:bg-muted/10">
                        <td data-label="商品名" className="px-4 py-2.5">
                          <button
                            type="button"
                            className={`text-left hover:underline cursor-pointer flex items-center gap-1 ${isZeroStock ? "text-muted-foreground" : "font-medium text-foreground"}`}
                            onClick={() => toggleDetailId(inv.id)}
                            title="クリックして詳細を表示"
                          >
                            {openDetailId === inv.id
                              ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                              : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                            }
                            {inv.title}
                          </button>
                          {inv.place && (
                            <p className="text-xs text-muted-foreground mt-0.5">📍 {inv.place}</p>
                          )}
                          {/* 管理番号プレビューは編集モード時のみ表示（通常は非表示） */}
                          {(inv.supplierUrl || inv.supplierName) && (
                            <p className="text-xs mt-0.5">
                              {inv.supplierUrl ? (
                                <a
                                  href={inv.supplierUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-500 hover:text-blue-700 hover:underline inline-flex items-center gap-0.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  🔗 {buildSupplierDisplay(inv.supplierUrl, inv.supplierName)}
                                </a>
                              ) : (
                                <span className="text-muted-foreground">{buildSupplierDisplay(inv.supplierUrl, inv.supplierName)}</span>
                              )}
                            </p>
                          )}
                          {/* 商品名の下にトグル展開 */}
                          <EbayListingUrlEditor
                            inventoryId={inv.id}
                            managementNo={getManagementNo(inv.etc)}
                            value={inv.ebayListingUrl}
                            compact
                            className="mt-0.5"
                          />
                          {openDetailId === inv.id && (
                            <div className="mt-2 pt-2 border-t border-blue-100 text-xs space-y-1.5 bg-blue-50/40 rounded p-2">
                              {isDetailLoading ? (
                                <div className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />読み込み中...</div>
                              ) : (
                                <>
                                  {/* 備考欄（etc） */}
                                  {(detailZaico?.etc ?? inv.etc) && (
                                    <div>
                                      <span className="text-muted-foreground font-medium">備考: </span>
                                      <span className="text-foreground">{detailZaico?.etc ?? inv.etc}</span>
                                    </div>
                                  )}
                                  {/* optional_attributes */}
                                  {detailZaico?.optional_attributes && detailZaico.optional_attributes.length > 0 && (
                                    <div className="space-y-0.5">
                                      {detailZaico.optional_attributes.map((attr: { name: string; value: string | null }, i: number) =>
                                        attr.value ? (
                                          <div key={i}>
                                            <span className="text-muted-foreground font-medium">{attr.name}: </span>
                                            <span>{attr.value}</span>
                                          </div>
                                        ) : null
                                      )}
                                    </div>
                                  )}
                                  {/* 手動在庫増減メモ */}
                                  {detailMemos && detailMemos.length > 0 && (
                                    <div className="pt-1 border-t border-blue-100 space-y-1">
                                      <p className="font-medium text-muted-foreground">在庫増減メモ</p>
                                      {detailMemos.slice(0, 5).map((memo: { id: number; quantityDelta: number | null; memo: string | null; createdAt: Date; operatorName: string | null }) => (
                                        <div key={memo.id} className="flex items-start gap-1.5 bg-white/60 rounded p-1.5">
                                          <span className={`shrink-0 font-bold ${(memo.quantityDelta ?? 0) > 0 ? "text-green-600" : "text-red-600"}`}>
                                            {(memo.quantityDelta ?? 0) > 0 ? `+${memo.quantityDelta}` : memo.quantityDelta}
                                          </span>
                                          <div className="flex-1 min-w-0">
                                            {memo.memo && <p className="text-foreground">{memo.memo}</p>}
                                            <p className="text-muted-foreground">
                                              {new Date(memo.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                              {memo.operatorName && ` · ${memo.operatorName}`}
                                            </p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </td>
                        <td data-label="カテゴリ" className="px-4 py-2.5">
                          <Badge variant="outline" className="text-xs">{displayCategory}</Badge>
                        </td>
                        <td data-label="仕入単価" className="px-4 py-2.5 text-right">
                          {formatPrice(unitPrice)}
                        </td>
                        <td data-label="入庫日" className="px-4 py-2.5">
                          {lastPurchaseDateDisplay ? (
                            <span className="text-sm">{lastPurchaseDateDisplay}</span>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </td>
                        <td data-label="在庫金額" className="px-4 py-2.5 text-right">
                          {stockValue !== null ? (
                            <span className="font-medium text-foreground">¥{stockValue.toLocaleString()}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td data-label="在庫数" className="px-4 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => requestStockChange(inv, -1)}
                              className="w-7 h-7 rounded border border-border flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-40"
                              disabled={stockQty <= 0}
                              title="在庫数を1減らす"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            {editingStockId === inv.id ? (
                              <input
                                type="number"
                                min={0}
                                value={editingStockValue}
                                autoFocus
                                onChange={(e) => setEditingStockValue(e.target.value)}
                                onBlur={() => commitEditStock(inv)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitEditStock(inv);
                                  if (e.key === "Escape") setEditingStockId(null);
                                }}
                                className="w-14 text-center font-medium text-sm border border-primary rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                            ) : (
                              <span
                                className={`min-w-[2.5rem] text-center font-medium text-sm cursor-pointer hover:bg-muted/60 rounded px-1 py-0.5 transition-colors ${isZeroStock ? "text-muted-foreground" : ""}`}
                                title="クリックして直接入力"
                                onClick={() => startEditStock(inv)}
                              >
                                {Math.floor(stockQty)}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => requestStockChange(inv, +1)}
                              className="w-7 h-7 rounded border border-border flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                              title="在庫数を1増やす"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          </div>
          <PaginationBar
            page={invPage}
            totalPages={invTotalPages}
            onPageChange={setInvPage}
            totalItems={invTotalItems}
            startIndex={invStartIndex}
            endIndex={invEndIndex}
          />
        </>
      )}
      {/* フッター（固定） */}
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg z-10">
        <div className="max-w-5xl mx-auto px-4 py-3">
          {bulkDeleteMode ? (
            /* 削除モードフッター */
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <button
                  onClick={toggleBulkDeleteAll}
                  className="text-sm text-muted-foreground hover:text-foreground underline"
                >
                  {pagedInventories.every((inv) => bulkDeleteSelected.has(inv.id)) ? "全解除" : "全選択"}
                </button>
                <span className="text-sm text-destructive font-medium">
                  {bulkDeleteSelected.size > 0 ? `${bulkDeleteSelected.size}件選択中` : "削除する商品を選択してください"}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleBulkDeleteMode}
                className="flex-shrink-0"
              >
                <XCircle className="h-4 w-4 mr-1" />
                キャンセル
              </Button>
              <Button
                onClick={() => setShowBulkDeleteConfirm(true)}
                disabled={bulkDeleteSelected.size === 0 || isBulkDeleting}
                className="flex-shrink-0 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              >
                {isBulkDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1.5" />
                )}
                まとめて削除
                {bulkDeleteSelected.size > 0 && (
                  <Badge className="ml-1.5 bg-white/20 text-white text-xs">
                    {bulkDeleteSelected.size}
                  </Badge>
                )}
              </Button>
            </div>
          ) : (
            /* 出庫モードフッター */
            <>
              {checkedItems.length > 0 && (
                <div className="mb-2">
                  {/* 商品バッジ一覧 */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {checkedItems.map((item) => (
                      <Badge key={item.inventoryId} variant="secondary" className="text-xs">
                        {item.title} × {item.quantity}{item.unit}
                      </Badge>
                    ))}
                  </div>
                  {/* 販売価格サマリー（ユーロ建て） */}
                  {checkedItems.some((item) => item.sellingPrice != null) && (() => {
                    const rows = checkedItems.filter((item) => item.sellingPrice != null);
                    const total = rows.reduce((sum, item) => sum + (item.sellingPrice! * item.quantity), 0);
                    const totalQty = checkedItems.reduce((sum, item) => sum + item.quantity, 0);
                    // Luca（独発送管理）の場合はユーロ、それ以外はドル
                    const currencySymbol = bulkSheetName === "独発送管理" ? "€" : "$";
                    // 金額を「数値 + 通貨記号」の後置形式で表示するヘルパー
                    const fmt = (amount: number) => `${amount.toLocaleString()}${currencySymbol}`;
                    return (
                      <div className="rounded-md border border-amber-200 bg-amber-50/60 dark:bg-amber-900/20 dark:border-amber-700 px-3 py-2 text-xs space-y-1">
                        <div className="font-semibold text-foreground mb-1 flex items-center gap-1">
                          販売価格サマリー
                          <span className="font-bold text-foreground ml-2 text-sm">合計 {totalQty}台</span>
                        </div>
                        {rows.map((item) => (
                          <div key={item.inventoryId} className="flex justify-between gap-2">
                            <span className="text-muted-foreground truncate max-w-[160px]">{item.title} × {item.quantity}</span>
                            <span className="font-medium text-foreground whitespace-nowrap">
                              {fmt(item.sellingPrice! * item.quantity)}
                              <span className="text-muted-foreground font-normal ml-1">({fmt(item.sellingPrice!)}/台)</span>
                            </span>
                          </div>
                        ))}
                        <div className="flex justify-between gap-2 border-t border-amber-200 dark:border-amber-700 pt-1 mt-1">
                          <span className="font-semibold text-foreground">合計金額</span>
                          <span className="font-bold text-amber-700 dark:text-amber-400">{fmt(total)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Select
                  value={bulkCustomerCode}
                  onValueChange={(val) => {
                    setBulkCustomerCode(val);
                    if (val && val !== "__none__") {
                      // 先頭数字を优先、なければインボイスNoを使用
                      const prefixes = checkedItems
                        .map((item) => extractPrefixFromManagementNo(item.etc))
                        .filter(Boolean);
                      const uniquePrefixes = Array.from(new Set(prefixes));
                      const prefix = uniquePrefixes.length === 1 ? uniquePrefixes[0] : (bulkInvoiceNo || undefined);
                      setDeliveryNo(generateDeliveryNo(val, prefix));
                    } else {
                      setDeliveryNo("");
                    }
                  }}
                >
                  <SelectTrigger className="h-9 w-44">
                    <SelectValue placeholder="取引先" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">未指定</SelectItem>
                    {customers?.map((c) => (
                      <SelectItem key={c.id} value={c.code}>{c.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* 管理番号なしの商品が含まれる場合: インボイスNoプルダウン */}
                {checkedItems.some((item) => !extractPrefixFromManagementNo(item.etc)) &&
                  incompleteInvoices && incompleteInvoices.length > 0 && (
                  <Select
                    value={bulkInvoiceNo}
                    onValueChange={(invoiceNo) => {
                      setBulkInvoiceNo(invoiceNo);
                      if (!invoiceNo) return;
                      const code = bulkCustomerCode && bulkCustomerCode !== "__none__" ? bulkCustomerCode : null;
                      if (code) setDeliveryNo(generateDeliveryNo(code, invoiceNo));
                      // 管理番号なしのチェック済み商品の販売価格を更新
                      if (csvRows && csvRows.length > 0) {
                        setDeliveryItems((prev) => {
                          const next = new Map(prev);
                          Array.from(next.entries()).forEach(([id, item]) => {
                            if (item.checked && !extractPrefixFromManagementNo(item.etc)) {
                              // インボイスNoでCSVを照合
                              const invoiceRows = csvRows.filter((r) => r.invoiceNo === invoiceNo);
                              const titleLower = item.title.toLowerCase();
                              const matched = invoiceRows.find((r) => {
                                if (!r.productName) return false;
                                const csvNameLower = r.productName.toLowerCase();
                                return titleLower.includes(csvNameLower) || csvNameLower.includes(titleLower);
                              });
                              const first = invoiceRows.find((r) => r.sellingPrice != null);
                              const sp = matched?.sellingPrice ?? first?.sellingPrice ?? null;
                              const cur = matched?.currency ?? first?.currency ?? "EUR";
                              next.set(id, { ...item, sellingPrice: sp, currency: cur || "EUR" });
                            }
                          });
                          return next;
                        });
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 w-44">
                      <SelectValue placeholder="インボイスNo" />
                    </SelectTrigger>
                    <SelectContent>
                      {incompleteInvoices.map((inv) => (
                        <SelectItem key={inv.invoiceNo} value={inv.invoiceNo}>
                          No.{inv.invoiceNo} — {inv.partner}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <ShoppingCart className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <Input
                    placeholder="出庫No を入力（例: luca20260407）"
                    value={deliveryNo}
                    onChange={(e) => setDeliveryNo(e.target.value)}
                    className="h-9"
                    disabled={isSubmitting}
                  />
                </div>
                <Button
                  onClick={openDeliveryConfirm}
                  disabled={isSubmitting || checkedItems.length === 0 || !deliveryNo.trim()}
                  className="flex-shrink-0 bg-orange-600 hover:bg-orange-700 text-white"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <PackageMinus className="h-4 w-4 mr-1.5" />
                  )}
                  まとめて出庫
                  {checkedItems.length > 0 && (
                    <Badge className="ml-1.5 bg-white/20 text-white text-xs">
                      {checkedItems.length}
                    </Badge>
                  )}
                </Button>
              </div>
              {checkedItems.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  出庫する商品をチェックしてください
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* 一括削除確認ダイアログ */}
      <AlertDialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              在庫を一括削除
            </AlertDialogTitle>
            <AlertDialogDescription>
              選択した <strong>{bulkDeleteSelected.size}件</strong> の商品を削除します。この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              {bulkDeleteSelected.size}件を削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 出庫確認ダイアログ */}
      <Dialog open={showDeliveryConfirm} onOpenChange={setShowDeliveryConfirm}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageMinus className="h-5 w-5 text-orange-600" />
              出庫確認
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">出庫No</span>
              <span className="font-semibold">{deliveryNo}</span>
            </div>
            <div className="overflow-hidden rounded-md border">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-[32%]" />
                  <col className="w-[44%]" />
                  <col className="w-[24%]" />
                </colgroup>
                <thead>
                  <tr className="bg-muted/30 border-b">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">商品名</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">注文行</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">出庫数量</th>
                  </tr>
                </thead>
                <tbody>
                  {checkedItems.map((item) => {
                    const inv = (inventories as InventoryItem[] | undefined)?.find((i) => i.id === item.inventoryId);
                    const maxQty = inv ? Math.floor(parseFloat(inv.quantity ?? "0")) : item.quantity;
                    const orderLineValue = item.tradeRecordId
                      ? `id:${item.tradeRecordId}`
                      : item.csvProductName === null
                        ? "__none__"
                        : item.csvProductName
                          ? `name:${item.csvProductName}`
                          : "__auto__";
                    const orderProducts = bulkInvoiceProducts?.products ?? [];
                    const autoOrderLineLabel = getAutoOrderLineLabel(
                      item.title,
                      getManagementNo(inv?.etc),
                      orderProducts,
                    );
                    // setQuantityはInventoryItemを受け取るが、既存エントリがある場合はtitle/unitを使わないので
                    // DeliveryItemからダミーのInventoryItemを構築して渡す
                    const dummyInv: InventoryItem = inv ?? {
                      id: item.inventoryId,
                      title: item.title,
                      quantity: String(maxQty),
                      unit: item.unit,
                    } as InventoryItem;
                    return (
                      <tr key={item.inventoryId} className="border-b last:border-0">
                        <td className="min-w-0 break-words px-3 py-2 align-middle">{item.title}</td>
                        <td className="min-w-0 px-3 py-2 align-middle">
                          {bulkInvoiceNoForOrder ? (
                            <Select
                              value={orderLineValue}
                              onValueChange={(value) => setOrderLineSelection(item.inventoryId, value)}
                              disabled={orderProducts.length === 0}
                            >
                              <SelectTrigger className="h-8 w-full min-w-0">
                                <SelectValue placeholder="注文行" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__auto__">{autoOrderLineLabel}</SelectItem>
                                <SelectItem value="__none__">紐づけなし</SelectItem>
                                {orderProducts.map((product) => {
                                  const optionValue = product.tradeRecordId ? `id:${product.tradeRecordId}` : `name:${product.productName}`;
                                  return (
                                    <SelectItem key={optionValue} value={optionValue}>
                                      {product.productName}（残{product.remainingQty}/{product.orderQty}）
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">自動判定</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
                          <div className="flex min-w-0 items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setQuantity(item.inventoryId, Math.max(1, item.quantity - 1), dummyInv)}
                              className="w-6 h-6 rounded border border-orange-300 flex items-center justify-center text-orange-600 hover:bg-orange-50 transition-colors"
                              disabled={item.quantity <= 1}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={maxQty}
                              value={item.quantity}
                              onChange={(e) => {
                                const v = Math.min(maxQty, Math.max(1, Number(e.target.value)));
                                setQuantity(item.inventoryId, v, dummyInv);
                              }}
                              className="w-11 rounded border border-orange-300 bg-white px-1 py-0.5 text-center text-sm font-semibold text-orange-700 focus:outline-none focus:ring-1 focus:ring-orange-400"
                            />
                            <button
                              type="button"
                              onClick={() => setQuantity(item.inventoryId, Math.min(maxQty, item.quantity + 1), dummyInv)}
                              className="w-6 h-6 rounded border border-orange-300 flex items-center justify-center text-orange-600 hover:bg-orange-50 transition-colors"
                              disabled={item.quantity >= maxQty}
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                            <span className="text-muted-foreground ml-1">{item.unit}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              上記 {checkedItems.length} 件の商品を出庫処理します。この操作は元に戻せません。
            </p>
            {/* FedEx発送情報（任意） */}
            <div className="space-y-2 border-t pt-3">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <span className="text-blue-500">&#9992;</span> FedEx追跡番号（任意）
              </label>
              <p className="text-xs text-muted-foreground">入力すると出庫と同時にスプシに発送情報を登録します（発送日は当日自動）</p>
              <Input
                placeholder="追跡番号を入力..."
                value={bulkTrackingNumber}
                onChange={(e) => setBulkTrackingNumber(e.target.value)}
                list="today-tracking-numbers-bulk"
              />
              <datalist id="today-tracking-numbers-bulk">
                {todayTrackingNumbers?.map((t) => (
                  <option key={t.trackingNumber} value={t.trackingNumber} label={t.sheetName} />
                ))}
              </datalist>
              {todayTrackingNumbers && todayTrackingNumbers.length > 0 && (
                <p className="text-xs text-muted-foreground">ℹ️ 本日登録済み: {todayTrackingNumbers.map(t => t.trackingNumber).join(", ")}</p>
              )}
              {bulkTrackingNumber.trim() && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">シート</label>
                  <Select value={bulkSheetName} onValueChange={(v) => setBulkSheetName(v as ShipmentSheetName)}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="独発送管理">独発送管理</SelectItem>
                      <SelectItem value="サミー発送管理">サミー発送管理</SelectItem>
                      <SelectItem value="サイモン発送管理">サイモン発送管理</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDeliveryConfirm(false)} disabled={isSubmitting}>
              キャンセル
            </Button>
            <Button
              onClick={handleBulkDelivery}
              disabled={isSubmitting}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <PackageMinus className="h-4 w-4 mr-1.5" />
              )}
              出庫する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 個別出庫ダイアログ */}
      <Dialog open={showSingleDeliveryDialog} onOpenChange={setShowSingleDeliveryDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageMinus className="h-5 w-5 text-primary" />
              出庫
            </DialogTitle>
          </DialogHeader>
          {singleDeliveryItem && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/30 px-3 py-2 text-sm font-medium">
                {singleDeliveryItem.inv.title}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">出庫数量 <span className="text-xs text-muted-foreground font-normal">（在庫: {Math.floor(parseFloat(singleDeliveryItem.inv.quantity ?? "0"))} {singleDeliveryItem.inv.unit}）</span></label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSingleDeliveryItem(prev => prev ? { ...prev, qty: Math.max(1, prev.qty - 1) } : null)}
                    className="w-9 h-9 rounded border border-border flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <Input
                    type="number"
                    min={1}
                    max={parseFloat(singleDeliveryItem.inv.quantity ?? "1")}
                    value={singleDeliveryItem.qty}
                    onChange={(e) => setSingleDeliveryItem(prev => prev ? { ...prev, qty: Math.max(1, Number(e.target.value)) } : null)}
                    className="w-24 text-center"
                  />
                  <button
                    type="button"
                    onClick={() => setSingleDeliveryItem(prev => prev ? { ...prev, qty: Math.min(parseFloat(prev.inv.quantity ?? "999"), prev.qty + 1) } : null)}
                    className="w-9 h-9 rounded border border-border flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">取引先</label>
                <Select
                  value={singleCustomerCode}
                  onValueChange={(val) => {
                    setSingleCustomerCode(val);
                    if (val && val !== "__none__") {
                      // 管理番号の先頭数字を优先、なければインボイスNoを使用
                      const prefix = extractPrefixFromManagementNo(singleDeliveryItem?.inv.etc);
                      const invoicePrefix = prefix ?? (singleInvoiceNo || undefined);
                      setSingleDeliveryNo(generateDeliveryNo(val, invoicePrefix));
                    } else {
                      setSingleDeliveryNo("");
                    }
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="取引先を選択（管理番号から自動判別）" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">未指定</SelectItem>
                    {customers?.map((c) => (
                      <SelectItem key={c.id} value={c.code}>{c.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {singleCustomerCode && detectCustomerFromManagementNo(singleDeliveryItem?.inv.etc) && (
                  <p className="text-xs text-green-600">✓ 管理番号から自動判別しました</p>
                )}
                {/* 管理番号なしの場合: 未完了インボイスNo選択 */}
                {!extractPrefixFromManagementNo(singleDeliveryItem?.inv.etc) && incompleteInvoices && incompleteInvoices.length > 0 && (
                  <div className="mt-2">
                    <label className="text-xs text-muted-foreground">インボイスNoを選択（管理番号なしの場合）</label>
                    <Select
                      value={singleInvoiceNo}
                      onValueChange={(invoiceNo) => {
                        setSingleInvoiceNo(invoiceNo);
                        if (!invoiceNo) return;
                        // 取引先が選択済みなら出庫Noを自動生成
                        const code = singleCustomerCode && singleCustomerCode !== "__none__" ? singleCustomerCode : null;
                        if (code) setSingleDeliveryNo(generateDeliveryNo(code, invoiceNo));
                        else setSingleDeliveryNo(""); // 取引先未選択の場合は空に
                      }}
                    >
                      <SelectTrigger className="h-9 mt-1">
                        <SelectValue placeholder="未完了インボイスNoを選択..." />
                      </SelectTrigger>
                      <SelectContent>
                        {incompleteInvoices.map((inv) => (
                          <SelectItem key={inv.invoiceNo} value={inv.invoiceNo}>
                            No.{inv.invoiceNo} — {inv.partner}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {singleInvoiceNo && (!singleCustomerCode || singleCustomerCode === "__none__") && (
                      <p className="text-xs text-orange-600 mt-1">↑ 取引先も選択すると出庫Noが自動入力されます</p>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">出庫No</label>
                <Input
                  placeholder="出庫Noを入力（例: luca20260407）"
                  value={singleDeliveryNo}
                  onChange={(e) => setSingleDeliveryNo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSingleDelivery(); }}
                />
                {singleCustomerCode && singleCustomerCode !== "__none__" && (
                  <p className="text-xs text-muted-foreground">取引先を変更すると出庫Noが自動更新されます</p>
                )}
              </div>
              {singleInvoiceNoForOrder && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">注文行</label>
                  <Select
                    value={singleOrderLineValue}
                    onValueChange={setSingleOrderLineValue}
                    disabled={(singleInvoiceProducts?.products ?? []).length === 0}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="注文行を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">{singleAutoOrderLineLabel}</SelectItem>
                      <SelectItem value="__none__">紐づけなし</SelectItem>
                      {(singleInvoiceProducts?.products ?? []).map((product) => {
                        const optionValue = product.tradeRecordId ? `id:${product.tradeRecordId}` : `name:${product.productName}`;
                        return (
                          <SelectItem key={optionValue} value={optionValue}>
                            {product.productName}（残{product.remainingQty}/{product.orderQty}）
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    複数の商品行があるNoでは、ここで確定すると発注管理とFedEx集計がその行を使います。
                  </p>
                </div>
              )}
              {/* FedEx発送情報（任意） */}
              <div className="space-y-2 border-t pt-3">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <span className="text-blue-500">&#9992;</span> FedEx追跡番号（任意）
                </label>
                <p className="text-xs text-muted-foreground">入力すると出庫と同時にスプシに発送情報を登録します（発送日は当日自動）</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="追跡番号を入力..."
                    value={singleTrackingNumber}
                    onChange={(e) => setSingleTrackingNumber(e.target.value)}
                    className="flex-1"
                    list="today-tracking-numbers"
                  />
                  <datalist id="today-tracking-numbers">
                    {todayTrackingNumbers?.map((t) => (
                      <option key={t.trackingNumber} value={t.trackingNumber} label={t.sheetName} />
                    ))}
                  </datalist>
                </div>
                {todayTrackingNumbers && todayTrackingNumbers.length > 0 && (
                  <p className="text-xs text-muted-foreground">ℹ️ 本日登録済み: {todayTrackingNumbers.map(t => t.trackingNumber).join(", ")}</p>
                )}
                {singleTrackingNumber.trim() && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium">シート</label>
                    <Select value={singleSheetName} onValueChange={(v) => setSingleSheetName(v as ShipmentSheetName)}>
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="独発送管理">独発送管理</SelectItem>
                        <SelectItem value="サミー発送管理">サミー発送管理</SelectItem>
                        <SelectItem value="サイモン発送管理">サイモン発送管理</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowSingleDeliveryDialog(false)} disabled={isSingleSubmitting}>
              キャンセル
            </Button>
            <Button
              onClick={handleSingleDelivery}
              disabled={isSingleSubmitting}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {isSingleSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <PackageMinus className="h-4 w-4 mr-1.5" />
              )}
              出庫する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 在庫削除確認ダイアログ */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => { if (!open) { setShowDeleteDialog(false); setDeleteTarget(null); setAlsoDeletePurchaseIds([]); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>商品を削除しますか？</DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/30 px-3 py-2 text-sm font-medium">
                {deleteTarget.title}
              </div>
              <p className="text-sm text-muted-foreground">
                在庫一覧から削除します。削除済み商品ページから復元できます。
              </p>
              {/* 連動削除セクション */}
              {isLoadingRelatedPurchases ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  発注データを確認中...
                </div>
              ) : relatedPurchases && relatedPurchases.length > 0 ? (
                <div className="space-y-2 border rounded-md p-3 bg-yellow-50 border-yellow-200">
                  <p className="text-sm font-medium text-yellow-800">
                    発注データが {relatedPurchases.length} 件あります
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {relatedPurchases.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id={`del-purchase-${p.id}`}
                          checked={alsoDeletePurchaseIds.includes(p.id)}
                          onCheckedChange={(checked) => {
                            setAlsoDeletePurchaseIds((prev) =>
                              checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                            );
                          }}
                        />
                        <label htmlFor={`del-purchase-${p.id}`} className="cursor-pointer text-yellow-900">
                          発注No.{p.num} — {p.status === "ordered" ? "発注済み" : "未発注"}
                          {p.purchase_items[0]?.quantity ? ` ×${p.purchase_items[0].quantity}` : ""}
                        </label>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-yellow-700">連動削除する発注データにチェックを入れてください</p>
                </div>
              ) : relatedPurchases ? (
                <p className="text-sm text-muted-foreground">発注データはありません</p>
              ) : null}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowDeleteDialog(false); setDeleteTarget(null); setAlsoDeletePurchaseIds([]); }}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteInventory}
              disabled={isLoadingRelatedPurchases}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              {alsoDeletePurchaseIds.length > 0 ? `在庫と発注データを削除` : `在庫だけ削除`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 在庫数変更確認ダイアログ */}
      <Dialog open={!!stockChangeConfirm} onOpenChange={(open) => { if (!open) { setStockChangeConfirm(null); setStockChangeMemo(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>在庫数を変更しますか？</DialogTitle>
          </DialogHeader>
          {stockChangeConfirm && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/30 px-3 py-2 text-sm font-medium">
                {stockChangeConfirm.inv.title}
              </div>
              <div className="flex items-center justify-center gap-4 py-2">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">現在</p>
                  <p className="text-2xl font-bold">{Math.floor(parseFloat(stockChangeConfirm.inv.quantity ?? "0"))}</p>
                  <p className="text-xs text-muted-foreground">{stockChangeConfirm.inv.unit}</p>
                </div>
                <div className="text-muted-foreground">
                  {stockChangeConfirm.delta > 0 ? (
                    <span className="text-green-600 font-bold text-lg">+{stockChangeConfirm.delta} →</span>
                  ) : (
                    <span className="text-red-500 font-bold text-lg">{stockChangeConfirm.delta} →</span>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">変更後</p>
                  <p className={`text-2xl font-bold ${stockChangeConfirm.newQty === 0 ? "text-muted-foreground" : ""}`}>{stockChangeConfirm.newQty}</p>
                  <p className="text-xs text-muted-foreground">{stockChangeConfirm.inv.unit}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">サイト内DBの在庫数が更新されます</p>
              {/* メモ入力欄 */}
              <div className="space-y-1">
                <Label htmlFor="stock-change-memo" className="text-sm">メモ（任意）</Label>
                <Textarea
                  id="stock-change-memo"
                  placeholder="変更理由や備考を入力..."
                  value={stockChangeMemo}
                  onChange={(e) => setStockChangeMemo(e.target.value)}
                  rows={2}
                  className="text-sm resize-none"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setStockChangeConfirm(null); setStockChangeMemo(""); }} disabled={isStockChanging}>
              キャンセル
            </Button>
            <Button
              onClick={handleStockChange}
              disabled={isStockChanging}
              className={stockChangeConfirm?.delta && stockChangeConfirm.delta > 0 ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-500 hover:bg-red-600 text-white"}
            >
              {isStockChanging ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : null}
              変更する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* 在庫数変更履歴（メモ）ダイアログ */}
      {/* ============================================================ */}
      <Dialog open={!!memoHistoryItem} onOpenChange={(open) => { if (!open) setMemoHistoryItem(null); }}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              在庫数変更履歴
            </DialogTitle>
          </DialogHeader>
          {memoHistoryItem && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/30 px-3 py-2 text-sm font-medium">
                {memoHistoryItem.title}
              </div>
              {!memoHistoryData || memoHistoryData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  変更履歴がありません
                </div>
              ) : (
                <div className="space-y-2">
                  {memoHistoryData.map((memo) => {
                    const isIncrease = memo.changeType === "increase" || (memo.quantityDelta != null && memo.quantityDelta > 0);
                    const isDecrease = memo.changeType === "decrease" || (memo.quantityDelta != null && memo.quantityDelta < 0);
                    return (
                      <div key={memo.id} className="rounded-md border bg-card px-3 py-2 text-sm space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isIncrease && <span className="text-green-600 font-bold text-xs">+{memo.quantityDelta}</span>}
                            {isDecrease && <span className="text-red-500 font-bold text-xs">{memo.quantityDelta}</span>}
                            {!isIncrease && !isDecrease && <span className="text-muted-foreground text-xs">変更</span>}
                            {memo.quantityBefore != null && memo.quantityAfter != null && (
                              <span className="text-muted-foreground text-xs">{memo.quantityBefore} → {memo.quantityAfter}</span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(memo.createdAt).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        {memo.memo && (
                          <p className="text-xs text-foreground bg-muted/30 rounded px-2 py-1">{memo.memo}</p>
                        )}
                        {memo.operatorName && (
                          <p className="text-xs text-muted-foreground">操作者: {memo.operatorName}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemoHistoryItem(null)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showCategoryDialog} onOpenChange={setShowCategoryDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              カテゴリ管理
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCategory();
                }}
                placeholder="カテゴリ名"
              />
              <Button
                onClick={handleAddCategory}
                disabled={addCategoryMutation.isPending || !newCategoryName.trim()}
              >
                {addCategoryMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="rounded-md border max-h-72 overflow-y-auto">
              {categoryOptions.length === 0 ? (
                <p className="px-3 py-6 text-sm text-muted-foreground text-center">カテゴリがありません</p>
              ) : (
                categoryOptions.map((cat) => (
                  <div key={cat} className="flex items-center justify-between gap-3 px-3 py-2 border-b last:border-0">
                    <span className="text-sm font-medium truncate">{cat}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={() => setCategoryDeleteTarget(cat)}
                      disabled={deleteCategoryMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCategoryDialog(false)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!categoryDeleteTarget} onOpenChange={(open) => { if (!open) setCategoryDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>カテゴリを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{categoryDeleteTarget}」を在庫・入庫予定から外して未分類にします。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCategoryMutation.isPending}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCategory}
              disabled={deleteCategoryMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCategoryMutation.isPending ? "削除中..." : "削除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* ============================================================ */}
      {/* 在庫編集ダイアログ */}
      {/* ============================================================ */}
      <Dialog open={!!editingItem} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-blue-600" />
              在庫情報を編集
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-title">商品名 <span className="text-destructive">*</span></Label>
              <Input
                id="edit-title"
                value={editForm.title}
                onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))}
                placeholder="商品名を入力"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-quantity">在庫数</Label>
                <Input
                  id="edit-quantity"
                  type="number"
                  min={0}
                  value={editForm.quantity}
                  onChange={(e) => setEditForm(f => ({ ...f, quantity: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-unit">単位</Label>
                <Input
                  id="edit-unit"
                  value={editForm.unit}
                  onChange={(e) => setEditForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="個"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-category">カテゴリ</Label>
              <Select
                value={editForm.category || "__none__"}
                onValueChange={(v) => setEditForm(f => ({ ...f, category: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger id="edit-category">
                  <SelectValue placeholder="カテゴリを選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未分類</SelectItem>
                  {categoryOptions.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-price">仕入単価（円）</Label>
              <Input
                id="edit-price"
                type="number"
                min={0}
                value={editForm.purchase_unit_price}
                onChange={(e) => setEditForm(f => ({ ...f, purchase_unit_price: e.target.value }))}
                placeholder="例: 1500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-place">保管場所</Label>
              <Input
                id="edit-place"
                value={editForm.place}
                onChange={(e) => setEditForm(f => ({ ...f, place: e.target.value }))}
                placeholder="保管場所を入力"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-etc">管理番号・備考</Label>
              <Textarea
                id="edit-etc"
                value={editForm.etc}
                onChange={(e) => setEditForm(f => ({ ...f, etc: e.target.value }))}
                placeholder="例: E0618_01_A00001, 2024-01-15, 仕入先メモ"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">先頭（カンマ前）が管理番号として扱われます。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-supplier-name">仕入先名</Label>
              <Input
                id="edit-supplier-name"
                value={editForm.supplierName}
                onChange={(e) => setEditForm(f => ({ ...f, supplierName: e.target.value }))}
                placeholder="例: 駿河屋 盛岡MOSSビル店"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-supplier-url">仕入先URL</Label>
              <Input
                id="edit-supplier-url"
                value={editForm.supplierUrl}
                onChange={(e) => setEditForm(f => ({ ...f, supplierUrl: e.target.value }))}
                placeholder="https://..."
                type="url"
              />
              {getEbayStockType(editForm.etc) === "stocked" && (
                <div className="space-y-1.5 pt-2">
                  <Label htmlFor="edit-ebay-listing-url">自社出品ページ</Label>
                  <Input
                    id="edit-ebay-listing-url"
                    value={editForm.ebayListingUrl}
                    onChange={(e) => setEditForm(f => ({ ...f, ebayListingUrl: e.target.value }))}
                    placeholder="https://www.ebay.com/itm/..."
                    type="url"
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">サイト内DBに保存されます</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditingItem(null)} disabled={isEditSubmitting}>
              キャンセル
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={isEditSubmitting || !editForm.title.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isEditSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Pencil className="h-4 w-4 mr-1.5" />
              )}
              更新する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 発注済み登録ダイアログ */}
      <Dialog open={showOrderedDialog} onOpenChange={(open) => { if (!open) { setShowOrderedDialog(false); setOrderedTargetInv(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-amber-600" />
              発注済み登録
            </DialogTitle>
          </DialogHeader>
          {orderedTargetInv && (
            <div className="space-y-4">
              {/* 商品表示 */}
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md">
                <PackageCheck className="h-4 w-4 text-amber-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-800">{orderedTargetInv.title}</p>
                  {getManagementNo(orderedTargetInv.etc) && (
                    <p className="text-xs text-amber-600">管理番号: {getManagementNo(orderedTargetInv.etc)}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="del-ordered-qty">発注数量 <span className="text-destructive">*</span></Label>
                  <Input
                    id="del-ordered-qty"
                    type="number"
                    min={1}
                    value={orderedQty}
                    onChange={(e) => setOrderedQty(e.target.value)}
                    placeholder="1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="del-ordered-price">仕入単価（円）</Label>
                  <Input
                    id="del-ordered-price"
                    type="number"
                    min={0}
                    value={orderedUnitPrice}
                    onChange={(e) => setOrderedUnitPrice(e.target.value)}
                    placeholder="例: 1500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="del-ordered-num">発注No</Label>
                  <div className="relative">
                    <Input
                      id="del-ordered-num"
                      value={isLoadingNextNum ? "" : orderedNum}
                      onChange={(e) => setOrderedNum(e.target.value)}
                      placeholder={isLoadingNextNum ? "取得中...」" : "例: 5216"}
                      disabled={isLoadingNextNum}
                    />
                    {isLoadingNextNum && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="del-ordered-date">入庫予定日</Label>
                  <Input
                    id="del-ordered-date"
                    type="date"
                    value={orderedDate}
                    onChange={(e) => setOrderedDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>仕入先</Label>
                <Select value={orderedSupplier} onValueChange={(v) => { if (v === "__add__") { setShowAddSupplier(true); } else { setOrderedSupplier(v); } }}>
                  <SelectTrigger>
                    <SelectValue placeholder="仕入先を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {allSuppliers.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                    <SelectItem value="__add__" className="text-primary font-medium">➕ 新しい仕入先を追加</SelectItem>
                  </SelectContent>
                </Select>
                {showAddSupplier && (
                  <div className="flex gap-2 mt-1.5">
                    <Input
                      value={newSupplierInput}
                      onChange={(e) => setNewSupplierInput(e.target.value)}
                      placeholder="仕入先名を入力"
                      onKeyDown={(e) => { if (e.key === "Enter") addCustomSupplier(); if (e.key === "Escape") setShowAddSupplier(false); }}
                      autoFocus
                    />
                    <Button type="button" size="sm" onClick={addCustomSupplier} disabled={!newSupplierInput.trim()}>追加</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddSupplier(false)}>キャンセル</Button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="del-ordered-memo">メモ</Label>
                <Textarea
                  id="del-ordered-memo"
                  value={orderedMemo}
                  onChange={(e) => setOrderedMemo(e.target.value)}
                  placeholder="メモを入力"
                  rows={2}
                />
              </div>

              {/* 操作者選択 */}
              {operators && operators.length > 1 && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-2">操作者（作業履歴に記録されます）</p>
                  <div className="flex flex-wrap gap-2">
                    {operators.map((op) => (
                      <button
                        key={op.key}
                        type="button"
                        onClick={() => handleOperatorChange(op.key)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          selectedOperatorKey === op.key
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-foreground border-border hover:bg-muted/50"
                        }`}
                      >
                        {op.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowOrderedDialog(false); setOrderedTargetInv(null); }} disabled={isOrderedSubmitting}>
              キャンセル
            </Button>
            <Button
              onClick={handleOrderedSubmit}
              disabled={isOrderedSubmitting}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isOrderedSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <PackageCheck className="h-4 w-4 mr-1.5" />
              )}
              発注済みとして登録
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新規登録ダイアログ */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => { if (!open) setShowCreateDialog(false); }}><DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-green-600" />
              新規商品登録
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-title">商品名 <span className="text-destructive">*</span></Label>
              <Input
                id="create-title"
                value={createForm.title}
                onChange={(e) => setCreateForm(f => ({ ...f, title: e.target.value }))}
                placeholder="商品名を入力"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-quantity">在庫数</Label>
                <Input
                  id="create-quantity"
                  type="number"
                  min={0}
                  value={createForm.quantity}
                  onChange={(e) => setCreateForm(f => ({ ...f, quantity: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-unit">単位</Label>
                <Input
                  id="create-unit"
                  value={createForm.unit}
                  onChange={(e) => setCreateForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="個"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-category">カテゴリ</Label>
              <Select
                value={createForm.category || "__none__"}
                onValueChange={(v) => setCreateForm(f => ({ ...f, category: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger id="create-category">
                  <SelectValue placeholder="カテゴリを選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未分類</SelectItem>
                  {categoryOptions.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-price">仕入単価（円）</Label>
              <Input
                id="create-price"
                type="number"
                min={0}
                value={createForm.purchase_unit_price}
                onChange={(e) => setCreateForm(f => ({ ...f, purchase_unit_price: e.target.value }))}
                placeholder="例: 1500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-place">保管場所</Label>
              <Input
                id="create-place"
                value={createForm.place}
                onChange={(e) => setCreateForm(f => ({ ...f, place: e.target.value }))}
                placeholder="保管場所を入力"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-etc">備考欄</Label>
              <Textarea
                id="create-etc"
                value={createForm.etc}
                onChange={(e) => setCreateForm(f => ({ ...f, etc: e.target.value }))}
                placeholder="備考・管理番号など（例: 368-1, 2024-01-15, 株式会社ABC）"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">管理番号はカンマ区切りの先頭に記入（例: 368-1, ...）</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-supplier-url">仕入先URL</Label>
              <Input
                id="create-supplier-url"
                value={createForm.supplierUrl}
                onChange={(e) => setCreateForm(f => ({ ...f, supplierUrl: e.target.value }))}
                placeholder="https://..."
                type="url"
              />
              <p className="text-xs text-muted-foreground">サイト内DBに保存されます</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} disabled={isCreateSubmitting}>
              キャンセル
            </Button>
            <Button
              onClick={handleCreateSubmit}
              disabled={isCreateSubmitting || !createForm.title.trim()}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {isCreateSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Plus className="h-4 w-4 mr-1.5" />
              )}
              登録する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 商品詳細ダイアログ ===== */}
      <Dialog open={!!detailItem} onOpenChange={(open) => { if (!open) setDetailItem(null); }}>
        <DialogContent className="max-w-lg w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-blue-500" />
              商品詳細
            </DialogTitle>
          </DialogHeader>

          {isDetailLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              {/* 基本情報 */}
              <div className="space-y-2">
                <h3 className="font-semibold text-base border-b pb-1">基本情報</h3>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                  <span className="text-muted-foreground whitespace-nowrap">商品名</span>
                  <span className="font-medium">{detailZaico?.title ?? detailItem?.title}</span>

                  <span className="text-muted-foreground whitespace-nowrap">カテゴリ</span>
                  <span>{(detailZaico?.categories?.[0] ?? detailZaico?.category ?? detailItem?.categories?.[0] ?? detailItem?.category) || "-"}</span>

                  <span className="text-muted-foreground whitespace-nowrap">在庫数</span>
                  <span>{detailZaico?.quantity ?? detailItem?.quantity} {detailZaico?.unit ?? detailItem?.unit}</span>

                  <span className="text-muted-foreground whitespace-nowrap">保管場所</span>
                  <span>{detailZaico?.place ?? detailItem?.place ?? "-"}</span>

                  <span className="text-muted-foreground whitespace-nowrap">仕入単価</span>
                  <span>{formatPrice(detailZaico?.purchase_unit_price ?? detailZaico?.unit_price ?? detailItem?.purchase_unit_price ?? detailItem?.unit_price)}</span>

                  {/* etcフィールドから仕入先（[2]）を抽出 */}
                  {(() => {
                    const etc = detailZaico?.etc ?? detailItem?.etc ?? "";
                    const parts = etc.split(",").map((s) => s.trim());
                    const managementNo = parts[0] || "";
                    const dateStr = parts[1] || "";
                    const supplier = parts[2] || "";
                    return (
                      <>
                        {managementNo && (
                          <>
                            <span className="text-muted-foreground whitespace-nowrap">管理番号</span>
                            <span className="font-mono">{managementNo}</span>
                          </>
                        )}
                        {dateStr && (
                          <>
                            <span className="text-muted-foreground whitespace-nowrap">入庫日</span>
                            <span>{dateStr}</span>
                          </>
                        )}
                        {supplier && (
                          <>
                            <span className="text-muted-foreground whitespace-nowrap">仕入先</span>
                            <span>{supplier}</span>
                          </>
                        )}
                      </>
                    );
                  })()}

                  {(detailZaico?.code ?? detailItem?.code) && (
                    <>
                      <span className="text-muted-foreground whitespace-nowrap">コード</span>
                      <span className="font-mono">{detailZaico?.code ?? detailItem?.code}</span>
                    </>
                  )}

                  <span className="text-muted-foreground whitespace-nowrap">登録日</span>
                  <span>{(detailZaico?.created_at ?? detailItem?.created_at)?.slice(0, 10) ?? "-"}</span>

                  <span className="text-muted-foreground whitespace-nowrap">更新日</span>
                  <span>{(detailZaico?.updated_at ?? detailItem?.updated_at)?.slice(0, 10) ?? "-"}</span>
                </div>
              </div>

              {/* 仕入先URL */}
              {(detailItem?.supplierUrl || detailItem?.supplierName) && (
                <div className="space-y-1">
                  <h3 className="font-semibold border-b pb-1">仕入先リンク</h3>
                  {detailItem.supplierUrl ? (
                    <a
                      href={detailItem.supplierUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-blue-600 hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {buildSupplierDisplay(detailItem.supplierUrl, detailItem.supplierName)}
                    </a>
                  ) : (
                    <span>{buildSupplierDisplay(detailItem.supplierUrl, detailItem.supplierName)}</span>
                  )}
                </div>
              )}

              {/* 備考欄（optional_attributes） */}
              {detailZaico?.optional_attributes && detailZaico.optional_attributes.length > 0 && (
                <div className="space-y-1">
                  <h3 className="font-semibold border-b pb-1">備考・追加情報</h3>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                    {detailZaico.optional_attributes.map((attr, i) => (
                      <>
                        <span key={`k-${i}`} className="text-muted-foreground whitespace-nowrap">{attr.name}</span>
                        <span key={`v-${i}`} className="break-all">{attr.value ?? "-"}</span>
                      </>
                    ))}
                  </div>
                </div>
              )}

              {/* 手動在庫増減メモ履歴 */}
              {detailMemos && detailMemos.length > 0 && (
                <div className="space-y-1">
                  <h3 className="font-semibold border-b pb-1">手動在庫増減メモ</h3>
                  <div className="space-y-1.5">
                    {detailMemos.map((memo) => (
                      <div key={memo.id} className="flex items-start gap-2 text-xs bg-muted/30 rounded p-2">
                        <span className={`shrink-0 font-medium ${
                          (memo.quantityDelta ?? 0) > 0 ? "text-green-600" : "text-red-600"
                        }`}>
                          {(memo.quantityDelta ?? 0) > 0 ? `+${memo.quantityDelta}` : memo.quantityDelta}
                        </span>
                        <div className="flex-1 min-w-0">
                          {memo.memo && <p className="text-foreground">{memo.memo}</p>}
                          <p className="text-muted-foreground">
                            {new Date(memo.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            {memo.operatorName && ` · ${memo.operatorName}`}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailItem(null)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
