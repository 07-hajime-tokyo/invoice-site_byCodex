import { useState, useMemo, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Package } from "lucide-react";
import { normalizeProductName, isReturnProduct } from "@/inventory/lib/productNameUtils";
import { resolveShipmentItemInvoice } from "./invoiceResolution";
import { cleanShipmentProductTitle, normalizeShipmentGroupKey } from "./shipmentRows";
import type { CsvInvoiceData, FedexShipment, ShipmentInvoiceUsage, ShipmentItem } from "./types";

// 取引先ポータルと同じ表示形式のコンポーネント
export function PartnerView({
  shipments,
  csvData,
}: {
  shipments: FedexShipment[];
  csvData: Record<string, CsvInvoiceData>;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  // 追跡番号グループを構築（PartnerPortalと同じロジック）
  const shipmentGroups = useMemo(() => {
    type PartnerShipmentRow = {
      rowKey: string;
      invoiceNo: string;
      productName: string;
      orderedQty: number;
      shippedQty: number;
      remainingQty: number | null;
      productOrder: number;
    };
    type PartnerShipmentGroup = {
      key: string;
      trackingNumber: string;
      shippingDate: string;
      createdAtMs: number;
      rows: PartnerShipmentRow[];
      isComplete: boolean;
      invoiceNos: Set<string>;
      rowMap: Map<string, PartnerShipmentRow>;
    };

    const groups: PartnerShipmentGroup[] = [];
    const groupMap = new Map<string, PartnerShipmentGroup>();

    const parseDateStr = (s: string): number => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s).getTime();
      const parts = s.split("/");
      if (parts.length === 2) {
        const m = parseInt(parts[0], 10);
        const d = parseInt(parts[1], 10);
        if (!isNaN(m) && !isNaN(d)) return new Date(2026, m - 1, d).getTime();
      }
      return 0;
    };

    function getCreatedAtMs(shipment: FedexShipment): number {
      const ms = new Date(shipment.createdAt).getTime();
      return Number.isFinite(ms) ? ms : 0;
    }

    function upsertRow(
      group: PartnerShipmentGroup,
      rowKey: string,
      invoiceNo: string,
      productName: string,
      orderedQty: number,
      shippedQty: number,
      productOrder: number,
    ) {
      const existing = group.rowMap.get(rowKey);
      if (existing) {
        existing.shippedQty += shippedQty;
        if (orderedQty > 0) existing.orderedQty = orderedQty;
        existing.productOrder = Math.min(existing.productOrder, productOrder);
        return;
      }
      const row: PartnerShipmentRow = {
        rowKey,
        invoiceNo,
        productName,
        orderedQty,
        shippedQty,
        remainingQty: null,
        productOrder,
      };
      group.rowMap.set(rowKey, row);
    }

    const allocationUsage: ShipmentInvoiceUsage = new Map();
    const sortedShipments = [...shipments].sort((a, b) =>
      parseDateStr(a.shippingDate) - parseDateStr(b.shippingDate) ||
      getCreatedAtMs(a) - getCreatedAtMs(b) ||
      a.deliveryNo.localeCompare(b.deliveryNo, "ja", { numeric: true })
    );

    for (const s of sortedShipments) {
      let items: ShipmentItem[] = [];
      try { items = JSON.parse(s.itemsJson); } catch { items = []; }
      const groupKey = `${s.trackingNumber}_${s.shippingDate}`;
      if (!groupMap.has(groupKey)) {
        const g: PartnerShipmentGroup = {
          key: groupKey,
          trackingNumber: s.trackingNumber,
          shippingDate: s.shippingDate,
          createdAtMs: getCreatedAtMs(s),
          rows: [],
          isComplete: false,
          invoiceNos: new Set<string>(),
          rowMap: new Map<string, PartnerShipmentRow>(),
        };
        groupMap.set(groupKey, g);
        groups.push(g);
      }
      const group = groupMap.get(groupKey)!;
      group.createdAtMs = Math.min(group.createdAtMs, getCreatedAtMs(s));
      items.forEach((item, idx) => {
        const normalizedItem: ShipmentItem = isReturnProduct(item.productNameJa)
          ? { ...item, productNameJa: normalizeProductName(item.productNameJa), productNameEn: normalizeProductName(item.productNameEn) }
          : item;
        const { invoiceNo, product: matchedCsvProduct } = resolveShipmentItemInvoice(
          s.deliveryNo,
          normalizedItem,
          csvData,
          allocationUsage,
        );
        const rawTitle = normalizedItem.productNameJa || normalizedItem.productNameEn || "";
        const productName = matchedCsvProduct?.name ?? cleanShipmentProductTitle(rawTitle);
        const productOrder = matchedCsvProduct?.index ?? (csvData[invoiceNo]?.products.length ?? 0);
        const rowKey = matchedCsvProduct
          ? `${invoiceNo}:csv:${matchedCsvProduct.name}`
          : `${invoiceNo}:raw:${normalizeShipmentGroupKey(productName)}`;
        group.invoiceNos.add(invoiceNo);
        upsertRow(
          group,
          rowKey,
          invoiceNo,
          productName,
          matchedCsvProduct?.qty ?? 0,
          normalizedItem.quantity,
          productOrder,
        );
      });
    }

    for (const group of groups) {
      for (const invoiceNo of Array.from(group.invoiceNos)) {
        const products = csvData[invoiceNo]?.products ?? [];
        products.forEach((product, index) => {
          upsertRow(group, `${invoiceNo}:csv:${product.name}`, invoiceNo, product.name, product.qty, 0, index);
        });
      }
      group.rows = Array.from(group.rowMap.values()).sort((a, b) =>
        a.invoiceNo.localeCompare(b.invoiceNo, "ja") ||
        a.productOrder - b.productOrder ||
        a.productName.localeCompare(b.productName, "ja")
      );
    }

    const cumulativeShippedByRow = new Map<string, number>();
    const groupsOldestFirst = [...groups].sort((a, b) =>
      parseDateStr(a.shippingDate) - parseDateStr(b.shippingDate) ||
      a.createdAtMs - b.createdAtMs ||
      a.key.localeCompare(b.key, "ja")
    );
    for (const group of groupsOldestFirst) {
      for (const row of group.rows) {
        const previousShipped = cumulativeShippedByRow.get(row.rowKey) ?? 0;
        const cumulativeShipped = previousShipped + row.shippedQty;
        row.remainingQty = row.orderedQty > 0 ? Math.max(0, row.orderedQty - cumulativeShipped) : null;
        if (row.shippedQty > 0) cumulativeShippedByRow.set(row.rowKey, cumulativeShipped);
      }
      group.isComplete = group.rows.length > 0 && group.rows.every((row) => row.remainingQty !== null && row.remainingQty <= 0);
    }

    return groups.sort((a, b) => parseDateStr(b.shippingDate) - parseDateStr(a.shippingDate));
  }, [shipments, csvData]);

  // 発送数サマリー（残数計算用）
  const invoiceSummary = useMemo(() => {
    const summary: Record<string, { orderedQty: number; shippedQty: number }> = {};
    for (const [invoiceNo, data] of Object.entries(csvData)) {
      summary[invoiceNo] = { orderedQty: data.products.reduce((s, p) => s + p.qty, 0), shippedQty: 0 };
    }
    const allocationUsage: ShipmentInvoiceUsage = new Map();
    for (const s of shipments) {
      let items: ShipmentItem[] = [];
      try { items = JSON.parse(s.itemsJson); } catch { items = []; }
      for (const item of items) {
        const { invoiceNo } = resolveShipmentItemInvoice(s.deliveryNo, item, csvData, allocationUsage);
        if (!summary[invoiceNo]) summary[invoiceNo] = { orderedQty: 0, shippedQty: 0 };
        summary[invoiceNo].shippedQty += item.quantity;
      }
    }
    return summary;
  }, [shipments, csvData]);

  // 初回ロード時に直近のグループのみ展開
  useEffect(() => {
    if (!initialized && shipmentGroups.length > 0) {
      setExpandedGroups(new Set([shipmentGroups[0].key]));
      setInitialized(true);
    }
  }, [shipmentGroups, initialized]);

  if (shipmentGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Package className="h-12 w-12 mb-3 opacity-30" />
        <p className="text-sm">発送記録がありません</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {shipmentGroups.map((group, groupIdx) => {
        const isExpanded = expandedGroups.has(group.key);
        const toggleGroup = () => {
          setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(group.key)) next.delete(group.key);
            else next.add(group.key);
            return next;
          });
        };
        return (
          <Card key={group.key} className={group.isComplete ? "opacity-70" : ""}>
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg"
              onClick={toggleGroup}
            >
              <div className="text-muted-foreground flex-shrink-0">
                {isExpanded
                  ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                  : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                }
              </div>
              <span className="text-sm font-medium text-muted-foreground flex-shrink-0">Tracking:</span>
              <span className="font-mono font-semibold text-sm">{group.trackingNumber}</span>
              <span className="text-sm text-muted-foreground">·</span>
              <span className="text-sm text-muted-foreground flex-shrink-0">{group.shippingDate}</span>
              {groupIdx === 0 && (
                <Badge className="bg-sky-500/10 text-sky-600 border-sky-200 text-xs flex-shrink-0">Latest</Badge>
              )}
              {group.isComplete && (
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200 text-xs flex-shrink-0">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Complete
                </Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground flex-shrink-0">{group.rows.length} item{group.rows.length !== 1 ? "s" : ""}</span>
            </div>
            {isExpanded && (
              <CardContent className="px-4 pb-4 border-t">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs border-b">
                      <th className="text-left py-1.5 font-medium">Invoice</th>
                      <th className="text-left py-1.5 font-medium">Product</th>
                      <th className="text-right py-1.5 font-medium">Ordered</th>
                      <th className="text-right py-1.5 font-medium">Shipped</th>
                      <th className="text-right py-1.5 font-medium">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row, i) => {
                      return (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          <td className="py-2 text-muted-foreground text-xs">No.{row.invoiceNo}</td>
                          <td className="py-2"><div className="font-medium">{row.productName}</div></td>
                          <td className="py-2 text-right text-muted-foreground">{row.orderedQty > 0 ? row.orderedQty : "-"}</td>
                          <td className="py-2 text-right font-semibold">{row.shippedQty}</td>
                          <td className="py-2 text-right">
                            {row.remainingQty !== null && row.remainingQty > 0 ? (
                              <span className="text-amber-600 font-medium">{row.remainingQty}</span>
                            ) : row.remainingQty === 0 ? (
                              <span className="text-emerald-600 font-medium">0</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
