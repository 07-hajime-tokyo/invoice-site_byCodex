import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";

type Output = inferRouterOutputs<AppRouter>["inventory"];
export type SnapshotRow = Output["snapshot"]["list"][number];
export type ChangeLogRow = Output["inventoryMemo"]["listAll"][number];

export function buildTrendChartData(snapshots: SnapshotRow[]) {
    return snapshots
      .filter((row) => row.breakdown != null)
      .map((row) => ({
        date: row.date.slice(5),
        売り先未定: Math.round(row.breakdown!.unassignedAmount),
        売り先決定済み: Math.round(row.breakdown!.assignedAmount),
        合計: Math.round(row.breakdown!.totalAmount),
      }))
      .reverse();
}

export function buildTrendTableRows(snapshots: SnapshotRow[]) {
    return snapshots.map((row, index) => {
      const prev = snapshots[index + 1];
      const total = row.breakdown?.totalAmount ?? null;
      const prevTotal = prev?.breakdown?.totalAmount ?? null;
      const delta = total != null && prevTotal != null ? total - prevTotal : null;
      return { ...row, delta };
    });
}

export function filterInventoryChangeLogs(changeLogs: ChangeLogRow[], keyword: string) {
    const q = keyword.trim().toLowerCase();
    if (!q) return changeLogs;
    return changeLogs.filter((log) =>
      [log.title, log.memo, log.operatorName, log.changeType]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
}
