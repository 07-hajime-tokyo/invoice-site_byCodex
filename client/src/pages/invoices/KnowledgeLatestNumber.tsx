import { Button } from "@/components/ui/button";
import { RefreshCw, Download, Plus } from "lucide-react";

export type KnowledgeLatestNumberResult = {
  invoiceNumber: number | null;
  nextNumber: number | null;
  message: string;
};

export function KnowledgeLatestNumber({
  knowledgeCount,
  isExtracting,
  latestNumberResult,
  onExtract,
  onCreate,
}: {
  knowledgeCount: number;
  isExtracting: boolean;
  latestNumberResult: KnowledgeLatestNumberResult | null;
  onExtract: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="bg-muted/30 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold">最新インボイス番号を抽出</p>
      <p className="text-xs text-muted-foreground">
        知識ベースの学習データからAIが最新のインボイス番号を抽出し、次の番号でインボイスを作成できます。
      </p>
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1.5"
        onClick={() => onExtract()}
        disabled={isExtracting || knowledgeCount === 0}
      >
        {isExtracting ? (
          <>
            <RefreshCw size={13} className="animate-spin" />
            AI解析中...
          </>
        ) : (
          <>
            <Download size={13} />
            最新インボイス番号を抽出
          </>
        )}
      </Button>
      {latestNumberResult && (
        <div className="bg-background border border-border rounded p-2.5 space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {latestNumberResult.message}
          </p>
          {latestNumberResult.nextNumber && (
            <Button
              size="sm"
              className="w-full bg-[#075E54] hover:bg-[#075E54]/90 text-white gap-1.5"
              onClick={() => {
                onCreate();
              }}
            >
              <Plus size={13} />
              No.{latestNumberResult.nextNumber} でインボイスを作成
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
