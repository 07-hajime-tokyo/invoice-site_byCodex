import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { isEbayManagementNo } from "@shared/ebayInventory";
import { toast } from "sonner";

type EbayListingUrlEditorProps = {
  inventoryId?: number | null;
  managementNo?: string | null;
  value?: string | null;
  compact?: boolean;
  className?: string;
};

export function EbayListingUrlEditor({
  inventoryId,
  managementNo,
  value,
  compact = false,
  className,
}: EbayListingUrlEditorProps) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const mutation = trpc.inventory.zaico.updateEbayListingUrl.useMutation();
  const resolvedInventoryId = inventoryId ?? null;

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [editing, value]);

  if (!resolvedInventoryId || !isEbayManagementNo(managementNo)) return null;
  const safeInventoryId = resolvedInventoryId;

  async function save() {
    try {
      await mutation.mutateAsync({
        inventoryId: safeInventoryId,
        ebayListingUrl: draft.trim() || null,
      });
      await Promise.all([
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      ]);
      setEditing(false);
      toast.success("出品ページを保存しました");
    } catch (error) {
      const message = error instanceof Error ? error.message : "出品ページの保存に失敗しました";
      toast.error(message);
    }
  }

  if (editing) {
    return (
      <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "text-xs" : "text-sm", className)}>
        <span className="text-muted-foreground">出品ページ</span>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="https://www.ebay.com/itm/..."
          className={cn("h-8", compact ? "w-56 text-xs" : "w-80")}
        />
        <Button size="sm" variant="outline" onClick={save} disabled={mutation.isPending} className="h-8">
          {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(value ?? "");
            setEditing(false);
          }}
          className="h-8"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "text-xs" : "text-sm", className)}>
      <span className="text-muted-foreground">出品ページ:</span>
      {value ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          開く
        </a>
      ) : (
        <span className="text-muted-foreground">未登録</span>
      )}
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)} className="h-7 px-2">
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
