import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { type usePurchaseSelection } from "./usePurchaseSelection";
import { type usePurchaseListData } from "./usePurchaseListData";

export function usePurchaseBulkTracking({
  checkedPurchases,
  refetch,
}: {
  checkedPurchases: ReturnType<typeof usePurchaseSelection>["checkedPurchases"];
  refetch: ReturnType<typeof usePurchaseListData>["refetch"];
}) {
  const upsertExtraBulkMutation =
    trpc.inventory.purchaseExtra.upsertBulk.useMutation();
  const [showBulkTrackingDialog, setShowBulkTrackingDialog] = useState(false);
  const [bulkTrackingForm, setBulkTrackingForm] = useState({
    trackingNumber: "",
    shipDate: "",
    carrier: "auto",
  });
  const [isBulkTrackingSubmitting, setIsBulkTrackingSubmitting] =
    useState(false);
  async function handleBulkTrackingSubmit() {
    if (isBulkTrackingSubmitting || checkedPurchases.length === 0) return;
    if (!bulkTrackingForm.trackingNumber.trim()) {
      toast.error("追跡番号を入力してください");
      return;
    }
    setIsBulkTrackingSubmitting(true);
    try {
      await upsertExtraBulkMutation.mutateAsync({
        zaicoIds: checkedPurchases.map(p => p.id),
        trackingNumber: bulkTrackingForm.trackingNumber.trim() || undefined,
        shipDate: bulkTrackingForm.shipDate || undefined,
        carrier:
          bulkTrackingForm.carrier === "auto"
            ? undefined
            : bulkTrackingForm.carrier,
      });
      toast.success(`${checkedPurchases.length}件に追跡番号を登録しました`);
      setShowBulkTrackingDialog(false);
      setBulkTrackingForm({
        trackingNumber: "",
        shipDate: "",
        carrier: "auto",
      });
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "登録に失敗しました";
      toast.error(msg);
    } finally {
      setIsBulkTrackingSubmitting(false);
    }
  }
  return {
    showBulkTrackingDialog,
    setShowBulkTrackingDialog,
    bulkTrackingForm,
    setBulkTrackingForm,
    isBulkTrackingSubmitting,
    handleBulkTrackingSubmit,
  };
}
