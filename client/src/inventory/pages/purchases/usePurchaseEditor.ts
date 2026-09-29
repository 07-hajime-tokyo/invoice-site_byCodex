import { createEmptyEditState } from "./editState";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { type Purchase, type EditState } from "./types";
import { parseEtc, hasUnitPrice } from "./format";
import { type usePurchaseEditorState } from "./usePurchaseEditorState";
import { type usePurchaseOperator } from "./usePurchaseOperator";
import { type usePurchaseListData } from "./usePurchaseListData";

export function usePurchaseEditor({
  setEditingId,
  setEditState,
  editState,
  selectedOperatorKey,
  utils,
  refetch,
}: {
  setEditingId: ReturnType<typeof usePurchaseEditorState>["setEditingId"];
  setEditState: ReturnType<typeof usePurchaseEditorState>["setEditState"];
  editState: ReturnType<typeof usePurchaseEditorState>["editState"];
  selectedOperatorKey: ReturnType<
    typeof usePurchaseOperator
  >["selectedOperatorKey"];
  utils: ReturnType<typeof trpc.useUtils>;
  refetch: ReturnType<typeof usePurchaseListData>["refetch"];
}) {
  const upsertExtraMutation = trpc.inventory.purchaseExtra.upsert.useMutation();
  const updatePurchaseDataMutation =
    trpc.inventory.zaico.updatePurchaseData.useMutation();
  const updateSupplierNameOnlyMutation =
    trpc.inventory.zaico.updateSupplierNameOnly.useMutation();
  function startEdit(purchase: Purchase) {
    setEditingId(purchase.id);
    const itemEdits: EditState["itemEdits"] = {};
    for (const item of purchase.purchase_items) {
      const { managementNo } = parseEtc(item.etc);
      itemEdits[item.inventory_id] = {
        title: item.title ?? "",
        unitPrice: hasUnitPrice(item.unit_price) ? String(item.unit_price) : "",
        quantity: String(item.quantity ?? "1"),
        managementNo,
        estimatedDate: item.estimated_purchase_date ?? "",
        category: item.category ?? "",
      };
    }
    // 発送日が未設定の場合は当日日付を自動セット
    const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD形式
    setEditState({
      shipDate: purchase.extra?.shipDate ?? today,
      trackingNumber: purchase.extra?.trackingNumber ?? "",
      carrier: purchase.extra?.carrier ?? "auto",
      note: purchase.extra?.note ?? "",
      supplierName: purchase.csvSupplierName ?? "",
      supplierUrl: purchase.csvSupplierUrl ?? "",
      itemEdits,
    });
  }
  function cancelEdit() {
    setEditingId(null);
    setEditState(createEmptyEditState());
  }
  async function saveEdit(purchaseId: number, purchase: Purchase) {
    try {
      const blankTitle = purchase.purchase_items.find(item => {
        const edit = editState.itemEdits[item.inventory_id];
        return edit && edit.title.trim() === "";
      });
      if (blankTitle) {
        toast.error("商品名は空欄にできません");
        return;
      }
      const invalidQuantity = purchase.purchase_items.find(item => {
        const edit = editState.itemEdits[item.inventory_id];
        if (!edit) return false;
        const quantity = Number.parseInt(edit.quantity, 10);
        return !Number.isFinite(quantity) || quantity < 1;
      });
      if (invalidQuantity) {
        toast.error("発注数量は1以上で入力してください");
        return;
      }
      const firstItemForTracking = purchase.purchase_items[0];
      const firstItemTrackingEdit = firstItemForTracking
        ? editState.itemEdits[firstItemForTracking.inventory_id]
        : undefined;
      const trackingManagementNo =
        firstItemTrackingEdit?.managementNo.trim() ||
        (firstItemForTracking
          ? parseEtc(firstItemForTracking.etc).managementNo
          : "");
      const trackingLabelId = firstItemForTracking?.itemLabels?.[0]?.labelId;
      // 発注データ（単価・管理番号・入庫予定日）を更新
      const itemEditsEntries = Object.entries(editState.itemEdits);
      if (itemEditsEntries.length > 0) {
        const purchaseItems = purchase.purchase_items
          .map(item => {
            const edit = editState.itemEdits[item.inventory_id];
            if (!edit) return null;
            // etcフィールド: "管理番号, 日付, 仕入先" のカンマ区切りフォーマットを維持
            const parts = (item.etc ?? "").split(",").map(p => p.trim());
            const newManagementNo = edit.managementNo.trim();
            const newEtc = newManagementNo
              ? [newManagementNo, parts[1] ?? "", parts[2] ?? ""].join(", ")
              : (item.etc ?? "");
            const nextCategory = edit.category.trim();
            const currentCategory = item.category || "";
            const nextTitle = edit.title.trim();
            const currentTitle = item.title || "";
            const nextQuantity = Math.max(
              1,
              Number.parseInt(edit.quantity, 10)
            );
            const currentQuantity = Math.max(
              1,
              Number.parseInt(String(item.quantity ?? "1"), 10) || 1
            );
            return {
              ...(item.id > 0 && { id: item.id }),
              inventoryId: item.inventory_id,
              ...(nextTitle !== currentTitle && { title: nextTitle }),
              ...(edit.unitPrice !== "" && {
                unitPrice: parseFloat(edit.unitPrice),
              }),
              ...(nextQuantity !== currentQuantity && {
                quantity: nextQuantity,
              }),
              ...(edit.estimatedDate !== "" && {
                estimatedPurchaseDate: edit.estimatedDate,
              }),
              ...(newManagementNo !== parseEtc(item.etc).managementNo && {
                etc: newEtc,
              }),
              ...(nextCategory !== currentCategory && {
                category: nextCategory || null,
              }),
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        if (purchaseItems.length > 0) {
          await updatePurchaseDataMutation.mutateAsync({
            purchaseId,
            purchaseItems,
            operatorKey: selectedOperatorKey as "default" | "A" | "B",
          });
        }
      }
      // 仕入先名を更新（local_inventoriesのsupplierNameを更新）
      if (editState.supplierName !== (purchase.csvSupplierName ?? "")) {
        const firstItem = purchase.purchase_items[0];
        if (firstItem?.inventory_id) {
          await updateSupplierNameOnlyMutation.mutateAsync({
            purchaseId,
            inventoryId: firstItem.inventory_id,
            supplierName: editState.supplierName || null,
            supplierUrl: editState.supplierUrl.trim() || null,
          });
        }
      }
      if (
        editState.supplierName === (purchase.csvSupplierName ?? "") &&
        editState.supplierUrl !== (purchase.csvSupplierUrl ?? "")
      ) {
        const firstItem = purchase.purchase_items[0];
        if (firstItem?.inventory_id) {
          await updateSupplierNameOnlyMutation.mutateAsync({
            purchaseId,
            inventoryId: firstItem.inventory_id,
            supplierName: editState.supplierName || null,
            supplierUrl: editState.supplierUrl.trim() || null,
          });
        }
      }
      // 入庫補足情報（発送日・追跡番号・備考）を最後に保存して、商品本体更新による上書きを防ぐ
      await upsertExtraMutation.mutateAsync({
        zaicoId: purchaseId,
        shipDate: editState.shipDate.trim() || undefined,
        trackingNumber: editState.trackingNumber.trim() || undefined,
        carrier: editState.carrier === "auto" ? null : editState.carrier,
        note: editState.note.trim() || undefined,
        inventoryId: firstItemForTracking?.inventory_id || undefined,
        managementNo: trackingManagementNo || undefined,
        labelId: trackingLabelId || undefined,
      });
      toast.success("保存しました");
      setEditingId(null);
      await Promise.all([
        utils.inventory.zaico.getCategories.invalidate(),
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      ]);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "保存に失敗しました";
      toast.error(msg);
    }
  }
  return { upsertExtraMutation, startEdit, cancelEdit, saveEdit };
}
