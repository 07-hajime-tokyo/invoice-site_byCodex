import { describe, expect, it } from "vitest";
import {
  colorlessQualifierMatches,
  extractColorFromCsvName,
  extractModelFromCsvName,
  getColorKeywords,
  hasColorlessQualifierText,
  hasLimitedEditionMarker,
  isColorlessRandomColor,
  isOtherColor,
  isRandomColor,
  managementNoMatchesColor,
  matchesModel,
  normalizeColorToken,
  normalizeColorlessQualifierToken,
  normalizeLooseText,
} from "./colorMatching";

/** 発注管理画面の色・機種照合の整理前基準（現行出力の固定） */

describe("extractColorFromCsvName", () => {
  it("機種名を除去してカラー名を返す", () => {
    expect(extractColorFromCsvName("Vita 1000 コズミックレッド")).toBe("コズミックレッド");
    expect(extractColorFromCsvName("New 3DS ランダムカラー")).toBe("ランダムカラー");
    expect(extractColorFromCsvName("3DS LL ホワイトベース")).toBe("ホワイトベース");
    expect(extractColorFromCsvName("PS Vita 2000 アクアブルー")).toBe("アクアブルー");
  });
  it("機種名のみなら空文字を返す", () => {
    expect(extractColorFromCsvName("PSP")).toBe("");
    expect(extractColorFromCsvName("Vita 2000")).toBe("");
  });
  it("既知の機種名が無い場合は残り全体を返す", () => {
    expect(extractColorFromCsvName("コズミックレッド")).toBe("コズミックレッド");
    expect(extractColorFromCsvName("Switch ブルー")).toBe("Switch ブルー");
  });
});

describe("managementNoMatchesColor", () => {
  it("直接部分一致を判定する", () => {
    expect(managementNoMatchesColor("369_ルカ_コズミックレッド_5/5", "コズミックレッド")).toBe(true);
    expect(managementNoMatchesColor("369_ルカ_クリスタルブラック_5/5", "ブラック")).toBe(true);
  });
  it("「&」区切りの複合カラーを分割して照合する", () => {
    expect(managementNoMatchesColor("369_ルカ_レッド_5/5", "レッド&ブルー")).toBe(true);
  });
  it("ランダム/ホワイトベースの相互照合", () => {
    expect(managementNoMatchesColor("371_ルカ_ランダム_3/9", "ランダムカラー")).toBe(true);
    expect(managementNoMatchesColor("371_ルカ_ホワイト_3/9", "ホワイトベース")).toBe(true);
    expect(managementNoMatchesColor("371_ルカ_ホワイトベース_3/9", "ホワイト")).toBe(true);
  });
  it("空文字や不一致は false", () => {
    expect(managementNoMatchesColor("", "レッド")).toBe(false);
    expect(managementNoMatchesColor("369_ルカ_ブルー_5/5", "")).toBe(false);
    expect(managementNoMatchesColor("369_ルカ_ブルー_5/5", "ピンク")).toBe(false);
  });
});

describe("getColorKeywords", () => {
  it("区切り文字で分割する", () => {
    expect(getColorKeywords("ホワイト、レッド、ブルー")).toEqual(["ホワイト", "レッド", "ブルー"]);
    expect(getColorKeywords("レッド&ブルー")).toEqual(["レッド", "ブルー"]);
  });
  it("エイリアスを付加する", () => {
    expect(getColorKeywords("ランダムカラー")).toEqual(["ランダムカラー", "ランダム"]);
    expect(getColorKeywords("ホワイトベース")).toEqual(["ホワイトベース", "ホワイト", "白"]);
    expect(getColorKeywords("ブラック")).toEqual(["ブラック", "黒"]);
    expect(getColorKeywords("黒")).toEqual(["黒", "ブラック"]);
    expect(getColorKeywords("レッド")).toEqual(["レッド", "赤"]);
    expect(getColorKeywords("青")).toEqual(["青", "ブルー"]);
  });
});

