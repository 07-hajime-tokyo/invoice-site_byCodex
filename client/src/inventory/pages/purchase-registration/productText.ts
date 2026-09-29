
export function compactProductText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}
