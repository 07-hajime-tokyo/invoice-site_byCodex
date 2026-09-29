import { purchaseRowInventoryId } from "./purchaseRowIdentity";
import { actualProductTitle } from "./productTitles";
import { getInventoryCategory } from "./productPresentation";
import {
  cleanLegacyManagementNo,
  parsePurchaseEtc as parseEtc,
} from "@shared/purchaseMetadata";
import { getManagementNos } from "./managementNumbers";
import { buildEtcWithManagementNo } from "./purchaseEtc";
import { getSupplier } from "./supplier";
import { getItemLabels } from "./purchaseItems";
import type { PurchaseRow, InventoryItem } from "./dataTypes";
import type {
  TrackingFormState,
  PurchaseEditFormState,
  StockEditFormState,
} from "./formTypes";
import { TRACKING_CARRIER_KEYS } from "./tracking";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { type Carrier } from "@/inventory/lib/tracking";
import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";

function todayInputDate(): string {
  return new Date().toLocaleDateString("sv-SE");
}

export function useBulkTrackingForm() {
  const [showBulkTrackingDialog, setShowBulkTrackingDialog] = useState(false);

  const [bulkTrackingForm, setBulkTrackingForm] = useState<TrackingFormState>({
    shipDate: todayInputDate(),
    trackingNumber: "",
    carrier: "auto",
  });
  return {
    showBulkTrackingDialog,
    setShowBulkTrackingDialog,
    bulkTrackingForm,
    setBulkTrackingForm,
  };
}

export type RegistrationEditData = {
  inventoryItems: InventoryItem[];
  selectedBulkTrackingRows: PurchaseRow[];
  setSelectedMissingTrackingRowIds: Dispatch<SetStateAction<Set<number>>>;
  refetch: () => unknown;
  refetchAllPurchaseRegistrations: () => unknown;
  refetchInventories: () => unknown;
};

