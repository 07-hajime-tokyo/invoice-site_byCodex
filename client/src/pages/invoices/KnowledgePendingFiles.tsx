import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Pencil, X, RefreshCw, Upload } from "lucide-react";
export type PendingKnowledgeFile = {
  name: string;
  base64: string;
  mimeType: string;
  sizeKB: number;
  screenshotDate?: string;
};

export function KnowledgePendingFiles({
  pendingFiles,
  setPendingFiles,
  editingNameIdx,
  editingNameValue,
  setEditingNameIdx,
  setEditingNameValue,
  onUpload,
  isUploading,
}: {
  pendingFiles: PendingKnowledgeFile[];
  setPendingFiles: Dispatch<SetStateAction<PendingKnowledgeFile[]>>;
  editingNameIdx: number | null;
  editingNameValue: string;
  setEditingNameIdx: Dispatch<SetStateAction<number | null>>;
  setEditingNameValue: Dispatch<SetStateAction<string>>;
  onUpload: () => void;
  isUploading: boolean;
}) {
  return (
    <>
      {pendingFiles.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">
            アップロード待ち ({pendingFiles.length}件)
          </p>
          {pendingFiles.map((f, i) => (
            <div key={i} className="bg-muted/40 rounded px-2 py-1.5 space-y-1">
              <div className="flex items-center gap-2">
                <FileText
                  size={13}
                  className="text-muted-foreground flex-shrink-0"
                />
                {/* ファイル名インライン編集 */}
                {editingNameIdx === i ? (
                  <input
                    type="text"
                    autoFocus
                    className="text-xs flex-1 border border-[#075E54] rounded px-1.5 py-0.5 bg-background text-foreground"
                    value={editingNameValue}
                    onChange={e => setEditingNameValue(e.target.value)}
                    onBlur={() => {
                      const trimmed = editingNameValue.trim();
                      if (trimmed)
                        setPendingFiles(prev =>
                          prev.map((pf, j) =>
                            j === i ? { ...pf, name: trimmed } : pf
                          )
                        );
                      setEditingNameIdx(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        const trimmed = editingNameValue.trim();
                        if (trimmed)
                          setPendingFiles(prev =>
                            prev.map((pf, j) =>
                              j === i ? { ...pf, name: trimmed } : pf
                            )
                          );
                        setEditingNameIdx(null);
                      } else if (e.key === "Escape") {
                        setEditingNameIdx(null);
                      }
                    }}
                  />
                ) : (
                  <span
                    className="text-xs flex-1 truncate cursor-pointer hover:text-[#075E54] group flex items-center gap-1"
                    title="クリックして名前を変更"
                    onClick={() => {
                      setEditingNameIdx(i);
                      setEditingNameValue(f.name);
                    }}
                  >
                    {f.name}
                    <Pencil
                      size={10}
                      className="text-muted-foreground opacity-0 group-hover:opacity-100 flex-shrink-0"
                    />
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground flex-shrink-0">
                  {f.sizeKB}KB
                </span>
                <button
                  onClick={() =>
                    setPendingFiles(prev => prev.filter((_, j) => j !== i))
                  }
                >
                  <X
                    size={12}
                    className="text-muted-foreground hover:text-destructive"
                  />
                </button>
              </div>
              {/* Date input for screenshots */}
              {f.mimeType.startsWith("image/") && (
                <div className="flex items-center gap-1.5 pl-5">
                  <label className="text-[10px] text-muted-foreground whitespace-nowrap">
                    撮影日:
                  </label>
                  <input
                    type="date"
                    className="text-[10px] border border-border rounded px-1.5 py-0.5 bg-background text-foreground flex-1"
                    value={f.screenshotDate ?? ""}
                    onChange={e =>
                      setPendingFiles(prev =>
                        prev.map((pf, j) =>
                          j === i
                            ? { ...pf, screenshotDate: e.target.value }
                            : pf
                        )
                      )
                    }
                  />
                  <span className="text-[9px] text-muted-foreground">
                    日付を入力するとAIが時刻を正確に解釈
                  </span>
                </div>
              )}
            </div>
          ))}
          <Button
            className="w-full bg-[#075E54] hover:bg-[#075E54]/90 text-white"
            size="sm"
            onClick={onUpload}
            disabled={isUploading}
          >
            {isUploading ? (
              <>
                <RefreshCw size={13} className="animate-spin mr-1.5" />
                AI解析中...
              </>
            ) : (
              <>
                <Upload size={13} className="mr-1.5" />
                知識ベースに追加 ({pendingFiles.length}件)
              </>
            )}
          </Button>
        </div>
      )}
    </>
  );
}
