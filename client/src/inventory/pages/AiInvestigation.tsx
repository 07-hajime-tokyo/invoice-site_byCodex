import { useState } from "react";
import { Bot, History, Loader2, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionItemForm } from "@/inventory/components/ActionItemForm";
import { trpc } from "@/lib/trpc";
import { EvidenceTable } from "./ai-investigation/EvidenceTable";
import { InvestigationAnswer } from "./ai-investigation/InvestigationAnswer";
import { formatEbayOrderSummary, formatHistoryDate } from "./ai-investigation/format";
import {
  DEFAULT_EXAMPLES,
  EXAMPLES_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
  loadExamples,
  loadHistory,
} from "./ai-investigation/storage";
import type {
  EvidenceSection,
  InvestigationChatMessage,
  InvestigationHistoryItem,
  InvestigationResult,
} from "./ai-investigation/types";

function makeMessageId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
                    {order.orderId}: {formatEbayOrderSummary(order)}
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
