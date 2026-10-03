/** 在庫の備考から先頭の管理番号を取り出す。番号内の空白は保持する。 */
export function getInventoryManagementNo(etc: string | null | undefined) {
  return (
    String(etc ?? "")
      .split(",")[0]
      ?.trim() ?? ""
  );
}
