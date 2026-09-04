import { describe, expect, it } from "vitest";
import {
  allocateShipmentItemsToCsvProducts,
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

  it("3DS LLランダムカラーをNew 3DS LLに吸収しない", () => {
    expect(extractModel("3DS LL ランダムカラー")).toBe("3DSLL");
    expect(extractModel("New 3DS LL ランダムカラー")).toBe("New3DSLL");

    const products = [
      { name: "3DS LL ランダムカラー", qty: 15 },
      { name: "New 3DS LL ランダムカラー", qty: 5 },
    ];

    expect(suggestCsvProduct("3DSLL レッド×ブラック", "394_サイモン_9/15", products)?.name).toBe("3DS LL ランダムカラー");
    expect(suggestCsvProduct("New 3DS LL ブラック", "394_サイモン_New3DSLL_1/5", products)?.name).toBe("New 3DS LL ランダムカラー");
  });

  it("New 2DS LLを2DSとして扱わない", () => {
    expect(extractModel("New 2DS LL ブラック×ターコイズ")).toBe("New2DSLL");
    expect(extractModel("2DS クリアブラック")).toBe("2DS");
  });

  it("New 2DS LL モンスターボールをランダムカラーに混ぜない", () => {
    const products = [
      { name: "New 2DS LL モンスターボール", qty: 1 },
      { name: "New 2DS LL ランダムカラー", qty: 1 },
    ];

    expect(suggestCsvProduct("New 2DS LL モンスターボール", "409_マキシム_モンスターボール_1/1", products)?.name)
      .toBe("New 2DS LL モンスターボール");
    expect(suggestCsvProduct("New 2DS LL ホワイト×オレンジ", "409_マキシム_New2DSLL_1/1", products)?.name)
      .toBe("New 2DS LL ランダムカラー");
    expect(suggestCsvProduct("New 2DS LL モンスターボール", "409_マキシム_モンスターボール_1/1", [
      { name: "New 2DS LL ランダムカラー", qty: 1 },
    ])).toBeNull();
  });

  it("色付きの発注商品は管理番号の色も使って該当インボイス商品へ分類する", () => {
    const products = [
      { name: "New 2DS LL ホワイト×オレンジ", qty: 3 },
      { name: "New 2DS LL ホワイト×ラベンダー", qty: 1 },
      { name: "New 2DS LL マインクラフト", qty: 1 },
      { name: "3DS ブルー", qty: 2 },
      { name: "3DS レッド", qty: 1 },
    ];

    expect(suggestCsvProduct("New 2DS LL", "410_マキシム_New2DSLL_オレンジ_1/2", products)?.name)
      .toBe("New 2DS LL ホワイト×オレンジ");
    expect(suggestCsvProduct("New 2DS LL ホワイト×ラベンダー", "410_マキシム_New2DSLL_ラベンダー_1/1", products)?.name)
      .toBe("New 2DS LL ホワイト×ラベンダー");
    expect(suggestCsvProduct("3DS コバルトブルー", "410_マキシム_3DS_ブルー_1/2", products)?.name)
      .toBe("3DS ブルー");
    expect(suggestCsvProduct("3DS フレアレッド", "410_マキシム_3DS_レッド_1/1", products)?.name)
      .toBe("3DS レッド");
  });

  it("New 2DS LL マインクラフトをランダムカラーに混ぜない", () => {
    expect(suggestCsvProduct("New 2DS LL マインクラフト", "410_マキシム_New2DSLL_マインクラフト_1/1", [
      { name: "New 2DS LL ランダムカラー", qty: 1 },
    ])).toBeNull();
    expect(suggestCsvProduct("New 2DS LL マインクラフト", "410_マキシム_New2DSLL_マインクラフト_1/1", [
      { name: "New 2DS LL ホワイト×オレンジ", qty: 1 },
      { name: "New 2DS LL マインクラフト", qty: 1 },
    ])?.name).toBe("New 2DS LL マインクラフト");
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
    expect(suggestCsvProduct("New 3DS LL ピカチュウ", "393_ルカ_限定版_1/2", products)?.name).toBe("限定版");
    expect(suggestCsvProduct("New 2DS LL モンスターボール", "393_ルカ_限定版_2/2", products)?.name).toBe("限定版");
  });

  it("PSP3000の状態表記を色指定なしの注文行として扱う", () => {
    const products = [
      { name: "PSP 3000 bad screens", qty: 15 },
      { name: "PSP 2000 good condition", qty: 25 },
    ];

    expect(suggestCsvProduct("PSP 3000 ピアノ・ブラック", "399_マキシム_PSP3000_1/5", products)?.name).toBe("PSP 3000 bad screens");
    expect(suggestCsvProduct("PSP 3000 ランダムカラー", "", products)?.name).toBe("PSP 3000 bad screens");
    expect(suggestCsvProduct("PSP 2000 セラミック・ホワイト", "399_マキシム_PSP2000_1/5", products)?.name).toBe("PSP 2000 good condition");
  });

  it("PSP3000の状態表記行とランダムカラー行が両方ある場合は状態表記行を優先する", () => {
    const products = [
      { name: "PSP 3000 bad screens", qty: 15 },
      { name: "PSP 3000 ランダムカラー", qty: 15 },
    ];

    expect(suggestCsvProduct("PSP 3000 ピアノ・ブラック", "399_マキシム_PSP3000_1/5", products)?.name).toBe("PSP 3000 bad screens");
    expect(suggestCsvProduct("PSP 3000 ランダムカラー", "", products)?.name).toBe("PSP 3000 ランダムカラー");
  });

  it("ランダムカラーは英語の状態表記も吸収する", () => {
    const products = [
      { name: "PSP 3000 ランダムカラー", qty: 15 },
    ];

    expect(suggestCsvProduct("PSP 3000 bad screens", "", products)?.name).toBe("PSP 3000 ランダムカラー");
    expect(suggestCsvProduct("PSP 3000 good condition", "", products)?.name).toBe("PSP 3000 ランダムカラー");
  });

  it("Vita1100をVita1000注文行に色で紐づける", () => {
    const products = [
      { name: "PS Vita 1000 ブラック", qty: 5 },
      { name: "PS Vita 1000 レッド・ブルー・ホワイト", qty: 5 },
    ];

    expect(suggestCsvProduct("Vita 1100 クリスタル・ブラック", "400_マキシム*Vita1000*ブラック_1/5", products)?.name).toBe("PS Vita 1000 ブラック");
    expect(suggestCsvProduct("Vita 1100 クリスタル・ホワイト", "400_マキシム*Vita1000*ホワイト_1/5", products)?.name).toBe("PS Vita 1000 レッド・ブルー・ホワイト");
    expect(suggestCsvProduct("Vita 1000 サファイア・ブルー", "400_マキシム*Vita1000*ブルー_4/5", products)?.name).toBe("PS Vita 1000 レッド・ブルー・ホワイト");
  });

  it("PSP GoをPSPの他モデルと分けて扱う", () => {
    const products = [
      { name: "PSP Go", qty: 2 },
      { name: "PSP 3000 ランダムカラー", qty: 5 },
    ];

    expect(suggestCsvProduct("PSP Go パール・ホワイト", "400_マキシム_PSPGo_1/2", products)?.name).toBe("PSP Go");
    expect(suggestCsvProduct("PSP 3000 ピアノ・ブラック", "400_マキシム_PSP3000_1/5", products)?.name).toBe("PSP 3000 ランダムカラー");
  });

  it("2DSをNew 2DS LLと分けて注文行に紐づける", () => {
    const products = [
      { name: "2DS", qty: 5 },
      { name: "New 2DS LL", qty: 5 },
    ];

    expect(suggestCsvProduct("2DS クリアブラック", "393_ルカ_2DS_4/5", products)?.name).toBe("2DS");
    expect(suggestCsvProduct("New 2DS LL ブラック×ターコイズ", "393_ルカ_New2DSLL_1/5", products)?.name).toBe("New 2DS LL");
    expect(suggestCsvProduct("New 2DS LL モンスターボール", "393_ルカ_2DS_5/5", products)).toBeNull();
  });

  it("3DS LLホワイトベースだけが注文行にある場合は3DS LL仕入れをそこへ寄せる", () => {
    const products = [
      { name: "3DS LL ホワイトベース", qty: 5 },
      { name: "New 3DS LL ランダムカラー", qty: 5 },
    ];

    expect(suggestCsvProduct("3DSLL ミント×ホワイト", "400_マキシム_3DSLL_1/5", products)?.name).toBe("3DS LL ホワイトベース");
    expect(suggestCsvProduct("3DSLL レッド×ブラック", "400_マキシム_3DSLL_2/5", products)?.name).toBe("3DS LL ホワイトベース");
  });

  it("No.407の3DS LLどうぶつの森だけを3DS LLホワイトベースへ特別に寄せる", () => {
    const products = [
      { name: "3DS LL ホワイトベース", qty: 25 },
      { name: "New 3DS LL ランダムカラー", qty: 5 },
    ];

    expect(suggestCsvProduct("3DS LL どうぶつの森", "407_マキシム_3DSLL_どうぶつの森_1/5", products)?.name)
      .toBe("3DS LL ホワイトベース");
    expect(suggestCsvProduct("3DS LL どうぶつの森", "407_マキシム_9/25&10/25", [
      { name: "3DSLL ホワイトベース", qty: 25 },
      { name: "New 3DS LL ランダムカラー", qty: 5 },
    ])?.name)
      .toBe("3DSLL ホワイトベース");
    expect(suggestCsvProduct("3DS LL どうぶつの森", "406_マキシム_3DSLL_どうぶつの森_1/5", products))
      .toBeNull();
    expect(suggestCsvProduct("New 3DS LL どうぶつの森", "407_マキシム_New3DSLL_どうぶつの森_1/5", products))
      .toBeNull();
  });

  it("No.407でも3DS LLどうぶつの森の注文行がある場合は専用行を優先する", () => {
    const products = [
      { name: "3DS LL ホワイトベース", qty: 25 },
      { name: "3DS LL どうぶつの森", qty: 5 },
    ];

    expect(suggestCsvProduct("3DS LL どうぶつの森", "407_マキシム_3DSLL_どうぶつの森_1/5", products)?.name)
      .toBe("3DS LL どうぶつの森");
  });

  it("shipment allocation sums color items into model-only rows without leaking 3DS LL into 3DS", () => {
    const result = allocateShipmentItemsToCsvProducts([
      { productNameJa: "New3DS LL メタリックブラック", productNameEn: "", quantity: 1 },
      { productNameJa: "New3DS LL メタリックレッド", productNameEn: "", quantity: 1 },
      { productNameJa: "New3DS LL メタリックブルー", productNameEn: "", quantity: 1 },
      { productNameJa: "New3DS LL メタリックブルー", productNameEn: "", quantity: 2 },
      { productNameJa: "New3DS LL メタリックブラック", productNameEn: "", quantity: 1 },
      { productNameJa: "New3DS LL メタリックブルー", productNameEn: "", quantity: 1 },
      { productNameJa: "3DSLL ピンク×ホワイト", productNameEn: "", quantity: 1 },
    ], [
      { name: "New 3DS LL", qty: 8 },
      { name: "3DS LL", qty: 4 },
      { name: "3DS", qty: 2 },
    ]);

    expect(result).toEqual([
      { productNameJa: "New 3DS LL", productNameEn: "New 3DS LL", quantity: 7 },
      { productNameJa: "3DS LL", productNameEn: "3DS LL", quantity: 1 },
    ]);
  });

  it("403の実色出庫をランダムカラー注文行へ機種別に割り当てる", () => {
    const result = allocateShipmentItemsToCsvProducts([
      { productNameJa: "New 3DS LL メタリックブルー", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "New 3DS LL メタリックブラック", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "New 3DS LL メタリックブラック", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "New 2DS LL ブラック×ターコイズ", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "3DS LL ピンク×ホワイト", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "3DS LL ブルー×ブラック", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "3DS LL シルバー×ブラック", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "3DS LL レッド×ブラック", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "New 2DS LL ブラック×ライム", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "3DS LL ミント×ホワイト", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "3DS LL ミント×ホワイト", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "3DS LL レッド×ブラック", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "3DS LL シルバー×ブラック", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
      { productNameJa: "New 3DS LL メタリックレッド", productNameEn: "", quantity: 1, managementNo: "403_B000002" },
    ], [
      { name: "3DS LL ランダムカラー", qty: 10 },
      { name: "New 3DS LL ランダムカラー", qty: 4 },
      { name: "New 2DS LL ランダムカラー", qty: 2 },
    ]);

    expect(result).toEqual([
      { productNameJa: "New 3DS LL ランダムカラー", productNameEn: "New 3DS LL ランダムカラー", quantity: 4 },
      { productNameJa: "New 2DS LL ランダムカラー", productNameEn: "New 2DS LL ランダムカラー", quantity: 2 },
      { productNameJa: "3DS LL ランダムカラー", productNameEn: "3DS LL ランダムカラー", quantity: 8 },
    ]);
  });

  it("shipment allocation keeps New 2DS LL monster ball out of random color rows", () => {
    const result = allocateShipmentItemsToCsvProducts([
      { productNameJa: "New 2DS LL モンスターボール", productNameEn: "", quantity: 1, managementNo: "409_マキシム_モンスターボール_1/1" },
      { productNameJa: "New 2DS LL ホワイト×オレンジ", productNameEn: "", quantity: 1, managementNo: "409_マキシム_New2DSLL_1/1" },
    ], [
      { name: "New 2DS LL モンスターボール", qty: 1 },
      { name: "New 2DS LL ランダムカラー", qty: 1 },
    ]);

    expect(result).toEqual([
      { productNameJa: "New 2DS LL モンスターボール", productNameEn: "New 2DS LL モンスターボール", quantity: 1 },
      { productNameJa: "New 2DS LL ランダムカラー", productNameEn: "New 2DS LL ランダムカラー", quantity: 1 },
    ]);
  });

  it("shipment allocation fills specific color rows before random rows", () => {
    const result = allocateShipmentItemsToCsvProducts([
      { productNameJa: "New 3DS LL ブラック", productNameEn: "New 3DS LL Black", quantity: 3 },
    ], [
      { name: "New 3DS LL ランダムカラー", qty: 8 },
      { name: "New 3DS LL ブラック", qty: 1 },
    ]);

    expect(result).toEqual([
      { productNameJa: "New 3DS LL ブラック", productNameEn: "New 3DS LL ブラック", quantity: 1 },
      { productNameJa: "New 3DS LL ランダムカラー", productNameEn: "New 3DS LL ランダムカラー", quantity: 2 },
    ]);
  });
});
