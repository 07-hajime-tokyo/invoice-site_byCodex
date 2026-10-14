export function normalizeStockProposalTitleForGrouping(title: string): string {
  let normalizedTitle = title.replace(/^登録漏れ\s*/u, "").replace(/\s+/g, " ").trim();
  if (!normalizedTitle) return "-";
  normalizedTitle = normalizedTitle.replace(/\b(?:ps\s*)?vita\s*1[01]00\b/gi, "Vita 1000");
  normalizedTitle = normalizedTitle.replace(/\bnew\s*3ds\s*(?:ll|xl)\b/gi, "New 3DS LL");
  normalizedTitle = normalizedTitle.replace(/\b3ds\s*(?:ll|xl)\b/gi, "3DS LL");
  return normalizedTitle;
}

export function stockProposalProductKey(title: string): string {
  return normalizeStockProposalTitleForGrouping(title)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s　・･_\-‐‑‒–—―,、，/／&＆×xX]+/g, "");
}
