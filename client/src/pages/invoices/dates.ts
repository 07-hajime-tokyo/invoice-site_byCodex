// 発行日から1ヶ月後（同日-1日）の日付を計算する
export function calcDueDate(issueDateStr: string): string {
  if (!issueDateStr) return "";
  const d = new Date(issueDateStr);
  // 翌月の同日から1日引く（例: 3/25 → 4/24）
  d.setMonth(d.getMonth() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

