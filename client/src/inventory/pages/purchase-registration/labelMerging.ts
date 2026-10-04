import type { LabelView } from "./viewTypes";

export function isShippableLabelStatus(status?: string | null): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "received" || normalized === "stocked";
}

export function mergeLabelViewsById(...groups: LabelView[][]): LabelView[] {
  const map = new Map<string, LabelView>();
  for (const labels of groups) {
    for (const label of labels) {
      const key = label.labelId.trim().toUpperCase();
      if (!key) continue;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, label);
        continue;
      }
      const existingShippable = isShippableLabelStatus(existing.rawStatus);
      const nextShippable = isShippableLabelStatus(label.rawStatus);
      if (existing.inventoryId && !label.inventoryId) {
        map.set(key, { ...label, ...existing });
        continue;
      }
      if (existingShippable && !nextShippable) {
        map.set(key, {
          ...label,
          inventoryId: label.inventoryId ?? existing.inventoryId,
          rawStatus: existing.rawStatus,
          status: existing.status,
        });
        continue;
      }
      map.set(key, {
        ...existing,
        ...label,
        inventoryId: label.inventoryId ?? existing.inventoryId,
      });
    }
  }
  return Array.from(map.values());
}