// Called at the original state/mutation position. Data is bound after the parent queries.
export function useRegistrationEditing(
  utils: ReturnType<typeof trpc.useUtils>,
  bulkTracking: ReturnType<typeof useBulkTrackingForm>
) {
  const {
    showBulkTrackingDialog,
    setShowBulkTrackingDialog,
    bulkTrackingForm,
    setBulkTrackingForm,
  } = bulkTracking;
  const [deletingRowId, setDeletingRowId] = useState<number | null>(null);

  const [trackingDialogRow, setTrackingDialogRow] =
    useState<PurchaseRow | null>(null);

  const [editingPurchaseRow, setEditingPurchaseRow] =
    useState<PurchaseRow | null>(null);

  const [purchaseEditForm, setPurchaseEditForm] =
    useState<PurchaseEditFormState>({
      title: "",
      managementNo: "",
      category: "",
      quantity: "1",
      unitPrice: "",
      estimatedDate: "",
      supplierName: "",
      supplierUrl: "",
      shipDate: todayInputDate(),
      trackingNumber: "",
      carrier: "auto",
    });

  const [editingStockItem, setEditingStockItem] =
    useState<InventoryItem | null>(null);

  const [stockEditForm, setStockEditForm] = useState<StockEditFormState>({
    title: "",
    managementNo: "",
    category: "",
    quantity: "0",
    unit: "個",
    place: "",
    unitPrice: "",
    supplierName: "",
    supplierUrl: "",
  });

  const [trackingForm, setTrackingForm] = useState<TrackingFormState>({
    shipDate: todayInputDate(),
    trackingNumber: "",
    carrier: "auto",
  });

  const deleteInventoryMutation =
    trpc.inventory.zaico.deleteInventory.useMutation();

  const updatePurchaseDataMutation =
    trpc.inventory.zaico.updatePurchaseData.useMutation();

  const updateInventoryMutation =
    trpc.inventory.zaico.updateInventory.useMutation();

  const updateSupplierNameOnlyMutation =
    trpc.inventory.zaico.updateSupplierNameOnly.useMutation();

  const upsertPurchaseExtraMutation =
    trpc.inventory.purchaseExtra.upsert.useMutation();

  const upsertPurchaseExtraBulkMutation =
    trpc.inventory.purchaseExtra.upsertBulk.useMutation();

  const isPurchaseEditSaving =
    updatePurchaseDataMutation.isPending ||
    updateSupplierNameOnlyMutation.isPending ||
    upsertPurchaseExtraMutation.isPending ||
    upsertPurchaseExtraBulkMutation.isPending;

  const isStockEditSaving = updateInventoryMutation.isPending;

  function bindData({
    inventoryItems,
    selectedBulkTrackingRows,
    setSelectedMissingTrackingRowIds,
    refetch,
    refetchAllPurchaseRegistrations,
    refetchInventories,
  }: RegistrationEditData) {
    const handleOpenTrackingDialog = (row: PurchaseRow) => {
      const savedCarrier = row.extra?.carrier?.trim().toLowerCase();
      setTrackingForm({
        shipDate: row.extra?.shipDate?.slice(0, 10) || todayInputDate(),
        trackingNumber: row.extra?.trackingNumber ?? "",
        carrier:
          savedCarrier &&
          savedCarrier !== "auto" &&
          TRACKING_CARRIER_KEYS.has(savedCarrier as Carrier)
            ? (savedCarrier as Carrier)
            : "auto",
      });
      setTrackingDialogRow(row);
    };

    const handleOpenPurchaseEditDialog = (row: PurchaseRow) => {
      const firstItem = row.purchase_items[0];
      const parsed = parseEtc(firstItem?.etc);
      const supplier = getSupplier(row);
      const savedCarrier = row.extra?.carrier?.trim().toLowerCase();
      setPurchaseEditForm({
        title: firstItem
          ? firstItem.title?.trim() || actualProductTitle(firstItem)
          : "",
        managementNo: parsed.managementNo,
        category: firstItem?.category ?? "",
        quantity: String(firstItem?.quantity ?? "1"),
        unitPrice:
          firstItem?.unit_price != null ? String(firstItem.unit_price) : "",
        estimatedDate: firstItem?.estimated_purchase_date?.slice(0, 10) ?? "",
        supplierName: supplier.name === "-" ? "" : supplier.name,
        supplierUrl: supplier.url,
        shipDate: row.extra?.shipDate?.slice(0, 10) || todayInputDate(),
        trackingNumber: row.extra?.trackingNumber ?? "",
        carrier:
          savedCarrier &&
          savedCarrier !== "auto" &&
          TRACKING_CARRIER_KEYS.has(savedCarrier as Carrier)
            ? (savedCarrier as Carrier)
            : "auto",
      });
      setEditingPurchaseRow(row);
    };

    const handleSubmitPurchaseEdit = async () => {
      if (
        !editingPurchaseRow ||
        updatePurchaseDataMutation.isPending ||
        updateSupplierNameOnlyMutation.isPending ||
        upsertPurchaseExtraMutation.isPending
      )
        return;
      const firstItem = editingPurchaseRow.purchase_items[0];
      if (!firstItem) {
        toast.error("編集できる商品明細がありません");
        return;
      }
      const inventoryId = Number(
        firstItem.inventory_id ?? purchaseRowInventoryId(editingPurchaseRow)
      );
      if (!Number.isFinite(inventoryId) || inventoryId <= 0) {
        toast.error("在庫IDが見つからないため編集できません");
        return;
      }
      const title = purchaseEditForm.title.trim();
      if (!title) {
        toast.error("商品名を入力してください");
        return;
      }
      const quantity = Math.max(
        1,
        Number.parseInt(purchaseEditForm.quantity, 10) || 1
      );
      const unitPrice =
        purchaseEditForm.unitPrice.trim() === ""
          ? undefined
          : Number.parseFloat(purchaseEditForm.unitPrice);
      if (
        unitPrice !== undefined &&
        (!Number.isFinite(unitPrice) || unitPrice < 0)
      ) {
        toast.error("仕入単価は0以上の数字で入力してください");
        return;
      }

      const nextEtc = buildEtcWithManagementNo(
        purchaseEditForm.managementNo,
        firstItem.etc,
        purchaseEditForm.supplierName
      );
      const trackingNumber = purchaseEditForm.trackingNumber.trim();
      const currentCarrier =
        editingPurchaseRow.extra?.carrier?.trim() || "auto";
      const nextCarrier =
        purchaseEditForm.carrier === "auto"
          ? undefined
          : purchaseEditForm.carrier;
      const shouldUpdateTracking =
        trackingNumber !== (editingPurchaseRow.extra?.trackingNumber ?? "") ||
        purchaseEditForm.shipDate !==
          (editingPurchaseRow.extra?.shipDate?.slice(0, 10) || "") ||
        (nextCarrier ?? "auto") !== currentCarrier;
      const purchaseItemPayload = {
        ...(firstItem.id > 0 && { id: firstItem.id }),
        inventoryId,
        title,
        quantity,
        estimatedPurchaseDate: purchaseEditForm.estimatedDate || undefined,
        etc: nextEtc || undefined,
        category: purchaseEditForm.category.trim() || null,
        ...(unitPrice !== undefined && { unitPrice }),
      };

      try {
        await updatePurchaseDataMutation.mutateAsync({
          purchaseId: editingPurchaseRow.id,
          purchaseItems: [purchaseItemPayload],
        });
        await updateSupplierNameOnlyMutation.mutateAsync({
          purchaseId: editingPurchaseRow.id,
          inventoryId,
          supplierName: purchaseEditForm.supplierName.trim() || null,
          supplierUrl: purchaseEditForm.supplierUrl.trim() || null,
        });
        if (shouldUpdateTracking) {
          await upsertPurchaseExtraMutation.mutateAsync({
            zaicoId: editingPurchaseRow.id,
            shipDate: purchaseEditForm.shipDate || undefined,
            trackingNumber: trackingNumber || undefined,
            carrier: nextCarrier,
            note: editingPurchaseRow.extra?.note ?? undefined,
            inventoryId,
            managementNo: cleanLegacyManagementNo(
              purchaseEditForm.managementNo || firstItem.etc
            ),
            labelId: firstItem.itemLabels?.[0]?.labelId,
          });
        }
        toast.success("商品情報を更新しました");
        setEditingPurchaseRow(null);
        await Promise.all([
          utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
          utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
          utils.inventory.zaico.getInventories.invalidate(),
          utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
          utils.inventory.purchaseHistory.list.invalidate(),
        ]);
        void refetch();
        void refetchAllPurchaseRegistrations();
        void refetchInventories();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "商品情報の更新に失敗しました"
        );
      }
    };

    const handleOpenStockEditDialog = (inventoryId: number) => {
      const inventory = inventoryItems.find(item => item.id === inventoryId);
      if (!inventory) {
        toast.error("在庫情報が見つかりません");
        return;
      }
      const parsed = parseEtc(inventory.etc);
      setStockEditForm({
        title: inventory.title ?? "",
        managementNo: parsed.managementNo,
        category: getInventoryCategory(inventory),
        quantity: String(inventory.quantity ?? "0"),
        unit: inventory.unit ?? "個",
        place: inventory.place ?? "",
        unitPrice:
          inventory.purchase_unit_price != null
            ? String(inventory.purchase_unit_price)
            : inventory.unit_price != null
              ? String(inventory.unit_price)
              : "",
        supplierName: inventory.supplierName ?? parsed.supplierSite ?? "",
        supplierUrl: inventory.supplierUrl ?? "",
      });
      setEditingStockItem(inventory);
    };

    const handleSubmitStockEdit = async () => {
      if (!editingStockItem || updateInventoryMutation.isPending) return;
      const title = stockEditForm.title.trim();
      if (!title) {
        toast.error("商品名を入力してください");
        return;
      }
      const quantity = Math.max(
        0,
        Number.parseInt(stockEditForm.quantity, 10) || 0
      );
      const unitPrice =
        stockEditForm.unitPrice.trim() === ""
          ? undefined
          : Number.parseFloat(stockEditForm.unitPrice);
      if (
        unitPrice !== undefined &&
        (!Number.isFinite(unitPrice) || unitPrice < 0)
      ) {
        toast.error("仕入単価は0以上の数字で入力してください");
        return;
      }
      try {
        await updateInventoryMutation.mutateAsync({
          inventoryId: editingStockItem.id,
          title,
          quantity: String(quantity),
          unit: stockEditForm.unit || undefined,
          category: stockEditForm.category.trim() || undefined,
          place: stockEditForm.place.trim() || undefined,
          etc:
            buildEtcWithManagementNo(
              stockEditForm.managementNo,
              editingStockItem.etc,
              stockEditForm.supplierName
            ) || undefined,
          purchase_unit_price: unitPrice,
          supplierName: stockEditForm.supplierName.trim() || undefined,
          supplierUrl: stockEditForm.supplierUrl.trim() || undefined,
        });
        toast.success("在庫情報を更新しました");
        setEditingStockItem(null);
        await Promise.all([
          utils.inventory.zaico.getInventories.invalidate(),
          utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
          utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
          utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
        ]);
        void refetchInventories();
        void refetch();
        void refetchAllPurchaseRegistrations();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "在庫情報の更新に失敗しました"
        );
      }
    };

    const handleSubmitTracking = async () => {
      if (!trackingDialogRow || upsertPurchaseExtraMutation.isPending) return;
      const trackingNumber = trackingForm.trackingNumber.trim();
      if (!trackingNumber) {
        toast.error("追跡番号を入力してください");
        return;
      }
      try {
        await upsertPurchaseExtraMutation.mutateAsync({
          zaicoId: trackingDialogRow.id,
          shipDate: trackingForm.shipDate || undefined,
          trackingNumber,
          carrier:
            trackingForm.carrier === "auto" ? undefined : trackingForm.carrier,
          note: trackingDialogRow.extra?.note ?? undefined,
          inventoryId: purchaseRowInventoryId(trackingDialogRow) ?? undefined,
          managementNo: getManagementNos(trackingDialogRow.purchase_items)[0],
          labelId: getItemLabels(trackingDialogRow.purchase_items)[0]?.labelId,
        });
        toast.success("追跡番号を登録しました");
        setTrackingDialogRow(null);
        await Promise.all([
          utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
          utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
          utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
          utils.inventory.purchaseHistory.list.invalidate(),
        ]);
        void refetch();
        void refetchAllPurchaseRegistrations();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "追跡番号の登録に失敗しました"
        );
      }
    };

    const handleOpenBulkTrackingDialog = () => {
      if (selectedBulkTrackingRows.length === 0) {
        toast.error("追跡番号を登録する商品を選択してください");
        return;
      }
      setBulkTrackingForm({
        shipDate: todayInputDate(),
        trackingNumber: "",
        carrier: "auto",
      });
      setShowBulkTrackingDialog(true);
    };

    const handleSubmitBulkTracking = async () => {
      if (
        upsertPurchaseExtraBulkMutation.isPending ||
        selectedBulkTrackingRows.length === 0
      )
        return;
      const trackingNumber = bulkTrackingForm.trackingNumber.trim();
      if (!trackingNumber) {
        toast.error("追跡番号を入力してください");
        return;
      }

      try {
        await upsertPurchaseExtraBulkMutation.mutateAsync({
          zaicoIds: selectedBulkTrackingRows.map(row => row.id),
          shipDate: bulkTrackingForm.shipDate || undefined,
          trackingNumber,
          carrier:
            bulkTrackingForm.carrier === "auto"
              ? undefined
              : bulkTrackingForm.carrier,
        });
        toast.success(
          `${selectedBulkTrackingRows.length}件に追跡番号を登録しました`
        );
        setShowBulkTrackingDialog(false);
        setSelectedMissingTrackingRowIds(new Set());
        setBulkTrackingForm({
          shipDate: todayInputDate(),
          trackingNumber: "",
          carrier: "auto",
        });
        await Promise.all([
          utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
          utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
          utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
          utils.inventory.purchaseHistory.list.invalidate(),
        ]);
        void refetch();
        void refetchAllPurchaseRegistrations();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "追跡番号の一括登録に失敗しました"
        );
      }
    };

    const handleDeletePurchaseRow = async (row: PurchaseRow) => {
      const inventoryId = purchaseRowInventoryId(row);
      if (!inventoryId) {
        toast.error("削除できる在庫IDが見つかりません");
        return;
      }
      const title =
        actualProductTitle(row.purchase_items[0]) ||
        row.purchase_items[0]?.title ||
        "商品";
      if (
        !window.confirm(
          `${title} を削除しますか？\n削除済み商品に保存されます。`
        )
      )
        return;
      setDeletingRowId(row.id);
      try {
        await deleteInventoryMutation.mutateAsync({
          inventoryId,
          alsoDeletePurchaseIds: [row.id],
        });
        toast.success(`${title} を削除済み商品に移動しました`);
        await Promise.all([
          utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
          utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
          utils.inventory.zaico.getInventories.invalidate(),
          utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
          utils.inventory.deletedItems.list.invalidate(),
        ]);
        void refetch();
        void refetchAllPurchaseRegistrations();
        void refetchInventories();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "削除に失敗しました"
        );
      } finally {
        setDeletingRowId(null);
      }
    };
    return {
      handleOpenTrackingDialog,
      handleOpenPurchaseEditDialog,
      handleSubmitPurchaseEdit,
      handleOpenStockEditDialog,
      handleSubmitStockEdit,
      handleSubmitTracking,
      handleOpenBulkTrackingDialog,
      handleSubmitBulkTracking,
      handleDeletePurchaseRow,
    };
  }

  return {
    deletingRowId,
    trackingDialogRow,
    setTrackingDialogRow,
    editingPurchaseRow,
    setEditingPurchaseRow,
    purchaseEditForm,
    setPurchaseEditForm,
    editingStockItem,
    setEditingStockItem,
    stockEditForm,
    setStockEditForm,
    trackingForm,
    setTrackingForm,
    upsertPurchaseExtraMutation,
    upsertPurchaseExtraBulkMutation,
    isPurchaseEditSaving,
    isStockEditSaving,
    bindData,
  };
}

export type RegistrationEditing = ReturnType<typeof useRegistrationEditing>;
export type RegistrationEditActions = ReturnType<
  RegistrationEditing["bindData"]
>;
