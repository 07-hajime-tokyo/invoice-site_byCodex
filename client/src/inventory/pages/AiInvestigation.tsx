import { useMemo, useState } from "react";
import { Bot, Database, ExternalLink, Loader2, Plus, Search, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

type EvidenceRow = Record<string, string | number | boolean | null>;
type EvidenceSection = { title: string; rows: EvidenceRow[] };

const DEFAULT_EXAMPLES = [
  "FedEx発送登録漏れがないか確認してください",
];
const EXAMPLES_STORAGE_KEY = "invoice-site-ai-investigation-examples";

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

function formatCellValue(value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return value ? "あり" : "なし";
  return String(value);
}

function EvidenceTable({ section }: { section: EvidenceSection }) {
  const [open, setOpen] = useState(section.rows.length > 0);
  const keys = useMemo(() => {
    const preferred = [
      "no",
      "deliveryNo",
      "managementNo",
      "title",
      "productName",
      "quantity",
      "status",
      "trackingNumber",
      "shippingDate",
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
            {section.rows.length === 0 ? (
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
  const investigate = trpc.inventory.aiInvestigation.investigate.useMutation();
  const result = investigate.data;

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
                onClick={() => investigate.mutate({ question: question.trim(), includeEbay })}
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

      {investigate.error ? (
        <Card className="rounded-lg border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">
            {investigate.error.message}
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <div className="space-y-4">
          <Card className="rounded-lg border-emerald-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="h-4 w-4 text-emerald-600" />
                調査結果
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm whitespace-pre-wrap leading-6">
                {result.answer}
              </div>
            </CardContent>
          </Card>

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

          <div className="space-y-2">
            {(result.evidence as EvidenceSection[]).map((section) => (
              <EvidenceTable key={section.title} section={section} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
