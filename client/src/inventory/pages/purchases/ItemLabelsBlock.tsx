import { type PurchaseItem } from "./types";
import { parseEtc, getPurchaseItemLabelIds } from "./format";

export function ItemLabelsBlock({ item }: { item: PurchaseItem }) {
  const labelIds = getPurchaseItemLabelIds(item);
  if (labelIds.length === 0) return null;
  const { managementNo } = parseEtc(item.etc);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">商品ID:</span>
      {labelIds.map(labelId => (
        <span
          key={labelId}
          className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 font-mono text-sm font-semibold tracking-wide text-emerald-800"
        >
          {labelId}
        </span>
      ))}
      {managementNo && (
        <span className="text-xs text-muted-foreground">
          旧管理番号: {managementNo}
        </span>
      )}
    </div>
  );
}
