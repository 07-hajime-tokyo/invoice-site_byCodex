import { describe, expect, it, vi } from "vitest";

vi.mock("@/inventory/components/DefectiveInspectionDialog", () => ({
  fileAsBase64: vi.fn(async (file: File) => `base64:${file.name}`),
}));

import { filesToPayload, photoKindFor, yen } from "./view";
import {
  DEFECT_TAG_OPTIONS,
  KIND_BADGE,
  KIND_LABELS,
  TOP_EDGE_LABELS,
} from "./types";

describe("yen", () => {
  it("null・undefined は '—' を返す", () => {
    expect(yen(null)).toBe("—");
    expect(yen(undefined)).toBe("—");
  });

  it("値は四捨五入して ja-JP 桁区切り＋円で整形する", () => {
    expect(yen(0)).toBe("0円");
    expect(yen(1234567.4)).toBe("1,234,567円");
    expect(yen(999.5)).toBe("1,000円");
    expect(yen(-1234.4)).toBe("-1,234円");
  });
});

describe("photoKindFor", () => {
  it("1枚目=whole・2枚目=defect・3枚目以降=accessory", () => {
    expect(photoKindFor(0)).toBe("whole");
    expect(photoKindFor(1)).toBe("defect");
    expect(photoKindFor(2)).toBe("accessory");
    expect(photoKindFor(9)).toBe("accessory");
  });
});

describe("filesToPayload", () => {
  it("base64・mimeType・kind を index 順に組み立てる", async () => {
    const files = [
      new File(["a"], "whole.jpg", { type: "image/png" }),
      new File(["b"], "defect.jpg", { type: "" }),
      new File(["c"], "acc.jpg", { type: "image/webp" }),
    ];
    const payload = await filesToPayload(files);
    expect(payload).toEqual([
      { base64: "base64:whole.jpg", mimeType: "image/png", kind: "whole" },
      { base64: "base64:defect.jpg", mimeType: "image/jpeg", kind: "defect" },
      { base64: "base64:acc.jpg", mimeType: "image/webp", kind: "accessory" },
    ]);
  });

  it("空配列は空配列を返す", async () => {
    await expect(filesToPayload([])).resolves.toEqual([]);
  });
});

describe("定数", () => {
  it("TOP_EDGE_LABELS は4辺のラベルを固定する", () => {
    expect(TOP_EDGE_LABELS).toEqual({
      top: "そのまま",
      right: "右を上へ",
      bottom: "上下反転",
      left: "左を上へ",
    });
  });

  it("DEFECT_TAG_OPTIONS は9タグを固定順で持つ", () => {
    expect(DEFECT_TAG_OPTIONS).toEqual([
      "通電せず", "起動しない", "画面不良", "バッテリー不良", "充電不可",
      "ボタン・スティック不良", "外装破損", "付属品欠品", "その他",
    ]);
  });

  it("KIND_LABELS / KIND_BADGE は junk・surplus の2区分を固定する", () => {
    expect(KIND_LABELS).toEqual({
      junk: "ジャンク",
      surplus: "不要在庫（動作品）",
    });
    expect(KIND_BADGE).toEqual({
      junk: "border-amber-200 bg-amber-50 text-amber-800",
      surplus: "border-sky-200 bg-sky-50 text-sky-800",
    });
  });
});
