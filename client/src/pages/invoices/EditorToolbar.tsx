import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  RefreshCw,
  Save,
  Eye,
  Download,
  Sparkles,
} from "lucide-react";
export function EditorToolbar({
  children,
  showPreview,
  isPdfLoading,
  isFetchingRate,
  isSaving,
  onBack,
  onTogglePreview,
  onPdf,
  onSplit,
  onSave,
}: {
  children: ReactNode;
  showPreview: boolean;
  isPdfLoading: boolean;
  isFetchingRate: boolean;
  isSaving: boolean;
  onBack: () => void;
  onTogglePreview: () => void;
  onPdf: () => void;
  onSplit: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" size="sm" onClick={onBack} className="h-8 gap-1">
        <ChevronLeft size={14} /> 一覧に戻る
      </Button>

      {/* 保存確認ダイアログ */}
      {children}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onTogglePreview}
          className="h-8 gap-1"
        >
          <Eye size={13} /> {showPreview ? "編集に戻る" : "プレビュー"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onPdf}
          disabled={isPdfLoading}
          className="h-8 gap-1"
        >
          {isPdfLoading ? (
            <>
              <RefreshCw size={12} className="animate-spin" /> 生成中...
            </>
          ) : (
            <>
              <Download size={13} /> PDFで保存
            </>
          )}
        </Button>
        {/* 分割して保存ボタン */}
        <Button
          variant="outline"
          size="sm"
          onClick={onSplit}
          disabled={isFetchingRate}
          className="h-8 gap-1 border-orange-400 text-orange-600 hover:bg-orange-50"
        >
          {isFetchingRate ? (
            <>
              <RefreshCw size={12} className="animate-spin" /> 為替取得中...
            </>
          ) : (
            <>
              <Sparkles size={12} /> 分割して保存
            </>
          )}
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={isSaving}
          className="h-8 gap-1"
        >
          {isSaving ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : (
            <Save size={12} />
          )}
          保存
        </Button>
      </div>
    </div>
  );
}
