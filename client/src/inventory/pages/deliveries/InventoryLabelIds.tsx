import type { InventoryItem } from "./types";
import { getInventoryLabelIds } from "./display";

export function InventoryLabelIds({ inv, managementNo }: { inv: InventoryItem; managementNo: string }) {
  const labelIds = getInventoryLabelIds(inv);
  if (labelIds.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">商品ID:</span>
      {labelIds.map((labelId) => (
        <span
          key={labelId}
          className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-xs font-semibold tracking-wide text-emerald-800"
        >
          {labelId}
        </span>
      ))}
      {managementNo && <span className="text-[11px] text-muted-foreground">旧管理番号: {managementNo}</span>}
    </div>
  );
}