describe("extractModelFromCsvName", () => {
  it("機種キーワードを抽出する", () => {
    expect(extractModelFromCsvName("PS Vita 2000 ランダムカラー")).toBe("Vita2000");
    expect(extractModelFromCsvName("PS Vita ブラック")).toBe("Vita1000");
    expect(extractModelFromCsvName("New 3DS ランダムカラー")).toBe("New3DS");
    expect(extractModelFromCsvName("New 3DS LL パールホワイト")).toBe("New3DSLL");
    expect(extractModelFromCsvName("3DS LL ホワイトベース")).toBe("3DSLL");
    expect(extractModelFromCsvName("New 2DS LL ブラック×ターコイズ")).toBe("New2DSLL");
    expect(extractModelFromCsvName("DS Lite ホワイト")).toBe("DSLite");
    expect(extractModelFromCsvName("DSi LL レッド")).toBe("DSiLL");
    expect(extractModelFromCsvName("PSP 3000")).toBe("PSP");
    expect(extractModelFromCsvName("該当なし")).toBe("");
  });
});

describe("matchesModel", () => {
  it("タイトルから機種が特定できる場合は一致のみ許可", () => {
    expect(matchesModel("PS Vita 2000 ブラック", "", "Vita2000")).toBe(true);
    expect(matchesModel("PS Vita 2000 ブラック", "", "Vita1000")).toBe(false);
    expect(matchesModel("New 3DS LL ホワイト", "", "New3DSLL")).toBe(true);
  });
  it("管理番号側の表記でも判定できる", () => {
    expect(matchesModel("本体のみ", "369_vita2000_黒", "Vita2000")).toBe(true);
  });
  it("未知の機種名は常に true", () => {
    expect(matchesModel("なんでも", "", "")).toBe(true);
  });
});

describe("isRandomColor", () => {
  it("ランダム/random/ramdom を判定する", () => {
    expect(isRandomColor("ランダムカラー")).toBe(true);
    expect(isRandomColor("Random Color")).toBe(true);
    expect(isRandomColor("Ramdom")).toBe(true);
    expect(isRandomColor("ブラック")).toBe(false);
  });
});

describe("normalizeColorToken / normalizeColorlessQualifierToken", () => {
  it("英数字以外を除去し小文字化する", () => {
    expect(normalizeColorToken(" PS Vita-2000 ")).toBe("psvita2000");
  });
  it("状態語を除去する", () => {
    expect(normalizeColorlessQualifierToken("1000 bad screen")).toBe("1000");
    expect(normalizeColorlessQualifierToken("Vita2000 good condition")).toBe("vita2000");
  });
});

describe("hasColorlessQualifierText", () => {
  it("状態語を含むかを判定する", () => {
    expect(hasColorlessQualifierText("1000 bad screen")).toBe(true);
    expect(hasColorlessQualifierText("1000")).toBe(false);
  });
});

describe("isColorlessRandomColor", () => {
  it("空文字・機種のみ・数字のみを色なしとみなす", () => {
    expect(isColorlessRandomColor("")).toBe(true);
    expect(isColorlessRandomColor("Vita2000")).toBe(true);
    expect(isColorlessRandomColor("1000")).toBe(true);
    expect(isColorlessRandomColor("1000 grade A")).toBe(true);
    expect(isColorlessRandomColor("コズミックレッド")).toBe(false);
  });
});

describe("colorlessQualifierMatches", () => {
  it("バージョン番号とグレードの一致を要求する", () => {
    expect(colorlessQualifierMatches("1000", "PSP 1000 本体")).toBe(true);
    expect(colorlessQualifierMatches("1000", "PSP 2000 本体")).toBe(false);
    expect(colorlessQualifierMatches("grade A", "PSP grade A")).toBe(true);
    expect(colorlessQualifierMatches("grade A", "PSP grade B")).toBe(false);
  });
});

describe("isOtherColor", () => {
  it("その他カラー表記を判定する", () => {
    expect(isOtherColor("Other")).toBe(true);
    expect(isOtherColor("その他カラー")).toBe(true);
    expect(isOtherColor("それ以外")).toBe(true);
    expect(isOtherColor("ブラック")).toBe(false);
  });
});

describe("hasLimitedEditionMarker", () => {
  it("限定版マーカーを判定する", () => {
    expect(hasLimitedEditionMarker("ワンピース 限定版")).toBe(true);
    expect(hasLimitedEditionMarker("Limited Edition")).toBe(true);
    expect(hasLimitedEditionMarker(null)).toBe(false);
    expect(hasLimitedEditionMarker("通常版")).toBe(false);
  });
});

describe("normalizeLooseText", () => {
  it("空白・記号・長音符を除去し小文字化する", () => {
    expect(normalizeLooseText("ピンク・ホワイト")).toBe("ピンクホワイト");
    expect(normalizeLooseText("Vita　2000 ブルー")).toBe("vita2000ブル");
  });
});
