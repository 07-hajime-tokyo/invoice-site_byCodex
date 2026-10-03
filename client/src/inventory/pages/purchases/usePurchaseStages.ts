import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  INBOUND_CLASS_LABEL,
  getStageLabel,
  type InboundClass,
} from "@shared/inboundPipeline";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import { type Purchase } from "./types";
import { type usePurchaseListData } from "./usePurchaseListData";
import { type usePurchaseOperator } from "./usePurchaseOperator";

export function usePurchaseStages({
  refetch,
  selectedOperatorName,
}: {
  refetch: ReturnType<typeof usePurchaseListData>["refetch"];
  selectedOperatorName: ReturnType<
    typeof usePurchaseOperator
  >["selectedOperatorName"];
}) {
  const setInboundClassMutation =
    trpc.inventory.zaico.setInboundClass.useMutation();
  const advanceStageMutation = trpc.inventory.zaico.advanceStage.useMutation();
  const separateShaftMutation =
    trpc.inventory.zaico.separateShaft.useMutation();
  const [inboundBusyIds, setInboundBusyIds] = useState<Set<number>>(new Set());
  async function handleSetInboundClass(
    purchase: Purchase,
    inboundClass: InboundClass | null
  ) {
    if (inboundBusyIds.has(purchase.id)) return;
    setInboundBusyIds(prev => new Set(prev).add(purchase.id));
    try {
      await setInboundClassMutation.mutateAsync({
        purchaseId: purchase.id,
        inboundClass,
      });
      toast.success(
        inboundClass
          ? `分類を「${INBOUND_CLASS_LABEL[inboundClass]}」にしました`
          : "未仕訳に戻しました"
      );
      refetch();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "分類の変更に失敗しました"
      );
    } finally {
      setInboundBusyIds(prev => {
        const next = new Set(prev);
        next.delete(purchase.id);
        return next;
      });
    }
  }
  async function handleAdvanceStage(purchase: Purchase) {
    if (inboundBusyIds.has(purchase.id)) return;
    setInboundBusyIds(prev => new Set(prev).add(purchase.id));
    try {
      const res = await advanceStageMutation.mutateAsync({
        purchaseId: purchase.id,
        operatorName: getCurrentWorkWorkerName(selectedOperatorName),
        expectedStage: purchase.stage,
      });
      toast.success(`「${getStageLabel(res.stage)}」に進めました`);
      refetch();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "工程を進められませんでした"
      );
    } finally {
      setInboundBusyIds(prev => {
        const next = new Set(prev);
        next.delete(purchase.id);
        return next;
      });
    }
  }
  async function handleSeparateShaft(purchase: Purchase) {
    if (inboundBusyIds.has(purchase.id)) return;
    setInboundBusyIds(prev => new Set(prev).add(purchase.id));
    try {
      await separateShaftMutation.mutateAsync({
        purchaseId: purchase.id,
        operatorName: getCurrentWorkWorkerName(selectedOperatorName),
      });
      toast.success("シャフトを分離し、国内出品・発送待ちに追加しました");
      refetch();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "シャフト分離に失敗しました"
      );
    } finally {
      setInboundBusyIds(prev => {
        const next = new Set(prev);
        next.delete(purchase.id);
        return next;
      });
    }
  }
  return {
    inboundBusyIds,
    handleSetInboundClass,
    handleAdvanceStage,
    handleSeparateShaft,
  };
}
