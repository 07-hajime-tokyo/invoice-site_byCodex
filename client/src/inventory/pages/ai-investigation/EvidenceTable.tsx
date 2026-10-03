/**
 * 調査結果の根拠データ表示部品（セクション別テーブルと出庫履歴のグループ表示）。
 * AiInvestigation.tsx から逐語移動。EvidenceTable は「出庫履歴」セクションだけ
 * DeliveryEvidenceGroups で日付→インボイス→出庫Noの入れ子表示に切り替える。
 */
import { useMemo, useState } from "react";
import { Database, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  buildDeliveryHistoryUrl,
  buildSearchUrl,
  displayDate,
  formatCellValue,
  getEvidenceCellLink,
  invoiceNoFromDeliveryNo,
  summarizeProducts,
  toNumber,
} from "./format";
import type { EvidenceRow, EvidenceSection } from "./types";

export function DeliveryEvidenceGroups({ section, allSections }: { section: EvidenceSection; allSections: EvidenceSection[] }) {
  const [, setLocation] = useLocation();
  const comparisonRows = allSections.find((item) => item.title === "FedEx発送登録照合")?.rows ?? [];
  const comparisonByDeliveryNo = useMemo(() => {
    const map = new Map<string, EvidenceRow>();
    for (const row of comparisonRows) {
      const deliveryNo = String(row.deliveryNo ?? "").trim();
      if (deliveryNo) map.set(deliveryNo, row);
    }
    return map;
  }, [comparisonRows]);

  const groups = useMemo(() => {
    const dateMap = new Map<string, Map<string, Map<string, EvidenceRow[]>>>();
    for (const row of section.rows) {
      const date = String(row.deliveryDate ?? row.createdAt ?? "").slice(0, 10) || "-";
      const invoiceNo = invoiceNoFromDeliveryNo(row.deliveryNo);
      const deliveryNo = String(row.deliveryNo ?? "-").trim() || "-";
      if (!dateMap.has(date)) dateMap.set(date, new Map());
      const invoiceMap = dateMap.get(date)!;
      if (!invoiceMap.has(invoiceNo)) invoiceMap.set(invoiceNo, new Map());
      const deliveryMap = invoiceMap.get(invoiceNo)!;
      if (!deliveryMap.has(deliveryNo)) deliveryMap.set(deliveryNo, []);
      deliveryMap.get(deliveryNo)!.push(row);
    }
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, invoiceMap]) => ({
        date,
        invoices: Array.from(invoiceMap.entries())
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([invoiceNo, deliveryMap]) => {
            const deliveries = Array.from(deliveryMap.entries()).map(([deliveryNo, rows]) => {
              const comparison = comparisonByDeliveryNo.get(deliveryNo);
              const quantity = rows.reduce((sum, row) => sum + (toNumber(row.quantity) || 1), 0);
              return {
                deliveryNo,
                rows,
                quantity,
                comparison,
                products: summarizeProducts(rows),
                managementNos: Array.from(new Set(rows.map((row) => String(row.managementNo ?? "").trim()).filter(Boolean))),
              };
            }).sort((a, b) => a.deliveryNo.localeCompare(b.deliveryNo));
            return {
              invoiceNo,
              deliveries,
              quantity: deliveries.reduce((sum, delivery) => sum + delivery.quantity, 0),
              products: summarizeProducts(deliveries.flatMap((delivery) => delivery.rows)),
            };
          }),
      }));
  }, [comparisonByDeliveryNo, section.rows]);

  if (section.rows.length === 0) {
    return <div className="text-sm text-muted-foreground py-3">該当データなし</div>;
  }

  return (
    <div className="space-y-4">
      {groups.map((dateGroup) => (
        <div key={dateGroup.date} className="space-y-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>{displayDate(dateGroup.date)}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          {dateGroup.invoices.map((invoice) => (
            <div key={`${dateGroup.date}-${invoice.invoiceNo}`} className="rounded-lg border bg-background">
              <div className="px-4 py-3 border-b">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">No.{invoice.invoiceNo}</span>
                  <span className="text-xs text-muted-foreground">{displayDate(dateGroup.date)}</span>
                  <Badge variant="secondary">{invoice.quantity}商品</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                  {invoice.products.slice(0, 4).join("　")}
                </div>
              </div>
              <div className="divide-y">
                {invoice.deliveries.map((delivery) => {
                  const status = String(delivery.comparison?.status ?? "追跡番号なし");
                  const missingQuantity = toNumber(delivery.comparison?.missingQuantity);
                  const trackingNumbers = String(delivery.comparison?.trackingNumbers ?? "").trim();
                  const isMissing = status !== "登録済み" || missingQuantity > 0;
                  return (
                    <div key={delivery.deliveryNo} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="font-medium text-primary underline-offset-2 hover:underline"
                          onClick={() => setLocation(buildDeliveryHistoryUrl(delivery.rows[0]))}
                        >
                          出庫No: {delivery.deliveryNo}
                        </button>
                        <Badge variant={isMissing ? "destructive" : "default"}>
                          {isMissing ? status : "登録済み"}
                        </Badge>
                        {missingQuantity > 0 ? <Badge variant="outline">不足 {missingQuantity}</Badge> : null}
                        {trackingNumbers ? <Badge variant="outline">{trackingNumbers}</Badge> : null}
                        <span className="ml-auto text-xs text-muted-foreground">{delivery.quantity}商品</span>
                      </div>
                      <div className="mt-2 space-y-1">
                        {delivery.products.map((product) => (
                          <div key={product} className="rounded-md bg-muted/40 px-3 py-1.5 text-sm">
                            {product}
                          </div>
                        ))}
                        {delivery.managementNos.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {delivery.managementNos.map((managementNo) => (
                              <button
                                key={managementNo}
                                type="button"
                                className="rounded border px-2 py-1 text-xs text-primary underline-offset-2 hover:underline"
                                onClick={() => setLocation(buildSearchUrl("/inventory/deliveries", managementNo))}
                              >
                                管理番号: {managementNo}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function EvidenceTable({ section, allSections }: { section: EvidenceSection; allSections: EvidenceSection[] }) {
  const [open, setOpen] = useState(section.rows.length > 0);
  const [, setLocation] = useLocation();
  const keys = useMemo(() => {
    const preferred = [
      "no",
      "deliveryNo",
      "managementNo",
      "title",
      "productName",
      "quantity",
      "deliveryQuantity",
      "fedexQuantity",
      "missingQuantity",
      "status",
      "trackingNumber",
      "shippingDate",
      "directTradeTarget",
      "fedexExcluded",
      "managementNos",
      "spreadsheetStatus",
      "ebayOrderStatus",
    ];
    const actual = Array.from(new Set(section.rows.flatMap((row) => Object.keys(row))));
    return [
      ...preferred.filter((key) => actual.includes(key)),
      ...actual.filter((key) => !preferred.includes(key)).slice(0, 8),
    ].slice(0, 12);
  }, [section.rows]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="rounded-lg">
        <CollapsibleTrigger asChild>
          <button className="w-full">
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  {section.title}
                </span>
                <Badge variant="outline">{section.rows.length}件</Badge>
              </CardTitle>
            </CardHeader>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {section.title === "出庫履歴" ? (
              <DeliveryEvidenceGroups section={section} allSections={allSections} />
            ) : section.rows.length === 0 ? (
              <div className="text-sm text-muted-foreground py-3">該当データなし</div>
            ) : (
              <div className="overflow-x-auto border rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-muted/70">
                    <tr>
                      {keys.map((key) => (
                        <th key={key} className="px-3 py-2 text-left whitespace-nowrap font-medium">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.slice(0, 50).map((row, index) => (
                      <tr key={index} className="border-t">
                        {keys.map((key) => {
                          const text = formatCellValue(row[key]);
                          const isUrl = /^https?:\/\//i.test(text);
                          const internalLink = getEvidenceCellLink(section.title, key, row, text);
                          return (
                            <td key={key} className="px-3 py-2 max-w-[320px] truncate whitespace-nowrap">
                              {internalLink ? (
                                <button
                                  type="button"
                                  onClick={() => setLocation(internalLink)}
                                  className="text-primary underline-offset-2 hover:underline"
                                >
                                  {text}
                                </button>
                              ) : isUrl ? (
                                <a
                                  href={text}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                                >
                                  開く <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                text
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {section.rows.length > 50 ? (
              <div className="text-xs text-muted-foreground mt-2">先頭50件のみ表示しています</div>
            ) : null}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
