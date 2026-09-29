export function normalizeCategoryName(value?: string | null): string {
  return (value ?? "").trim();
}
