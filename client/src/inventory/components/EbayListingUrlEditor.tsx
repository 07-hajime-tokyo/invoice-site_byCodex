import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  getEbayOrderStatusLabel,
  getEbayStockType,
  isEbayManagementNo,
  normalizeEbayOrderStatus,
  type EbayOrderStatus,
} from "@shared/ebayInventory";
import { toast } from "sonner";

type EbayListingUrlEditorProps = {
  inventoryId?: number | null;
  managementNo?: string | null;
  value?: string | null;
  type?: "listing" | "order";
  compact?: boolean;
  className?: string;
};

export function EbayListingUrlEditor({
  inventoryId,
  managementNo,
  value,
  type = "listing",
  compact = false,
  className,
}: EbayListingUrlEditorProps) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const listingMutation = trpc.inventory.zaico.updateEbayListingUrl.useMutation();
  const orderMutation = trpc.inventory.zaico.updateEbayOrderUrl.useMutation();
  const resolvedInventoryId = inventoryId ?? null;
  const mutation = type === "order" ? orderMutation : listingMutation;
  const label = type === "order" ? "Orderページ" : "出品ページ";
  const placeholder = type === "order" ? "https://www.ebay.com/sh/ord/details?orderid=..." : "https://www.ebay.com/itm/...";

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [editing, value]);

  if (!resolvedInventoryId || !isEbayManagementNo(managementNo)) return null;
  if (type === "listing" && getEbayStockType(managementNo) !== "stocked") return null;
  const safeInventoryId = resolvedInventoryId;

  async function save() {
    try {
      if (type === "order") {
        await orderMutation.mutateAsync({
          inventoryId: safeInventoryId,
          ebayOrderUrl: draft.trim() || null,
        });
      } else {
        await listingMutation.mutateAsync({
          inventoryId: safeInventoryId,
          ebayListingUrl: draft.trim() || null,
        });
      }
      await Promise.all([
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      ]);
      setEditing(false);
      toast.success(`${label}を保存しました`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label}の保存に失敗しました`;
      toast.error(message);
    }
  }

  if (editing) {
    return (
      <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "text-xs" : "text-sm", className)}>
        <span className="text-muted-foreground">{label}</span>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
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
      <span className="text-muted-foreground">{label}:</span>
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

type EbayOrderStatusEditorProps = {
  inventoryId?: number | null;
  managementNo?: string | null;
  value?: string | null;
  compact?: boolean;
  className?: string;
};

const orderStatusOptions: EbayOrderStatus[] = ["normal", "cancelled", "returned"];

export function EbayOrderStatusEditor({
  inventoryId,
  managementNo,
  value,
  compact = false,
  className,
}: EbayOrderStatusEditorProps) {
  const utils = trpc.useUtils();
  const mutation = trpc.inventory.zaico.updateEbayOrderStatus.useMutation();
  const resolvedInventoryId = inventoryId ?? null;
  const status = normalizeEbayOrderStatus(value);

  if (!resolvedInventoryId || !isEbayManagementNo(managementNo)) return null;
  const safeInventoryId = resolvedInventoryId;

  async function save(nextStatus: EbayOrderStatus) {
    try {
      await mutation.mutateAsync({
        inventoryId: safeInventoryId,
        ebayOrderStatus: nextStatus,
      });
      await Promise.all([
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      ]);
      toast.success("Order状態を保存しました");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Order状態の保存に失敗しました";
      toast.error(message);
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "text-xs" : "text-sm", className)}>
      <span className="text-muted-foreground">状態:</span>
      <Select value={status} onValueChange={(next) => save(normalizeEbayOrderStatus(next))} disabled={mutation.isPending}>
        <SelectTrigger className={cn("h-8", compact ? "w-28 text-xs" : "w-32")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {orderStatusOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {getEbayOrderStatusLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
