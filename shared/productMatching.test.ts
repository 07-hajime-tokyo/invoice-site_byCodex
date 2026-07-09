import { describe, expect, it } from "vitest";
import {
  extractManagementInvoiceKey,
  extractModel,
  isAccessory,
  suggestCsvProduct,
} from "./productMatching";

describe("productMatching", () => {
  it("DSi LLの色違いをDSiLLランダムカラーへ提案する", () => {
    const suggestion = suggestCsvProduct("DSi LL グリーン", "", [
      { name: "DSiLL イエロー", qty: 15 },
      { name: "DSiLL ワインレッド", qty: 15 },
      { name: "DSiLL ランダムカラー", qty: 15 },
    ]);

    expect(suggestion?.name).toBe("DSiLL ランダムカラー");
  });

  it("DSiXLをDSiではなくDSiLLとして扱う", () => {
    expect(extractModel("DSiXL グリーン")).toBe("DSiLL");

    const suggestion = suggestCsvProduct("DSiXL グリーン", "", [
      { name: "DSiLL イエロー", qty: 15 },
      { name: "DSiLL ワインレッド", qty: 15 },
      { name: "DSiLL ランダムカラー", qty: 15 },
    ]);

    expect(suggestion?.name).toBe("DSiLL ランダムカラー");
  });

  it("タッチペン付きの本体商品をアクセサリー扱いにしない", () => {
    expect(isAccessory("DSi LL イエロー タッチペン付き")).toBe(false);

    const suggestion = suggestCsvProduct("DSi LL イエロー タッチペン付き", "", [
      { name: "DSiLL イエロー", qty: 15 },
      { name: "DSiLL ランダムカラー", qty: 15 },
    ]);

    expect(suggestion?.name).toBe("DSiLL イエロー");
  });

  it("Vita2000の駿河屋誤発送ブルーをアクアブルーへ提案する", () => {
    const suggestion = suggestCsvProduct("5/15 駿河屋誤発送 vita2000 ブルー", "", [
      { name: "Vita2000 アクア・ブルー", qty: 5 },
      { name: "Vita2000 ブラック", qty: 5 },
    ]);

    expect(suggestion?.name).toBe("Vita2000 アクア・ブルー");
  });

  it("明確なカラーがないVita2000をランダムカラーへ提案する", () => {
    const suggestion = suggestCsvProduct("Vita 2000 ネオン・オレンジ", "", [
      { name: "Vita2000 ランダムカラー", qty: 5 },
    ]);

    expect(suggestion?.name).toBe("Vita2000 ランダムカラー");
  });

  it("全角数字や不可視文字を正規化して管理番号キーを取る", () => {
    expect(extractManagementInvoiceKey("３９１_サミー_グリーン")).toBe("391");
    expect(extractManagementInvoiceKey("\u200B３９１_サミー_グリーン")).toBe("391");
  });

  it("New 3DSとNew 3DS LLを別物として扱う", () => {
    expect(extractModel("New 3DS ブラック")).toBe("New3DS");
    expect(extractModel("New 3DS LL ブラック")).toBe("New3DSLL");

    const suggestion = suggestCsvProduct("New 3DS ブラック", "", [
      { name: "New3DSLL ランダムカラー", qty: 10 },
      { name: "New3DS ランダムカラー", qty: 6 },
    ]);

    expect(suggestion?.name).toBe("New3DS ランダムカラー");
  });

  it("New 2DS LLを2DSとして扱わない", () => {
    expect(extractModel("New 2DS LL ブラック×ターコイズ")).toBe("New2DSLL");
    expect(extractModel("2DS クリアブラック")).toBe("2DS");
  });

  it("No.393のNew 3DS系を別々の注文行へ分類する", () => {
    const products = [
      { name: "New 3DS LL ランダムカラー", qty: 10 },
      { name: "New 3DS ランダムカラー", qty: 6 },
      { name: "New 3DS LL どうぶつの森", qty: 1 },
      { name: "New 2DS LL", qty: 5 },
      { name: "2DS", qty: 5 },
      { name: "限定版", qty: 2 },
    ];

    expect(suggestCsvProduct("New 3DS LL ランダムカラー", "", products)?.name).toBe("New 3DS LL ランダムカラー");
    expect(suggestCsvProduct("New 3DS ランダムカラー", "", products)?.name).toBe("New 3DS ランダムカラー");
    expect(suggestCsvProduct("New 3DS LL どうぶつの森", "", products)?.name).toBe("New 3DS LL どうぶつの森");
    expect(suggestCsvProduct("New 2DS LL", "", products)?.name).toBe("New 2DS LL");
    expect(suggestCsvProduct("2DS", "", products)?.name).toBe("2DS");
  });
});
