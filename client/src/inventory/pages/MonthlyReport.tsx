import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  RefreshCw,
  Save,
  Trash2,
  ChevronDown,
  ChevronRight,
  Download,
  CalendarDays,
  Package,
  ShoppingCart,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Truck,
  PlusCircle,
  X,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ============================================================
// 型定義
// ============================================================
type InventorySummaryItem = {
  category: string;
  managementNo?: string;
  title: string;
  quantity: number;
  unitPrice: number | null;
  totalValue: number | null;
};

type ProductRow = {
  name: string;
  qty: number;
  sellingPrice: number | null;
  currency: string;
  tradeAmount: number | null;
};

type PurchaseItemForReport = {
  zaicoId: number;
  title: string;
  quantity: number;
  unitPrice: number | null;
  managementNo: string;
  status: string;
};

type StockItemForReport = {
  inventoryId: number;
  title: string;
  quantity: number;
  unitPrice: number | null;
  managementNo: string;
  category: string;
};

type DeliveryItemForReport = {
  inventoryId: number;
  title: string;
  quantity: number;
  unitPrice: number | null;
  managementNo: string;
  deliveredAt: string;
  deliveryNo: string;
};

type InvoiceForReport = {
  invoiceNo: string;
  partner: string;
  paymentDate: string;
  products: ProductRow[];
  totalOrderQty: number;
  purchaseItems: PurchaseItemForReport[];
  stockItems: StockItemForReport[];
  deliveryItems: DeliveryItemForReport[];
  domesticNote: string | null;
  totalPurchaseCost: number | null;
  totalStockCost: number | null;
};

type PreviewData = {
  inventorySummary: InventorySummaryItem[];
  invoiceList: InvoiceForReport[];
};

// 仕入れ単価の手入力状態: key = `${invoiceNo}__${itemKey}`
type CostOverrides = Record<string, number | null>;

// ============================================================
// ユーティリティ
// ============================================================
function fmt(n: number | null | undefined, prefix = "¥"): string {
  if (n == null) return "-";
  return `${prefix}${n.toLocaleString("ja-JP")}`;
}

