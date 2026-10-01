import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Pencil, Check } from "lucide-react";

/** インボイスメモのインライン編集コンポーネント */
export function InvoiceMemoField({ invoiceKey, colorKey }: { invoiceKey: string; colorKey: string }) {
  const { data: memos } = trpc.inventory.invoiceMemo.list.useQuery({ invoiceKey });
  const upsertMemo = trpc.inventory.invoiceMemo.upsert.useMutation();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const currentMemo = memos?.find((m) => m.colorKey === colorKey)?.memo ?? "";

  const startEdit = useCallback(() => {
    setDraft(currentMemo);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [currentMemo]);

  const save = useCallback(async () => {
    await upsertMemo.mutateAsync({ invoiceKey, colorKey, memo: draft });
    await utils.inventory.invoiceMemo.list.invalidate({ invoiceKey });
    setEditing(false);
  }, [upsertMemo, utils, invoiceKey, colorKey, draft]);

  if (editing) {
    return (
      <div className="flex items-center gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          className="text-xs border rounded px-2 py-0.5 w-48 bg-background"
          placeholder="メモを入力..."
        />
        <button
          onClick={save}
          className="text-green-600 hover:text-green-700 p-0.5"
          title="保存"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1 ml-2 cursor-pointer group"
      onClick={(e) => { e.stopPropagation(); startEdit(); }}
      title="クリックしてメモを編集"
    >
      {currentMemo ? (
        <span className="text-xs text-muted-foreground max-w-[200px] truncate">{currentMemo}</span>
      ) : (
        <span className="text-xs text-muted-foreground/40 hidden group-hover:inline">メモを追加</span>
      )}
      <Pencil className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </div>
  );
}
