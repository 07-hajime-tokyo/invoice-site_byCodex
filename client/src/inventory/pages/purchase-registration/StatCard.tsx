export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-3 md:p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 break-words text-lg font-semibold tracking-tight md:text-xl">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
