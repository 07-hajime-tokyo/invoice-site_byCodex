/**
 * 取引CSVのC列（番号）とN列（仕入先名）を使う既存の補完規則。
 * CSV読取・行パーサーは呼出元のものを使い、途中で失敗しても追加済みの値を保持する。
 */
export function fillCsvPurchaseSuppliers(
  text: string,
  suppliers: Map<string, string>,
  parseLine: (line: string) => string[]
): void {
  const lines = text.split(/\r?\n/);
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseLine(line).map(col => col.trim());
    const invoiceNo = cols[2]?.trim() ?? "";
    const supplierName = cols[13]?.trim() ?? "";
    if (!invoiceNo || !/^\d+$/.test(invoiceNo)) continue;
    if (supplierName && !suppliers.has(invoiceNo)) {
      suppliers.set(invoiceNo, supplierName);
    }
  }
}
