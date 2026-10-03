export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: { label: "下書き", className: "bg-gray-100 text-gray-600 border-gray-200" },
    sent: { label: "送付済み", className: "bg-blue-50 text-blue-600 border-blue-200" },
    paid: { label: "支払済み", className: "bg-emerald-50 text-emerald-600 border-emerald-200" },
  };
  const s = map[status] ?? map.draft;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.className}`}>
      {s.label}
    </span>
  );
}
