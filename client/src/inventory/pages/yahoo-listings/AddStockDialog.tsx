import { useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { DEFECT_TAG_OPTIONS, KIND_LABELS, type ListingKind } from "./types";

/** 出品待ちへ在庫を入れるダイアログ。商品名でまとめて選べる */
export function AddStockDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [listingKind, setListingKind] = useState<ListingKind>("surplus");
  const [defectTags, setDefectTags] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const search = trpc.inventory.inboundDesk.searchStockForListing.useQuery(
    { query },
    { enabled: open }
  );
  const addMany = trpc.inventory.inboundDesk.restockManyToListing.useMutation();

  const busy = addMany.isPending;
  const blocked = listingKind === "junk" && defectTags.length === 0;

  function toggleTitle(labelIds: string[], checked: boolean) {
    setSelected(current => {
      const set = new Set(current);
      for (const id of labelIds) {
        if (checked) set.add(id);
        else set.delete(id);
      }
      return Array.from(set);
    });
  }

  async function submit() {
    if (selected.length === 0) {
      toast.error("在庫を1台以上選んでください");
      return;
    }
    try {
      const result = await addMany.mutateAsync({
        labelIds: selected,
        listingKind,
        defectTags: defectTags as never,
        defectNote: note.trim() || undefined,
      });
      if (result.failed.length > 0) {
        toast.warning(
          `${result.moved.length}台を出品待ちへ。${result.failed.length}台は失敗（${result.failed[0]?.message ?? ""}）`
        );
      } else {
        toast.success(`${result.moved.length}台を出品待ちへ入れました`);
      }
      setSelected([]);
      setNote("");
      setDefectTags([]);
      await onDone();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "登録に失敗しました");
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && !busy && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 pb-4 pt-6">
          <DialogTitle>在庫から出品待ちへ入れる</DialogTitle>
          <DialogDescription>
            商品名で探して、まとめて選べます。写真はあとから足せます。
          </DialogDescription>
        </DialogHeader>

        {/* 登録ボタンは下に固定する。1台選んだ時点ですぐ押せるようにするため、
            候補が何十行あってもスクロールして探しに行かなくてよい */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div>
            <div className="text-sm font-semibold">1. 何を出すか</div>
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
            <p className="mt-2 text-xs text-muted-foreground">
              {listingKind === "surplus"
                ? "動く物。タイトルに【ジャンク】は付かず、説明文は「動作確認済・返品不可」になります。"
                : "不良品。タイトルに【ジャンク】が付き、説明文は「動作保証なし」になります。"}
            </p>
          </div>

          {listingKind === "junk" && (
            <fieldset>
              <legend className="text-sm font-semibold">
                不良タグ <span className="text-destructive">（1つ以上必須）</span>
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {DEFECT_TAG_OPTIONS.map(tag => {
                  const on = defectTags.includes(tag);
                  return (
                    <Button
                      key={tag}
                      type="button"
                      variant={on ? "default" : "outline"}
                      aria-pressed={on}
                      className="min-h-12 h-auto whitespace-normal px-2 py-2"
                      onClick={() =>
                        setDefectTags(current =>
                          on ? current.filter(value => value !== tag) : [...current, tag]
                        )
                      }
                      disabled={busy}
                    >
                      {tag}
                    </Button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div>
            <label htmlFor="listing-note" className="text-sm font-semibold">
              メモ（任意・1行／選んだ全台に付きます）
            </label>
            <Textarea
              id="listing-note"
              value={note}
              maxLength={500}
              rows={2}
              className="mt-2 min-h-11"
              placeholder={
                listingKind === "surplus"
                  ? "例: 画面に薄いスレあり"
                  : "例: ACアダプター接続時に充電ランプが点灯しません"
              }
              onChange={event => setNote(event.target.value.replace(/[\r\n]+/g, " "))}
              disabled={busy}
            />
          </div>

          <div>
            <div className="text-sm font-semibold">2. 在庫を選ぶ</div>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="商品名・商品ID・旧管理番号で検索（例: スイッチ）"
                className="min-h-12 pl-9"
                disabled={busy}
              />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              選択中 <span className="font-semibold text-foreground">{selected.length}台</span>
              {search.data?.truncated ? "／候補が多いため一部のみ表示しています" : ""}
            </div>

            <div className="mt-2 space-y-2">
              {search.isLoading && (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> 在庫を読み込んでいます
                </div>
              )}
              {search.data?.titles.length === 0 && (
                <div className="py-6 text-sm text-muted-foreground">
                  出品待ちに入れられる在庫が見つかりません。
                </div>
              )}
              {search.data?.titles.map(entry => {
                const ids = entry.members.map(member => member.labelId);
                const chosen = ids.filter(id => selected.includes(id)).length;
                return (
                  <div key={entry.title} className="rounded-lg border p-3">
                    <label className="flex items-start gap-3">
                      <Checkbox
                        checked={chosen === ids.length && ids.length > 0}
                        onCheckedChange={checked => toggleTitle(ids, checked === true)}
                        disabled={busy}
                        className="mt-1"
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-semibold">{entry.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          在庫 {entry.count}台 ／ 選択 {chosen}台
                        </span>
                      </span>
                    </label>
                    {chosen > 0 && chosen < ids.length && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {entry.members.map(member => {
                          const on = selected.includes(member.labelId);
                          return (
                            <Button
                              key={member.labelId}
                              type="button"
                              size="sm"
                              variant={on ? "default" : "outline"}
                              className="h-8 px-2 font-mono text-xs"
                              onClick={() => toggleTitle([member.labelId], !on)}
                              disabled={busy}
                            >
                              {member.labelId}
                            </Button>
                          );
                        })}
                      </div>
                    )}
                    {chosen === 0 && ids.length > 1 && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        一部だけ選びたいときは、まずここにチェックを入れてから外してください
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-none flex-row items-center gap-2 border-t bg-background px-6 py-3 sm:gap-2">
          <Button type="button" variant="outline" className="min-h-12" onClick={onClose} disabled={busy}>
            キャンセル
          </Button>
          <Button
            type="button"
            className="min-h-12 flex-1"
            onClick={() => void submit()}
            disabled={busy || blocked || selected.length === 0}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            {selected.length}台を出品待ちへ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
