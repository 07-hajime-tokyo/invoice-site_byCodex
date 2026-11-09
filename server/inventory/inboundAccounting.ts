type ReceiptLog = { sourceType: string | null; sourceId: string | null };

// Rows arrive newest first; an undo invalidates the preceding receipt.
export function activeReceiptLabelIds(logs: readonly ReceiptLog[]): Set<string> {
  const seen = new Set<string>();
  const received = new Set<string>();
  for (const log of logs) {
    for (const value of (log.sourceId ?? "").split(",")) {
      const id = value.trim().toUpperCase();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (log.sourceType === "inbound-receipt") received.add(id);
    }
  }
  return received;
}

export function resolveInspectionStock(
  quantity: number,
  labelId: string,
  labels: readonly { labelId: string; status: string }[],
  countedLabelIds: ReadonlySet<string>,
): "counted" | "uncounted" | "conflict" {
  const otherCounted = labels.filter(label =>
    label.labelId !== labelId &&
    (label.status === "stocked" ||
      (label.status === "received" && countedLabelIds.has(label.labelId)))
  ).length;
  const explicitlyCounted = countedLabelIds.has(labelId);
  if (quantity < otherCounted + Number(explicitlyCounted)) return "conflict";
  // A pre-existing, unassigned stock unit can back this label without adding stock again.
  return quantity > otherCounted ? "counted" : "uncounted";
}
