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
  Download,
  Pencil,
  Check,
  X,
  Undo2,
  Trash2,
  ChevronDown,
  ChevronRight,
  CalendarIcon,
  SortAsc,
  SortDesc,
  ArrowLeft,
  Send,
  Package,
  Edit,
} from "lucide-react";
import { toast } from "sonner";
import { usePagination } from "@/inventory/hooks/usePagination";
import { PaginationBar } from "@/inventory/components/PaginationBar";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  type CancelledItem,
  type FedexShipmentView,
  type HistoryItem,
} from "./delivery-history/types";
import {
  type ShipmentSheetName,
  detectShipmentSheetName,
  isDollarPartnerName,
} from "./delivery-history/shipmentSheets";
import { buildGroupDeliveredSummary } from "./delivery-history/deliveredSummary";
import {
  formatDate,
  getActiveHistoryItems,
  getManagementNo,
  parseCancelledItems,
} from "./delivery-history/display";
import { exportCSV } from "./delivery-history/exportCsv";
import {
  extractDeliveryGroup,
  formatDisplayDeliveryNo,
  resolveHistoryGroup,
} from "./delivery-history/grouping";
import { InventoryDetailToggle } from "./delivery-history/InventoryDetailToggle";
import { CancelConfirmDialog } from "./delivery-history/CancelConfirmDialog";
import { FedexShipmentDialog } from "./delivery-history/FedexShipmentDialog";
import { FedexBatchDialog } from "./delivery-history/FedexBatchDialog";

export { FedexShipmentDialog };
export type { HistoryItem };

