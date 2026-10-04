import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { type Purchase } from "./types";
import { type usePurchaseOperator } from "./usePurchaseOperator";
import { type usePurchaseListData } from "./usePurchaseListData";
import { type useOrderedPurchase } from "./useOrderedPurchase";

export function usePurchaseDeletion({
  selectedOperatorKey,
  refetch,
  refetchInventories,
  utils,
}: {
  selectedOperatorKey: ReturnType<
    typeof usePurchaseOperator
  >["selectedOperatorKey"];
  refetch: ReturnType<typeof usePurchaseListData>["refetch"];
  refetchInventories: ReturnType<
    typeof useOrderedPurchase
  >["refetchInventories"];
  utils: ReturnType<typeof trpc.useUtils>;
}) {
  const deleteInventoryMutation =
    trpc.inventory.zaico.deleteInventory.useMutation();
  const deletePurchaseOnlyMutation =
    trpc.inventory.zaico.deletePurchaseOnly.useMutation();
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  async function handleDeleteInventory(
    inventoryId: number,
    title: string,
    purchaseId?: number
  ) {
    if (deletingIds.has(inventoryId)) return;
    setDeletingIds(prev => {
      const next = new Set(prev).add(inventoryId);
      if (purchaseId) next.add(purchaseId);
      return next;
    });
    try {
      await deleteInventoryMutation.mutateAsync({
        inventoryId,
        operatorKey: selectedOperatorKey as "default" | "A" | "B",
        ...(purchaseId ? { alsoDeletePurchaseIds: [purchaseId] } : {}),
      });
      toast.success(`「${title}」を削除しました`);
      await Promise.all([
        refetch(),
        refetchInventories(),
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "削除に失敗しました";
      toast.error(msg);
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(inventoryId);
        if (purchaseId) next.delete(purchaseId);
        return next;
      });
    }
  }
  async function handleDeletePurchaseAndInventory(
    purchase: Purchase,
    title: string
  ) {
    const inventoryIds = Array.from(
      new Set(
        purchase.purchase_items
          .map(item => Number(item.inventory_id))
          .filter(id => Number.isFinite(id) && id > 0)
      )
    );
    const lockIds = [purchase.id, ...inventoryIds];
    if (lockIds.some(id => deletingIds.has(id))) return;
    setDeletingIds(prev => {
      const next = new Set(prev);
      lockIds.forEach(id => next.add(id));
      return next;
    });
    try {
      if (inventoryIds.length > 0) {
        for (let index = 0; index < inventoryIds.length; index += 1) {
          await deleteInventoryMutation.mutateAsync({
            inventoryId: inventoryIds[index],
            operatorKey: selectedOperatorKey as "default" | "A" | "B",
            ...(index === 0 ? { alsoDeletePurchaseIds: [purchase.id] } : {}),
          });
        }
        toast.success(`「${title}」を在庫一覧からも削除しました`);
      } else {
        await deletePurchaseOnlyMutation.mutateAsync({
          purchaseId: purchase.id,
          operatorKey: selectedOperatorKey as "default" | "A" | "B",
        });
        toast.success(`「${title}」の発注データを削除しました`);
      }
      await Promise.all([
        refetch(),
        refetchInventories(),
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "削除に失敗しました";
      toast.error(msg);
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        lockIds.forEach(id => next.delete(id));
        return next;
      });
    }
  }
  return {
    deletingIds,
    handleDeleteInventory,
    handleDeletePurchaseAndInventory,
  };
}
