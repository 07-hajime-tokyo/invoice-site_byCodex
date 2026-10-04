import { ProductQrCode } from "./ProductQrCode";
import { fieldClass } from "./fieldStyles";
import { EmptyState } from "./EmptyState";
import { mergeLabelViewsById } from "./labelMerging";
import { ProductFulfillmentTableV2 } from "./ProductFulfillmentTable";
import { buildLabelViews } from "./registrationLabelViews";
import { labelBadgeClass } from "./labelStatus";
import { invoiceNoFromGroupKey } from "./invoiceIdentity";
import type { PurchaseRow } from "./dataTypes";
import type { LabelView, ShippingItemView, ProductSummary, AllocationGroup } from "./viewTypes";
import { formatCurrency } from "./format";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { invoiceNoFromDeliveryNo } from "@shared/invoiceKey";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FedexShipmentDialog, type HistoryItem } from "@/inventory/pages/DeliveryHistory";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import { ChevronDown, Loader2, PackageMinus, RotateCcw, ScanLine, Send, Trash2, Truck } from "lucide-react";
import { useQrCameraScanner, normalizeProductLabelInput } from "./scanInput";
import { SHIPMENT_SHEET_NAMES, todayShipmentDate, generatePurchaseRegistrationDeliveryNo, commonInvoiceNoFromShippingItems, detectShipmentSheetNameForGroup, isShippableLabel, buildShippingItemsFromLabels, selectedShippingItems, historyItemsToFedexItems } from "./shippingRules";
import type { ShipmentSheetName } from "./shippingRules";
import { OutboundBoxPanel } from "./OutboundBoxes";

