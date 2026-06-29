import { useMemo, useState } from "react";
import { Bot, Database, ExternalLink, History, Loader2, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionItemForm } from "@/inventory/components/ActionItemForm";
import { trpc } from "@/lib/trpc";

type EvidenceRow = Record<string, string | number | boolean | null>;
type EvidenceSection = { title: string; rows: EvidenceRow[] };
type InvestigationResult = {
  answer: string;
  evidence: EvidenceSection[];
  ebayOrders?: Array<{
    orderId: string;
    ok: boolean;
    status?: {
      orderFulfillmentStatus?: string | null;
      cancelState?: string | null;
    };
    error?: string;
  }>;
};
type InvestigationHistoryItem = {
  id: string;
  question: string;
  includeEbay: boolean;
  createdAt: string;
  result: InvestigationResult;
};

const DEFAULT_EXAMPLES = [
  "FedEx発送登録漏れがないか確認してください",
];
const EXAMPLES_STORAGE_KEY = "invoice-site-ai-investigation-examples";
const HISTORY_STORAGE_KEY = "invoice-site-ai-investigation-history";

function loadExamples() {
  if (typeof window === "undefined") return DEFAULT_EXAMPLES;
  try {
    const saved = JSON.parse(localStorage.getItem(EXAMPLES_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(saved)) return DEFAULT_EXAMPLES;
    const custom = saved.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return Array.from(new Set([...DEFAULT_EXAMPLES, ...custom]));
  } catch {
    return DEFAULT_EXAMPLES;
  }
}

function loadHistory(): InvestigationHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter((item): item is InvestigationHistoryItem =>
      item &&
      typeof item === "object" &&
      typeof item.id === "string" &&
      typeof item.question === "string" &&
      typeof item.createdAt === "string" &&
      item.result &&
      typeof item.result === "object" &&
      typeof item.result.answer === "string",
    );
  } catch {
    return [];
  }
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCellValue(value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return value ? "あり" : "なし";
  return String(value);
}

function toNumber(value: unknown) {
  const num = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function invoiceNoFromDeliveryNo(value: unknown) {
  return String(value ?? "").match(/^(\d+)/)?.[1] ?? "-";
}

function displayDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  return text.replaceAll("-", "/");
}

function summarizeProducts(rows: EvidenceRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const title = String(row.title ?? row.productName ?? "-").trim() || "-";
    map.set(title, (map.get(title) ?? 0) + (toNumber(row.quantity) || 1));
  }
  return Array.from(map.entries()).map(([title, quantity]) => `${title} x${quantity}`);
}

