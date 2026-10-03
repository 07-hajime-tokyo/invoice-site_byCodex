import type { Dispatch, SetStateAction, RefObject } from "react";
import { Upload } from "lucide-react";
export function KnowledgeFilePicker({
  isDragging,
  setIsDragging,
  handleFileSelect,
  fileInputRef,
}: {
  isDragging: boolean;
  setIsDragging: Dispatch<SetStateAction<boolean>>;
  handleFileSelect: (files: FileList | null) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div
      className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
        isDragging
          ? "border-[#075E54] bg-[#075E54]/5"
          : "border-border hover:border-[#075E54]/50 hover:bg-muted/30"
      }`}
      onDragOver={e => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={e => {
        e.preventDefault();
        setIsDragging(false);
        handleFileSelect(e.dataTransfer.files);
      }}
      onClick={() => fileInputRef.current?.click()}
    >
      <Upload size={22} className="mx-auto mb-2 text-muted-foreground" />
      <p className="text-sm font-medium">
        ファイルをドロップ または クリックして選択
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        .txt（チャット履歴）/ 画像（スクショ）/ .pdf（インボイス）· 最大10MB
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">
        💡 スクリーンショットは{" "}
        <kbd className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] font-mono">
          Ctrl
        </kbd>{" "}
        /{" "}
        <kbd className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] font-mono">
          ⌘
        </kbd>{" "}
        +{" "}
        <kbd className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] font-mono">
          V
        </kbd>{" "}
        で貼り付け可能
      </p>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.pdf,image/*"
        className="hidden"
        onChange={e => handleFileSelect(e.target.files)}
      />
    </div>
  );
}
