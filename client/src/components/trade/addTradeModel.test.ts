import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRADE_PARTNERS,
  createInitialForm,
  getCurrencyForPartner,
  getTodayDateString,
  isHiddenTradePartner,
  toJapanesePartner,
  toJapaneseProductName,
} from "./addTradeModel";

describe("getTodayDateString / createInitialForm", () => {
  it("今日の日付を YYYY-MM-DD で返す", () => {
    expect(getTodayDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("初期フォームは今日の支払日・当月・ユーロ通貨を持つ", () => {
    const form = createInitialForm();
    const today = getTodayDateString();
    expect(form.paymentDate).toBe(today);
    expect(form.month).toBe(String(new Date(`${today}T00:00:00`).getMonth() + 1));
    expect(form.currency).toBe("ユーロ");
    expect(form.partner).toBe("");
    expect(form.shippingCost).toBe("");
  });
});

describe("getCurrencyForPartner（Add版）", () => {
  it("ルカ/サイモン/マキシム/ネレ系はユーロ", () => {
    expect(getCurrencyForPartner("ルカ")).toBe("ユーロ");
    expect(getCurrencyForPartner("Luca Neumann")).toBe("ユーロ");
    expect(getCurrencyForPartner("simon")).toBe("ユーロ");
    expect(getCurrencyForPartner("ネレ")).toBe("ユーロ");
  });

  it("それ以外（サミー・デボン・不明を含む）はドル", () => {
    expect(getCurrencyForPartner("サミー")).toBe("ドル");
    expect(getCurrencyForPartner("デボン")).toBe("ドル");
    expect(getCurrencyForPartner("unknown")).toBe("ドル");
  });
});

describe("isHiddenTradePartner", () => {
  it("hennes kamusien（NFKC・大文字小文字無視）のみ非表示", () => {
    expect(isHiddenTradePartner("hennes kamusien")).toBe(true);
    expect(isHiddenTradePartner(" Hennes Kamusien ")).toBe(true);
    expect(isHiddenTradePartner("サイモン")).toBe(false);
    expect(isHiddenTradePartner(null)).toBe(false);
  });
});

describe("toJapanesePartner", () => {
  it("完全一致マッピングを優先する", () => {
    expect(toJapanesePartner("luca neumann")).toBe("ルカ");
    expect(toJapanesePartner("hennes kamusien")).toBe("サイモン");
    expect(toJapanesePartner("devon brako")).toBe("デボン");
  });

  it("前方一致でフルネームを変換し、該当なしはそのまま", () => {
    expect(toJapanesePartner("Simon Meyer")).toBe("サイモン");
    expect(toJapanesePartner("Maxim Weber")).toBe("マキシム");
    expect(toJapanesePartner("田中太郎")).toBe("田中太郎");
  });
});

describe("toJapaneseProductName", () => {
  it("色・フレーズを日本語に置換する", () => {
    expect(toJapaneseProductName("New3DS Random Color")).toBe("New3DS ランダムカラー");
    expect(toJapaneseProductName("Switch White Base")).toBe("Switch ホワイトベース");
    expect(toJapaneseProductName("DSi Turquoise / Black")).toBe("DSi ターコイズ / ブラック");
  });

  it("配列順で先に pink が置換されるため coral pink はコーラルピンクにならない（既存仕様の固定）", () => {
    expect(toJapaneseProductName("coral pink")).toBe("coral ピンク");
  });
});

describe("DEFAULT_TRADE_PARTNERS", () => {
  it("既定の取引相手リストを保持する", () => {
    expect([...DEFAULT_TRADE_PARTNERS]).toEqual(["ルカ", "サミー", "デボン", "サイモン", "マキシム", "ネレ"]);
  });
});
