/**
 * ChartSection Component
 * Design: Scandinavian BI Style
 * Interactive charts using Recharts for trade data visualization
 */
import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TradeRecord, formatCurrency, formatNumber } from "@/lib/csvUtils";
import { ChevronDown, ChevronUp, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChartSectionProps {
  records: TradeRecord[];
}

const TEAL = "#0F766E";
const AMBER = "#D97706";
const ROSE = "#E11D48";
const TEAL_LIGHT = "#5EEAD4";
const COLORS = [TEAL, AMBER, "#6366F1", "#EC4899", "#F59E0B", "#10B981"];

const MONTH_LABELS: Record<string, string> = {
  "1": "1月", "2": "2月", "3": "3月", "4": "4月",
  "5": "5月", "6": "6月", "7": "7月", "8": "8月",
  "9": "9月", "10": "10月", "11": "11月", "12": "12月",
};

export function ChartSection({ records }: ChartSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [activeChart, setActiveChart] = useState<"monthly" | "partner" | "product" | "profit">("monthly");

  // Monthly profit data
  const monthlyData = useMemo(() => {
    const map: Record<string, { profit: number; sales: number; count: number }> = {};
    for (const r of records) {
      if (!r.month) continue;
      if (!map[r.month]) map[r.month] = { profit: 0, sales: 0, count: 0 };
      map[r.month].profit += r.profitWithRefund;
      map[r.month].sales += r.totalSales;
      map[r.month].count += 1;
    }
    return Object.entries(map)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([month, v]) => ({
        name: MONTH_LABELS[month] ?? `${month}月`,
        利益: Math.round(v.profit),
        売上: Math.round(v.sales),
        件数: v.count,
      }));
  }, [records]);

  // Partner breakdown
  const partnerData = useMemo(() => {
    const map: Record<string, { profit: number; count: number }> = {};
    for (const r of records) {
      if (!r.partner) continue;
      if (!map[r.partner]) map[r.partner] = { profit: 0, count: 0 };
      map[r.partner].profit += r.profitWithRefund;
      map[r.partner].count += 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1].profit - a[1].profit)
      .map(([name, v]) => ({
        name,
        利益: Math.round(v.profit),
        件数: v.count,
      }));
  }, [records]);

  // Top products by profit
  const productData = useMemo(() => {
    const map: Record<string, { profit: number; count: number }> = {};
    for (const r of records) {
      if (!r.productName) continue;
      if (!map[r.productName]) map[r.productName] = { profit: 0, count: 0 };
      map[r.productName].profit += r.profitWithRefund;
      map[r.productName].count += 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1].profit - a[1].profit)
      .slice(0, 10)
      .map(([name, v]) => ({
        name: name.length > 14 ? name.slice(0, 14) + "…" : name,
        利益: Math.round(v.profit),
        件数: v.count,
      }));
  }, [records]);

  // Cumulative profit line
  const cumulativeData = useMemo(() => {
    const sorted = [...records]
      .filter((r) => r.paymentDate)
      .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));
    let cum = 0;
    return sorted.map((r) => {
      cum += r.profitWithRefund;
      return {
        name: r.paymentDate,
        累積利益: Math.round(cum),
      };
    });
  }, [records]);

  const formatYAxis = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return String(v);
  };

  const tooltipFormatter = (value: number, name: string) => {
    if (name === "件数") return [formatNumber(value) + "件", name];
    return [formatCurrency(value), name];
  };

  const tabs = [
    { key: "monthly" as const, label: "月別利益" },
    { key: "partner" as const, label: "取引相手別" },
    { key: "product" as const, label: "商品TOP10" },
    { key: "profit" as const, label: "累積利益" },
  ];

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm mb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <BarChart2 size={16} className="text-primary" />
          <span className="text-sm font-semibold text-foreground">データ可視化</span>
          <span className="text-xs text-muted-foreground ml-1">({records.length}件)</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(!isOpen)}
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
        >
          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span className="ml-1 text-xs">{isOpen ? "折りたたむ" : "展開"}</span>
        </Button>
      </div>

      {isOpen && (
        <div className="p-4">
          {/* Chart tabs */}
          <div className="flex gap-1 mb-4 flex-wrap">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveChart(t.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                  activeChart === t.key
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Charts */}
          <div className="h-64 md:h-72">
            {activeChart === "monthly" && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip formatter={tooltipFormatter} contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #E5E7EB" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="利益" fill={TEAL} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="売上" fill={TEAL_LIGHT} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}

            {activeChart === "partner" && (
              <div className="flex flex-col md:flex-row gap-4 h-full">
                <div className="flex-1 min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={partnerData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                      <XAxis type="number" tickFormatter={formatYAxis} tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} width={52} />
                      <Tooltip formatter={tooltipFormatter} contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #E5E7EB" }} />
                      <Bar dataKey="利益" fill={TEAL} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full md:w-48 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={partnerData}
                        dataKey="件数"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                        fontSize={10}
                      >
                        {partnerData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => [formatNumber(v as number) + "件", "件数"]} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {activeChart === "product" && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                  <XAxis type="number" tickFormatter={formatYAxis} tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#374151" }} axisLine={false} tickLine={false} width={120} />
                  <Tooltip formatter={tooltipFormatter} contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #E5E7EB" }} />
                  <Bar dataKey="利益" fill={AMBER} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}

            {activeChart === "profit" && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cumulativeData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="name" tick={false} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip
                    formatter={(v) => [formatCurrency(v as number), "累積利益"]}
                    contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #E5E7EB" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="累積利益"
                    stroke={TEAL}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: TEAL }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
