/**
 * KnowledgeBasePage 表示ヘルパーの基準テスト。
 * 抽出前の KnowledgeBasePage.tsx と同じ出力（アイコン種別・色クラス・ラベル）を固定する。
 */
import { describe, expect, it } from "vitest";
import { File, FileText, Image } from "lucide-react";
import { getFileIcon, getSourceTypeLabel } from "./presentation";

describe("getFileIcon", () => {
  it("image/* は青のImageアイコン", () => {
    const icon = getFileIcon("image/png", "photo.png");
    expect(icon.type).toBe(Image);
    expect(icon.props).toMatchObject({ size: 14, className: "text-blue-500" });
  });

  it("application/pdf は赤のFileTextアイコン", () => {
    const icon = getFileIcon("application/pdf", "invoice.pdf");
    expect(icon.type).toBe(FileText);
    expect(icon.props).toMatchObject({ size: 14, className: "text-red-500" });
  });

  it("MIMEが不明でも拡張子 .pdf（大文字含む）ならFileText", () => {
    const icon = getFileIcon("application/octet-stream", "Invoice - 123.PDF");
    expect(icon.type).toBe(FileText);
  });

  it("それ以外は緑のFileアイコン", () => {
    const icon = getFileIcon("text/plain", "chat.txt");
    expect(icon.type).toBe(File);
    expect(icon.props).toMatchObject({ size: 14, className: "text-green-500" });
  });
});

describe("getSourceTypeLabel", () => {
  it("既知の3種別は日本語ラベルと配色を返す", () => {
    expect(getSourceTypeLabel("chat_text")).toEqual({ label: "テキスト", color: "bg-green-100 text-green-700" });
    expect(getSourceTypeLabel("screenshot")).toEqual({ label: "スクショ", color: "bg-blue-100 text-blue-700" });
    expect(getSourceTypeLabel("invoice_pdf")).toEqual({ label: "PDF", color: "bg-red-100 text-red-700" });
  });

  it("未知の種別はそのままグレーで返す", () => {
    expect(getSourceTypeLabel("unknown_type")).toEqual({ label: "unknown_type", color: "bg-gray-100 text-gray-700" });
  });
});
