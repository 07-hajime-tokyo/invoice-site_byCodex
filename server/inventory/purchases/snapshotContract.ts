import type {
  LocalInventoryWithLabels as LocalInventoryRow,
  LocalPurchaseWithLabels as LocalPurchaseRow,
} from "../db";
export type PurchaseSnapshotInput = {
  inventory?: (Partial<LocalInventoryRow> & { id: number }) | null;
  purchases?: Array<Partial<LocalPurchaseRow> & { id?: number | null }>;
  source: string;
  reason: string;
  operatorName?: string | null;
};
export type PurchaseSnapshotRecorder = (
  input: PurchaseSnapshotInput
) => Promise<void>;
