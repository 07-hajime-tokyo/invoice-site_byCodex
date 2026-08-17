import { useMemo, useState } from "react";
import {
  Camera,
  Check,
  Copy,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { fileAsBase64 } from "@/inventory/components/DefectiveInspectionDialog";
import { trpc } from "@/lib/trpc";

type ListingKind = "junk" | "surplus";

const DEFECT_TAG_OPTIONS = [
  "通電せず", "起動しない", "画面不良", "バッテリー不良", "充電不可",
  "ボタン・スティック不良", "外装破損", "付属品欠品", "その他",
] as const;

const KIND_LABELS: Record<ListingKind, string> = {
  junk: "ジャンク",
  surplus: "不要在庫（動作品）",
};

const KIND_BADGE: Record<ListingKind, string> = {
  junk: "border-amber-200 bg-amber-50 text-amber-800",
  surplus: "border-sky-200 bg-sky-50 text-sky-800",
};

function yen(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function photoKindFor(index: number) {
  return index === 0 ? "whole" : index === 1 ? "defect" : "accessory";
}

async function filesToPayload(files: File[]) {
  return Promise.all(
    files.map(async (file, index) => ({
      base64: await fileAsBase64(file),
      mimeType: file.type || "image/jpeg",
      kind: photoKindFor(index) as "whole" | "defect" | "accessory",
    }))
  );
}

/** 出品待ちへ在庫を入れるダイアログ。商品名でまとめて選べる */
function AddStockDialog({
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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>在庫から出品待ちへ入れる</DialogTitle>
          <DialogDescription>
            商品名で探して、まとめて選べます。写真はあとから足せます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="min-h-12" onClick={onClose} disabled={busy}>
            キャンセル
          </Button>
          <Button type="button" className="min-h-12" onClick={() => void submit()} disabled={busy || blocked}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            {selected.length}台を出品待ちへ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function YahooListings() {
  const [kindFilter, setKindFilter] = useState<"all" | ListingKind>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [busyLabelId, setBusyLabelId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const queue = trpc.inventory.inboundDesk.yahooListingQueue.useQuery();
  const attachPhotos = trpc.inventory.inboundDesk.attachListingPhotos.useMutation();
  const refreshListing = trpc.inventory.inboundDesk.refreshDefectiveListing.useMutation();
  const createGroup = trpc.inventory.inboundDesk.createDefectiveGroup.useMutation();
  const dissolveGroup = trpc.inventory.inboundDesk.dissolveDefectiveGroup.useMutation();

  const items = useMemo(() => {
    const all = queue.data?.items ?? [];
    return kindFilter === "all" ? all : all.filter(item => item.listingKind === kindFilter);
  }, [queue.data, kindFilter]);

  const activeGroups = (queue.data?.groups ?? []).filter(group => group.status === "active");

  async function reload() {
    await utils.inventory.inboundDesk.yahooListingQueue.invalidate();
  }

  async function copyText(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what}をコピーしました`);
    } catch {
      toast.error("コピーできませんでした。長押しで選択してください");
    }
  }

  async function onPickPhotos(labelId: string, files: File[]) {
    if (files.length === 0) return;
    setBusyLabelId(labelId);
    try {
      const payload = await filesToPayload(files.slice(0, 10));
      const result = await attachPhotos.mutateAsync({ labelId, files: payload });
      toast.success(`${labelId} に写真を${result.photoCount}枚まで反映しました`);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "写真を保存できませんでした");
    } finally {
      setBusyLabelId(null);
    }
  }

  async function onRefreshMarket(labelId: string, keyword: string | null) {
    const next = window.prompt("相場を取り直す検索キーワード", keyword ?? "");
    if (next === null) return;
    setBusyLabelId(labelId);
    try {
      await refreshListing.mutateAsync({ labelId, keyword: next.trim() || undefined });
      toast.success(`${labelId} の相場を取り直しました`);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "相場を取れませんでした");
    } finally {
      setBusyLabelId(null);
    }
  }

  async function onGroup() {
    if (selected.length < 2) {
      toast.error("まとめ出品は2台以上選んでください");
      return;
    }
    try {
      await createGroup.mutateAsync({ labelIds: selected });
      toast.success(`${selected.length}台を1出品にまとめました`);
      setSelected([]);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "まとめ出品を作れませんでした");
    }
  }

  const counts = useMemo(() => {
    const all = queue.data?.items ?? [];
    return {
      all: all.length,
      junk: all.filter(item => item.listingKind === "junk").length,
      surplus: all.filter(item => item.listingKind === "surplus").length,
    };
  }, [queue.data]);

  return (
    <div className="space-y-4 pb-24">
      <div>
        <h1 className="text-2xl font-bold">ヤフオク出品</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          出品待ちの在庫です。写真を足して、タイトルと説明をコピーしてヤフオクへ貼ります。出品そのものは人が行います。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ["all", `すべて ${counts.all}`],
          ["junk", `ジャンク ${counts.junk}`],
          ["surplus", `不要在庫 ${counts.surplus}`],
        ] as const).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={kindFilter === value ? "default" : "outline"}
            className="min-h-10"
            onClick={() => setKindFilter(value)}
          >
            {label}
          </Button>
        ))}
        <Button type="button" size="sm" className="min-h-10" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> 在庫から追加
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-10"
          onClick={() => void reload()}
          disabled={queue.isFetching}
        >
          <RefreshCw className={`mr-1 h-4 w-4 ${queue.isFetching ? "animate-spin" : ""}`} /> 最新化
        </Button>
      </div>

      {activeGroups.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="text-sm font-semibold">まとめ出品グループ</div>
            {activeGroups.map(group => (
              <div key={group.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                <Badge variant="outline" className={KIND_BADGE[group.listingKind]}>
                  {KIND_LABELS[group.listingKind]}
                </Badge>
                <span className="font-mono text-xs">{group.groupCode}</span>
                <span className="text-xs text-muted-foreground">{group.memberLabelIds.length}台</span>
                <span className="text-xs text-muted-foreground">
                  {group.sheetSyncedAt ? "シート反映済み" : "シート未反映"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto min-h-10"
                  onClick={async () => {
                    try {
                      await dissolveGroup.mutateAsync({ id: group.id });
                      toast.success(`${group.groupCode} を解除しました`);
                      await reload();
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "解除できませんでした");
                    }
                  }}
                >
                  <Unlink className="mr-1 h-4 w-4" /> 解除
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {queue.isLoading && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 読み込んでいます
        </div>
      )}

      {!queue.isLoading && items.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            出品待ちの在庫はありません。「在庫から追加」で入れてください。
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {items.map(item => {
          const busy = busyLabelId === item.labelId;
          const chosen = selected.includes(item.labelId);
          const inputId = `photos-${item.labelId}`;
          return (
            <Card key={item.labelId} className={chosen ? "border-primary" : ""}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={chosen}
                    disabled={Boolean(item.groupCode)}
                    onCheckedChange={checked =>
                      setSelected(current =>
                        checked === true
                          ? [...current, item.labelId]
                          : current.filter(value => value !== item.labelId)
                      )
                    }
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={KIND_BADGE[item.listingKind]}>
                        {KIND_LABELS[item.listingKind]}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">{item.labelId}</span>
                      {item.groupCode && (
                        <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-800">
                          <Layers className="mr-1 h-3 w-3" />
                          {item.groupCode}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-semibold">{item.title}</div>
                    {item.defectTags.length > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.defectTags.join("・")}
                        {item.defectNote ? ` / ${item.defectNote}` : ""}
                      </div>
                    )}
                    {item.defectTags.length === 0 && item.defectNote && (
                      <div className="mt-1 text-xs text-muted-foreground">{item.defectNote}</div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <div className="text-muted-foreground">相場の中央値</div>
                    <div className="text-sm font-semibold">{yen(item.marketMedian)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">採用件数</div>
                    <div className="text-sm font-semibold">{item.marketCount}件</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">写真</div>
                    <div className={`text-sm font-semibold ${item.photos.length === 0 ? "text-destructive" : ""}`}>
                      {item.photos.length === 0 ? "未撮影" : `${item.photos.length}枚`}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">シート</div>
                    <div className="text-sm font-semibold">
                      {item.sheetSyncedAt ? "反映済み" : "未反映"}
                    </div>
                  </div>
                </div>

                {item.photos.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto">
                    {item.photos.map(photo => (
                      <img
                        key={photo.key}
                        src={photo.url}
                        alt=""
                        className="h-20 w-20 flex-none rounded-md object-cover"
                        loading="lazy"
                      />
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <input
                    id={inputId}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    className="sr-only"
                    onChange={event => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      void onPickPhotos(item.labelId, files);
                    }}
                    disabled={busy}
                  />
                  <label
                    htmlFor={inputId}
                    className="inline-flex min-h-12 cursor-pointer items-center rounded-md border bg-background px-3 text-sm font-semibold shadow-sm"
                  >
                    {busy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Camera className="mr-2 h-4 w-4" />
                    )}
                    写真を撮る・追加
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12"
                    onClick={() => void onRefreshMarket(item.labelId, item.keyword)}
                    disabled={busy}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> 相場を取り直す
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12"
                    onClick={() => void copyText(item.labelId, "商品ID")}
                  >
                    <Copy className="mr-2 h-4 w-4" /> 商品ID
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  出品タイトルと説明文はスプレッドシートの「不良在庫」シートに入ります。
                  {item.keyword ? `検索キーワード: ${item.keyword}` : ""}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className="text-sm font-semibold">{selected.length}台を選択中</span>
            <Button type="button" variant="outline" className="ml-auto min-h-12" onClick={() => setSelected([])}>
              解除
            </Button>
            <Button
              type="button"
              className="min-h-12"
              onClick={() => void onGroup()}
              disabled={selected.length < 2 || createGroup.isPending}
            >
              {createGroup.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              1出品にまとめる
            </Button>
          </div>
        </div>
      )}

      <AddStockDialog open={addOpen} onClose={() => setAddOpen(false)} onDone={reload} />
    </div>
  );
}
