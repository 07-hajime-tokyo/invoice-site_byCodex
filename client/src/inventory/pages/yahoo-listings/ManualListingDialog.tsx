import { useState } from "react";
import { Loader2, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { KIND_LABELS, type ListingKind } from "./types";

/**
 * 在庫に無いものを手で足すダイアログ。
 * 空箱などの付属品は取引ハブに在庫登録されないので、ここから出品待ちへ入れる。
 */
export function ManualListingDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [title, setTitle] = useState("");
  const [listingKind, setListingKind] = useState<ListingKind>("surplus");
  const [note, setNote] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const create = trpc.inventory.inboundDesk.createManualListing.useMutation();
  const busy = create.isPending;

  async function submit() {
    if (!title.trim()) {
      toast.error("商品名を入れてください");
      return;
    }
    try {
      const parsedPrice = unitPrice.trim() ? Number(unitPrice.replace(/[^d]/g, "")) : undefined;
      const result = await create.mutateAsync({
        title: title.trim(),
        listingKind,
        note: note.trim() || undefined,
        unitPrice: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
      });
      toast.success(`${result.labelId} として出品待ちへ入れました`);
      setTitle("");
      setNote("");
      setUnitPrice("");
      await onDone();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "追加できませんでした");
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>在庫に無いものを手入力で追加</DialogTitle>
          <DialogDescription>
            空箱・説明書・ケーブルなど、取引ハブに在庫登録していないものを出品待ちへ入れます。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label htmlFor="manual-title" className="text-sm font-semibold">
              商品名 <span className="text-destructive">（必須）</span>
            </label>
            <Input
              id="manual-title"
              value={title}
              maxLength={500}
              className="mt-2 min-h-12"
              placeholder="例: ニンテンドー3DS LL 空箱のみ"
              onChange={event => setTitle(event.target.value)}
              disabled={busy}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              相場はこの商品名から検索語を組み立てます。機種名を入れてください。
            </p>
          </div>
          <div>
            <div className="text-sm font-semibold">区分</div>
            <div className="mt-2 flex gap-2">
              {(["surplus", "junk"] as const).map(kind => (
                <Button
                  key={kind}
                  type="button"
                  variant={listingKind === kind ? "default" : "outline"}
                  className="min-h-12 flex-1 whitespace-normal"
                  onClick={() => setListingKind(kind)}
                  disabled={busy}
                >
                  {KIND_LABELS[kind]}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="manual-note" className="text-sm font-semibold">メモ（任意・1行）</label>
            <Textarea
              id="manual-note"
              value={note}
              maxLength={500}
              rows={2}
              className="mt-2 min-h-11"
              placeholder="例: 角に潰れあり"
              onChange={event => setNote(event.target.value.replace(/[\r\n]+/g, " "))}
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="manual-price" className="text-sm font-semibold">仕入単価（任意）</label>
            <Input
              id="manual-price"
              value={unitPrice}
              inputMode="numeric"
              className="mt-2 min-h-12"
              placeholder="0"
              onChange={event => setUnitPrice(event.target.value)}
              disabled={busy}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="min-h-12" onClick={onClose} disabled={busy}>
            キャンセル
          </Button>
          <Button type="button" className="min-h-12" onClick={() => void submit()} disabled={busy || !title.trim()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PencilLine className="mr-2 h-4 w-4" />}
            出品待ちへ追加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
