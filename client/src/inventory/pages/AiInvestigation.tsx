import { useMemo, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Database, ExternalLink, History, Loader2, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { useLocation } from "wouter";
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
      orderPaymentStatus?: string | null;
      cancelState?: string | null;
      refundStatus?: string | null;
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
  messages?: InvestigationChatMessage[];
  updatedAt?: string;
};
type InvestigationChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  result?: InvestigationResult;
};

const DEFAULT_EXAMPLES = [
  "FedEx発送登録漏れがないか確認してください",
];
const EXAMPLES_STORAGE_KEY = "invoice-site-ai-investigation-examples";
const HISTORY_STORAGE_KEY = "invoice-site-ai-investigation-history";

function makeMessageId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

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

function buildDeliveryHistoryUrl(row: EvidenceRow) {
  const params = new URLSearchParams();
  const group = invoiceNoFromDeliveryNo(row.deliveryNo);
  const historyId = String(row.historyId ?? "").trim();
  if (group && group !== "-") params.set("group", group);
  if (historyId) params.set("historyId", historyId);
  const query = params.toString();
  return `/inventory/delivery-history${query ? `?${query}` : ""}`;
}

function buildSearchUrl(path: string, query: string) {
  const params = new URLSearchParams();
  params.set("q", query);
  return `${path}?${params.toString()}`;
}

function firstSearchTerm(value: string) {
  return value.split(/\s+\/\s+|,/)[0]?.trim() ?? value;
}

function formatEbayStatus(value: string | null | undefined) {
  const status = String(value ?? "").trim();
  if (!status) return "-";
  const labels: Record<string, string> = {
    FULFILLED: "発送済み",
    IN_PROGRESS: "処理中",
    NOT_STARTED: "未発送",
    PAID: "支払い済み",
    PENDING: "保留",
    NOT_PAID: "未払い",
    NONE: "なし",
    NONE_REQUESTED: "キャンセル申請なし",
    NOT_CANCELED: "キャンセルなし",
    CANCELED: "キャンセル済み",
    CANCELLED: "キャンセル済み",
    CANCEL_REQUESTED: "キャンセル申請中",
    CANCEL_REJECTED: "キャンセル却下",
    REFUNDED: "返金済み",
    PARTIALLY_REFUNDED: "一部返金",
  };
  return labels[status] ? `${labels[status]} (${status})` : status;
}

function getEvidenceCellLink(sectionTitle: string, key: string, row: EvidenceRow, text: string) {
  if (!text || text === "-") return null;
  if (key === "deliveryNo") return buildDeliveryHistoryUrl(row);
  if (key === "managementNo" || key === "managementNos") {
    const query = firstSearchTerm(text);
    if (!query || query === "-") return null;
    if (sectionTitle === "入庫管理 発注") return buildSearchUrl("/inventory/purchases", query);
    return buildSearchUrl("/inventory/deliveries", query);
  }
  return null;
}

