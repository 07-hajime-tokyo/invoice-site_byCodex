export function inventoryStockQuantity(quantity: unknown): number {
  const value = Math.floor(Number(quantity ?? 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function inventoryLabelQuantity(quantity: unknown): number {
  return Math.max(1, inventoryStockQuantity(quantity));
}

export function inventoryInitialLabelStatus(quantity: unknown): "ordered" | "stocked" {
  return inventoryStockQuantity(quantity) > 0 ? "stocked" : "ordered";
}