/** 通貨表示: 「2125ユーロ」「2125ドル」のように数値→通貨名の順 */
function fmtForeign(price: number | null, currency: string): string {
  if (price == null) return "-";
  const formatted = price.toLocaleString("ja-JP", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  // 通貨コードを日本語表示に変換
  const currencyLabel =
    currency === "EUR" || currency === "€" ? "ユーロ" :
    currency === "USD" || currency === "$" ? "ドル" :
    currency === "GBP" || currency === "£" ? "ポンド" :
    currency === "ユーロ" ? "ユーロ" :
    currency === "ドル" ? "ドル" :
    currency || "";
  return `${formatted}${currencyLabel}`;
}

function parseDomesticNote(note: string | null): { isDomestic: boolean; detail: string | null } {
  if (!note) return { isDomestic: false, detail: null };
  const lower = note.toLowerCase();
  if (lower.includes("toynet") || lower.includes("益子") || lower.includes("国内")) {
    return { isDomestic: true, detail: note };
  }
  return { isDomestic: false, detail: null };
}

/** 日付文字列を「YYYY/MM/DD」形式にフォーマット */
function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  // 「Tue Mar 10 2026 09:00:00 GMT+0900 (Japan Standard Time)」のような形式を変換
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr; // パース失敗時はそのまま返す
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function getCurrentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ============================================================
// メインコンポーネント
// ============================================================
export default function MonthlyReport() {
  // プレビューデータ取得（独立したリクエストとして送信するためfetchPolicy設定）
  const { data: preview, isLoading: previewLoading, refetch: refetchPreview } = trpc.inventory.monthlyReport.preview.useQuery(
    undefined,
    { trpc: { abortOnUnmount: true } }
  );
  // 保存済みレポート一覧（previewと別タイミングで取得するため少し遅延）
  const [listEnabled, setListEnabled] = useState(false);
  const { data: savedReports, refetch: refetchList } = trpc.inventory.monthlyReport.list.useQuery(
    undefined,
    { enabled: listEnabled }
  );
  // コンポーネントマウント後に少し遅延してlistを有効化（previewと別バッチにする）
  useEffect(() => {
    const timer = setTimeout(() => setListEnabled(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // 保存mutation
  const saveMutation = trpc.inventory.monthlyReport.save.useMutation({
    onSuccess: () => {
      toast.success("レポートを保存しました");
      refetchList();
    },
    onError: (e) => toast.error(`保存失敗: ${e.message}`),
  });

  // 削除mutation
  const deleteMutation = trpc.inventory.monthlyReport.delete.useMutation({
    onSuccess: () => {
      toast.success("レポートを削除しました");
      refetchList();
      if (selectedReportId != null) setSelectedReportId(null);
    },
    onError: (e) => toast.error(`削除失敗: ${e.message}`),
  });

  // 仕入れ単価保存mutation
  const upsertCostMutation = trpc.inventory.monthlyReport.upsertCost.useMutation({
    onError: (e) => toast.error(`単価保存失敗: ${e.message}`),
  });
   void upsertCostMutation; // suppress unused warning

  // UI状態
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [label, setLabel] = useState("");
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const [costOverrides, setCostOverrides] = useState<CostOverrides>({});
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"preview" | "saved">("preview");

  // 在庫サマリーの表示/非表示
  const [showInventorySummary, setShowInventorySummary] = useState(true);
  // カテゴリ絞り込み
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  // 在庫サマリーの単価未設定商品への単価入力（key = `${category}__${title}__${idx}`）
  const [inventoryPriceOverrides, setInventoryPriceOverrides] = useState<Record<string, number | null>>({});
  const handleInventoryPriceChange = (key: string, value: string) => {
    const num = value === "" ? null : parseFloat(value);
    setInventoryPriceOverrides((prev) => ({ ...prev, [key]: isNaN(num as number) ? null : num }));
  };

  // 選択済みレポートの詳細
  const { data: selectedReport } = trpc.inventory.monthlyReport.get.useQuery(
    { id: selectedReportId! },
    { enabled: selectedReportId != null }
  );
  // 保存済みレポートのinvoiceListJsonをパース
  const savedInvoiceList = useMemo<InvoiceForReport[]>(() => {
    if (!selectedReport?.invoiceListJson) return [];
    try { return JSON.parse(selectedReport.invoiceListJson) as InvoiceForReport[]; } catch { return []; }
  }, [selectedReport?.invoiceListJson]);
  const savedInventorySummary = useMemo<InventorySummaryItem[]>(() => {
    if (!selectedReport?.inventorySummaryJson) return [];
    try { return JSON.parse(selectedReport.inventorySummaryJson) as InventorySummaryItem[]; } catch { return []; }
  }, [selectedReport?.inventorySummaryJson]);
  // 保存済みレポート用の展開状態
  const [savedExpandedInvoices, setSavedExpandedInvoices] = useState<Set<string>>(new Set());
  const toggleSavedInvoice = (no: string) => setSavedExpandedInvoices((prev) => {
    const next = new Set(prev);
    if (next.has(no)) next.delete(no); else next.add(no);
    return next;
  });

  // プレビューデータをパース
  const previewData = preview as PreviewData | undefined;

  // 手動入力行の管理
  const invoiceNos = useMemo(() => {
    if (!previewData) return [];
    return previewData.invoiceList.map((inv) => inv.invoiceNo);
  }, [previewData]);
  const { data: manualItemsRaw, refetch: refetchManualItems } = trpc.inventory.invoiceManualItem.listByInvoiceNos.useQuery(
    { invoiceNos },
    { enabled: invoiceNos.length > 0 }
  );
  const manualItemsMap = useMemo(() => {
    const map: Record<string, Array<{ id: number; invoiceNo: string; title: string; quantity: number; unitPrice: string | null; sortOrder: number }>> = {};
    if (!manualItemsRaw) return map;
    for (const item of manualItemsRaw) {
      if (!map[item.invoiceNo]) map[item.invoiceNo] = [];
      map[item.invoiceNo].push(item);
    }
    return map;
  }, [manualItemsRaw]);
  const createManualItemMutation = trpc.inventory.invoiceManualItem.create.useMutation({
    onSuccess: () => { void refetchManualItems(); },
    onError: (e) => toast.error(`追加失敗: ${e.message}`),
  });
  const updateManualItemMutation = trpc.inventory.invoiceManualItem.update.useMutation({
    onError: (e) => toast.error(`更新失敗: ${e.message}`),
  });
  const deleteManualItemMutation = trpc.inventory.invoiceManualItem.delete.useMutation({
    onSuccess: () => { void refetchManualItems(); },
    onError: (e) => toast.error(`削除失敗: ${e.message}`),
  });
  const [manualEdits, setManualEdits] = useState<Record<number, { title: string; quantity: string; unitPrice: string }>>({}); 

  // ============================================================
  // 国内卸発注行の管理
  // ============================================================
  // 国内卸商品マスタを取得
  const { data: domesticProductsMaster } = trpc.inventory.domesticProduct.list.useQuery();
  // 指定年月の国内卸発注行を取得
  const { data: domesticItemsRaw, refetch: refetchDomesticItems } = trpc.inventory.monthlyDomesticItem.list.useQuery(
    { yearMonth },
    { enabled: !!yearMonth }
  );
  const createDomesticItemMutation = trpc.inventory.monthlyDomesticItem.create.useMutation({
    onSuccess: () => { void refetchDomesticItems(); },
    onError: (e) => toast.error(`追加失敗: ${e.message}`),
  });
  const updateDomesticItemMutation = trpc.inventory.monthlyDomesticItem.update.useMutation({
    onError: (e) => toast.error(`更新失敗: ${e.message}`),
  });
  const togglePaidMutation = trpc.inventory.monthlyDomesticItem.togglePaid.useMutation({
    onSuccess: () => { void refetchDomesticItems(); },
    onError: (e) => toast.error(`更新失敗: ${e.message}`),
  });
  const deleteDomesticItemMutation = trpc.inventory.monthlyDomesticItem.delete.useMutation({
    onSuccess: () => { void refetchDomesticItems(); },
    onError: (e) => toast.error(`削除失敗: ${e.message}`),
  });
  // 国内卸発注行の編集状態
  const [domesticEdits, setDomesticEdits] = useState<Record<number, { title: string; quantity: string; unitPrice: string; supplierName: string; note: string }>>({}); 
  // 新規手動入力行の状態
  const [newDomesticRow, setNewDomesticRow] = useState({ title: "", quantity: "1", unitPrice: "", supplierName: "", note: "" });
  // マスタ選択ドロップダウンの選択値
  const [selectedMasterId, setSelectedMasterId] = useState<string>("");
  // マスタ選択時の数量
  const [selectedMasterQuantity, setSelectedMasterQuantity] = useState<string>("1");

  // 国内卸発注行の小計計算
  const domesticItemsTotal = useMemo(() => {
    if (!domesticItemsRaw) return 0;
    return domesticItemsRaw.reduce((sum, item) => {
      const up = item.unitPrice != null ? parseFloat(String(item.unitPrice)) : 0;
      return sum + up * item.quantity;
    }, 0);
  }, [domesticItemsRaw]);

  // 支払済み合計
  const domesticPaidTotal = useMemo(() => {
    if (!domesticItemsRaw) return 0;
    return domesticItemsRaw
      .filter((item) => item.isPaid)
      .reduce((sum, item) => {
        const up = item.unitPrice != null ? parseFloat(String(item.unitPrice)) : 0;
        return sum + up * item.quantity;
      }, 0);
  }, [domesticItemsRaw]);

  // 未払い合計
  const domesticUnpaidTotal = useMemo(() => {
    if (!domesticItemsRaw) return 0;
    return domesticItemsRaw
      .filter((item) => !item.isPaid)
      .reduce((sum, item) => {
        const up = item.unitPrice != null ? parseFloat(String(item.unitPrice)) : 0;
        return sum + up * item.quantity;
      }, 0);
  }, [domesticItemsRaw]);

  // 国内卸マスタから行を追加
  const handleAddFromMaster = () => {
    if (!selectedMasterId) return;
    const master = (domesticProductsMaster ?? []).find((p) => String(p.id) === selectedMasterId);
    if (!master) return;
    createDomesticItemMutation.mutate({
      yearMonth,
      domesticProductId: master.id,
      title: master.title,
      quantity: parseInt(selectedMasterQuantity) || 1,
      unitPrice: master.unitPrice != null ? parseFloat(String(master.unitPrice)) : null,
      supplierName: master.supplierName ?? null,
      note: master.note ?? null,
    });
    setSelectedMasterId("");
    setSelectedMasterQuantity("1");
  };

  // 手動入力行を追加
  const handleAddManualDomestic = () => {
    if (!newDomesticRow.title.trim()) { toast.error("商品名を入力してください"); return; }
    createDomesticItemMutation.mutate({
      yearMonth,
      title: newDomesticRow.title.trim(),
      quantity: parseInt(newDomesticRow.quantity) || 1,
      unitPrice: newDomesticRow.unitPrice ? parseFloat(newDomesticRow.unitPrice) : null,
      supplierName: newDomesticRow.supplierName.trim() || null,
      note: newDomesticRow.note.trim() || null,
    });
    setNewDomesticRow({ title: "", quantity: "1", unitPrice: "", supplierName: "", note: "" });
  };

  // 在庫サマリーのカテゴリ別集計
  const categorySummary = useMemo(() => {
    if (!previewData) return [];
    const map = new Map<string, { items: InventorySummaryItem[]; total: number | null }>();
    for (const item of previewData.inventorySummary) {
      const existing = map.get(item.category);
      if (existing) {
        existing.items.push(item);
        if (item.totalValue != null) {
          existing.total = (existing.total ?? 0) + item.totalValue;
        }
      } else {
        map.set(item.category, { items: [item], total: item.totalValue });
      }
    }
    return Array.from(map.entries()).map(([cat, v]) => ({ category: cat, ...v }));
  }, [previewData]);

  // カテゴリ一覧（絞り込み用）
  const allCategories = useMemo(() => {
    return categorySummary.map((c) => c.category);
  }, [categorySummary]);

  // 絞り込み後のカテゴリサマリー
  const filteredCategorySummary = useMemo(() => {
    if (selectedCategory === "all") return categorySummary;
    return categorySummary.filter((c) => c.category === selectedCategory);
  }, [categorySummary, selectedCategory]);

  const grandTotal = useMemo(() => {
    let total = 0;
    for (const cat of categorySummary) {
      for (const item of cat.items) {
        const key = `${cat.category}__${item.title}__${cat.items.indexOf(item)}`;
        const up = item.unitPrice ?? inventoryPriceOverrides[key] ?? null;
        if (up != null) total += up * item.quantity;
      }
    }
    return total;
  }, [categorySummary, inventoryPriceOverrides]);

  const filteredTotal = useMemo(() => {
    let total = 0;
    for (const cat of filteredCategorySummary) {
      for (const item of cat.items) {
        const key = `${cat.category}__${item.title}__${cat.items.indexOf(item)}`;
        const up = item.unitPrice ?? inventoryPriceOverrides[key] ?? null;
        if (up != null) total += up * item.quantity;
      }
    }
    return total;
  }, [filteredCategorySummary, inventoryPriceOverrides]);

  // インボイスの展開トグル
  const toggleInvoice = (invoiceNo: string) => {
    setExpandedInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceNo)) next.delete(invoiceNo);
      else next.add(invoiceNo);
      return next;
    });
  };

  // 仕入れ単価の取得（オーバーライド > Zaico単価）
  const getUnitPrice = (itemKey: string, defaultPrice: number | null): number | null => {
    if (itemKey in costOverrides) return costOverrides[itemKey];
    return defaultPrice;
  };

  // 仕入れ単価の変更
  const handleCostChange = (itemKey: string, value: string) => {
    const num = value === "" ? null : parseFloat(value);
    setCostOverrides((prev) => ({ ...prev, [itemKey]: isNaN(num as number) ? null : num }));
  };

  // レポート保存
  const handleSave = () => {
    if (!previewData) return;
    saveMutation.mutate({
      yearMonth,
      label: label || `${yearMonth} 棚卸しレポート`,
      inventorySummaryJson: JSON.stringify(previewData.inventorySummary),
      invoiceListJson: JSON.stringify(previewData.invoiceList),
    });
  };

  // 保存済みレポートのCSV出力
  const handleExportSavedCSV = (report: { label?: string | null; yearMonth: string; invoiceListJson?: string | null; inventorySummaryJson?: string | null }) => {
    const invList: InvoiceForReport[] = (() => {
      try { return JSON.parse(report.invoiceListJson ?? "[]") as InvoiceForReport[]; } catch { return []; }
    })();
    const invSummary: InventorySummaryItem[] = (() => {
      try { return JSON.parse(report.inventorySummaryJson ?? "[]") as InventorySummaryItem[]; } catch { return []; }
    })();

    const rows: string[][] = [];

    rows.push(["=== 在庫金額サマリー ===", "", "", "", "", ""]);
    rows.push(["カテゴリ", "管理番号", "商品名", "数量", "仕入単価", "在庫金額"]);
    for (const item of invSummary) {
      rows.push([item.category, item.managementNo ?? "", item.title, String(item.quantity), item.unitPrice != null ? String(item.unitPrice) : "", item.totalValue != null ? String(item.totalValue) : ""]);
    }
    const savedGrandTotal = invSummary.reduce((sum, item) => sum + (item.totalValue ?? 0), 0);
    rows.push(["", "", "", "", "合計", String(savedGrandTotal)]);
    rows.push([]);

    rows.push(["=== 支払い済み・未完了インボイス ===", "", "", "", "", "", ""]);
    rows.push(["インボイスNo", "取引相手", "支払日", "商品名", "発注数", "販売価格", "通貨", "取引金額"]);
    for (const inv of invList) {
      for (const p of inv.products) {
        rows.push([inv.invoiceNo, inv.partner, inv.paymentDate, p.name, String(p.qty), p.sellingPrice != null ? String(p.sellingPrice) : "", p.currency, p.tradeAmount != null ? String(p.tradeAmount) : ""]);
      }
    }
    rows.push([]);

    rows.push(["=== インボイス別仕入れコスト ===", "", "", "", "", ""]);
    rows.push(["インボイスNo", "種別", "商品名", "数量", "仕入単価", "小計"]);
    for (const inv of invList) {
      for (const pi of inv.purchaseItems) {
        rows.push([inv.invoiceNo, "発注済み", pi.title, String(pi.quantity), pi.unitPrice != null ? String(pi.unitPrice) : "", pi.unitPrice != null ? String(pi.unitPrice * pi.quantity) : ""]);
      }
      for (const si of inv.stockItems) {
        rows.push([inv.invoiceNo, "在庫", si.title, String(si.quantity), si.unitPrice != null ? String(si.unitPrice) : "", si.unitPrice != null ? String(si.unitPrice * si.quantity) : ""]);
      }
    }
    rows.push([]);

    rows.push(["=== 出庫済み商品 ===", "", "", "", "", ""]);
    rows.push(["インボイスNo", "商品名", "出庫数", "仕入単価", "出庫金額", "出庫日", "出庫No"]);
    for (const inv of invList) {
      for (const di of (inv.deliveryItems ?? [])) {
        rows.push([inv.invoiceNo, di.title, String(di.quantity), di.unitPrice != null ? String(di.unitPrice) : "", di.unitPrice != null ? String(di.unitPrice * di.quantity) : "", di.deliveredAt, di.deliveryNo]);
      }
    }

    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `棚卸しレポート_${report.yearMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSVをダウンロードしました");
  };

  // CSV出力
  const handleExportCSV = () => {
    if (!previewData) return;
    const rows: string[][] = [];

    rows.push(["=== 在庫金額サマリー ===", "", "", "", "", ""]);
    rows.push(["カテゴリ", "管理番号", "商品名", "数量", "仕入単価", "在庫金額"]);
    for (const item of previewData.inventorySummary) {
      rows.push([item.category, item.managementNo ?? "", item.title, String(item.quantity), item.unitPrice != null ? String(item.unitPrice) : "", item.totalValue != null ? String(item.totalValue) : ""]);
    }
    rows.push(["", "", "", "", "合計", String(grandTotal)]);
    rows.push([]);

    rows.push(["=== 支払い済み・未完了インボイス ===", "", "", "", "", "", ""]);
    rows.push(["インボイスNo", "取引相手", "支払日", "商品名", "発注数", "販売価格", "通貨", "取引金額"]);
    for (const inv of previewData.invoiceList) {
      for (const p of inv.products) {
        rows.push([inv.invoiceNo, inv.partner, inv.paymentDate, p.name, String(p.qty), p.sellingPrice != null ? String(p.sellingPrice) : "", p.currency, p.tradeAmount != null ? String(p.tradeAmount) : ""]);
      }
    }
    rows.push([]);

    rows.push(["=== インボイス別仕入れコスト ===", "", "", "", "", ""]);
    rows.push(["インボイスNo", "種別", "商品名", "数量", "仕入単価", "小計"]);
    for (const inv of previewData.invoiceList) {
      for (const pi of inv.purchaseItems) {
        const key = `${inv.invoiceNo}__ordered__${pi.zaicoId}`;
        const up = getUnitPrice(key, pi.unitPrice);
        rows.push([inv.invoiceNo, "発注済み", pi.title, String(pi.quantity), up != null ? String(up) : "", up != null ? String(up * pi.quantity) : ""]);
      }
      for (const si of inv.stockItems) {
        const key = `${inv.invoiceNo}__stock__${si.inventoryId}`;
        const up = getUnitPrice(key, si.unitPrice);
        rows.push([inv.invoiceNo, "在庫", si.title, String(si.quantity), up != null ? String(up) : "", up != null ? String(up * si.quantity) : ""]);
      }
    }
    rows.push([]);

    rows.push(["=== 出庫済み商品 ===", "", "", "", "", ""]);
    rows.push(["インボイスNo", "商品名", "出庫数", "仕入単価", "出庫金額", "出庫日", "出庫No"]);
    for (const inv of previewData.invoiceList) {
      for (const di of (inv.deliveryItems ?? [])) {
        rows.push([inv.invoiceNo, di.title, String(di.quantity), di.unitPrice != null ? String(di.unitPrice) : "", di.unitPrice != null ? String(di.unitPrice * di.quantity) : "", di.deliveredAt, di.deliveryNo]);
      }
    }
    rows.push([]);

    // 国内卸発注商品セクション
    if (domesticItemsRaw && domesticItemsRaw.length > 0) {
      rows.push(["=== 国内卸発注商品 ===", "", "", "", ""]);
      rows.push(["商品名", "数量", "仕入単価", "小計", "仕入先"]);
      for (const item of domesticItemsRaw) {
        const up = item.unitPrice != null ? parseFloat(String(item.unitPrice)) : null;
        rows.push([item.title, String(item.quantity), up != null ? String(up) : "", up != null ? String(up * item.quantity) : "", item.supplierName ?? ""]);
      }
      rows.push(["", "", "小計", String(domesticItemsTotal), ""]);
    }


    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `棚卸しレポート_${yearMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSVをダウンロードしました");
  };

  // ============================================================
  // レンダリング
  // ============================================================
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* ページヘッダー */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">月次棚卸しレポート</h1>
            <p className="text-sm text-muted-foreground">月末に棚卸しを行い、在庫金額と仕入れコストを確認します</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("preview")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "preview" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            レポート作成
          </button>
          <button
            onClick={() => setActiveTab("saved")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "saved" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            保存済み ({savedReports?.length ?? 0})
          </button>
        </div>
      </div>

      {/* ========== レポート作成タブ ========== */}
      {activeTab === "preview" && (
        <div className="space-y-6">
          {/* 操作バー */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium whitespace-nowrap">対象年月</label>
                  <Input
                    type="month"
                    value={yearMonth}
                    onChange={(e) => setYearMonth(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="flex items-center gap-2 flex-1 min-w-48">
                  <label className="text-sm font-medium whitespace-nowrap">レポート名</label>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={`${yearMonth} 棚卸しレポート`}
                    className="flex-1"
                  />
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <Button variant="outline" size="sm" onClick={() => refetchPreview()} disabled={previewLoading}>
                    <RefreshCw className={`h-4 w-4 mr-1 ${previewLoading ? "animate-spin" : ""}`} />
                    最新データ取得
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!previewData}>
                    <Download className="h-4 w-4 mr-1" />
                    CSV出力
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={!previewData || saveMutation.isPending}>
                    <Save className="h-4 w-4 mr-1" />
                    保存
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {previewLoading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-3">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span>データを取得中...</span>
            </div>
          )}

          {previewData && (
            <>
              {/* ========== セクション1: 在庫金額サマリー ========== */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Package className="h-4 w-4 text-blue-500" />
                    在庫金額サマリー
                    <Badge variant="secondary" className="ml-2">
                      合計 {fmt(grandTotal)}
                    </Badge>
                    <div className="ml-auto flex items-center gap-2">
                      {/* カテゴリ絞り込み */}
                      <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                        <SelectTrigger className="h-8 w-44 text-xs">
                          <SelectValue placeholder="カテゴリ絞り込み" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">すべてのカテゴリ</SelectItem>
                          {allCategories.filter(cat => cat && cat.trim() !== '').map((cat) => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* 表示/非表示トグル */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowInventorySummary((v) => !v)}
                        className="h-8 px-2 text-xs gap-1"
                      >
                        {showInventorySummary ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {showInventorySummary ? "非表示" : "表示"}
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                {showInventorySummary && (
                  <CardContent className="p-0">
                    {filteredCategorySummary.length === 0 && (
                      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                        該当するカテゴリがありません
                      </div>
                    )}
                    {filteredCategorySummary.map((cat) => (
                      <div key={cat.category}>
                        {/* カテゴリヘッダー */}
                        <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-t">
                          <span className="text-sm font-semibold text-foreground">{cat.category}</span>
                          <span className="text-sm font-semibold">{fmt(cat.total)}</span>
                        </div>
                        {/* 商品行 */}
                        <table className="w-full text-sm">
                          <tbody>
                            {cat.items.map((item, idx) => {
                              const priceKey = `${cat.category}__${item.title}__${idx}`;
                              const overridePrice = inventoryPriceOverrides[priceKey] ?? null;
                              const effectivePrice = item.unitPrice ?? overridePrice;
                              const effectiveTotal = effectivePrice != null ? effectivePrice * item.quantity : null;
                              return (
                              <tr key={idx} className="border-b last:border-b-0 hover:bg-muted/20">
                                <td className="px-6 py-2 w-44 font-mono text-xs text-muted-foreground">{item.managementNo || "—"}</td>
                                <td className="px-6 py-2 text-muted-foreground">{item.title}</td>
                                <td className="px-4 py-2 text-right w-20">{item.quantity}個</td>
                                <td className="px-4 py-2 text-right w-44 text-muted-foreground">
                                  {item.unitPrice != null ? (
                                    <span>{fmt(item.unitPrice)} / 個</span>
                                  ) : (
                                    <div className="flex items-center justify-end gap-1">
                                      <Input
                                        type="number"
                                        value={overridePrice != null ? String(overridePrice) : ""}
                                        onChange={(e) => handleInventoryPriceChange(priceKey, e.target.value)}
                                        placeholder="単価入力"
                                        className="h-6 w-24 text-right text-xs"
                                      />
                                      <span className="text-xs text-muted-foreground">円</span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right w-28 font-medium">
                                  {effectiveTotal != null ? fmt(effectiveTotal) : (
                                    <span className="text-amber-500 text-xs">-</span>
                                  )}
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                    {/* 総合計 */}
                    <div className="flex items-center justify-between px-4 py-3 bg-primary/5 border-t font-semibold">
                      <span>{selectedCategory === "all" ? "総合計" : `${selectedCategory} 合計`}</span>
                      <span className="text-lg text-primary">{fmt(filteredTotal)}</span>
                    </div>
                  </CardContent>
                )}
              </Card>

              {/* ========== セクション2: 支払い済み・未完了インボイス ========== */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShoppingCart className="h-4 w-4 text-orange-500" />
                    支払い済み・未完了インボイス
                    <Badge variant="secondary" className="ml-auto">
                      {previewData.invoiceList.length}件
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {previewData.invoiceList.length === 0 && (
                    <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-sm">支払い済み・未完了のインボイスはありません</span>
                    </div>
                  )}
                  {previewData.invoiceList.map((inv) => {
                    const isExpanded = expandedInvoices.has(inv.invoiceNo);
                    const domestic = parseDomesticNote(inv.domesticNote);

                    // 仕入れコスト計算（オーバーライド込み）
                    let purchaseCostTotal = 0;
                    let purchaseCostHasNull = false;
                    for (const pi of inv.purchaseItems) {
                      const key = `${inv.invoiceNo}__ordered__${pi.zaicoId}`;
                      const up = getUnitPrice(key, pi.unitPrice);
                      if (up != null) purchaseCostTotal += up * pi.quantity;
                      else purchaseCostHasNull = true;
                    }
                    let stockCostTotal = 0;
                    let stockCostHasNull = false;
                    for (const si of inv.stockItems) {
                      const key = `${inv.invoiceNo}__stock__${si.inventoryId}`;
                      const up = getUnitPrice(key, si.unitPrice);
                      if (up != null) stockCostTotal += up * si.quantity;
                      else stockCostHasNull = true;
                    }
                    // 手動入力行の小計も在庫合計に加算
                    const manualItemsForInv = manualItemsMap[inv.invoiceNo] ?? [];
                    let manualCostTotal = 0;
                    for (const mi of manualItemsForInv) {
                      const edit = manualEdits[mi.id];
                      const up = edit ? parseFloat(edit.unitPrice) : (mi.unitPrice != null ? parseFloat(mi.unitPrice) : null);
                      const qty = edit ? parseInt(edit.quantity, 10) : mi.quantity;
                      if (up != null && !isNaN(up) && qty > 0) manualCostTotal += up * qty;
                    }
                    const combinedTotal = purchaseCostTotal + stockCostTotal + manualCostTotal;

                    // 出庫済みコスト計算
                    let deliveryCostTotal = 0;
                    let deliveryCostHasNull = false;
                    for (const di of (inv.deliveryItems ?? [])) {
                      if (di.unitPrice != null) deliveryCostTotal += di.unitPrice * di.quantity;
                      else deliveryCostHasNull = true;
                    }

                    // 取引金額合計（外貨）
                    const tradeTotals = inv.products.reduce((acc, p) => {
                      if (p.tradeAmount == null) return acc;
                      const cur = p.currency || "?";
                      acc[cur] = (acc[cur] ?? 0) + p.tradeAmount;
                      return acc;
                    }, {} as Record<string, number>);

                    return (
                      <div key={inv.invoiceNo} className="border-t">
                        {/* インボイスヘッダー */}
                        <button
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                          onClick={() => toggleInvoice(inv.invoiceNo)}
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                          <span className="font-semibold text-sm w-16">No.{inv.invoiceNo}</span>
                          <span className="text-sm text-muted-foreground w-20">{inv.partner}</span>
                          <span className="text-xs text-muted-foreground">{fmtDate(inv.paymentDate)}</span>
                          {domestic.isDomestic && (
                            <Badge variant="outline" className="text-xs border-green-400 text-green-600 ml-1">国内卸使用</Badge>
                          )}
                          <div className="ml-auto flex items-center gap-4 text-sm">
                            {Object.entries(tradeTotals).map(([cur, amt]) => (
                              <span key={cur} className="text-orange-600 font-medium">{fmtForeign(amt, cur)}</span>
                            ))}
                            <span className="text-muted-foreground text-xs">仕入れ: {purchaseCostHasNull || stockCostHasNull ? "~" : ""}{fmt(combinedTotal)}</span>
                          </div>
                        </button>

                        {/* 展開詳細 */}
                        {isExpanded && (
                          <div className="px-4 pb-4 space-y-4 bg-muted/10">
                            {/* 国内卸メモ */}
                            {domestic.isDomestic && (
                              <div className="flex items-start gap-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800 text-sm">
                                <AlertCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                                <div>
                                  <span className="font-medium text-green-700 dark:text-green-400">国内卸使用メモ：</span>
                                  <span className="text-green-700 dark:text-green-400 ml-1">{domestic.detail}</span>
                                </div>
                              </div>
                            )}

                            {/* 商品一覧（CSV発注情報） */}
                            <div>
                              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">取引データ発注商品</h4>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-xs text-muted-foreground border-b">
                                    <th className="text-left pb-1 font-medium">商品名</th>
                                    <th className="text-right pb-1 font-medium w-16">発注数</th>
                                    <th className="text-right pb-1 font-medium w-28">販売価格</th>
                                    <th className="text-right pb-1 font-medium w-28">取引金額</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {inv.products.map((p, i) => (
                                    <tr key={i} className="border-b last:border-b-0">
                                      <td className="py-1.5">{p.name}</td>
                                      <td className="py-1.5 text-right">{p.qty}個</td>
                                      <td className="py-1.5 text-right text-muted-foreground">{fmtForeign(p.sellingPrice, p.currency)}</td>
                                      <td className="py-1.5 text-right font-medium text-orange-600">{fmtForeign(p.tradeAmount, p.currency)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <Separator />

                            {/* 発注済み商品（Zaico）の仕入れコスト */}
                            {inv.purchaseItems.length > 0 && (
                              <div>
                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">発注済み商品（仕入れコスト）</h4>
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-xs text-muted-foreground border-b">
                                      <th className="text-left pb-1 font-medium">商品名</th>
                                      <th className="text-right pb-1 font-medium w-16">数量</th>
                                      <th className="text-right pb-1 font-medium w-36">仕入単価（¥）</th>
                                      <th className="text-right pb-1 font-medium w-28">小計</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {inv.purchaseItems.map((pi) => {
                                      const key = `${inv.invoiceNo}__ordered__${pi.zaicoId}`;
                                      const up = getUnitPrice(key, pi.unitPrice);
                                      const subtotal = up != null ? up * pi.quantity : null;
                                      return (
                                        <tr key={pi.zaicoId} className="border-b last:border-b-0">
                                          <td className="py-1.5">{pi.title}</td>
                                          <td className="py-1.5 text-right">{pi.quantity}個</td>
                                          <td className="py-1.5 text-right">
                                            <Input
                                              type="number"
                                              value={up != null ? String(up) : ""}
                                              onChange={(e) => handleCostChange(key, e.target.value)}
                                              placeholder={pi.unitPrice != null ? String(pi.unitPrice) : "単価を入力"}
                                              className="h-7 w-32 text-right text-sm ml-auto"
                                            />
                                          </td>
                                          <td className="py-1.5 text-right font-medium">
                                            {subtotal != null ? fmt(subtotal) : <span className="text-amber-500 text-xs">未入力</span>}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                    <tr className="bg-muted/30">
                                      <td colSpan={3} className="py-1.5 px-2 text-right text-xs font-semibold">発注済み合計</td>
                                      <td className="py-1.5 text-right font-semibold text-sm">
                                        {purchaseCostHasNull ? "~" : ""}{fmt(purchaseCostTotal)}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* 在庫商品の仕入れコスト */}
                            {inv.stockItems.length > 0 && (
                              <div>
                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">在庫商品（仕入れコスト）</h4>
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-xs text-muted-foreground border-b">
                                      <th className="text-left pb-1 font-medium">商品名</th>
                                      <th className="text-right pb-1 font-medium w-16">数量</th>
                                      <th className="text-right pb-1 font-medium w-36">仕入単価（¥）</th>
                                      <th className="text-right pb-1 font-medium w-28">小計</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {inv.stockItems.map((si) => {
                                      const key = `${inv.invoiceNo}__stock__${si.inventoryId}`;
                                      const up = getUnitPrice(key, si.unitPrice);
                                      const subtotal = up != null ? up * si.quantity : null;
                                      return (
                                        <tr key={si.inventoryId} className="border-b last:border-b-0">
                                          <td className="py-1.5">{si.title}</td>
                                          <td className="py-1.5 text-right">{si.quantity}個</td>
                                          <td className="py-1.5 text-right">
                                            <Input
                                              type="number"
                                              value={up != null ? String(up) : ""}
                                              onChange={(e) => handleCostChange(key, e.target.value)}
                                              placeholder={si.unitPrice != null ? String(si.unitPrice) : "単価を入力"}
                                              className="h-7 w-32 text-right text-sm ml-auto"
                                            />
                                          </td>
                                          <td className="py-1.5 text-right font-medium">
                                            {subtotal != null ? fmt(subtotal) : <span className="text-amber-500 text-xs">未入力</span>}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                    <tr className="bg-muted/30">
                                      <td colSpan={3} className="py-1.5 px-2 text-right text-xs font-semibold">在庫合計</td>
                                      <td className="py-1.5 text-right font-semibold text-sm">
                                        {stockCostHasNull ? "~" : ""}{fmt(stockCostTotal)}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* 手動入力行 */}
                            <div>
                              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                                手動入力商品
                              </h4>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-xs text-muted-foreground border-b">
                                    <th className="text-left pb-1 font-medium">商品名</th>
                                    <th className="text-right pb-1 font-medium w-24">数量</th>
                                    <th className="text-right pb-1 font-medium w-36">仕入単価（￥）</th>
                                    <th className="text-right pb-1 font-medium w-28">小計</th>
                                    <th className="w-8" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {manualItemsForInv.map((mi) => {
                                    const edit = manualEdits[mi.id];
                                    const titleVal = edit ? edit.title : mi.title;
                                    const qtyVal = edit ? edit.quantity : String(mi.quantity);
                                    const upVal = edit ? edit.unitPrice : (mi.unitPrice != null ? mi.unitPrice : "");
                                    const upNum = parseFloat(upVal);
                                    const qtyNum = parseInt(qtyVal, 10);
                                    const subtotal = !isNaN(upNum) && upNum > 0 && qtyNum > 0 ? upNum * qtyNum : null;
                                    const saveEdit = () => {
                                      if (!edit) return;
                                      updateManualItemMutation.mutate({
                                        id: mi.id,
                                        title: edit.title,
                                        quantity: parseInt(edit.quantity, 10) || 1,
                                        unitPrice: edit.unitPrice.trim() === "" || Number.isNaN(parseFloat(edit.unitPrice)) ? null : parseFloat(edit.unitPrice),
                                      }, {
                                        onSuccess: () => {
                                          setManualEdits((prev) => { const next = { ...prev }; delete next[mi.id]; return next; });
                                          void refetchManualItems();
                                        },
                                      });
                                    };
                                    return (
                                      <tr key={mi.id} className="border-b last:border-b-0 group">
                                        <td className="py-1.5">
                                          <Input
                                            value={titleVal}
                                            onChange={(e) => setManualEdits((prev) => ({ ...prev, [mi.id]: { title: e.target.value, quantity: qtyVal, unitPrice: upVal } }))}
                                            onBlur={saveEdit}
                                            placeholder="商品名"
                                            className="h-7 text-sm"
                                          />
                                        </td>
                                        <td className="py-1.5 text-right">
                                          <Input
                                            type="number"
                                            value={qtyVal}
                                            onChange={(e) => setManualEdits((prev) => ({ ...prev, [mi.id]: { title: titleVal, quantity: e.target.value, unitPrice: upVal } }))}
                                            onBlur={saveEdit}
                                            placeholder="1"
                                            className="h-7 w-20 text-right text-sm ml-auto"
                                          />
                                        </td>
                                        <td className="py-1.5 text-right">
                                          <Input
                                            type="number"
                                            value={upVal}
                                            onChange={(e) => setManualEdits((prev) => ({ ...prev, [mi.id]: { title: titleVal, quantity: qtyVal, unitPrice: e.target.value } }))}
                                            onBlur={saveEdit}
                                            placeholder="単価を入力"
                                            className="h-7 w-32 text-right text-sm ml-auto"
                                          />
                                        </td>
                                        <td className="py-1.5 text-right font-medium">
                                          {subtotal != null ? fmt(subtotal) : <span className="text-amber-500 text-xs">未入力</span>}
                                        </td>
                                        <td className="py-1.5 text-center">
                                          <button
                                            onClick={() => deleteManualItemMutation.mutate({ id: mi.id })}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                          >
                                            <X className="h-3.5 w-3.5" />
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  {manualItemsForInv.length > 0 && (
                                    <tr className="bg-muted/20">
                                      <td colSpan={3} className="py-1.5 px-2 text-right text-xs font-semibold">手動入力合計</td>
                                      <td className="py-1.5 text-right font-semibold text-sm">{fmt(manualCostTotal)}</td>
                                      <td />
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="mt-2 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => createManualItemMutation.mutate({ invoiceNo: inv.invoiceNo, title: "", quantity: 1, unitPrice: null })}
                                disabled={createManualItemMutation.isPending}
                              >
                                <PlusCircle className="h-3.5 w-3.5 mr-1" />
                                行を追加
                              </Button>
                            </div>

                            {/* 出庫済み商品一覧 */}
                            {(inv.deliveryItems ?? []).length > 0 && (
                              <div>
                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                                  <Truck className="h-3.5 w-3.5" />
                                  出庫済み商品
                                </h4>
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-xs text-muted-foreground border-b">
                                      <th className="text-left pb-1 font-medium">商品名</th>
                                      <th className="text-right pb-1 font-medium w-16">出庫数</th>
                                      <th className="text-right pb-1 font-medium w-28">仕入単価</th>
                                      <th className="text-right pb-1 font-medium w-28">出庫金額</th>
                                      <th className="text-right pb-1 font-medium w-28 hidden sm:table-cell">出庫日</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(inv.deliveryItems ?? []).map((di, idx) => {
                                      const subtotal = di.unitPrice != null ? di.unitPrice * di.quantity : null;
                                      return (
                                        <tr key={idx} className="border-b last:border-b-0">
                                          <td className="py-1.5">{di.title}</td>
                                          <td className="py-1.5 text-right">{di.quantity}個</td>
                                          <td className="py-1.5 text-right text-muted-foreground">
                                            {di.unitPrice != null ? fmt(di.unitPrice) : <span className="text-amber-500 text-xs">未設定</span>}
                                          </td>
                                          <td className="py-1.5 text-right font-medium text-blue-600">
                                            {subtotal != null ? fmt(subtotal) : "-"}
                                          </td>
                                          <td className="py-1.5 text-right text-xs text-muted-foreground hidden sm:table-cell">
                                            {new Date(di.deliveredAt).toLocaleDateString("ja-JP")}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                    <tr className="bg-blue-50 dark:bg-blue-950/20">
                                      <td colSpan={3} className="py-1.5 px-2 text-right text-xs font-semibold">出庫合計</td>
                                      <td className="py-1.5 text-right font-semibold text-sm text-blue-600">
                                        {deliveryCostHasNull ? "~" : ""}{fmt(deliveryCostTotal)}
                                      </td>
                                      <td className="hidden sm:table-cell" />
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {(inv.deliveryItems ?? []).length === 0 && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                                <Truck className="h-3.5 w-3.5" />
                                <span>このインボイスの出庫履歴はありません（削除済み商品の出庫は表示されません）</span>
                              </div>
                            )}

                            {/* 合計サマリー */}
                            <div className="flex justify-end">
                              <div className="bg-primary/5 border rounded-lg px-4 py-3 text-sm space-y-1 min-w-48">
                                <div className="flex justify-between gap-8">
                                  <span className="text-muted-foreground">発注済み合計</span>
                                  <span>{purchaseCostHasNull ? "~" : ""}{fmt(purchaseCostTotal)}</span>
                                </div>
                                <div className="flex justify-between gap-8">
                                  <span className="text-muted-foreground">在庫合計</span>
                                  <span>{stockCostHasNull ? "~" : ""}{fmt(stockCostTotal)}</span>
                                </div>
                                {manualCostTotal > 0 && (
                                  <div className="flex justify-between gap-8">
                                    <span className="text-muted-foreground">手動入力合計</span>
                                    <span>{fmt(manualCostTotal)}</span>
                                  </div>
                                )}
                                {(inv.deliveryItems ?? []).length > 0 && (
                                  <div className="flex justify-between gap-8">
                                    <span className="text-muted-foreground">出庫合計</span>
                                    <span className="text-blue-600">{deliveryCostHasNull ? "~" : ""}{fmt(deliveryCostTotal)}</span>
                                  </div>
                                )}
                                <Separator className="my-1" />
                                <div className="flex justify-between gap-8 font-semibold">
                                  <span>仕入れコスト合計</span>
                                  <span className="text-primary">{purchaseCostHasNull || stockCostHasNull ? "~" : ""}{fmt(combinedTotal)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* ===== 全インボイス 総合計サマリー ===== */}
                  {previewData.invoiceList.length > 0 && (() => {
                    let totalPurchase = 0, totalPurchaseHasNull = false;
                    let totalStock = 0, totalStockHasNull = false;
                    let totalManual = 0; // eslint-disable-line @typescript-eslint/no-unused-vars
                    let totalDelivery = 0, totalDeliveryHasNull = false;
                    const tradeSumByCurrency: Record<string, number> = {};

                    for (const inv of previewData.invoiceList) {
                      // 発注済み
                      for (const pi of inv.purchaseItems) {
                        const key = `${inv.invoiceNo}__ordered__${pi.zaicoId}`;
                        const up = getUnitPrice(key, pi.unitPrice);
                        if (up != null) totalPurchase += up * pi.quantity;
                        else totalPurchaseHasNull = true;
                      }
                      // 在庫
                      for (const si of inv.stockItems) {
                        const key = `${inv.invoiceNo}__stock__${si.inventoryId}`;
                        const up = getUnitPrice(key, si.unitPrice);
                        if (up != null) totalStock += up * si.quantity;
                        else totalStockHasNull = true;
                      }
                      // 手動入力
                      const manualForInv = manualItemsMap[inv.invoiceNo] ?? [];
                      for (const mi of manualForInv) {
                        const edit = manualEdits[mi.id];
                        const up = edit ? parseFloat(edit.unitPrice) : (mi.unitPrice != null ? parseFloat(mi.unitPrice) : null);
                        const qty = edit ? parseInt(edit.quantity, 10) : mi.quantity;
                        if (up != null && !isNaN(up) && qty > 0) totalManual += up * qty;
                      }
                      // 出庫済み
                      for (const di of (inv.deliveryItems ?? [])) {
                        if (di.unitPrice != null) totalDelivery += di.unitPrice * di.quantity;
                        else totalDeliveryHasNull = true;
                      }
                      // 取引金額（外貨）
                      for (const p of inv.products) {
                        if (p.tradeAmount != null) {
                          const cur = p.currency || "?";
                          tradeSumByCurrency[cur] = (tradeSumByCurrency[cur] ?? 0) + p.tradeAmount;
                        }
                      }
                    }
                    return (
                      <div className="border-t pt-4 mt-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">全インボイス 総合計</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="rounded-lg bg-muted/30 border p-3 text-center">
                            <p className="text-xs text-muted-foreground font-medium mb-1">発注済み</p>
                            <p className="text-lg font-bold text-foreground">{totalPurchaseHasNull ? "~" : ""}{fmt(totalPurchase)}</p>
                          </div>
                          <div className="rounded-lg bg-muted/30 border p-3 text-center">
                            <p className="text-xs text-muted-foreground font-medium mb-1">在庫</p>
                            <p className="text-lg font-bold text-foreground">{totalStockHasNull ? "~" : ""}{fmt(totalStock + totalManual)}</p>
                          </div>
                          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-center">
                            <p className="text-xs text-blue-700 dark:text-blue-400 font-medium mb-1">出庫済み</p>
                            <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{totalDeliveryHasNull ? "~" : ""}{fmt(totalDelivery)}</p>
                          </div>
                          <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 p-3 text-center">
                            <p className="text-xs text-orange-700 dark:text-orange-400 font-medium mb-1">取引金額</p>
                            <div className="space-y-0.5">
                              {Object.entries(tradeSumByCurrency).map(([cur, amt]) => (
                                <p key={cur} className="text-lg font-bold text-orange-700 dark:text-orange-400">{fmtForeign(amt, cur)}</p>
                              ))}
                              {Object.keys(tradeSumByCurrency).length === 0 && <p className="text-lg font-bold text-orange-700 dark:text-orange-400">-</p>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                </CardContent>
              </Card>
              {/* ========== 国内卸発注商品セクション ========== */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Truck className="h-4 w-4 text-green-600" />
                    国内卸発注商品
                    <Badge variant="secondary" className="ml-2">
                      小計 {fmt(domesticItemsTotal)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* 登録済み行一覧 */}
                  {domesticItemsRaw && domesticItemsRaw.length > 0 ? (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/30 text-xs text-muted-foreground">
                            <th className="text-left px-3 py-2 font-medium">商品名</th>
                            <th className="text-right px-3 py-2 font-medium w-20">数量</th>
                            <th className="text-right px-3 py-2 font-medium w-28">仕入単価</th>
                            <th className="text-right px-3 py-2 font-medium w-28">小計</th>
                            <th className="text-left px-3 py-2 font-medium w-28">仕入先</th>
                            <th className="text-center px-3 py-2 font-medium w-20">支払</th>
                            <th className="px-3 py-2 w-20"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {domesticItemsRaw.map((item) => {
                            const isEditing = item.id in domesticEdits;
                            const subtotal = item.unitPrice != null ? parseFloat(String(item.unitPrice)) * item.quantity : null;
                            return (
                              <tr key={item.id} className="border-t hover:bg-muted/10">
                                {isEditing ? (
                                  <>
                                    <td className="px-2 py-1.5">
                                      <Input value={domesticEdits[item.id].title} onChange={(e) => setDomesticEdits((v) => ({ ...v, [item.id]: { ...v[item.id], title: e.target.value } }))} className="h-7 text-sm" />
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <Input type="number" value={domesticEdits[item.id].quantity} onChange={(e) => setDomesticEdits((v) => ({ ...v, [item.id]: { ...v[item.id], quantity: e.target.value } }))} className="h-7 text-sm text-right" min="1" />
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <Input type="number" value={domesticEdits[item.id].unitPrice} onChange={(e) => setDomesticEdits((v) => ({ ...v, [item.id]: { ...v[item.id], unitPrice: e.target.value } }))} className="h-7 text-sm text-right" placeholder="例: 3500" />
                                    </td>
                                    <td className="px-2 py-1.5 text-right text-muted-foreground text-xs">-</td>
                                    <td className="px-2 py-1.5">
                                      <Input value={domesticEdits[item.id].supplierName} onChange={(e) => setDomesticEdits((v) => ({ ...v, [item.id]: { ...v[item.id], supplierName: e.target.value } }))} className="h-7 text-sm" placeholder="例: toynet" />
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                      {/* 編集中は支払フラグ変更不可 */}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <div className="flex gap-1 justify-end">
                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={() => {
                                          const ed = domesticEdits[item.id];
                                          updateDomesticItemMutation.mutate({
                                            id: item.id,
                                            title: ed.title,
                                            quantity: parseInt(ed.quantity) || 1,
                                            unitPrice: ed.unitPrice ? parseFloat(ed.unitPrice) : null,
                                            supplierName: ed.supplierName.trim() || null,
                                          }, { onSuccess: () => { void refetchDomesticItems(); setDomesticEdits((v) => { const n = { ...v }; delete n[item.id]; return n; }); } });
                                        }}>
                                          <Save className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDomesticEdits((v) => { const n = { ...v }; delete n[item.id]; return n; })}>
                                          <X className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="px-3 py-2 font-medium">{item.title}</td>
                                    <td className="px-3 py-2 text-right">{item.quantity}個</td>
                                    <td className="px-3 py-2 text-right text-muted-foreground">{item.unitPrice != null ? fmt(parseFloat(String(item.unitPrice))) : <span className="text-amber-500 text-xs">未設定</span>}</td>
                                    <td className="px-3 py-2 text-right font-medium">{subtotal != null ? fmt(subtotal) : "-"}</td>
                                    <td className="px-3 py-2 text-muted-foreground text-xs">{item.supplierName ?? "-"}</td>
                                    <td className="px-3 py-2 text-center">
                                      <button
                                        onClick={() => togglePaidMutation.mutate({ id: item.id, isPaid: !item.isPaid })}
                                        className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${item.isPaid ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
                                        title={item.isPaid ? "クリックして未払いに戻す" : "クリックして支払済みにする"}
                                      >
                                        {item.isPaid ? "支払済" : "未払い"}
                                      </button>
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="flex gap-1 justify-end">
                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDomesticEdits((v) => ({ ...v, [item.id]: { title: item.title, quantity: String(item.quantity), unitPrice: item.unitPrice ?? "", supplierName: item.supplierName ?? "", note: item.note ?? "" } }))}>
                                          <PlusCircle className="h-3.5 w-3.5 rotate-45" />
                                        </Button>
                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteDomesticItemMutation.mutate({ id: item.id })}>
                                          <X className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </td>
                                  </>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">まだ国内卸発注商品が登録されていません。</p>
                  )}

                  {/* マスタから選択追加 */}
                  {domesticProductsMaster && domesticProductsMaster.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Select value={selectedMasterId} onValueChange={setSelectedMasterId}>
                        <SelectTrigger className="h-8 w-56 text-xs">
                          <SelectValue placeholder="マスタから商品を選択..." />
                        </SelectTrigger>
                        <SelectContent>
                          {domesticProductsMaster.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {p.title}{p.unitPrice != null ? ` (¥${parseFloat(String(p.unitPrice)).toLocaleString("ja-JP")})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1">
                        <label className="text-xs text-muted-foreground whitespace-nowrap">数量:</label>
                        <Input
                          type="number"
                          min="1"
                          value={selectedMasterQuantity}
                          onChange={(e) => setSelectedMasterQuantity(e.target.value)}
                          className="h-8 w-16 text-sm text-right"
                        />
                      </div>
                      <Button size="sm" variant="outline" onClick={handleAddFromMaster} disabled={!selectedMasterId || createDomesticItemMutation.isPending}>
                        <PlusCircle className="h-4 w-4 mr-1" />
                        追加
                      </Button>
                    </div>
                  )}

                  {/* 手動入力行追加 */}
                  <div className="border rounded-lg p-3 bg-muted/10 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">手動入力で追加</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="col-span-2 sm:col-span-1">
                        <label className="text-xs text-muted-foreground block mb-1">商品名 <span className="text-destructive">*</span></label>
                        <Input value={newDomesticRow.title} onChange={(e) => setNewDomesticRow((v) => ({ ...v, title: e.target.value }))} placeholder="例: New3DSLL 本体" className="h-8 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">数量</label>
                        <Input type="number" value={newDomesticRow.quantity} onChange={(e) => setNewDomesticRow((v) => ({ ...v, quantity: e.target.value }))} min="1" className="h-8 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">仕入単価（円）</label>
                        <Input type="number" value={newDomesticRow.unitPrice} onChange={(e) => setNewDomesticRow((v) => ({ ...v, unitPrice: e.target.value }))} placeholder="例: 3500" className="h-8 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">仕入先名</label>
                        <Input value={newDomesticRow.supplierName} onChange={(e) => setNewDomesticRow((v) => ({ ...v, supplierName: e.target.value }))} placeholder="例: toynet" className="h-8 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">メモ</label>
                        <Input value={newDomesticRow.note} onChange={(e) => setNewDomesticRow((v) => ({ ...v, note: e.target.value }))} placeholder="任意のメモ" className="h-8 text-sm" />
                      </div>
                    </div>
                    <Button size="sm" onClick={handleAddManualDomestic} disabled={createDomesticItemMutation.isPending}>
                      <PlusCircle className="h-4 w-4 mr-1" />
                      手動入力で追加
                    </Button>
                  </div>

                  {/* 合計金額サマリー */}
                  {domesticItemsRaw && domesticItemsRaw.length > 0 && (
                    <div className="border-t pt-4 mt-2 space-y-3">
                      {/* 件数サマリー */}
                      <div className="flex items-center gap-4 px-1 text-sm text-muted-foreground">
                        <span>合計 <strong className="text-foreground">{domesticItemsRaw.length}</strong> 件</span>
                        <span className="text-green-600">支払済み <strong>{domesticItemsRaw.filter((i) => i.isPaid).length}</strong> 件</span>
                        <span className="text-amber-600">未払い <strong>{domesticItemsRaw.filter((i) => !i.isPaid).length}</strong> 件</span>
                      </div>
                      {/* 金額サマリー：支払済み・未払い・総合計 */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3 text-center">
                          <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">支払済み</p>
                          <p className="text-xl font-bold text-green-700 dark:text-green-400">{fmt(domesticPaidTotal)}</p>
                        </div>
                        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-center">
                          <p className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-1">未払い</p>
                          <p className="text-xl font-bold text-amber-700 dark:text-amber-400">{fmt(domesticUnpaidTotal)}</p>
                        </div>
                        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-center">
                          <p className="text-xs text-blue-700 dark:text-blue-400 font-medium mb-1">国内卸 合計</p>
                          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{fmt(domesticItemsTotal)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ========== 保存済みタブ ========== */}
      {activeTab === "saved" && (
        <div className="space-y-4">
          {(!savedReports || savedReports.length === 0) && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <CalendarDays className="h-10 w-10 opacity-30" />
              <p className="text-sm">保存済みレポートはありません</p>
              <Button variant="outline" size="sm" onClick={() => setActiveTab("preview")}>
                レポートを作成する
              </Button>
            </div>
          )}
          {savedReports?.map((report) => {
            const isSelected = selectedReportId === report.id;
            let invCount = 0;
            try {
              const parsed = JSON.parse(report.invoiceListJson ?? "[]");
              invCount = Array.isArray(parsed) ? parsed.length : 0;
            } catch { /* ignore */ }

            return (
              <Card key={report.id} className={`transition-all ${isSelected ? "ring-2 ring-primary" : "hover:shadow-md"}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <button
                      className="flex items-center gap-3 text-left flex-1 min-w-0"
                      onClick={() => {
                        setSelectedReportId(isSelected ? null : report.id);
                        if (isSelected) setSavedExpandedInvoices(new Set());
                      }}
                    >
                      {isSelected ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{report.label ?? `${report.yearMonth} 棚卸しレポート`}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {report.yearMonth} ・ インボイス {invCount}件 ・ 作成: {new Date(report.createdAt).toLocaleDateString("ja-JP")}
                          {report.createdBy && ` ・ ${report.createdBy}`}
                        </p>
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-muted-foreground hover:text-foreground"
                      onClick={(e) => { e.stopPropagation(); handleExportSavedCSV(report); }}
                      title="CSVダウンロード"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>レポートを削除しますか？</AlertDialogTitle>
                          <AlertDialogDescription>
                            「{report.label ?? `${report.yearMonth} 棚卸しレポート`}」を削除します。この操作は取り消せません。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>キャンセル</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMutation.mutate({ id: report.id })}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            削除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  {/* 展開詳細: 保存済みレポートの内容 */}
                  {isSelected && selectedReport && (
                    <div className="mt-4 border-t pt-4 space-y-4">
                      {/* 在庫金額サマリー */}
                      {savedInventorySummary.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                            <Package className="h-3.5 w-3.5" />
                            在庫金額サマリー
                          </h4>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-muted-foreground border-b">
                                <th className="text-left pb-1 font-medium">カテゴリ</th>
                                <th className="text-left pb-1 font-medium w-44">管理番号</th>
                                <th className="text-left pb-1 font-medium">商品名</th>
                                <th className="text-right pb-1 font-medium w-16">数量</th>
                                <th className="text-right pb-1 font-medium w-28">仕入単価</th>
                                <th className="text-right pb-1 font-medium w-28">在庫金額</th>
                              </tr>
                            </thead>
                            <tbody>
                              {savedInventorySummary.map((item, idx) => (
                                <tr key={idx} className="border-b last:border-b-0 hover:bg-muted/20">
                                  <td className="py-1.5 text-xs text-muted-foreground">{item.category}</td>
                                  <td className="py-1.5 font-mono text-xs text-muted-foreground">{item.managementNo || "—"}</td>
                                  <td className="py-1.5">{item.title}</td>
                                  <td className="py-1.5 text-right">{item.quantity}個</td>
                                  <td className="py-1.5 text-right text-muted-foreground">{item.unitPrice != null ? fmt(item.unitPrice) : <span className="text-amber-500 text-xs">未設定</span>}</td>
                                  <td className="py-1.5 text-right font-medium">{item.totalValue != null ? fmt(item.totalValue) : "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* インボイス一覧 */}
                      {savedInvoiceList.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                            <ShoppingCart className="h-3.5 w-3.5" />
                            インボイス一覧 ({savedInvoiceList.length}件)
                          </h4>
                          <div className="border rounded-lg overflow-hidden">
                            {savedInvoiceList.map((inv) => {
                              const isSavedExpanded = savedExpandedInvoices.has(inv.invoiceNo);
                              const domestic = parseDomesticNote(inv.domesticNote);
                              // コスト計算
                              let purchaseCostTotal = 0;
                              let purchaseCostHasNull = false;
                              for (const pi of inv.purchaseItems) {
                                if (pi.unitPrice != null) purchaseCostTotal += pi.unitPrice * pi.quantity;
                                else purchaseCostHasNull = true;
                              }
                              let stockCostTotal = 0;
                              let stockCostHasNull = false;
                              for (const si of inv.stockItems) {
                                if (si.unitPrice != null) stockCostTotal += si.unitPrice * si.quantity;
                                else stockCostHasNull = true;
                              }
                              let deliveryCostTotal = 0;
                              let deliveryCostHasNull = false;
                              for (const di of (inv.deliveryItems ?? [])) {
                                if (di.unitPrice != null) deliveryCostTotal += di.unitPrice * di.quantity;
                                else deliveryCostHasNull = true;
                              }
                              const combinedTotal = purchaseCostTotal + stockCostTotal;
                              const tradeTotals = inv.products.reduce((acc, p) => {
                                if (p.tradeAmount == null) return acc;
                                const cur = p.currency || "?";
                                acc[cur] = (acc[cur] ?? 0) + p.tradeAmount;
                                return acc;
                              }, {} as Record<string, number>);
                              return (
                                <div key={inv.invoiceNo} className="border-b last:border-b-0">
                                  <button
                                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                                    onClick={() => toggleSavedInvoice(inv.invoiceNo)}
                                  >
                                    {isSavedExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                                    <span className="font-semibold text-sm w-16">No.{inv.invoiceNo}</span>
                                    <span className="text-sm text-muted-foreground w-20">{inv.partner}</span>
                                    <span className="text-xs text-muted-foreground">{fmtDate(inv.paymentDate)}</span>
                                    {domestic.isDomestic && (
                                      <Badge variant="outline" className="text-xs border-green-400 text-green-600 ml-1">国内卸使用</Badge>
                                    )}
                                    <div className="ml-auto flex items-center gap-4 text-sm">
                                      {Object.entries(tradeTotals).map(([cur, amt]) => (
                                        <span key={cur} className="text-orange-600 font-medium">{fmtForeign(amt, cur)}</span>
                                      ))}
                                      <span className="text-muted-foreground text-xs">仕入れ: {purchaseCostHasNull || stockCostHasNull ? "~" : ""}{fmt(combinedTotal)}</span>
                                    </div>
                                  </button>
                                  {isSavedExpanded && (
                                    <div className="px-4 pb-4 space-y-4 bg-muted/10">
                                      {domestic.isDomestic && (
                                        <div className="flex items-start gap-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800 text-sm">
                                          <AlertCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                                          <div>
                                            <span className="font-medium text-green-700 dark:text-green-400">国内卸使用メモ：</span>
                                            <span className="text-green-700 dark:text-green-400 ml-1">{domestic.detail}</span>
                                          </div>
                                        </div>
                                      )}
                                      {/* 発注商品 */}
                                      {inv.products.length > 0 && (
                                        <div>
                                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">取引データ発注商品</h4>
                                          <table className="w-full text-sm">
                                            <thead>
                                              <tr className="text-xs text-muted-foreground border-b">
                                                <th className="text-left pb-1 font-medium">商品名</th>
                                                <th className="text-right pb-1 font-medium w-16">発注数</th>
                                                <th className="text-right pb-1 font-medium w-28">販売価格</th>
                                                <th className="text-right pb-1 font-medium w-28">取引金額</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {inv.products.map((p, idx) => (
                                                <tr key={idx} className="border-b last:border-b-0">
                                                  <td className="py-1.5">{p.name}</td>
                                                  <td className="py-1.5 text-right">{p.qty}個</td>
                                                  <td className="py-1.5 text-right">{p.sellingPrice != null ? fmtForeign(p.sellingPrice, p.currency) : "-"}</td>
                                                  <td className="py-1.5 text-right font-medium text-orange-600">{p.tradeAmount != null ? fmtForeign(p.tradeAmount, p.currency) : "-"}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                      {/* 発注済み商品 */}
                                      {inv.purchaseItems.length > 0 && (
                                        <div>
                                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">発注済み商品</h4>
                                          <table className="w-full text-sm">
                                            <thead>
                                              <tr className="text-xs text-muted-foreground border-b">
                                                <th className="text-left pb-1 font-medium">商品名</th>
                                                <th className="text-right pb-1 font-medium w-16">数量</th>
                                                <th className="text-right pb-1 font-medium w-28">仕入単価</th>
                                                <th className="text-right pb-1 font-medium w-28">小計</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {inv.purchaseItems.map((pi) => {
                                                const subtotal = pi.unitPrice != null ? pi.unitPrice * pi.quantity : null;
                                                return (
                                                  <tr key={pi.zaicoId} className="border-b last:border-b-0">
                                                    <td className="py-1.5">{pi.title}</td>
                                                    <td className="py-1.5 text-right">{pi.quantity}個</td>
                                                    <td className="py-1.5 text-right text-muted-foreground">{pi.unitPrice != null ? fmt(pi.unitPrice) : <span className="text-amber-500 text-xs">未設定</span>}</td>
                                                    <td className="py-1.5 text-right font-medium">{subtotal != null ? fmt(subtotal) : "-"}</td>
                                                  </tr>
                                                );
                                              })}
                                              <tr className="bg-muted/30">
                                                <td colSpan={3} className="py-1.5 px-2 text-right text-xs font-semibold">発注済み合計</td>
                                                <td className="py-1.5 text-right font-semibold text-sm">{purchaseCostHasNull ? "~" : ""}{fmt(purchaseCostTotal)}</td>
                                              </tr>
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                      {/* 在庫商品 */}
                                      {inv.stockItems.length > 0 && (
                                        <div>
                                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">在庫商品</h4>
                                          <table className="w-full text-sm">
                                            <thead>
                                              <tr className="text-xs text-muted-foreground border-b">
                                                <th className="text-left pb-1 font-medium">商品名</th>
                                                <th className="text-right pb-1 font-medium w-16">数量</th>
                                                <th className="text-right pb-1 font-medium w-28">仕入単価</th>
                                                <th className="text-right pb-1 font-medium w-28">小計</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {inv.stockItems.map((si) => {
                                                const subtotal = si.unitPrice != null ? si.unitPrice * si.quantity : null;
                                                return (
                                                  <tr key={si.inventoryId} className="border-b last:border-b-0">
                                                    <td className="py-1.5">{si.title}</td>
                                                    <td className="py-1.5 text-right">{si.quantity}個</td>
                                                    <td className="py-1.5 text-right text-muted-foreground">{si.unitPrice != null ? fmt(si.unitPrice) : <span className="text-amber-500 text-xs">未設定</span>}</td>
                                                    <td className="py-1.5 text-right font-medium">{subtotal != null ? fmt(subtotal) : "-"}</td>
                                                  </tr>
                                                );
                                              })}
                                              <tr className="bg-muted/30">
                                                <td colSpan={3} className="py-1.5 px-2 text-right text-xs font-semibold">在庫合計</td>
                                                <td className="py-1.5 text-right font-semibold text-sm">{stockCostHasNull ? "~" : ""}{fmt(stockCostTotal)}</td>
                                              </tr>
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                      {/* 出庫済み商品 */}
                                      {(inv.deliveryItems ?? []).length > 0 && (
                                        <div>
                                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                                            <Truck className="h-3.5 w-3.5" />
                                            出庫済み商品
                                          </h4>
                                          <table className="w-full text-sm">
                                            <thead>
                                              <tr className="text-xs text-muted-foreground border-b">
                                                <th className="text-left pb-1 font-medium">商品名</th>
                                                <th className="text-right pb-1 font-medium w-16">出庫数</th>
                                                <th className="text-right pb-1 font-medium w-28">仕入単価</th>
                                                <th className="text-right pb-1 font-medium w-28">出庫金額</th>
                                                <th className="text-right pb-1 font-medium w-28 hidden sm:table-cell">出庫日</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {(inv.deliveryItems ?? []).map((di, idx) => {
                                                const subtotal = di.unitPrice != null ? di.unitPrice * di.quantity : null;
                                                return (
                                                  <tr key={idx} className="border-b last:border-b-0">
                                                    <td className="py-1.5">{di.title}</td>
                                                    <td className="py-1.5 text-right">{di.quantity}個</td>
                                                    <td className="py-1.5 text-right text-muted-foreground">{di.unitPrice != null ? fmt(di.unitPrice) : <span className="text-amber-500 text-xs">未設定</span>}</td>
                                                    <td className="py-1.5 text-right font-medium text-blue-600">{subtotal != null ? fmt(subtotal) : "-"}</td>
                                                    <td className="py-1.5 text-right text-xs text-muted-foreground hidden sm:table-cell">{new Date(di.deliveredAt).toLocaleDateString("ja-JP")}</td>
                                                  </tr>
                                                );
                                              })}
                                              <tr className="bg-blue-50 dark:bg-blue-950/20">
                                                <td colSpan={3} className="py-1.5 px-2 text-right text-xs font-semibold">出庫合計</td>
                                                <td className="py-1.5 text-right font-semibold text-sm text-blue-600">{deliveryCostHasNull ? "~" : ""}{fmt(deliveryCostTotal)}</td>
                                                <td className="hidden sm:table-cell" />
                                              </tr>
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                      {/* 小計サマリー */}
                                      <div className="flex justify-end">
                                        <div className="bg-primary/5 border rounded-lg px-4 py-3 text-sm space-y-1 min-w-48">
                                          <div className="flex justify-between gap-8">
                                            <span className="text-muted-foreground">発注済み合計</span>
                                            <span>{purchaseCostHasNull ? "~" : ""}{fmt(purchaseCostTotal)}</span>
                                          </div>
                                          <div className="flex justify-between gap-8">
                                            <span className="text-muted-foreground">在庫合計</span>
                                            <span>{stockCostHasNull ? "~" : ""}{fmt(stockCostTotal)}</span>
                                          </div>
                                          {(inv.deliveryItems ?? []).length > 0 && (
                                            <div className="flex justify-between gap-8">
                                              <span className="text-muted-foreground">出庫合計</span>
                                              <span className="text-blue-600">{deliveryCostHasNull ? "~" : ""}{fmt(deliveryCostTotal)}</span>
                                            </div>
                                          )}
                                          <Separator className="my-1" />
                                          <div className="flex justify-between gap-8 font-semibold">
                                            <span>仕入れコスト合計</span>
                                            <span className="text-primary">{purchaseCostHasNull || stockCostHasNull ? "~" : ""}{fmt(combinedTotal)}</span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
