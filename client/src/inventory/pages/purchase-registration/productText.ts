
export function compactProductText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

export function productKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

export function hasAnyProductText(value: string, keywords: string[]): boolean {
  const compact = compactProductText(value);
  return keywords.some((keyword) => compact.includes(compactProductText(keyword)));
}
