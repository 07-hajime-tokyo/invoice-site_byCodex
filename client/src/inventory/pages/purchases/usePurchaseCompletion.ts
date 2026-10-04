import { buildPurchaseCompletionInput } from "./completionInput";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import { type Purchase } from "./types";
import { parseEtc } from "./format";
import { type usePurchaseOperator } from "./usePurchaseOperator";
import { type usePurchaseListData } from "./usePurchaseListData";
import { type usePurchaseSelection } from "./usePurchaseSelection";

export function usePurchaseCompletion({
  today,
  selectedOperatorKey,
  selectedOperatorName,
  refetch,
  checkedPurchases,
  setCheckedPurchaseIds,
}: {
  today: string;
  selectedOperatorKey: ReturnType<
    typeof usePurchaseOperator
  >["selectedOperatorKey"];
  selectedOperatorName: ReturnType<
    typeof usePurchaseOperator
  >["selectedOperatorName"];
  refetch: ReturnType<typeof usePurchaseListData>["refetch"];
  checkedPurchases: ReturnType<typeof usePurchaseSelection>["checkedPurchases"];
  setCheckedPurchaseIds: ReturnType<
    typeof usePurchaseSelection
  >["setCheckedPurchaseIds"];
}) {
  const completeMutation = trpc.inventory.zaico.completePurchase.useMutation();
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());
  const [confirmPurchase, setConfirmPurchase] = useState<Purchase | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  async function handleComplete(purchase: Purchase) {
    if (processingIds.has(purchase.id)) return;
    setConfirmPurchase(purchase);
  }
  async function executeComplete(purchase: Purchase) {
    setConfirmPurchase(null);
    if (processingIds.has(purchase.id)) return;
    setProcessingIds(prev => new Set(prev).add(purchase.id));
    const firstItem = purchase.purchase_items[0];
    const { managementNo } = parseEtc(firstItem?.etc);
    try {
      await completeMutation.mutateAsync(
        buildPurchaseCompletionInput(
          purchase,
          today,
          selectedOperatorKey,
          getCurrentWorkWorkerName(selectedOperatorName)
        )
      );
      toast.success(
        `「${managementNo || purchase.num || purchase.id}」を入庫済みにしました`
      );
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "入庫処理に失敗しました";
      toast.error(msg);
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(purchase.id);
        return next;
      });
    }
  }
  async function handleBulkComplete() {
    if (bulkProcessing || checkedPurchases.length === 0) return;
    setShowBulkConfirm(false);
    setBulkProcessing(true);
    let successCount = 0;
    let failCount = 0;
    for (const purchase of checkedPurchases) {
      try {
        await completeMutation.mutateAsync(
          buildPurchaseCompletionInput(
            purchase,
            today,
            selectedOperatorKey,
            getCurrentWorkWorkerName(selectedOperatorName)
          )
        );
        successCount++;
      } catch {
        failCount++;
      }
    }
    setBulkProcessing(false);
    setCheckedPurchaseIds(new Set());
    refetch();
    if (failCount === 0) {
      toast.success(`${successCount}件の入庫登録が完了しました`);
    } else {
      toast.warning(`${successCount}件成功、${failCount}件失敗`);
    }
  }
  return {
    processingIds,
    confirmPurchase,
    setConfirmPurchase,
    showBulkConfirm,
    setShowBulkConfirm,
    bulkProcessing,
    handleComplete,
    executeComplete,
    handleBulkComplete,
  };
}
