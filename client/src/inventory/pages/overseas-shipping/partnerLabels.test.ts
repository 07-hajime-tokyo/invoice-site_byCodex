import { describe, expect, it } from "vitest";
import { partnerLabel, partnerTabLabel, partnerTabSheetName } from "./partnerLabels";

/** 海外発送・梱包画面の取引先ラベル/タブ変換の整理前基準（現行出力の固定） */

describe("partnerLabel", () => {
  it("4種のシート名を表示名に変換する", () => {
    expect(partnerLabel("独発送管理")).toBe("Luca/Maxim");
    expect(partnerLabel("サミー発送管理")).toBe("Samee");
    expect(partnerLabel("サイモン発送管理")).toBe("Simon");
    expect(partnerLabel("ネレ発送管理")).toBe("Nele");
  });
  it("未知のシート名（デボン含む）はそのまま返す", () => {
    expect(partnerLabel("デボン発送管理")).toBe("デボン発送管理");
    expect(partnerLabel("")).toBe("");
  });
});

describe("partnerTabLabel", () => {
  it("タブごとの表示名を返す", () => {
    expect(partnerTabLabel("all")).toBe("すべて");
    expect(partnerTabLabel("luca")).toBe("Luca/Maxim");
    expect(partnerTabLabel("samee")).toBe("Samee");
    expect(partnerTabLabel("simon")).toBe("Simon");
    expect(partnerTabLabel("nele")).toBe("Nele");
  });
});

describe("partnerTabSheetName", () => {
  it("タブごとのシート名（allはnull）を返す", () => {
    expect(partnerTabSheetName("all")).toBeNull();
    expect(partnerTabSheetName("luca")).toBe("独発送管理");
    expect(partnerTabSheetName("samee")).toBe("サミー発送管理");
    expect(partnerTabSheetName("simon")).toBe("サイモン発送管理");
    expect(partnerTabSheetName("nele")).toBe("ネレ発送管理");
  });
});
