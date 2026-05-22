/**
 * ProgressBadge — 仕入れ・発送の進捗をインボイスNoに紐づけて表示するコンポーネント
 * 「あと何台仕入れないといけないか」「あと何台発送しないといけないか」がパッと見でわかるデザイン
 */
import React from "react";
import { Loader2, CheckCircle2, PackageCheck, Truck, AlertCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Zaico APIから取得した進捗データの型
export interface InvoiceProgress {
  invoiceNo: number;
  orderedQty: number;    // 仕入れ発注中
  receivedQty: number;  // 仕入れ完了（入庫済み）
  inStockQty: number;   // 在庫あり（発送待ち）
  shippedQty: number;   // 発送済み
  purchaseItems: Array<{
    title: string;
    managementNo: string;
    quantity: number;
    status: string;
    shipDate: string | null;
    trackingNumber: string | null;
  }>;
  inventoryItems: Array<{
    title: string;
    managementNo: string;
    quantity: number;
    place: string | null;
  }>;
}

interface ProgressBadgeProps {
  invoiceNo: number;
  orderQty: number; // CSVの発注数
  progress: InvoiceProgress | undefined;
  loading: boolean;
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function ProgressBadge({ invoiceNo, orderQty, progress, loading }: ProgressBadgeProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <Loader2 size={11} className="animate-spin" />
        <span className="text-[10px]">読込中</span>
      </div>
    );
  }

  if (!progress) {
    return (
      <span className="text-[10px] text-muted-foreground/40">—</span>
    );
  }

  // 仕入れ進捗
  const procuredQty = progress.orderedQty + progress.receivedQty;
  const remainProcure = Math.max(0, orderQty - procuredQty);
  const procureComplete = procuredQty >= orderQty && orderQty > 0;

  // 発送進捗（在庫データがある場合のみ）
  const hasShipData = progress.inStockQty > 0 || progress.shippedQty > 0;
  const remainShip = Math.max(0, orderQty - progress.shippedQty);
  const shipComplete = progress.shippedQty >= orderQty && orderQty > 0;

  const tooltipContent = (
    <div className="text-xs space-y-2.5 max-w-[280px]">
      <div className="font-semibold border-b border-border pb-1.5">
        インボイス #{invoiceNo} — 発注数: {orderQty} 台
      </div>

      {/* 仕入れ進捗 */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1 text-[11px] font-semibold text-blue-700">
          <PackageCheck size={11} />
          仕入れ進捗
        </div>
        <div className="pl-1 space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">発注中（未入庫）</span>
            <span className="font-medium text-amber-600">{progress.orderedQty} 台</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">入庫済み</span>
            <span className="font-medium text-teal-600">{progress.receivedQty} 台</span>
          </div>
          <div className="flex justify-between text-[11px] font-semibold">
            <span className={remainProcure > 0 ? "text-red-600" : "text-teal-600"}>
              {remainProcure > 0 ? `あと ${remainProcure} 台仕入れ必要` : "仕入れ完了 ✓"}
            </span>
            <span className="text-muted-foreground">{procuredQty}/{orderQty}</span>
          </div>
          <ProgressBar
            value={procuredQty}
            max={orderQty}
            color={procureComplete ? "bg-teal-500" : procuredQty > 0 ? "bg-amber-400" : "bg-red-300"}
          />
        </div>
      </div>

      {/* 発送進捗 */}
      {hasShipData && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-purple-700">
            <Truck size={11} />
            発送進捗
          </div>
          <div className="pl-1 space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">在庫（発送待ち）</span>
              <span className="font-medium text-amber-600">{progress.inStockQty} 台</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">発送済み</span>
              <span className="font-medium text-teal-600">{progress.shippedQty} 台</span>
            </div>
            <div className="flex justify-between text-[11px] font-semibold">
              <span className={remainShip > 0 ? "text-red-600" : "text-teal-600"}>
                {remainShip > 0 ? `あと ${remainShip} 台発送必要` : "発送完了 ✓"}
              </span>
              <span className="text-muted-foreground">{progress.shippedQty}/{orderQty}</span>
            </div>
            <ProgressBar
              value={progress.shippedQty}
              max={orderQty}
              color={shipComplete ? "bg-teal-500" : progress.shippedQty > 0 ? "bg-purple-400" : "bg-muted-foreground/20"}
            />
          </div>
        </div>
      )}

      {/* 仕入れアイテム一覧 */}
      {progress.purchaseItems.length > 0 && (
        <div className="border-t border-border pt-1.5 space-y-0.5">
          <div className="text-[10px] text-muted-foreground font-medium mb-1">仕入れ登録一覧:</div>
          {progress.purchaseItems.slice(0, 5).map((item, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  item.status === "received" ? "bg-teal-500" : "bg-amber-400"
                }`}
              />
              <span className="text-[10px] text-muted-foreground truncate flex-1">
                {item.managementNo}
              </span>
              <span className={`text-[10px] flex-shrink-0 ${item.status === "received" ? "text-teal-600" : "text-amber-600"}`}>
                {item.status === "received" ? "入庫" : "発注中"}
              </span>
            </div>
          ))}
          {progress.purchaseItems.length > 5 && (
            <div className="text-[10px] text-muted-foreground">他 {progress.purchaseItems.length - 5} 件...</div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col gap-0.5 min-w-[100px] cursor-default select-none">
          {/* 仕入れ進捗 */}
          <div className="flex items-center gap-1.5">
            <PackageCheck size={11} className={procureComplete ? "text-teal-500" : "text-blue-400"} />
            <div className="flex-1">
              <ProgressBar
                value={procuredQty}
                max={orderQty}
                color={procureComplete ? "bg-teal-500" : procuredQty > 0 ? "bg-amber-400" : "bg-red-300"}
              />
            </div>
            {procureComplete ? (
              <CheckCircle2 size={11} className="text-teal-500 flex-shrink-0" />
            ) : remainProcure > 0 ? (
              <span className="text-[10px] font-bold text-red-500 flex-shrink-0 tabular-nums">残{remainProcure}</span>
            ) : null}
          </div>

          {/* 仕入れ数テキスト */}
          <div className="flex items-center gap-1 pl-0.5">
            <span className="text-[10px] tabular-nums text-muted-foreground">
              仕入 <span className={procureComplete ? "text-teal-600 font-semibold" : "text-amber-600 font-semibold"}>{procuredQty}</span>/{orderQty}
            </span>
            {hasShipData && (
              <>
                <span className="text-[9px] text-muted-foreground/50">·</span>
                <Truck size={9} className={shipComplete ? "text-teal-500" : "text-purple-400"} />
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  発送 <span className={shipComplete ? "text-teal-600 font-semibold" : "text-purple-600 font-semibold"}>{progress.shippedQty}</span>/{orderQty}
                </span>
              </>
            )}
          </div>

          {/* 発送進捗バー（在庫データがある場合のみ） */}
          {hasShipData && (
            <div className="flex items-center gap-1.5">
              <Truck size={11} className={shipComplete ? "text-teal-500" : "text-purple-400"} />
              <div className="flex-1">
                <ProgressBar
                  value={progress.shippedQty}
                  max={orderQty}
                  color={shipComplete ? "bg-teal-500" : progress.shippedQty > 0 ? "bg-purple-400" : "bg-muted-foreground/20"}
                />
              </div>
              {shipComplete ? (
                <CheckCircle2 size={11} className="text-teal-500 flex-shrink-0" />
              ) : remainShip > 0 ? (
                <span className="text-[10px] font-bold text-red-500 flex-shrink-0 tabular-nums">残{remainShip}</span>
              ) : null}
            </div>
          )}

          {/* 緊急アラート: 仕入れも発送も0の場合 */}
          {!procureComplete && procuredQty === 0 && (
            <div className="flex items-center gap-1 mt-0.5">
              <AlertCircle size={10} className="text-red-500" />
              <span className="text-[9px] text-red-500 font-semibold">未着手</span>
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="p-3 max-w-[300px]">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}