function DeliveryEvidenceGroups({ section, allSections }: { section: EvidenceSection; allSections: EvidenceSection[] }) {
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
                        <span className="font-medium">出庫No: {delivery.deliveryNo}</span>
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

function EvidenceTable({ section, allSections }: { section: EvidenceSection; allSections: EvidenceSection[] }) {
  const [open, setOpen] = useState(section.rows.length > 0);
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
                          return (
                            <td key={key} className="px-3 py-2 max-w-[320px] truncate whitespace-nowrap">
                              {isUrl ? (
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

export default function AiInvestigation() {
  const [question, setQuestion] = useState("");
  const [includeEbay, setIncludeEbay] = useState(true);
  const [examples, setExamples] = useState(loadExamples);
  const [newExample, setNewExample] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(true);
  const [historyItems, setHistoryItems] = useState(loadHistory);
  const [displayResult, setDisplayResult] = useState<InvestigationResult | null>(null);
  const saveHistory = (next: InvestigationHistoryItem[]) => {
    const limited = next.slice(0, 30);
    setHistoryItems(limited);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(limited));
  };
  const investigate = trpc.inventory.aiInvestigation.investigate.useMutation({
    onSuccess(data, variables) {
      const result = data as InvestigationResult;
      setDisplayResult(result);
      setResultOpen(true);
      saveHistory([
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
          question: variables.question,
          includeEbay: variables.includeEbay ?? true,
          createdAt: new Date().toISOString(),
          result,
        },
        ...historyItems,
      ]);
    },
  });
  const result = displayResult;

  const canSubmit = question.trim().length >= 2 && !investigate.isPending;

  const saveExamples = (next: string[]) => {
    const normalized = Array.from(new Set(next.map((value) => value.trim()).filter(Boolean)));
    setExamples(normalized);
    localStorage.setItem(
      EXAMPLES_STORAGE_KEY,
      JSON.stringify(normalized.filter((value) => !DEFAULT_EXAMPLES.includes(value))),
    );
  };

  const addExample = () => {
    const trimmed = newExample.trim();
    if (trimmed.length < 2) return;
    saveExamples([...examples, trimmed]);
    setNewExample("");
  };

  const removeExample = (example: string) => {
    saveExamples(examples.filter((value) => value !== example));
  };

  const runInvestigation = () => {
    const trimmed = question.trim();
    if (!canSubmit) return;
    setDisplayResult(null);
    investigate.mutate({ question: trimmed, includeEbay });
  };

  const openHistoryItem = (item: InvestigationHistoryItem) => {
    setQuestion(item.question);
    setIncludeEbay(item.includeEbay);
    setDisplayResult(item.result);
    setResultOpen(true);
  };

  const deleteHistoryItem = (id: string) => {
    saveHistory(historyItems.filter((item) => item.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-600" />
            AI調査
          </h1>
        </div>
      </div>

      <Card className="rounded-lg">
        <CardContent className="p-4 space-y-3">
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                runInvestigation();
              }
            }}
            placeholder="例: No.392のアクアブルーが5台発送済みのはずなのに3/5になっています"
            className="min-h-[120px] resize-y"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="include-ebay"
                checked={includeEbay}
                onCheckedChange={(checked) => setIncludeEbay(checked === true)}
              />
              <label htmlFor="include-ebay" className="text-sm cursor-pointer">
                eBay APIも確認
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {examples.map((example) => (
                <div key={example} className="flex items-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-r-none"
                    onClick={() => setQuestion(example)}
                  >
                    {example.length > 22 ? `${example.slice(0, 22)}...` : example}
                  </Button>
                  {!DEFAULT_EXAMPLES.includes(example) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-8 rounded-l-none border-l-0"
                      onClick={() => removeExample(example)}
                      aria-label="候補を削除"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              ))}
              <div className="flex items-center">
                <Input
                  value={newExample}
                  onChange={(event) => setNewExample(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addExample();
                    }
                  }}
                  placeholder="候補を追加"
                  className="h-9 w-[180px] rounded-r-none"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-l-none border-l-0"
                  onClick={addExample}
                  disabled={newExample.trim().length < 2}
                  aria-label="候補を追加"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <Button
                type="button"
                disabled={!canSubmit}
                onClick={runInvestigation}
              >
                {investigate.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                調査する
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <Card className="rounded-lg">
          <CollapsibleTrigger asChild>
            <button className="w-full">
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <History className="h-4 w-4 text-muted-foreground" />
                    調査履歴
                  </span>
                  <Badge variant="outline">{historyItems.length}件</Badge>
                </CardTitle>
              </CardHeader>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              {historyItems.length === 0 ? (
                <div className="text-sm text-muted-foreground py-3">まだ履歴はありません</div>
              ) : (
                <div className="space-y-2">
                  {historyItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      <button
                        type="button"
                        className="min-w-0 text-left flex-1"
                        onClick={() => openHistoryItem(item)}
                      >
                        <div className="text-sm truncate">{item.question}</div>
                        <div className="text-xs text-muted-foreground">{formatHistoryDate(item.createdAt)}</div>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => deleteHistoryItem(item.id)}
                        aria-label="履歴を削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {investigate.error ? (
        <Card className="rounded-lg border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">
            {investigate.error.message}
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <div className="space-y-4">
          <Collapsible open={resultOpen} onOpenChange={setResultOpen}>
            <Card className="rounded-lg border-emerald-200">
              <CollapsibleTrigger asChild>
                <button type="button" className="w-full text-left">
                  <CardHeader className="py-3">
                    <CardTitle className="text-base flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-emerald-600" />
                        調査結果
                      </span>
                      <Badge variant="outline">{resultOpen ? "表示中" : "非表示"}</Badge>
                    </CardTitle>
                  </CardHeader>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="text-sm whitespace-pre-wrap leading-6">
                    {result.answer}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {result.ebayOrders?.length ? (
            <Card className="rounded-lg">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">eBay API確認</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 flex flex-wrap gap-2">
                {result.ebayOrders.map((order) => (
                  <Badge key={order.orderId} variant={order.ok ? "default" : "destructive"}>
                    {order.orderId}: {order.ok
                      ? `${order.status?.orderFulfillmentStatus ?? "-"} / ${order.status?.cancelState ?? "cancelなし"}`
                      : order.error}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <ActionItemForm sourceQuestion={question} />

          <div className="space-y-2">
            {(result.evidence as EvidenceSection[]).map((section) => (
              <EvidenceTable key={section.title} section={section} allSections={result.evidence as EvidenceSection[]} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