export function ShippingPanel({
  group,
  invoiceOptions,
  labels,
  allLabels,
  products,
  onDeliverySuccess,
}: {
  group: AllocationGroup | null;
  invoiceOptions: AllocationGroup[];
  labels: LabelView[];
  allLabels: LabelView[];
  products: ProductSummary[];
  onDeliverySuccess: (labelIds: string[]) => void;
}) {
  const utils = trpc.useUtils();
  const createDeliveryMutation = trpc.inventory.zaico.createDelivery.useMutation();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [confirmKeys, setConfirmKeys] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [deliveryNo, setDeliveryNo] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [fedexDialog, setFedexDialog] = useState<{ deliveryNo: string; historyId: number; items: HistoryItem[] } | null>(null);
  const [expandedHistoryNos, setExpandedHistoryNos] = useState<Set<string>>(new Set());
  // 箱モードで箱を開いている間は、こちらの従来出庫を伏せて取り違えを防ぐ
  const [openBoxCode, setOpenBoxCode] = useState<string | null>(null);
  const [forceLegacyShipping, setForceLegacyShipping] = useState(false);
  useEffect(() => {
    if (!openBoxCode) setForceLegacyShipping(false);
  }, [openBoxCode]);
  const [deleteHistoryConfirm, setDeleteHistoryConfirm] = useState<{
    historyId: number;
    deliveryNo: string;
    inventoryIds: number[];
    titles: string[];
  } | null>(null);
  const invoiceNo = invoiceNoFromGroupKey(group?.key);
  const [selectedDeliveryInvoiceKey, setSelectedDeliveryInvoiceKey] = useState("");
  const [manualLabelValue, setManualLabelValue] = useState("");
  const [manualShippingLabels, setManualShippingLabels] = useState<LabelView[]>([]);
  const [manualLookupPending, setManualLookupPending] = useState(false);
  const shippingQrScanner = useQrCameraScanner((rawValue) => {
    setManualLabelValue(rawValue);
    void addLabelForShipping(rawValue, { openConfirmAfterAdd: true });
  });
  const manualLabelId = normalizeProductLabelInput(manualLabelValue);
  const availableLabels = useMemo(() => mergeLabelViewsById(labels, manualShippingLabels), [labels, manualShippingLabels]);
  const searchableLabels = useMemo(() => mergeLabelViewsById(availableLabels, allLabels), [allLabels, availableLabels]);
  const manualMatchedLabel = useMemo(
    () => (manualLabelId ? searchableLabels.find((label) => label.labelId.trim().toUpperCase() === manualLabelId) ?? null : null),
    [manualLabelId, searchableLabels],
  );
  const shippingItems = useMemo(() => buildShippingItemsFromLabels(availableLabels), [availableLabels]);
  const shippableItems = useMemo(() => shippingItems.filter((item) => item.canShip), [shippingItems]);
  const pendingInventoryLabels = availableLabels.filter((label) => label.labelId.trim() && !label.inventoryId && isShippableLabel(label));
  const confirmItems = useMemo(
    () => selectedShippingItems(shippingItems, confirmKeys, quantities),
    [confirmKeys, quantities, shippingItems],
  );
  const checkedItems = useMemo(
    () => selectedShippingItems(shippingItems, selectedKeys, quantities),
    [quantities, selectedKeys, shippingItems],
  );
  function resolveDeliveryInvoiceNo(items: ShippingItemView[], overrideKey = selectedDeliveryInvoiceKey): string | null {
    const selectedNo = invoiceNoFromGroupKey(overrideKey);
    return selectedNo ?? invoiceNo ?? commonInvoiceNoFromShippingItems(items);
  }

  function resolveDeliveryGroup(items: ShippingItemView[], overrideKey = selectedDeliveryInvoiceKey): AllocationGroup | null {
    const selectedGroup = invoiceOptions.find((option) => option.key === overrideKey) ?? null;
    if (selectedGroup) return selectedGroup;
    if (invoiceNo) return group;
    const inferredInvoiceNo = commonInvoiceNoFromShippingItems(items);
    if (inferredInvoiceNo) {
      return invoiceOptions.find((option) => invoiceNoFromGroupKey(option.key) === inferredInvoiceNo) ?? group;
    }
    return group;
  }

  function resolveAutoDeliveryNo(items: ShippingItemView[], overrideKey = selectedDeliveryInvoiceKey): string {
    const nextInvoiceNo = resolveDeliveryInvoiceNo(items, overrideKey);
    const nextGroup = resolveDeliveryGroup(items, overrideKey);
    return generatePurchaseRegistrationDeliveryNo(nextGroup, nextInvoiceNo);
  }

  const autoDeliveryNo = useMemo(
    () => resolveAutoDeliveryNo(checkedItems),
    [checkedItems, group, invoiceNo, invoiceOptions, selectedDeliveryInvoiceKey],
  );
  const autoSheetName = useMemo(() => detectShipmentSheetNameForGroup(group, shippingItems), [group, shippingItems]);
  const [shipmentSheetName, setShipmentSheetName] = useState<ShipmentSheetName>(autoSheetName);
  const [invoiceFedexTrackingNumber, setInvoiceFedexTrackingNumber] = useState("");
  const [invoiceFedexSheetName, setInvoiceFedexSheetName] = useState<ShipmentSheetName>(autoSheetName);
  const hasTrackingNumber = trackingNumber.trim().length > 0;
  /**
   * FedEx追跡番号を聞くのは海外直取だけ。
   * eBay・ヤフオク・在庫の出庫（ebay_1709 / stock_... など）では要らないので出さない。
   */
  const isOverseasDelivery = Boolean(
    invoiceNoFromDeliveryNo(deliveryNo.trim() || autoDeliveryNo),
  );
  const allSelected = shippableItems.length > 0 && shippableItems.every((item) => selectedKeys.has(item.key));
  const isSubmitting = createDeliveryMutation.isPending;

  const { data: histories, isLoading: historiesLoading, refetch: refetchHistories } =
    trpc.inventory.deliveryHistory.listByInvoicePrefix.useQuery(
      { invoiceNo: invoiceNo ?? "0" },
      { enabled: Boolean(invoiceNo), staleTime: 30_000 },
    );
  const { data: fedexShipmentsData, refetch: refetchFedex } = trpc.inventory.fedex.getAll.useQuery(undefined, {
    staleTime: 30_000,
  });
  const createFedexMutation = trpc.inventory.fedex.create.useMutation({
    onSuccess: (data) => {
      void refetchFedex();
      if (data.success) {
        toast.success(data.message ?? "FedEx発送情報を登録しました");
      } else {
        toast.warning(data.message ?? "FedEx発送情報をDBに保存しました。スプレッドシート反映は確認してください");
      }
      setFedexDialog(null);
    },
    onError: (error) => {
      toast.error(`FedEx発送登録に失敗しました: ${error.message}`);
    },
  });
  const createFedexBatchMutation = trpc.inventory.fedex.createBatch.useMutation({
    onSuccess: (data) => {
      void refetchFedex();
      void refetchHistories();
      void utils.inventory.fedex.getAll.invalidate();
      void utils.inventory.deliveryHistory.list.invalidate();
      void utils.inventory.deliveryHistory.listByInvoicePrefix.invalidate();
      if (data.success) {
        toast.success(data.message ?? "FedEx発送登録をまとめて登録しました");
        setInvoiceFedexTrackingNumber("");
      } else {
        toast.warning(data.message ?? "FedEx発送登録の一部に失敗しました");
      }
    },
    onError: (error) => {
      toast.error(`FedEx一括登録に失敗しました: ${error.message}`);
    },
  });
  const deleteHistoryMutation = trpc.inventory.deliveryHistory.deleteGroup.useMutation({
    onSuccess: (data) => {
      void refetchHistories();
      void refetchFedex();
      void utils.inventory.deliveryHistory.list.invalidate();
      void utils.inventory.deliveryHistory.listByInvoicePrefix.invalidate();
      void utils.inventory.zaico.getInventories.invalidate();
      void utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate();
      void utils.inventory.zaico.getPurchasesWithCategory.invalidate();
      void utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate();
      if (data.failCount > 0) {
        toast.warning(`出庫履歴を削除しました（在庫削除: ${data.successCount}件成功, ${data.failCount}件失敗）`);
      } else {
        toast.success("出庫履歴とサイト内在庫を削除しました");
      }
      setDeleteHistoryConfirm(null);
    },
    onError: (error) => {
      toast.error(`出庫履歴の削除に失敗しました: ${error.message}`);
    },
  });

  const fedexShipmentsMap = useMemo(() => {
    const map = new Map<string, Array<{ id: number; sheetName: string; shippingDate: string; trackingNumber: string; spreadsheetStatus: string }>>();
    for (const shipment of (fedexShipmentsData ?? []) as Array<{
      id: number;
      deliveryNo: string;
      sheetName: string;
      shippingDate: string;
      trackingNumber: string;
      spreadsheetStatus: string;
    }>) {
      const current = map.get(shipment.deliveryNo) ?? [];
      current.push({
        id: shipment.id,
        sheetName: shipment.sheetName,
        shippingDate: shipment.shippingDate,
        trackingNumber: shipment.trackingNumber,
        spreadsheetStatus: shipment.spreadsheetStatus,
      });
      map.set(shipment.deliveryNo, current);
    }
    return map;
  }, [fedexShipmentsData]);

  const historyGroups = useMemo(() => {
    const grouped = new Map<string, { historyId: number; deliveryNo: string; createdAt: Date; items: HistoryItem[] }>();
    for (const history of (histories ?? []) as Array<{ id: number; deliveryNo: string; createdAt: string | Date; items: HistoryItem[] }>) {
      const existing = grouped.get(history.deliveryNo);
      const nextItems = history.items ?? [];
      if (existing) {
        existing.items.push(...nextItems);
        existing.createdAt = new Date(Math.max(existing.createdAt.getTime(), new Date(history.createdAt).getTime()));
      } else {
        grouped.set(history.deliveryNo, {
          historyId: history.id,
          deliveryNo: history.deliveryNo,
          createdAt: new Date(history.createdAt),
          items: [...nextItems],
        });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [histories]);

  useEffect(() => {
    setDeliveryNo(autoDeliveryNo);
  }, [autoDeliveryNo]);

  useEffect(() => {
    setSelectedDeliveryInvoiceKey(invoiceNo ? `invoice-${invoiceNo}` : "");
  }, [invoiceNo]);

  useEffect(() => {
    setShipmentSheetName(autoSheetName);
    setInvoiceFedexSheetName(autoSheetName);
  }, [autoSheetName]);

  useEffect(() => {
    setManualLabelValue("");
    setManualShippingLabels([]);
    setInvoiceFedexTrackingNumber("");
  }, [group?.key]);

  useEffect(() => {
    setSelectedKeys((current) => {
      const validKeys = new Set(shippableItems.map((item) => item.key));
      const next = new Set(Array.from(current).filter((key) => validKeys.has(key)));
      return next.size === current.size ? current : next;
    });
    setConfirmKeys((current) => {
      const validKeys = new Set(shippableItems.map((item) => item.key));
      const next = new Set(Array.from(current).filter((key) => validKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [shippableItems]);

  function toggleSelected(key: string) {
    if (!shippableItems.some((item) => item.key === key)) return;
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllSelected() {
    setSelectedKeys(allSelected ? new Set() : new Set(shippableItems.map((item) => item.key)));
  }

  function setItemQuantity(item: ShippingItemView, quantity: number) {
    const nextQuantity = Math.min(item.maxQuantity, Math.max(1, Math.floor(quantity)));
    setQuantities((current) => ({ ...current, [item.key]: nextQuantity }));
  }

  async function lookupShippingLabel(targetLabelId: string): Promise<LabelView | null> {
    const localLabel = searchableLabels.find((label) => label.labelId.trim().toUpperCase() === targetLabelId) ?? null;
    if (localLabel && isShippableLabel(localLabel) && localLabel.inventoryId) return localLabel;
    if (targetLabelId.length < 4) return localLabel;
    const result = await utils.inventory.zaico.getPurchasesWithCategoryPage.fetch({
      page: 1,
      pageSize: 100,
      category: null,
      status: null,
      search: targetLabelId,
      inboundClass: null,
    });
    const fetchedLabel = buildLabelViews((result?.items ?? []) as PurchaseRow[])
      .find((label) => label.labelId.trim().toUpperCase() === targetLabelId) ?? null;
    return fetchedLabel ?? localLabel;
  }

  async function addLabelForShipping(rawValue: string, options?: { openConfirmAfterAdd?: boolean }) {
    const targetLabelId = normalizeProductLabelInput(rawValue);
    if (!targetLabelId) {
      toast.error("商品IDを入力してください");
      return false;
    }
    if (manualLookupPending) return false;
    setManualLookupPending(true);
    let targetLabel: LabelView | null = null;
    try {
      targetLabel = await lookupShippingLabel(targetLabelId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "商品IDの確認に失敗しました");
      setManualLookupPending(false);
      return false;
    }
    setManualLookupPending(false);
    if (!targetLabel) {
      toast.error(`商品ID ${targetLabelId} が見つかりません`);
      return false;
    }
    if (!isShippableLabel(targetLabel)) {
      toast.error(`${targetLabelId} は未入庫のため出庫できません`);
      return false;
    }
    const [item] = buildShippingItemsFromLabels([targetLabel]);
    if (!item) {
      toast.error(`${targetLabelId} は在庫IDの反映待ちです。更新後に出庫してください`);
      return false;
    }
    setManualShippingLabels((current) => mergeLabelViewsById(current, [targetLabel]));
    setSelectedKeys((current) => {
      const next = new Set(current);
      next.add(item.key);
      return next;
    });
    setManualLabelValue("");
    if (options?.openConfirmAfterAdd) {
      setConfirmKeys(new Set([item.key]));
      setDeliveryNo(resolveAutoDeliveryNo([item]));
      setShowConfirm(true);
    }
    toast.success(`${targetLabelId} を出庫対象に追加しました`);
    return true;
  }

  function addManualLabelForShipping() {
    void addLabelForShipping(manualLabelValue);
  }

  function openConfirm(keys: Set<string>) {
    const targets = selectedShippingItems(shippingItems, keys, quantities);
    if (targets.length === 0) {
      toast.error("出庫する商品を選択してください");
      return;
    }
    setConfirmKeys(new Set(keys));
    setDeliveryNo(resolveAutoDeliveryNo(targets));
    setShowConfirm(true);
  }

  async function submitDelivery() {
    if (confirmItems.length === 0 || isSubmitting) return;
    const nextDeliveryNo = deliveryNo.trim() || autoDeliveryNo;
    const nextInvoiceNo = invoiceNoFromDeliveryNo(nextDeliveryNo) ?? resolveDeliveryInvoiceNo(confirmItems) ?? undefined;
    const nextTrackingNumber = trackingNumber.trim();
    try {
      const result = await createDeliveryMutation.mutateAsync({
        deliveryNo: nextDeliveryNo,
        deliveryDate: new Date().toISOString().slice(0, 10),
        operatorName: getCurrentWorkWorkerName("野田"),
        invoiceNo: nextInvoiceNo,
        sheetName: nextTrackingNumber ? shipmentSheetName : undefined,
        trackingNumber: nextTrackingNumber || undefined,
        items: confirmItems.map((item) => ({
          inventoryId: item.inventoryId,
          title: item.title,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          labelId: item.labelId ?? undefined,
        })),
      });
      toast.success(`${nextDeliveryNo} の出庫登録が完了しました`);
      if (nextTrackingNumber && result.fedexResult) {
        if (result.fedexResult.success) {
          toast.success(result.fedexResult.message);
        } else {
          toast.warning(result.fedexResult.message);
        }
      }
      const shippedLabelIds = confirmItems.flatMap((item) => (item.labelId ? [item.labelId] : []));
      onDeliverySuccess(shippedLabelIds);
      setSelectedKeys((current) => {
        const next = new Set(current);
        for (const item of confirmItems) next.delete(item.key);
        return next;
      });
      setConfirmKeys(new Set());
      setTrackingNumber("");
      setShowConfirm(false);
      void Promise.all([
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
        utils.inventory.deliveryHistory.list.invalidate(),
        utils.inventory.deliveryHistory.listByInvoicePrefix.invalidate(),
        utils.inventory.fedex.getAll.invalidate(),
      ]);
      void refetchHistories();
      void refetchFedex();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "出庫登録に失敗しました");
    }
  }

  function submitInvoiceFedexBatch() {
    const tracking = invoiceFedexTrackingNumber.trim();
    if (!tracking) {
      toast.error("FedEx追跡番号を入力してください");
      return;
    }
    const shipments = historyGroups
      .map((history) => ({
        deliveryNo: history.deliveryNo,
        sheetName: invoiceFedexSheetName,
        trackingNumber: tracking,
        historyId: history.historyId,
        items: historyItemsToFedexItems(history.items),
      }))
      .filter((shipment) => shipment.items.length > 0);
    if (shipments.length === 0) {
      toast.error("FedEx登録できる出庫履歴がありません");
      return;
    }
    createFedexBatchMutation.mutate({
      shippingDate: todayShipmentDate(),
      shipments,
      operatorName: getCurrentWorkWorkerName("驥守伐"),
    });
  }

  return (
    <div className="space-y-4">
      <OutboundBoxPanel invoiceOptions={invoiceOptions} onOpenBoxChange={setOpenBoxCode} />
      {openBoxCode ? (
        <section className="rounded-md border-2 border-amber-400 bg-amber-50 p-3 sm:p-4">
          <p className="text-sm font-semibold text-amber-900">
            箱モードで {openBoxCode} を開いています。個体IDは上の共通スキャン欄で読んでください。
          </p>
          <p className="mt-1 text-xs text-amber-900">
            下の「出庫」で登録すると、箱に紐づかないまま出庫が確定します（2026-08-16に実際に起きました）。
            箱を閉じるか「封をする」まで、こちらは使えません。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 bg-white"
            onClick={() => setForceLegacyShipping(true)}
          >
            それでも箱を使わずに出庫する
          </Button>
        </section>
      ) : null}
      <section
        className={cn(
          "rounded-md border bg-background p-3 sm:p-4",
          openBoxCode && !forceLegacyShipping && "pointer-events-none opacity-40"
        )}
        aria-hidden={openBoxCode && !forceLegacyShipping ? true : undefined}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">出庫（箱を使わない）</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              選択中のインボイス/在庫から、商品IDラベル単位で出庫できます。海外直取で箱IDを使うときは上のパネルで行ってください。
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 sm:w-auto"
              onClick={shippingQrScanner.startCamera}
              disabled={shippingQrScanner.cameraActive}
            >
              <ScanLine className="h-4 w-4" />
              QR読取
            </Button>
            {shippingQrScanner.cameraActive ? (
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={shippingQrScanner.stopCamera}>
                停止
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={toggleAllSelected} disabled={shippableItems.length === 0}>
              {allSelected ? "全解除" : "全選択"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 sm:w-auto"
              onClick={() => openConfirm(new Set(shippableItems.map((item) => item.key)))}
              disabled={shippableItems.length === 0}
            >
              <PackageMinus className="h-4 w-4" />
              すべて出庫
            </Button>
            <Button
              type="button"
              className="w-full gap-2 bg-orange-600 text-white hover:bg-orange-700 sm:w-auto"
              onClick={() => openConfirm(selectedKeys)}
              disabled={checkedItems.length === 0}
            >
              <Truck className="h-4 w-4" />
              選択を出庫
              {checkedItems.length > 0 ? <Badge className="ml-1 bg-white/20 text-white">{checkedItems.length}</Badge> : null}
            </Button>
          </div>
        </div>

        <div className="mt-3 rounded-md border bg-slate-50 p-3">
          <div className={cn("mb-3 overflow-hidden rounded-md border bg-black", shippingQrScanner.cameraActive ? "block" : "hidden")}>
            <video
              ref={shippingQrScanner.videoRef}
              className="h-[58vh] min-h-[260px] max-h-[520px] w-full object-cover md:h-80 md:min-h-0"
              muted
              playsInline
            />
          </div>
          {shippingQrScanner.cameraError ? <p className="mb-3 text-sm text-destructive">{shippingQrScanner.cameraError}</p> : null}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              value={manualLabelValue}
              onChange={(event) => setManualLabelValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addManualLabelForShipping();
              }}
              placeholder="商品IDを入力して出庫対象に追加"
              autoComplete="off"
              className="h-11 font-mono text-base sm:h-9 sm:text-sm"
            />
            <Button
              type="button"
              className="h-11 w-full gap-2 bg-orange-600 text-white hover:bg-orange-700 sm:h-9 sm:w-auto"
              onClick={addManualLabelForShipping}
              disabled={!manualLabelId || manualLookupPending}
            >
              {manualLookupPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
              追加
            </Button>
          </div>
          {manualLabelId && manualMatchedLabel && !isShippableLabel(manualMatchedLabel) ? (
            <p className="mt-2 text-sm text-amber-700">この商品IDはまだ入庫されていないため、出庫できません。</p>
          ) : null}
        </div>

        {pendingInventoryLabels.length > 0 ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {pendingInventoryLabels.length}件のラベルは在庫IDの反映待ちです。更新後に出庫できます。
          </div>
        ) : null}

        {shippingItems.length === 0 ? (
          <div className="mt-4">
            <EmptyState icon={Truck} title="出庫できるラベルがありません" description="入庫済みの商品IDラベル、または在庫一覧を選択してください。" />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shippingItems.map((item) => {
              const checked = selectedKeys.has(item.key);
              const quantity = quantities[item.key] ?? item.quantity;
              return (
                <div
                  key={item.key}
                  className={cn(
                    "rounded-md border bg-card p-3 shadow-sm transition-colors",
                    checked && "border-orange-300 bg-orange-50",
                    !item.canShip && "bg-slate-50 opacity-80",
                  )}
                >
                  <div className="flex gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelected(item.key)}
                      disabled={!item.canShip}
                      className="mt-1 h-4 w-4 shrink-0 accent-orange-600"
                      aria-label={`${item.labelId ?? item.title} を出庫選択`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-lg font-bold tracking-wide text-slate-950 sm:text-xl">{item.labelId}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-950">{item.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">旧管理番号: {item.legacyManagementNo}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {item.allocationLabel ? <Badge variant="secondary" className="font-mono">{item.allocationLabel}</Badge> : null}
                        <Badge className={labelBadgeClass(item.rawStatus)}>{item.status}</Badge>
                        <Badge variant="outline">{formatCurrency(item.unitPrice)}</Badge>
                      </div>
                    </div>
                    {item.labelId ? (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border bg-white p-1.5 sm:h-20 sm:w-20">
                        <ProductQrCode value={item.labelId} />
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="h-7 w-7 rounded border text-orange-600 disabled:opacity-40"
                        onClick={() => setItemQuantity(item, quantity - 1)}
                        disabled={quantity <= 1}
                      >
                        -
                      </button>
                      <Input
                        type="number"
                        min={1}
                        max={item.maxQuantity}
                        value={quantity}
                        onChange={(event) => setItemQuantity(item, Number(event.target.value))}
                        className="h-7 w-14 px-1 text-center"
                      />
                      <button
                        type="button"
                        className="h-7 w-7 rounded border text-orange-600 disabled:opacity-40"
                        onClick={() => setItemQuantity(item, quantity + 1)}
                        disabled={quantity >= item.maxQuantity}
                      >
                        +
                      </button>
                    </div>
                    <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => openConfirm(new Set([item.key]))} disabled={!item.canShip}>
                      この商品を出庫
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section id="purchase-shipping-history" className="rounded-md border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">出庫履歴 / FedEx発送登録</h3>
            <p className="mt-1 text-sm text-muted-foreground">このインボイスの出庫履歴からFedEx登録できます。</p>
          </div>
          {invoiceNo ? <Badge variant="outline">No.{invoiceNo}</Badge> : <Badge variant="secondary">在庫</Badge>}
        </div>
        {!invoiceNo ? (
          <p className="mt-3 text-sm text-muted-foreground">在庫一覧はインボイス番号がないため、履歴からのFedEx登録は対象外です。</p>
        ) : historiesLoading ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            出庫履歴を読み込み中
          </div>
        ) : historyGroups.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">まだ出庫履歴がありません。</p>
        ) : (
          <>
            <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3">
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
                <Input
                  value={invoiceFedexTrackingNumber}
                  onChange={(event) => setInvoiceFedexTrackingNumber(event.target.value)}
                  placeholder="FedEx追跡番号を入力..."
                  autoComplete="off"
                />
                <select
                  className={fieldClass}
                  value={invoiceFedexSheetName}
                  onChange={(event) => setInvoiceFedexSheetName(event.target.value as ShipmentSheetName)}
                >
                  {SHIPMENT_SHEET_NAMES.map((sheetName) => (
                    <option key={sheetName} value={sheetName}>{sheetName}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  className="w-full gap-2 bg-blue-600 text-white hover:bg-blue-700 lg:w-auto"
                  onClick={submitInvoiceFedexBatch}
                  disabled={createFedexBatchMutation.isPending || !invoiceFedexTrackingNumber.trim()}
                >
                  {createFedexBatchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  インボイスまとめてFedEx登録
                </Button>
              </div>
              <p className="mt-2 text-xs text-blue-800">
                このインボイスの出庫履歴 {historyGroups.length.toLocaleString()} 件をまとめてFedEx発送登録します。
              </p>
            </div>
            <div className="mt-3 divide-y rounded-md border">
            {historyGroups.map((history) => {
              const existingShipments = fedexShipmentsMap.get(history.deliveryNo) ?? [];
              const itemCount = history.items.reduce((total, item) => total + item.quantity, 0);
              const isHistoryExpanded = expandedHistoryNos.has(history.deliveryNo);
              return (
                <Collapsible
                  key={history.deliveryNo}
                  open={isHistoryExpanded}
                  onOpenChange={(open) => {
                    setExpandedHistoryNos((prev) => {
                      const next = new Set(prev);
                      if (open) next.add(history.deliveryNo);
                      else next.delete(history.deliveryNo);
                      return next;
                    });
                  }}
                  className="p-3"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <CollapsibleTrigger asChild>
                      <button type="button" className="min-w-0 flex-1 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isHistoryExpanded ? "rotate-0" : "-rotate-90")} />
                          <span className="font-mono text-sm font-semibold">{history.deliveryNo}</span>
                          <Badge variant="outline">{itemCount}点</Badge>
                          {existingShipments.length > 0 ? <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">FedEx登録済み</Badge> : null}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {isHistoryExpanded ? "詳細を閉じる" : "詳細を表示"}
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                        onClick={() => setFedexDialog({ deliveryNo: history.deliveryNo, historyId: history.historyId, items: history.items })}
                      >
                        <Send className="h-3.5 w-3.5" />
                        FedEx登録
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-2 border-rose-200 text-rose-700 hover:bg-rose-50"
                        onClick={() => setDeleteHistoryConfirm({
                          historyId: history.historyId,
                          deliveryNo: history.deliveryNo,
                          inventoryIds: Array.from(new Set(history.items.map((item) => item.inventoryId).filter((id) => Number.isFinite(id)))),
                          titles: history.items.map((item) => item.title).filter(Boolean),
                        })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        削除
                      </Button>
                    </div>
                  </div>
                  <CollapsibleContent>
                    <div className="mt-3 overflow-hidden rounded-md border bg-muted/20">
                      {history.items.map((item, index) => (
                        <div
                          key={`${history.deliveryNo}-${item.inventoryId}-${index}`}
                          className="grid gap-1 border-b px-3 py-2 text-sm last:border-b-0 md:grid-cols-[minmax(0,1fr)_80px_minmax(160px,220px)] md:items-center"
                        >
                          <div className="min-w-0 font-medium text-foreground">{item.title}</div>
                          <div className="text-xs text-muted-foreground md:text-right">{item.quantity}点</div>
                          <div className="font-mono text-xs text-muted-foreground md:text-right">
                            {item.managementNo ? `管理番号: ${item.managementNo}` : "管理番号: -"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
              })}
            </div>
          </>
        )}
      </section>
      <ProductFulfillmentTableV2 products={products} />

      <Dialog open={showConfirm} onOpenChange={(open) => !isSubmitting && setShowConfirm(open)}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageMinus className="h-5 w-5 text-orange-600" />
              出庫確認
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className={cn("grid gap-3", hasTrackingNumber ? "md:grid-cols-[1fr_1fr_1fr_180px]" : "md:grid-cols-3")}>
              <label className="space-y-1 text-sm">
                <span className="text-xs text-muted-foreground">インボイスNo / 取引先</span>
                <select
                  className={fieldClass}
                  value={selectedDeliveryInvoiceKey || "__auto__"}
                  onChange={(event) => {
                    const nextKey = event.target.value === "__auto__" ? "" : event.target.value;
                    setSelectedDeliveryInvoiceKey(nextKey);
                    const targets = confirmItems.length > 0 ? confirmItems : checkedItems;
                    setDeliveryNo(resolveAutoDeliveryNo(targets, nextKey));
                  }}
                >
                  <option value="__auto__">自動判定</option>
                  {invoiceOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs text-muted-foreground">出庫No</span>
                <Input value={deliveryNo} onChange={(event) => setDeliveryNo(event.target.value)} placeholder={autoDeliveryNo} />
              </label>
              {isOverseasDelivery ? (
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">FedEx追跡番号（任意）</span>
                  <Input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="追跡番号を入力..." />
                </label>
              ) : null}
              {hasTrackingNumber ? (
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">発送管理</span>
                  <select className={fieldClass} value={shipmentSheetName} onChange={(event) => setShipmentSheetName(event.target.value as ShipmentSheetName)}>
                    {SHIPMENT_SHEET_NAMES.map((sheetName) => (
                      <option key={sheetName} value={sheetName}>{sheetName}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="space-y-2 md:hidden">
              {confirmItems.map((item) => (
                <div key={item.key} className="rounded-md border bg-background p-3">
                  <div className="font-medium">{item.title}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{item.labelId} / {item.legacyManagementNo}</div>
                  <div className="mt-2 text-xs text-muted-foreground">{item.allocationLabel || "自動判定"}</div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">出庫数量</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="h-8 w-8 rounded border text-orange-600 disabled:opacity-40"
                        onClick={() => setItemQuantity(item, item.quantity - 1)}
                        disabled={item.quantity <= 1}
                      >
                        -
                      </button>
                      <Input
                        type="number"
                        min={1}
                        max={item.maxQuantity}
                        value={item.quantity}
                        onChange={(event) => setItemQuantity(item, Number(event.target.value))}
                        className="h-8 w-16 px-1 text-center"
                      />
                      <button
                        type="button"
                        className="h-8 w-8 rounded border text-orange-600 disabled:opacity-40"
                        onClick={() => setItemQuantity(item, item.quantity + 1)}
                        disabled={item.quantity >= item.maxQuantity}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-hidden rounded-md border md:block">
              <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                  <div className="grid grid-cols-[minmax(0,1fr)_150px_120px] border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <div>商品名</div>
                    <div>注文行</div>
                    <div className="text-right">出庫数量</div>
                  </div>
                  <div className="divide-y">
                    {confirmItems.map((item) => (
                      <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_150px_120px] items-center gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{item.title}</div>
                          <div className="mt-0.5 font-mono text-xs text-muted-foreground">{item.labelId} / {item.legacyManagementNo}</div>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{item.allocationLabel || "自動判定"}</div>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="h-7 w-7 rounded border text-orange-600 disabled:opacity-40"
                            onClick={() => setItemQuantity(item, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                          >
                            -
                          </button>
                          <Input
                            type="number"
                            min={1}
                            max={item.maxQuantity}
                            value={item.quantity}
                            onChange={(event) => setItemQuantity(item, Number(event.target.value))}
                            className="h-7 w-14 px-1 text-center"
                          />
                          <button
                            type="button"
                            className="h-7 w-7 rounded border text-orange-600 disabled:opacity-40"
                            onClick={() => setItemQuantity(item, item.quantity + 1)}
                            disabled={item.quantity >= item.maxQuantity}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">上記 {confirmItems.length} 件の商品を出庫処理します。この操作は元に戻せません。</p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setShowConfirm(false)} disabled={isSubmitting}>
              キャンセル
            </Button>
            <Button type="button" className="gap-2 bg-orange-600 text-white hover:bg-orange-700" onClick={submitDelivery} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageMinus className="h-4 w-4" />}
              出庫する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteHistoryConfirm)}
        onOpenChange={(open) => {
          if (!open && !deleteHistoryMutation.isPending) setDeleteHistoryConfirm(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Trash2 className="h-5 w-5 text-destructive" />
              出庫履歴を削除
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <strong>{deleteHistoryConfirm?.deliveryNo}</strong> の出庫履歴とサイト内在庫の商品を削除します。この操作は元に戻せません。
            </p>
            {deleteHistoryConfirm?.titles.length ? (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-3">
                {deleteHistoryConfirm.titles.map((title, index) => (
                  <p key={`${title}-${index}`} className="text-sm">{title}</p>
                ))}
              </div>
            ) : null}
            <p className="rounded bg-amber-50 p-2 text-xs text-amber-700">
              ※ 出庫履歴のDBレコードとサイト内在庫が両方削除されます。
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteHistoryConfirm(null)}
              disabled={deleteHistoryMutation.isPending}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="gap-1.5"
              disabled={deleteHistoryMutation.isPending || !deleteHistoryConfirm}
              onClick={() => {
                if (!deleteHistoryConfirm) return;
                deleteHistoryMutation.mutate({
                  historyId: deleteHistoryConfirm.historyId,
                  inventoryIds: deleteHistoryConfirm.inventoryIds,
                });
              }}
            >
              {deleteHistoryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {fedexDialog ? (
        <FedexShipmentDialog
          open={Boolean(fedexDialog)}
          onClose={() => setFedexDialog(null)}
          groupKey={fedexDialog.deliveryNo}
          groupItems={fedexDialog.items}
          onSubmit={(data) =>
            createFedexMutation.mutate({
              deliveryNo: fedexDialog.deliveryNo,
              sheetName: data.sheetName,
              shippingDate: data.shippingDate,
              trackingNumber: data.trackingNumber,
              items: data.items,
              historyId: fedexDialog.historyId,
              operatorName: getCurrentWorkWorkerName("野田"),
            })
          }
          isPending={createFedexMutation.isPending}
          existingShipments={fedexShipmentsMap.get(fedexDialog.deliveryNo) ?? []}
        />
      ) : null}
    </div>
  );
}

export function ReturnPanel({ labels }: { labels: LabelView[] }) {
  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <h2 className="text-lg font-semibold">返品</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Input placeholder="返品する商品IDをスキャン" />
          <select className={fieldClass} defaultValue="sale">
            <option value="sale">販売済みとして出庫</option>
            <option value="supplier">仕入先返品</option>
            <option value="disposal">処分</option>
            <option value="customer">顧客返品</option>
          </select>
          <Button type="button" variant="outline" className="gap-2">
            <RotateCcw className="h-4 w-4" />
            返品登録
          </Button>
        </div>
      </section>
      {labels.length === 0 ? (
        <EmptyState icon={RotateCcw} title="返品対象の商品IDがありません" />
      ) : (
        <section className="rounded-md border bg-background p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">返品対象</h3>
            <Badge variant="outline">{labels.length.toLocaleString()}件</Badge>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {labels.map((label) => (
              <div key={label.labelId} className="rounded-md border bg-card p-3 shadow-sm">
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-lg font-bold tracking-wide text-slate-950">{label.labelId}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950">{label.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">旧管理番号: {label.legacyManagementNo}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {label.allocationLabel ? <Badge variant="secondary" className="font-mono">{label.allocationLabel}</Badge> : null}
                      <Badge className={labelBadgeClass(label.rawStatus)}>{label.status}</Badge>
                      <Badge variant="outline">{label.supplier.name}</Badge>
                    </div>
                  </div>
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border bg-white p-1.5 sm:h-20 sm:w-20">
                    <ProductQrCode value={label.labelId} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
