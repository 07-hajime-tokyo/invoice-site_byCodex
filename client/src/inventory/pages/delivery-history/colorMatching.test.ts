import { describe, expect, it } from "vitest";
import {
  colorAliases,
  colorKeywordMatches,
  extractModelName,
  isRandomColor,
  normalizeColorText,
} from "./colorMatching";

/** 出庫履歴画面の色・機種照合の整理前基準（現行出力の固定） */

describe("isRandomColor", () => {
  it("ランダム/random/ramdom を含む名称を判定する", () => {
    expect(isRandomColor("Vita2000 ランダムカラー")).toBe(true);
    expect(isRandomColor("Random color")).toBe(true);
    expect(isRandomColor("Ramdom")).toBe(true);
    expect(isRandomColor("Vita2000 ブラック")).toBe(false);
  });
});

describe("normalizeColorText", () => {
  it("小文字化し区切り記号（長音符含む）を除去する", () => {
    expect(normalizeColorText("ピンク・ホワイト")).toBe("ピンクホワイト");
    expect(normalizeColorText("Black-White")).toBe("blackwhite");
    expect(normalizeColorText("グレー　＆ 黒")).toBe("グレ黒");
  });
});

describe("colorAliases", () => {
  it("既知の色は別表記グループを返し、未知はそのまま", () => {
    expect(colorAliases("黒")).toEqual(["black", "ブラック", "黒"]);
    expect(colorAliases("グレイ")).toEqual(["gray", "grey", "グレー", "グレイ"]);
    expect(colorAliases("カモフラ")).toEqual(["カモフラ"]);
  });
});

describe("colorKeywordMatches", () => {
  it("色キーワードの別表記も含めて商品名と照合する", () => {
    expect(colorKeywordMatches("黒", "PSP3000 ブラック")).toBe(true);
    expect(colorKeywordMatches("White", "Vita2000 ホワイト")).toBe(true);
    expect(colorKeywordMatches("赤", "PSP3000 ブルー")).toBe(false);
  });
});

describe("extractModelName", () => {
  it("既知の機種パターンを正規名へ寄せる", () => {
    expect(extractModelName("Toynet Vita2000 アクアブルー")).toBe("Vita2000");
    expect(extractModelName("PS Vita 2000 ランダムカラー")).toBe("Vita2000");
    expect(extractModelName("PS Vita 1100 ブラック")).toBe("Vita1000");
    expect(extractModelName("New 2DS LL ホワイト")).toBe("New2DSLL");
    expect(extractModelName("スイッチライト グレー")).toBe("SwitchLite");
    // JSDocの例と異なり、色明示でも機種名のみを返すのが現行実装
    expect(extractModelName("PSP3000 ブラック")).toBe("PSP3000");
  });
  it("未知の名称はそのまま返す（全角スペースは半角化）", () => {
    expect(extractModelName("謎の商品　限定版")).toBe("謎の商品 限定版");
  });
});
