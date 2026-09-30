/**
 * KnowledgeBasePage の型・表示ヘルパー。
 * KnowledgeBasePage.tsx から逐語移動（画面の状態・クエリ・イベント配線は本体に残す）。
 */
import { File, FileText, Image } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface FileItem {
  name: string;
  base64: string;
  mimeType: string;
  sizeKB: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function getFileIcon(mimeType: string, name: string) {
  if (mimeType.startsWith("image/")) return <Image size={14} className="text-blue-500" />;
  if (mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf"))
    return <FileText size={14} className="text-red-500" />;
  return <File size={14} className="text-green-500" />;
}

export function getSourceTypeLabel(type: string) {
  switch (type) {
    case "chat_text": return { label: "テキスト", color: "bg-green-100 text-green-700" };
    case "screenshot": return { label: "スクショ", color: "bg-blue-100 text-blue-700" };
    case "invoice_pdf": return { label: "PDF", color: "bg-red-100 text-red-700" };
    default: return { label: type, color: "bg-gray-100 text-gray-700" };
  }
}
