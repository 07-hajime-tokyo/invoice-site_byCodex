import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadInspectionDraft,
  saveInspectionDraft,
  type InspectionDraft,
} from "./inspectionDraft";
afterEach(() => vi.unstubAllGlobals());
function storage(raw: string | null) {
  const localStorage = { getItem: vi.fn(() => raw), setItem: vi.fn() };
  vi.stubGlobal("window", { localStorage });
  return localStorage;
}
describe("検品途中の端末保存の既存契約", () => {
  it("旧形式の不良判定はジャンクと代替依頼に読み替える", () => {
    storage(JSON.stringify({ A: "defective", B: "stocked", C: "returned" }));
    expect(loadInspectionDraft()).toEqual({
      A: { outcome: "junk", requestReplacement: true },
      B: { outcome: "stocked", requestReplacement: false },
      C: { outcome: "returned", requestReplacement: false },
    });
  });
  it("現在の形式は写真・タグ・メモを含めて保存し再取得できる", () => {
    const draft: InspectionDraft = {
      A: {
        outcome: "junk",
        requestReplacement: false,
        defectTags: ["通電せず"],
        defectNote: "架空",
        defectPhotos: [],
      },
    };
    const s = storage(JSON.stringify(draft));
    saveInspectionDraft(draft);
    expect(s.setItem).toHaveBeenCalledWith(
      "inbound-desk-inspection-draft-v1",
      JSON.stringify(draft)
    );
    expect(loadInspectionDraft()).toEqual(draft);
  });
  it.each([null, "{", "null", "1"])(
    "空・壊れた保存値 %s では空の下書きを返す",
    raw => {
      storage(raw);
      expect(loadInspectionDraft()).toEqual({});
    }
  );
  it("ブラウザーの保存拒否でも検品画面を止めない", () => {
    const s = storage(null);
    s.getItem.mockImplementation(() => {
      throw new Error("disabled");
    });
    s.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    expect(loadInspectionDraft()).toEqual({});
    expect(() => saveInspectionDraft({})).not.toThrow();
  });
});
