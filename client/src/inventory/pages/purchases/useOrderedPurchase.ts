import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { type OrderedPurchaseForm } from "./types";
import { emptyOrderedForm } from "./constants";
import { cleanManagementNo } from "./format";
import { type usePurchaseOperator } from "./usePurchaseOperator";

export function useOrderedPurchase({
  selectedOperatorKey,
  utils,
}: {
  selectedOperatorKey: ReturnType<
    typeof usePurchaseOperator
  >["selectedOperatorKey"];
  utils: ReturnType<typeof trpc.useUtils>;
}) {
  const { data: inventories, refetch: refetchInventories } =
    trpc.inventory.zaico.getInventories.useQuery(undefined, {
      enabled: false,
      staleTime: 5 * 60_000,
    });
  const createOrderedPurchaseMutation =
    trpc.inventory.zaico.createOrderedPurchase.useMutation();
  const [showOrderedDialog, setShowOrderedDialog] = useState(false);
  const [orderedForm, setOrderedForm] =
    useState<OrderedPurchaseForm>(emptyOrderedForm);
  const [isOrderedSubmitting, setIsOrderedSubmitting] = useState(false);
  const [orderedInventorySearch, setOrderedInventorySearch] = useState("");
  const filteredInventoriesForOrder = useMemo(() => {
    if (!inventories) return [];
    const q = orderedInventorySearch.toLowerCase();
    if (!q) return inventories.slice(0, 50);
    return (
      inventories as Array<{
        id: number;
        title: string;
        quantity: string;
        unit: string;
        etc?: string;
        purchase_unit_price?: number;
        unit_price?: number;
        supplierName?: string | null;
        supplierUrl?: string | null;
      }>
    )
      .filter(
        inv =>
          inv.title.toLowerCase().includes(q) ||
          (inv.etc ?? "").toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [inventories, orderedInventorySearch]);
  function openOrderedDialog() {
    setOrderedForm(emptyOrderedForm);
    setOrderedInventorySearch("");
    setShowOrderedDialog(true);
    void refetchInventories();
  }
  function handleSelectInventoryForOrder(inv: {
    id: number;
    title: string;
    unit: string;
    purchase_unit_price?: number;
    unit_price?: number;
    etc?: string;
    supplierName?: string | null;
    supplierUrl?: string | null;
  }) {
    const managementNo = cleanManagementNo(inv.etc);
    const unitPrice = inv.purchase_unit_price ?? inv.unit_price;
    setOrderedForm(f => ({
      ...f,
      inventoryId: String(inv.id),
      title: inv.title,
      unitPrice: unitPrice != null ? String(unitPrice) : "",
      managementNo,
      customerName: inv.supplierName ?? "",
      supplierUrl: inv.supplierUrl ?? "",
    }));
    setOrderedInventorySearch(inv.title);
  }
  async function handleOrderedSubmit() {
    if (isOrderedSubmitting) return;
    if (!orderedForm.inventoryId) {
      toast.error("商品を選択してください");
      return;
    }
    if (!orderedForm.title.trim()) {
      toast.error("商品名を入力してください");
      return;
    }
    const qty = parseFloat(orderedForm.quantity);
    if (!qty || qty <= 0) {
      toast.error("数量は1以上を入力してください");
      return;
    }
    setIsOrderedSubmitting(true);
    try {
      await createOrderedPurchaseMutation.mutateAsync({
        inventoryId: parseInt(orderedForm.inventoryId, 10),
        title: orderedForm.title.trim(),
        quantity: qty,
        unitPrice:
          orderedForm.unitPrice.trim() !== ""
            ? parseFloat(orderedForm.unitPrice)
            : undefined,
        customerName: orderedForm.customerName || undefined,
        supplierName: orderedForm.customerName || undefined,
        supplierUrl: orderedForm.supplierUrl || undefined,
        num: orderedForm.num || undefined,
        estimatedPurchaseDate: orderedForm.estimatedPurchaseDate || undefined,
        memo: orderedForm.memo || undefined,
        managementNo: orderedForm.managementNo || undefined,
        operatorKey: selectedOperatorKey as "default" | "A" | "B",
      });
      toast.success(`「${orderedForm.title}」を発注済みとして登録しました`);
      setShowOrderedDialog(false);
      setOrderedForm(emptyOrderedForm);
      await Promise.all([
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "登録に失敗しました";
      toast.error(msg);
    } finally {
      setIsOrderedSubmitting(false);
    }
  }
  return {
    refetchInventories,
    showOrderedDialog,
    setShowOrderedDialog,
    orderedForm,
    setOrderedForm,
    isOrderedSubmitting,
    orderedInventorySearch,
    setOrderedInventorySearch,
    filteredInventoriesForOrder,
    openOrderedDialog,
    handleSelectInventoryForOrder,
    handleOrderedSubmit,
  };
}
