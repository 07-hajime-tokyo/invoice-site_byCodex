import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { InboundLabel } from "@/inventory/lib/inboundDesk";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

const DEFECT_TAG_OPTIONS = [
  "通電せず", "起動しない", "画面不良", "バッテリー不良", "充電不可",
  "ボタン・スティック不良", "外装破損", "付属品欠品", "その他",
] as const;

export type DefectTag = (typeof DEFECT_TAG_OPTIONS)[number];
export type UploadedDefectPhoto = {
  url: string;
  key: string;
  kind: "whole" | "defect" | "accessory";
};

export function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("写真を読み込めませんでした"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

export function DefectiveInspectionDialog({
  label,
  busy,
  onClose,
  onSubmit,
}: {
  label: InboundLabel | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (value: { defectTags: DefectTag[]; defectNote: string; files: File[] }) => Promise<void>;
}) {
  const [defectTags, setDefectTags] = useState<DefectTag[]>([]);
  const [defectNote, setDefectNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    if (!label) return;
    setDefectTags([]);
    setDefectNote("");
    setFiles([]);
  }, [label]);

  return (
    <Dialog open={Boolean(label)} onOpenChange={open => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl [&>button]:min-h-12 [&>button]:min-w-12">
        <DialogHeader>
          <DialogTitle>不良内容と写真を記録</DialogTitle>
          <DialogDescription>{label ? `${label.labelId} / ${label.title}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <fieldset>
            <legend className="text-sm font-semibold">不良タグ <span className="text-destructive">（1つ以上必須）</span></legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {DEFECT_TAG_OPTIONS.map(tag => {
                const selected = defectTags.includes(tag);
                return (
                  <Button key={tag} type="button" variant={selected ? "default" : "outline"} aria-pressed={selected}
                    className="min-h-12 h-auto whitespace-normal px-2 py-2"
                    onClick={() => setDefectTags(current => selected ? current.filter(value => value !== tag) : [...current, tag])}
                    disabled={busy}>
                    {tag}
                  </Button>
                );
              })}
            </div>
          </fieldset>
          <div>
            <label htmlFor="defect-note" className="text-sm font-semibold">不良メモ（任意・1行）</label>
            <Textarea id="defect-note" value={defectNote} maxLength={500} rows={2} className="mt-2 min-h-11"
              placeholder="例: ACアダプター接続時に充電ランプが点灯しません"
              onChange={event => setDefectNote(event.target.value.replace(/[\r\n]+/g, " "))} disabled={busy} />
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
            <div className="text-sm font-semibold text-sky-950">写真は3枚推奨（最大10枚）</div>
            <div className="mt-1 text-xs text-sky-900">①全体 ②不良箇所のアップ ③付属品込み。写真0枚でも登録できますが、出品タイトルに「写真未撮影」が付きます。</div>
            <input id="defect-photos" type="file" accept="image/*" capture="environment" multiple className="sr-only"
              onChange={event => {
                const chosen = Array.from(event.target.files ?? []);
                if (chosen.length > 10) toast.error("写真は10枚までです");
                const next = chosen.slice(0, 10);
                if (next.reduce((sum, file) => sum + file.size, 0) > 45 * 1024 * 1024) {
                  toast.error("写真の合計サイズは45MB以下にしてください");
                  event.target.value = "";
                  setFiles([]);
                  return;
                }
                setFiles(next);
              }} disabled={busy} />
            <label htmlFor="defect-photos" className="mt-3 flex min-h-12 cursor-pointer items-center justify-center rounded-md border border-sky-300 bg-white px-4 py-2 text-sm font-semibold text-sky-950 shadow-sm">
              iPhoneで撮影・写真を選択
            </label>
            <div className="mt-2 text-xs text-sky-900">{files.length > 0 ? `${files.length}枚選択: ${files.map(file => file.name).join(" / ")}` : "写真なし"}</div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="min-h-12" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button type="button" className="min-h-12" disabled={busy || defectTags.length === 0}
            onClick={() => void onSubmit({ defectTags, defectNote, files })}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TriangleAlert className="mr-2 h-4 w-4" />}
            不良在庫として登録
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
