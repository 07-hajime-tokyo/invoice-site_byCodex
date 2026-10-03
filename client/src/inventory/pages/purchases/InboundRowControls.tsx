import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INBOUND_CLASS_ORDER,
  INBOUND_CLASS_LABEL,
  UNCLASSIFIED_LABEL,
  getStagesForClass,
  getStageLabel,
  getStageIndex,
  nextStage,
  isInboundComplete,
  type InboundClass,
} from "@shared/inboundPipeline";
import { type Purchase } from "./types";

export function InboundRowControls({
  purchase,
  busy,
  onSetClass,
  onAdvance,
  onSeparateShaft,
}: {
  purchase: Purchase;
  busy: boolean;
  onSetClass: (purchase: Purchase, cls: InboundClass | null) => void;
  onAdvance: (purchase: Purchase) => void;
  onSeparateShaft: (purchase: Purchase) => void;
}) {
  const inboundClass = purchase.inboundClass ?? null;
  const classSource = purchase.classSource ?? "auto";
  const stage = purchase.stage ?? "received";
  const stages = getStagesForClass(inboundClass);
  const currentIndex = getStageIndex(inboundClass, stage);
  const complete = isInboundComplete(inboundClass, stage);
  const upcoming = nextStage(inboundClass, stage);
  const canSeparateShaft =
    (inboundClass === "ebay" || inboundClass === "oregon") &&
    stage === "registered" &&
    !complete;

  return (
    <div className="mt-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 space-y-2">
      {/* 分類行 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-muted-foreground">分類:</span>
        <Select
          value={inboundClass ?? "unclassified"}
          onValueChange={v =>
            onSetClass(
              purchase,
              v === "unclassified" ? null : (v as InboundClass)
            )
          }
          disabled={busy}
        >
          <SelectTrigger className="h-7 w-[168px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unclassified">{UNCLASSIFIED_LABEL}</SelectItem>
            {INBOUND_CLASS_ORDER.map(cls => (
              <SelectItem key={cls} value={cls}>
                {INBOUND_CLASS_LABEL[cls]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {inboundClass && (
          <Badge
            variant="outline"
            className={`text-[10px] ${classSource === "manual" ? "border-purple-300 text-purple-700 dark:text-purple-300" : "border-blue-300 text-blue-700 dark:text-blue-300"}`}
          >
            {classSource === "manual" ? "手動" : "自動"}
          </Badge>
        )}
        {complete && (
          <Badge className="text-[10px] bg-muted text-muted-foreground border">
            完了
          </Badge>
        )}
      </div>

      {/* 未仕訳: クイック分類ボタン（入庫作業前ゲート） */}
      {!inboundClass && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground">仕訳:</span>
          {INBOUND_CLASS_ORDER.map(cls => (
            <Button
              key={cls}
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={busy}
              onClick={() => onSetClass(purchase, cls)}
            >
              {INBOUND_CLASS_LABEL[cls]}
            </Button>
          ))}
        </div>
      )}

      {/* 分類済み: 工程チップ ＋ 次工程ボタン */}
      {inboundClass && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {stages.map((s, i) => {
              const done = complete || i <= currentIndex;
              const isCurrent = !complete && i === currentIndex;
              return (
                <span key={s} className="flex items-center gap-1">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border ${
                      isCurrent
                        ? "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200"
                        : done
                          ? "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-200"
                          : "bg-background text-muted-foreground border-border"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${done ? "bg-teal-500" : "bg-muted-foreground/30"}`}
                    />
                    {getStageLabel(s)}
                  </span>
                  {i < stages.length - 1 && (
                    <span className="text-muted-foreground/40 text-[10px]">
                      –
                    </span>
                  )}
                </span>
              );
            })}
          </div>
          {!complete && upcoming && (
            <Button
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              disabled={busy}
              onClick={() => onAdvance(purchase)}
            >
              {busy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                `${getStageLabel(upcoming)}へ進む ▶`
              )}
            </Button>
          )}
          {canSeparateShaft && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-[11px] border-amber-300 text-amber-700 dark:text-amber-300"
              disabled={busy}
              onClick={() => onSeparateShaft(purchase)}
            >
              シャフト分離
            </Button>
          )}
        </div>
      )}
      {purchase.shaftParentPurchaseId != null && (
        <div className="text-[10px] text-muted-foreground">
          ↳ シャフト分離で生成（元発注 #{purchase.shaftParentPurchaseId}）
        </div>
      )}
    </div>
  );
}
