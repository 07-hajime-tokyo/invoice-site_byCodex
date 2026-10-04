import { useMemo, useState } from "react";
import {
  Camera,
  Check,
  Copy,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  PackageCheck,
  PencilLine,
  Send,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import {
  KIND_BADGE,
  KIND_LABELS,
  TOP_EDGE_LABELS,
  type ListingKind,
  type TopEdge,
} from "./yahoo-listings/types";
import { filesToPayload, yen } from "./yahoo-listings/view";
import { AddStockDialog } from "./yahoo-listings/AddStockDialog";
import { ManualListingDialog } from "./yahoo-listings/ManualListingDialog";

export default function YahooListings() {
  const [kindFilter, setKindFilter] = useState<"all" | ListingKind>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [busyLabelId, setBusyLabelId] = useState<string | null>(null);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  /** 写真ごとに「どの辺を上にするか」。選び終えてから一括で適用する */
  const [topEdges, setTopEdges] = useState<Record<string, TopEdge>>({});

  const utils = trpc.useUtils();
  const queue = trpc.inventory.inboundDesk.yahooListingQueue.useQuery();
  const attachPhotos = trpc.inventory.inboundDesk.attachListingPhotos.useMutation();
  const markShipped = trpc.inventory.inboundDesk.markListingShipped.useMutation();
  const rotatePhotos = trpc.inventory.inboundDesk.rotateListingPhotos.useMutation();
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

  /**
   * 登録直後のシート書き込みはレスポンスを返したあとに走るため、
   * Vercelが関数を凍らせると途中で切れて「未反映」のまま残る（2026-08-17に実測）。
   * ここでは1件ずつ待って送り直し、送れたぶんだけ確実に反映済みにする。
   */
  async function onSendPending() {
    const pending = (queue.data?.items ?? []).filter(item => !item.sheetSyncedAt);
    if (pending.length === 0) return;
    setSending({ done: 0, total: pending.length });
    let failed = 0;
    for (const [index, item] of pending.entries()) {
      try {
        await refreshListing.mutateAsync({
          labelId: item.labelId,
          reuseFreshMarket: true,
        });
      } catch {
        failed += 1;
      }
      setSending({ done: index + 1, total: pending.length });
    }
    setSending(null);
    await reload();
    if (failed > 0) toast.warning(`${pending.length - failed}件を反映。${failed}件は失敗しました`);
    else toast.success(`${pending.length}件をシートへ反映しました`);
  }

  /** ヤフオクで売れて発送したことを記録する。在庫を0にし、出庫履歴へ1行残す */
  /** 選んだ向きを10枚まとめて適用する。1枚ずつ90度ずつ押すと時間がかかるため */
  async function onApplyRotations(labelId: string, photoKeys: string[]) {
    const rotations = photoKeys
      .map(photoKey => ({ photoKey, topEdge: topEdges[photoKey] ?? ("top" as TopEdge) }))
      .filter(entry => entry.topEdge !== "top");
    if (rotations.length === 0) {
      toast.error("向きを変える写真を選んでください");
      return;
    }
    setBusyLabelId(labelId);
    try {
      const result = await rotatePhotos.mutateAsync({ labelId, rotations });
      if (result.failed.length > 0) {
        toast.warning(`${result.applied.length}枚を回転。${result.failed.length}枚は失敗`);
      } else {
        toast.success(`${result.applied.length}枚の向きを直しました`);
      }
      setTopEdges(current => {
        const next = { ...current };
        for (const key of photoKeys) delete next[key];
        return next;
      });
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "向きを直せませんでした");
    } finally {
      setBusyLabelId(null);
    }
  }

  async function onMarkShipped(labelId: string, title: string) {
    if (!window.confirm(`${title}（${labelId}）を発送済みにします。
在庫が1減り、出庫履歴に「ヤフオク」の行が残ります。`)) {
      return;
    }
    setBusyLabelId(labelId);
    try {
      await markShipped.mutateAsync({ labelId });
      toast.success(`${labelId} を発送済みにしました`);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "発送済みにできませんでした");
    } finally {
      setBusyLabelId(null);
    }
  }

  /**
   * 検索語の作り方を変えたあとは、保存済みの相場が古い。
   * 「GBA ミルキーブルー」のような社内名のまま保存された行は採用0件のまま残るので、
   * 1件ずつ待って引き直す。
   */
  async function onRefreshStale() {
    const stale = (queue.data?.items ?? []).filter(item => item.keywordStale);
    if (stale.length === 0) return;
    setSending({ done: 0, total: stale.length });
    let failed = 0;
    for (const [index, item] of stale.entries()) {
      try {
        await refreshListing.mutateAsync({ labelId: item.labelId });
      } catch {
        failed += 1;
      }
      setSending({ done: index + 1, total: stale.length });
    }
    setSending(null);
    await reload();
    if (failed > 0) toast.warning(`${stale.length - failed}件の相場を取り直し。${failed}件は失敗`);
    else toast.success(`${stale.length}件の相場を取り直しました`);
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
      pending: all.filter(item => !item.sheetSyncedAt).length,
      stale: all.filter(item => item.keywordStale).length,
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
        <Button type="button" size="sm" variant="outline" className="min-h-10" onClick={() => setManualOpen(true)}>
          <PencilLine className="mr-1 h-4 w-4" /> 手入力で追加
        </Button>
        {counts.stale > 0 && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="min-h-10"
            onClick={() => void onRefreshStale()}
            disabled={Boolean(sending)}
          >
            {sending ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                取得中 {sending.done}/{sending.total}
              </>
            ) : (
              <>
                <RefreshCw className="mr-1 h-4 w-4" /> 相場が古い {counts.stale}件を取り直す
              </>
            )}
          </Button>
        )}
        {counts.pending > 0 && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="min-h-10"
            onClick={() => void onSendPending()}
            disabled={Boolean(sending)}
          >
            {sending ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                送信中 {sending.done}/{sending.total}
              </>
            ) : (
              <>
                <Send className="mr-1 h-4 w-4" /> 未反映 {counts.pending}件をシートへ送る
              </>
            )}
          </Button>
        )}
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
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">
                      上にしたい辺を選んで、まとめて直す
                    </div>
                    <div className="flex gap-4 overflow-x-auto pb-1">
                      {item.photos.map(photo => {
                        const edge = topEdges[photo.key] ?? "top";
                        return (
                          <div key={photo.key} className="flex-none">
                            {/* 写真の4辺にボタンを置く。押した辺が上に来る */}
                            <div className="relative h-28 w-28">
                              <img
                                src={photo.url}
                                alt=""
                                className="h-28 w-28 rounded-md border object-contain"
                                loading="lazy"
                              />
                              {(["top", "right", "bottom", "left"] as const).map(side => (
                                <button
                                  key={side}
                                  type="button"
                                  aria-label={TOP_EDGE_LABELS[side]}
                                  aria-pressed={edge === side}
                                  disabled={busy}
                                  onClick={() =>
                                    setTopEdges(current => ({ ...current, [photo.key]: side }))
                                  }
                                  className={[
                                    "absolute flex items-center justify-center rounded-sm border text-[10px] font-bold",
                                    edge === side
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-muted-foreground/40 bg-background/85",
                                    side === "top" ? "left-1/2 top-0 h-5 w-10 -translate-x-1/2" : "",
                                    side === "bottom" ? "bottom-0 left-1/2 h-5 w-10 -translate-x-1/2" : "",
                                    side === "left" ? "left-0 top-1/2 h-10 w-5 -translate-y-1/2" : "",
                                    side === "right" ? "right-0 top-1/2 h-10 w-5 -translate-y-1/2" : "",
                                  ].join(" ")}
                                >
                                  {edge === side ? "上" : ""}
                                </button>
                              ))}
                            </div>
                            <div className="mt-1 w-28 text-center text-[11px] text-muted-foreground">
                              {TOP_EDGE_LABELS[edge]}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() =>
                        void onApplyRotations(item.labelId, item.photos.map(photo => photo.key))
                      }
                      disabled={busy}
                    >
                      {busy ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCw className="mr-2 h-4 w-4" />
                      )}
                      選んだ向きをまとめて直す
                    </Button>
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
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12"
                    onClick={() => void onMarkShipped(item.labelId, item.title)}
                    disabled={busy}
                  >
                    <PackageCheck className="mr-2 h-4 w-4" /> 発送済みにする
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  出品タイトルと説明文はスプレッドシート「ヤフオク出品」の「出品待ち」シートに入ります。
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
      <ManualListingDialog open={manualOpen} onClose={() => setManualOpen(false)} onDone={reload} />
    </div>
  );
}