export default function DeliveryHistory() {
  const utils = trpc.useUtils();
  const [loadHistoryDetails, setLoadHistoryDetails] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLoadHistoryDetails(true), 900);
    return () => window.clearTimeout(timer);
  }, []);
  const { data: histories, isLoading, refetch } = trpc.inventory.deliveryHistory.list.useQuery({ limit: 200 });
  // 在庫一覧を取得して削除済商品を自動検出
  const { data: inventories } = trpc.inventory.zaico.getInventories.useQuery(undefined, { enabled: loadHistoryDetails });
  const inventoryManagementMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const inv of (inventories ?? []) as Array<{ id: number; etc?: string }>) {
      map.set(inv.id, getManagementNo(inv.etc));
    }
    return map;
  }, [inventories]);
  const withManagementNos = (items: HistoryItem[]) =>
    items.map((item) => ({
      ...item,
      managementNo: item.managementNo || inventoryManagementMap.get(item.inventoryId) || "",
    }));
  // 発注管理サマリー（csvProductsをグループヘッダーに表示するため）
  const { data: orderSummary } = trpc.inventory.orderManagement.getSummary.useQuery(undefined, { enabled: loadHistoryDetails });
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
  const { data: csvRawData } = trpc.inventory.orderManagement.getCsvData.useQuery(undefined, { enabled: loadHistoryDetails });
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
  const shipmentSheetByInvoiceMap = useMemo(() => {
    const map = new Map<string, ShipmentSheetName>();
    for (const [invoiceNo, rows] of csvPriceMap) {
      const partner = rows.find((row) => row.partner?.trim())?.partner;
      if (partner) map.set(invoiceNo, detectShipmentSheetName(partner));
    }
    return map;
  }, [csvPriceMap]);
  // URLパラメータ読み取り（発注管理からのリンク用）
  const [location, setLocation] = useLocation();
  const urlParams = useMemo(() => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    return { group: params.get("group"), date: params.get("date"), historyId: params.get("historyId") };
  }, [location]);
  const highlightedHistoryId = useMemo(() => {
    const id = Number(urlParams.historyId);
    return Number.isFinite(id) && id > 0 ? id : null;
  }, [urlParams.historyId]);

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
      const key = resolveHistoryGroup(
        { deliveryNo: h.deliveryNo, items: withManagementNos(h.items as HistoryItem[]) },
        inventoryManagementMap
      );
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
  }, [filteredHistories, inventoryManagementMap, sortOrder, urlParams.group]);

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

  useEffect(() => {
    if (!highlightedHistoryId) return;
    const timer = window.setTimeout(() => {
      const element = document.getElementById(`delivery-history-${highlightedHistoryId}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [highlightedHistoryId, pagedGroups]);

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
  // FedExバッチ選択モード（出庫履歴ID -> 選択中か）
  const [fedexSelectMode, setFedexSelectMode] = useState(false);
  const [fedexSelectedHistoryIds, setFedexSelectedHistoryIds] = useState<Set<number>>(new Set());
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
    const map = new Map<string, FedexShipmentView[]>();
    if (!fedexShipmentsData) return map;
    for (const s of fedexShipmentsData as FedexShipmentView[]) {
      if (!s.deliveryNo) continue;
      const key = extractDeliveryGroup(s.deliveryNo);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [fedexShipmentsData]);
  // historyId -> 追跡番号リスト（各出庫行に紐付く追跡番号のみ表示するため）
  const fedexByHistoryId = useMemo(() => {
    const map = new Map<number, FedexShipmentView[]>();
    if (!fedexShipmentsData) return map;
    for (const s of fedexShipmentsData as FedexShipmentView[]) {
      if (!s.historyId) continue;
      if (!map.has(s.historyId)) map.set(s.historyId, []);
      map.get(s.historyId)!.push(s);
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
      setFedexSelectedHistoryIds(new Set());
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
    items: Array<{ productNameJa: string; productNameEn: string; quantity: number; managementNo?: string | null }>;
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

  if (isLoading && !histories) {
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
                setFedexSelectedHistoryIds(new Set());
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
            const groupTotalItems = groupHistories.reduce((sum, h) => sum + getActiveHistoryItems(h).length, 0);
            // CSV発注商品名（グループヘッダーに表示）
            const groupCsvProducts = csvProductsMap.get(groupKey) ?? [];
            // 全グループの全アイテムを結合
            const allGroupItems: HistoryItem[] = withManagementNos(groupHistories.flatMap((h) => getActiveHistoryItems(h)));
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
            const isDollarPartner = isDollarPartnerName(groupPartner);
            const groupCurrency = isDollarPartner ? "$" : "€";
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
                const gIsDollarPartner = isDollarPartnerName(gPartner);
                const gAllItems: HistoryItem[] = withManagementNos(gHistories.flatMap((h) => getActiveHistoryItems(h)));
                const gCsvProducts = csvProductsMap.get(gKey) ?? [];
                const gDelivered = buildGroupDeliveredSummary(gCsvProducts, gAllItems);
                for (const csvRow of gCsvPriceRows) {
                  if (csvRow.sellingPrice == null) continue;
                  const matched = gDelivered.find((d) => { const dL = d.name.toLowerCase(); const cL = csvRow.productName.toLowerCase(); return dL.includes(cL) || cL.includes(dL); });
                  const qty = matched ? matched.deliveredQty : 0;
                  if (gIsDollarPartner) dateTotalDollar += csvRow.sellingPrice * qty;
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
                        <Badge className={`text-xs font-bold ${isDollarPartner ? "bg-purple-100 text-purple-700 border-purple-200" : "bg-blue-100 text-blue-700 border-blue-200"} border`}>
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
                          checked={
                            groupHistories.every((h) => fedexSelectedHistoryIds.has(h.id))
                              ? true
                              : groupHistories.some((h) => fedexSelectedHistoryIds.has(h.id))
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={(checked) => {
                            setFedexSelectedHistoryIds((prev) => {
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
                        <span className="text-xs text-blue-700 font-medium">
                          {groupHistories.every((h) => fedexSelectedHistoryIds.has(h.id))
                            ? "このNoを全解除"
                            : groupHistories.some((h) => fedexSelectedHistoryIds.has(h.id))
                              ? "このNoを全選択（一部選択中）"
                              : "このNoを全選択"}
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
            const cancelledItems = parseCancelledItems(history.cancelledItemsJson as string | null);
            const cancelledIds = new Set(cancelledItems.map((c) => c.inventoryId));
            const allItems = withManagementNos(history.items as HistoryItem[]);
            const cancelableItems = allItems.filter(
              (item) => !deletedIds.has(item.inventoryId) && !cancelledIds.has(item.inventoryId)
            );
            const hasCancelledItems = cancelledIds.size > 0;
            const isBatchMode = batchSelectMode === history.id;
            const displayDeliveryNo = formatDisplayDeliveryNo(history.deliveryNo, groupKey);

            return (
              <div
                key={history.id}
                id={`delivery-history-${history.id}`}
                className={`border-t bg-card overflow-hidden scroll-mt-24 ${
                  highlightedHistoryId === history.id ? "ring-2 ring-emerald-500 bg-emerald-50/40" : ""
                }`}
              >
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
                    {fedexSelectMode && (
                      <label className="flex items-center gap-1.5 cursor-pointer select-none mr-1" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={fedexSelectedHistoryIds.has(history.id)}
                          onCheckedChange={(checked) => {
                            setFedexSelectedHistoryIds((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(history.id);
                              else next.delete(history.id);
                              return next;
                            });
                          }}
                          className="h-4 w-4"
                        />
                        <span className="text-xs text-blue-700 font-medium">FedEx</span>
                      </label>
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
                        <span className="font-semibold text-sm">出庫No: {displayDeliveryNo}</span>
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
                      let shipments: FedexShipmentView[];
                      if (byHistoryId.length > 0) {
                        shipments = byHistoryId;
                      } else {
                        // historyId未設定のdeliveryNoベースのもの（既存データ）
                        // deliveryNoが完全一致するものだけ表示（グループキーではなく完全一致）
                        shipments = (fedexShipmentsData as FedexShipmentView[] ?? [])
                            .filter((s) => !s.historyId && s.deliveryNo === history.deliveryNo);
                      }
                      if (shipments.length === 0) return null;
                      return (
                        <div className="flex items-center gap-1 flex-wrap">
                          {shipments.map((s) => {
                            const items = (() => { try { return JSON.parse(s.itemsJson ?? "[]") as Array<{productNameJa:string;productNameEn:string;quantity:number}>; } catch { return []; } })();
                            const statusLabel =
                              s.spreadsheetStatus === "success" ? "スプシ反映済み" :
                              s.spreadsheetStatus === "error" ? `スプシ反映エラー${s.spreadsheetError ? `: ${s.spreadsheetError}` : ""}` :
                              "スプシ反映待ち";
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
                                  title={`FedEx追跡: ${s.trackingNumber} (発送日: ${s.shippingDate}) / ${statusLabel}`}
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
                              labelId={item.labelId}
                              managementNo={item.managementNo}
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
            operatorName: getCurrentWorkWorkerName("野田"),
          })}
          isPending={createFedexMutation.isPending}
          existingShipments={fedexShipmentsMap.get(fedexDialog.groupKey) ?? []}
        />
      )}

      {/* FedExバッチ登録ダイアログ */}
      <FedexBatchDialog
        open={fedexBatchDialog}
        onClose={() => { setFedexBatchDialog(false); }}
        selectedHistoryIds={Array.from(fedexSelectedHistoryIds)}
        groupedHistories={groupedHistories}
        csvProductsMap={csvProductsMap}
        shipmentSheetByInvoiceMap={shipmentSheetByInvoiceMap}
        inventoryManagementMap={inventoryManagementMap}
        initialShippingDate={fedexBarShippingDate}
        initialTrackingNumber={fedexBarTrackingNumber}
        onSubmit={(shippingDate, shipments) => {
          createFedexBatchMutation.mutate({
            shippingDate,
            shipments,
            operatorName: getCurrentWorkWorkerName("野田"),
          });
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
                {fedexSelectedHistoryIds.size > 0 ? (
                  <span className="bg-white text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
                    {fedexSelectedHistoryIds.size}件選択中
                  </span>
                ) : (
                  <span className="text-blue-200 text-xs">出庫履歴を選択してください</span>
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-white hover:bg-blue-600"
                  onClick={() => {
                    const visibleIds = pagedGroups.flatMap(([, histories]) => histories.map((h) => h.id));
                    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => fedexSelectedHistoryIds.has(id));
                    setFedexSelectedHistoryIds((prev) => {
                      const next = new Set(prev);
                      for (const id of visibleIds) {
                        if (allVisibleSelected) next.delete(id);
                        else next.add(id);
                      }
                      return next;
                    });
                  }}
                >
                  {(() => {
                    const visibleIds = pagedGroups.flatMap(([, histories]) => histories.map((h) => h.id));
                    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => fedexSelectedHistoryIds.has(id));
                    return allVisibleSelected ? "表示中を全解除" : "表示中を全選択";
                  })()}
                </Button>
                {fedexSelectedHistoryIds.size > 0 && (
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
                    setFedexSelectedHistoryIds(new Set());
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
