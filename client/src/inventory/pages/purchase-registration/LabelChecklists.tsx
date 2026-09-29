import { Fragment } from "react";
import { createPortal } from "react-dom";
import { buildChecklistRows } from "./labelPrintLayout";
import type { LabelView } from "./viewTypes";

export function LabelChecklistView({ labels }: { labels: LabelView[] }) {
  const groups = buildChecklistRows(labels);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        付箋の旧管理番号から商品IDを引くための一覧です。チェックした商品IDだけを載せます（未選択なら表示中のすべて）。
      </p>
      <div className="overflow-hidden rounded-md border bg-background">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2 text-left font-medium">✓</th>
                <th className="w-32 px-3 py-2 text-left font-medium">商品ID</th>
                <th className="px-3 py-2 text-left font-medium">旧管理番号</th>
                <th className="px-3 py-2 text-left font-medium">商品名</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.name}>
                  <tr className="border-b bg-slate-50">
                    <td colSpan={4} className="px-3 py-2 text-xs font-medium text-muted-foreground">
                      {group.name} - {group.labels.length}件
                    </td>
                  </tr>
                  {group.labels.map((label) => (
                    <tr key={label.key} className="border-b last:border-b-0">
                      <td className="px-3 py-2 text-muted-foreground">□</td>
                      <td className="px-3 py-2 font-mono font-semibold text-slate-950">{label.labelId}</td>
                      <td className="px-3 py-2">{label.legacyManagementNo}</td>
                      <td className="px-3 py-2">{label.title}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 付箋の旧管理番号から商品IDを引くための一覧。棚を回る順に見られるようカテゴリごとにまとめ、
// その中は旧管理番号の順に並べる。
export function PrintableChecklistSheet({ labels }: { labels: LabelView[] }) {
  const groups = buildChecklistRows(labels);
  if (groups.length === 0) return null;
  const sheet = (
    <div className="checklist-print-root" aria-hidden="true">
      <div className="checklist-print-head">商品IDと旧管理番号の確認シート（{labels.length}件）</div>
      <table className="checklist-print-table">
        <thead>
          <tr>
            <th className="checklist-print-check">✓</th>
            <th className="checklist-print-idcol">商品ID</th>
            <th>旧管理番号</th>
            <th>商品名</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.name}>
              <tr className="checklist-print-group">
                <td colSpan={4}>
                  {group.name} - {group.labels.length}件
                </td>
              </tr>
              {group.labels.map((label) => (
                <tr key={label.key}>
                  <td className="checklist-print-check" />
                  <td className="checklist-print-idcol">{label.labelId}</td>
                  <td>{label.legacyManagementNo}</td>
                  <td>{label.title}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );

  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body);
}