function splitInvestigationAnswer(answer: string) {
  const trimmed = answer.trim();
  const detailsStart = trimmed.search(/\n##\s*(?:詳細|数量サマリー|次に見るところ|原因候補|次にするべき行動)/);
  if (detailsStart <= 0) return { summary: trimmed, details: "" };
  return {
    summary: trimmed.slice(0, detailsStart).trim(),
    details: trimmed.slice(detailsStart).trim(),
  };
}

function InvestigationAnswer({ answer }: { answer: string }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const parts = useMemo(() => splitInvestigationAnswer(answer), [answer]);

  return (
    <div className="space-y-3">
      <div className="text-sm whitespace-pre-wrap leading-6">{parts.summary}</div>
      {parts.details ? (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {detailsOpen ? "詳細を隠す" : "詳細を表示"}
          </Button>
          {detailsOpen ? (
            <div className="rounded-md border bg-muted/20 p-3 text-sm whitespace-pre-wrap leading-6">
              {parts.details}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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

function EvidenceTable({ section, allSections }: { section: EvidenceSection; allSections: EvidenceSection[] }) {
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

export default function AiInvestigation() {
  const [question, setQuestion] = useState("");
  const [includeEbay, setIncludeEbay] = useState(true);
  const [examples, setExamples] = useState(loadExamples);
  const [newExample, setNewExample] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(true);
  const [historyItems, setHistoryItems] = useState(loadHistory);
  const [displayResult, setDisplayResult] = useState<InvestigationResult | null>(null);
  const [activeContext, setActiveContext] = useState<{ question: string; result: InvestigationResult } | null>(null);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<InvestigationChatMessage[]>([]);
  const saveHistory = (next: InvestigationHistoryItem[]) => {
    const limited = next.slice(0, 30);
    setHistoryItems(limited);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(limited));
  };
  const updateHistory = (updater: (items: InvestigationHistoryItem[]) => InvestigationHistoryItem[]) => {
    setHistoryItems((items) => {
      const limited = updater(items).slice(0, 30);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(limited));
      return limited;
    });
  };
  const investigate = trpc.inventory.aiInvestigation.investigate.useMutation();
  const result = displayResult;

  const canSubmit = question.trim().length >= 2 && !investigate.isPending;
  const canSubmitFollowUp = followUpQuestion.trim().length >= 2 && chatMessages.length > 0 && !investigate.isPending;

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

  const buildConversationContext = (
    trimmed: string,
    priorityContext: Array<{ question: string; result: InvestigationResult } | null> = [activeContext],
  ) => {
    const contextSource = [
      ...priorityContext,
      ...historyItems.map((item) => ({ question: item.question, result: item.result })),
    ];
    const seen = new Set<string>();
    return contextSource
      .filter((item): item is { question: string; result: InvestigationResult } => Boolean(item?.question && item.result?.answer))
      .filter((item) => {
        const key = `${item.question}\n${item.result.answer}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return item.question !== trimmed;
      })
      .slice(0, 5)
      .map((item) => ({ question: item.question, answer: item.result.answer }));
  };

  const runInvestigationWithText = async (
    text: string,
    priorityContext?: Array<{ question: string; result: InvestigationResult } | null>,
    options: { resetConversation?: boolean } = {},
  ) => {
    const trimmed = text.trim();
    if (trimmed.length < 2 || investigate.isPending) return;
    const isNewConversation = options.resetConversation === true;
    const currentHistoryId = isNewConversation ? makeMessageId() : activeHistoryId;
    const conversationContext = buildConversationContext(trimmed, priorityContext);
    const userMessage: InvestigationChatMessage = {
      id: makeMessageId(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setResultOpen(true);
    setChatMessages((messages) => isNewConversation ? [userMessage] : [...messages, userMessage]);
    if (isNewConversation) {
      setDisplayResult(null);
      setActiveContext(null);
      setActiveHistoryId(null);
      setSubmittedQuestion("");
    }
    try {
      const data = await investigate.mutateAsync({ question: trimmed, includeEbay, conversationContext });
      const nextResult = data as InvestigationResult;
      const assistantMessage: InvestigationChatMessage = {
        id: makeMessageId(),
        role: "assistant",
        content: nextResult.answer,
        createdAt: new Date().toISOString(),
        result: nextResult,
      };
      setDisplayResult(nextResult);
      setActiveContext({ question: trimmed, result: nextResult });
      setSubmittedQuestion(trimmed);
      setFollowUpQuestion("");
      setResultOpen(true);
      setChatMessages((messages) => [...messages, assistantMessage]);
      const nextMessages = isNewConversation
        ? [userMessage, assistantMessage]
        : [...chatMessages, userMessage, assistantMessage];
      const existingHistory = currentHistoryId
        ? historyItems.find((item) => item.id === currentHistoryId)
        : null;
      const historyId = currentHistoryId ?? makeMessageId();
      const historyQuestion = isNewConversation
        ? trimmed
        : (existingHistory?.question ?? activeContext?.question ?? trimmed);
      setActiveHistoryId(historyId);
      updateHistory((items) => {
        const existing = items.find((item) => item.id === historyId);
        if (!existing) {
          return [
            {
              id: historyId,
              question: historyQuestion,
              includeEbay,
              createdAt: userMessage.createdAt,
              updatedAt: assistantMessage.createdAt,
              result: nextResult,
              messages: nextMessages,
            },
            ...items,
          ];
        }
        return [
          {
            ...existing,
            includeEbay,
            updatedAt: assistantMessage.createdAt,
            result: nextResult,
            messages: nextMessages,
          },
          ...items.filter((item) => item.id !== historyId),
        ];
      });
    } catch {
      // tRPC exposes the error through investigate.error; keep the typed question visible.
    }
  };

  const runInvestigation = () => {
    runInvestigationWithText(question, undefined, { resetConversation: true });
  };

  const runFollowUpInvestigation = () => {
    runInvestigationWithText(followUpQuestion, [activeContext]);
  };

  const openHistoryItem = (item: InvestigationHistoryItem) => {
    setQuestion(item.question);
    setIncludeEbay(item.includeEbay);
    setDisplayResult(item.result);
    setActiveContext({ question: item.question, result: item.result });
    setActiveHistoryId(item.id);
    setSubmittedQuestion(item.question);
    setFollowUpQuestion("");
    setChatMessages(item.messages?.length ? item.messages : [
      {
        id: makeMessageId(),
        role: "user",
        content: item.question,
        createdAt: item.createdAt,
      },
      {
        id: makeMessageId(),
        role: "assistant",
        content: item.result.answer,
        createdAt: item.createdAt,
        result: item.result,
      },
    ]);
    setResultOpen(true);
  };

  const deleteHistoryItem = (id: string) => {
    saveHistory(historyItems.filter((item) => item.id !== id));
    if (activeHistoryId === id) setActiveHistoryId(null);
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
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="text-sm truncate">{item.question}</div>
                          {(item.messages?.filter((message) => message.role === "user").length ?? 1) > 1 ? (
                            <Badge variant="secondary" className="shrink-0">
                              {item.messages?.filter((message) => message.role === "user").length}質問
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatHistoryDate(item.updatedAt ?? item.createdAt)}
                        </div>
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

      {chatMessages.length > 0 ? (
        <div className="space-y-4">
          <Collapsible open={resultOpen} onOpenChange={setResultOpen}>
            <Card className="rounded-lg border-emerald-200">
              <CollapsibleTrigger asChild>
                <button type="button" className="w-full text-left">
                  <CardHeader className="py-3">
                    <CardTitle className="text-base flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-emerald-600" />
                        調査チャット
                      </span>
                      <Badge variant="outline">{resultOpen ? "表示中" : "非表示"}</Badge>
                    </CardTitle>
                  </CardHeader>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-3">
                  {chatMessages.map((message) => (
                    <div
                      key={message.id}
                      className={message.role === "user"
                        ? "ml-auto max-w-[82%] rounded-lg border bg-primary/5 px-3 py-2"
                        : "max-w-[92%] rounded-lg border bg-background px-3 py-2"}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant={message.role === "user" ? "secondary" : "outline"}>
                          {message.role === "user" ? "質問" : "回答"}
                        </Badge>
                        <span>{formatHistoryDate(message.createdAt)}</span>
                      </div>
                      {message.role === "assistant" ? (
                        <InvestigationAnswer answer={message.content} />
                      ) : (
                        <div className="text-sm whitespace-pre-wrap leading-6">{message.content}</div>
                      )}
                    </div>
                  ))}
                  {investigate.isPending ? (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      調査中です
                    </div>
                  ) : null}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <Card className="rounded-lg">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">続けて質問</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <Textarea
                value={followUpQuestion}
                onChange={(event) => setFollowUpQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    runFollowUpInvestigation();
                  }
                }}
                className="min-h-[88px] resize-y"
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={!canSubmitFollowUp}
                  onClick={runFollowUpInvestigation}
                >
                  {investigate.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4 mr-2" />
                  )}
                  調査する
                </Button>
              </div>
            </CardContent>
          </Card>

          {result?.ebayOrders?.length ? (
            <Card className="rounded-lg">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">eBay API確認</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 flex flex-wrap gap-2">
                {result.ebayOrders.map((order) => (
                  <Badge key={order.orderId} variant={order.ok ? "default" : "destructive"}>
                    {order.orderId}: {order.ok
                      ? `発送=${formatEbayStatus(order.status?.orderFulfillmentStatus)} / キャンセル=${formatEbayStatus(order.status?.cancelState)}`
                      : order.error}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {result ? <ActionItemForm sourceQuestion={submittedQuestion || question} /> : null}

          {result ? (
            <div className="space-y-2">
              {(result.evidence as EvidenceSection[]).map((section) => (
                <EvidenceTable key={section.title} section={section} allSections={result.evidence as EvidenceSection[]} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
