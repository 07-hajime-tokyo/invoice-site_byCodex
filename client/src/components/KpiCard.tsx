/**
 * KpiCard Component
 * Design: Scandinavian BI Style
 * Displays key performance indicators with count-up animation
 */
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  icon: ReactNode;
  trend?: "positive" | "negative" | "neutral";
  sub?: string;
  className?: string;
}

export function KpiCard({ label, value, icon, trend = "neutral", sub, className }: KpiCardProps) {
  const trendColor =
    trend === "positive"
      ? "text-teal-600"
      : trend === "negative"
      ? "text-rose-500"
      : "text-amber-600";

  return (
    <div className={cn("kpi-card animate-count", className)}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground tracking-wide uppercase">{label}</span>
        <span className="text-muted-foreground/60">{icon}</span>
      </div>
      <div className={cn("text-2xl font-bold tabular-nums leading-tight", trendColor)}>
        {value}
      </div>
      {sub && (
        <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      )}
    </div>
  );
}
