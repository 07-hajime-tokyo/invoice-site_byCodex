/**
 * AI回答の「要約＋折りたたみ詳細」表示部品。
 * AiInvestigation.tsx から逐語移動。
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { splitInvestigationAnswer } from "./format";

export function InvestigationAnswer({ answer }: { answer: string }) {
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
