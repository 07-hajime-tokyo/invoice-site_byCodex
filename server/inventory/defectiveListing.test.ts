import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  buildDefectiveSheetPayload,
  generateDefectiveDescription,
  generateDefectiveTitle,
  generateYahooKeyword,
  mergeSiteCellsWithoutHumanColumns,
  shouldTreatAsJunk,
} from "./defectiveListing";
import {
  buildDefectivePhotoKey,
  convertDefectivePhotoToJpeg,
  uploadDefectivePhotos,
} from "./defectivePhotos";
import { estimateGroupMarketMedian } from "./defectiveGroups";
import {
  inboundInspectionInputSchema,
  restockToDefectiveBlockReason,
  restockToDefectiveInputSchema,
} from "./inboundDesk";
import { postGasAction } from "./gasClient";
import { parseYahooClosedPricesHtml } from "./yahooClosedPrices";

const fixtureHtml = `<!doctype html><html><head>
  <meta name="description" content="過去120日間の落札相場です。約123件の落札価格を確認できます。">
</head><body>
  <dl><div><dt>最安</dt><dd>100円</dd></div><div><dt>平均</dt><dd>2,500円</dd></div><div><dt>最高</dt><dd>9,999円</dd></div></dl>
  <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      items: [
        {
          auctionId: "a1",
          title: "Nintendo Switch HAC-001 ジャンク",
          price: 1000,
          initPriceNoTax: 1,
          bidCount: 3,
          endTime: "2026-08-12T12:00:00+09:00",
          seller: { isStore: false },
        },
        {
          auctionId: "a2",
          title: "Nintendo Switch HAC-001 充電不可",
          price: 3000,
          initPriceNoTax: 100,
          bidCount: 8,
          endTime: "2026-08-13T12:00:00+09:00",
          seller: { isStore: false },
        },
        {
          auctionId: "a3",
          title: "Nintendo Switch 5台 ジャンク",
          price: 15000,
          initPriceNoTax: 1,
          bidCount: 12,
          endTime: "2026-08-13T13:00:00+09:00",
          seller: { isStore: false },
        },
        {
          auctionId: "a4",
          title: "Nintendo Switch HAC-001",
          price: 7000,
          initPriceNoTax: 1,
          bidCount: 2,
          endTime: "2026-08-13T14:00:00+09:00",
          seller: { isStore: true },
        },
        {
          auctionId: "a5",
          title: "Nintendo Switch 部品取り",
          price: 500,
          initPriceNoTax: 1,
          bidCount: 1,
          endTime: "2026-08-13T15:00:00+09:00",
          seller: { isStore: false },
        },
      ],
    },
  })}</script>
</body></html>`;

describe("defective listing generation", () => {
  it("estimates a bundle as the representative single-item median times quantity", () => {
    expect(estimateGroupMarketMedian([1000, 1000, 3000], 3)).toBe(3000);
    expect(estimateGroupMarketMedian([1000, 3000], 2)).toBe(4000);
    expect(estimateGroupMarketMedian([1000], 2)).toBeNull();
  });

  it("rejects shipped and sealed labels with the required recovery route", () => {
    expect(restockToDefectiveBlockReason({ status: "shipped", boxStatus: "shipped", boxCode: "B000001" }))
      .toMatch(/追跡番号を解除し、封を解いて/);
    expect(restockToDefectiveBlockReason({ status: "stocked", boxStatus: "sealed", boxCode: "B000002" }))
      .toMatch(/封を解いて/);
    expect(restockToDefectiveBlockReason({ status: "stocked" })).toBeNull();
    expect(restockToDefectiveInputSchema.safeParse({
      labelId: "ACDEFGH",
      defectTags: [],
    }).success).toBe(false);
  });
  it("lets a working surplus item through without defect tags, but still blocks a junk one", () => {
    expect(restockToDefectiveInputSchema.safeParse({
      labelId: "ACDEFGH",
      listingKind: "surplus",
      defectTags: [],
    }).success).toBe(true);
    expect(restockToDefectiveInputSchema.safeParse({
      labelId: "ACDEFGH",
      listingKind: "junk",
      defectTags: [],
    }).success).toBe(false);
    // 区分を省いたら従来どおりジャンク扱い
    const parsed = restockToDefectiveInputSchema.safeParse({
      labelId: "ACDEFGH",
      defectTags: ["充電不可"],
    });
    expect(parsed.success && parsed.data.listingKind).toBe("junk");
  });
  it("drops the junk prefix and the junk wording for a working surplus item", () => {
    const title = generateDefectiveTitle({
      productName: "Nintendo Switch 本体のみ 対策済",
      defectTags: [],
      photoCount: 3,
      listingKind: "surplus",
    });
    expect(title.includes("【ジャンク】")).toBe(false);
    // 社内の品名ではなく、買い手が探す日本語の一般名で始める
    expect(title.startsWith("ニンテンドースイッチ 本体のみ")).toBe(true);
    // ヤフオクは海外バイヤーも見るので英語表記も入れる
    expect(title).toContain("Nintendo Switch");
    expect(title.endsWith(" 動作確認済")).toBe(true);
    expect(Array.from(title).length).toBeLessThanOrEqual(65);

    const description = generateDefectiveDescription({
      productName: "Nintendo Switch 本体のみ 対策済",
      defectTags: [],
      defectNote: "画面に薄いスレあり",
      listingKind: "surplus",
    });
    expect(description).toContain("商品の状態");
    expect(description).toContain("・動作確認済みです");
    expect(description).toContain("・画面に薄いスレあり");
    expect(description).not.toContain("不良内容");
    expect(description).not.toContain("動作保証はありません");
    expect(description).toContain("返品・交換・返金はお受けできません");
  });
  it("searches by model name, ignoring supplier prefixes and 対策済/未対策", () => {
    // どれも同じ「Switch 本体」の相場を見る。対策済かどうかで分けない
    for (const name of ["益子Switch対策済", "toy net Switch タブレット 対策済", "Switch 未対策 本体のみ", "デボン返品　スイッチ　対策済み"]) {
      expect(generateYahooKeyword(name, [], "surplus")).toBe("Nintendo Switch 本体のみ");
    }
    expect(generateYahooKeyword("Switch lite イエロー", [], "surplus")).toBe("Nintendo Switch Lite 本体");
    expect(generateYahooKeyword("DS Lite メタリックロゼ", [], "surplus")).toBe("ニンテンドーDS Lite 本体");
    expect(generateYahooKeyword("GBA 本体 ホワイト", [], "surplus")).toBe("ゲームボーイアドバンス 本体");
    expect(generateYahooKeyword("New 3DS LL ランダムカラー", [], "surplus")).toBe("Newニンテンドー3DS LL 本体");
    expect(generateYahooKeyword("3DS LL ホワイトベース", [], "surplus")).toBe("ニンテンドー3DS LL 本体 -New");
    // ジャンクで出すものは検索語にもジャンクが付く
    expect(generateYahooKeyword("益子Switch対策済", ["起動しない"], "junk")).toBe("Nintendo Switch 本体のみ 起動しない");
    // 表に無い品名は従来どおりの組み立てに落ちる
    expect(generateYahooKeyword("Microsoft Surface Pro 1866", [], "surplus")).toContain("Microsoft");
  });

  it("treats a title containing ジャンク as junk even when the kind says surplus", () => {
    expect(shouldTreatAsJunk({ productName: "Switch 本体 ジャンク", listingKind: "surplus" })).toBe(true);
    expect(shouldTreatAsJunk({ productName: "Switch 本体", listingKind: "surplus" })).toBe(false);
    expect(shouldTreatAsJunk({ productName: "Switch 本体", listingKind: "junk" })).toBe(true);
  });

  it("keeps the surplus keyword free of the junk word so the median is not dragged down", () => {
    expect(generateYahooKeyword("Nintendo Switch 本体のみ 対策済", [], "surplus"))
      .not.toContain("ジャンク");
    expect(generateYahooKeyword("Nintendo Switch 本体のみ 対策済", []))
      .toContain("ジャンク");
  });
  it("keeps the warning, junk prefix, and defect tag within 65 characters", () => {
    const title = generateDefectiveTitle({
      productName:
        "Microsoft Ｓｕｒｆａｃｅ Pro 1866 Type Cover付き とても長い商品名がここから延々と続いても削られる",
      defectTags: ["充電不可"],
      photoCount: 0,
    });
    expect(Array.from(title)).toHaveLength(65);
    expect(title.startsWith("【写真未撮影】【ジャンク】Microsoft")).toBe(true);
    expect(title.endsWith(" 充電不可")).toBe(true);
  });

  it("uses a deterministic keyword and the fixed single-item text", () => {
    // 型番ではなく機種の一般名で引く。HAC-001 で絞ると落札が数件しか出ず中央値が当てにならない
    expect(
      generateYahooKeyword("Nintendo Switch HAC-001 本体", ["起動しない"])
    ).toBe("Nintendo Switch 本体のみ 起動しない");
    const description = generateDefectiveDescription({
      productName: "Nintendo Switch HAC-001",
      defectTags: ["起動しない"],
      defectNote: "電源ボタンを押しても反応しません",
    });
    expect(description).toContain(
      "商品説明\nNintendo Switch HAC-001 の出品です。"
    );
    expect(description).toContain(
      "不良内容\n・起動しない\n・電源ボタンを押しても反応しません"
    );
    expect(description).toContain("・返品・交換・返金はお受けできません");
  });

  it("writes photo and no-market warnings without sending human columns", () => {
    const payload = buildDefectiveSheetPayload({
      productId: "ABC1234",
      inspectedAt: new Date("2026-08-14T00:00:00Z"),
      productName: "Nintendo Switch HAC-001",
      defectTags: ["起動しない"],
      photos: [],
      market: {
        keyword: "Nintendo HAC-001 起動しない",
        fetchedAt: "2026-08-14T00:00:00.000Z",
        summaryWindow: { days: 0, min: 0, avg: 0, max: 0, count: 0 },
        adopted: { count: 0, median: null, min: null, max: null },
        samples: [],
      },
    });
    expect(payload.photoCount).toBe("写真なし");
    expect(payload.median).toBe("該当なし");
    expect(payload.listingTitle.startsWith("【写真未撮影】")).toBe(true);
    expect(payload).not.toHaveProperty("開始価格");
    expect(payload).not.toHaveProperty("出品ステータス");
  });

  it("preserves all four human-owned cells on a repeated upsert", () => {
    const existing = {
      商品ID: "ABC1234",
      商品名: "old",
      開始価格: 1,
      出品ステータス: "出品中",
      出品URL: "https://example.test/item",
      落札額: 9250,
    };
    const merged = mergeSiteCellsWithoutHumanColumns(existing, {
      商品名: "new",
      開始価格: 999,
      出品ステータス: "未出品",
      出品URL: "",
      落札額: "",
    });
    expect(merged).toMatchObject({
      商品名: "new",
      開始価格: 1,
      出品ステータス: "出品中",
      出品URL: "https://example.test/item",
      落札額: 9250,
    });
  });
});

describe("Yahoo closed-price parsing", () => {
  it("excludes bundles, quantity expressions, parts-only rows, and stores", () => {
    const result = parseYahooClosedPricesHtml(
      fixtureHtml,
      "Nintendo Switch ジャンク",
      new Date("2026-08-14T12:00:00Z")
    );
    expect(result.summaryWindow).toEqual({
      days: 120,
      min: 100,
      avg: 2500,
      max: 9999,
      count: 123,
    });
    expect(result.adopted).toEqual({
      count: 2,
      median: 2000,
      min: 1000,
      max: 3000,
    });
    expect(result.samples.map(sample => sample.title)).toEqual([
      "Nintendo Switch HAC-001 充電不可",
      "Nintendo Switch HAC-001 ジャンク",
    ]);
  });
});

describe("photo preparation and GAS behavior", () => {
  it("creates a 1600px-or-smaller JPEG and a product-scoped key", async () => {
    const source = await sharp({
      create: { width: 2400, height: 1800, channels: 3, background: "#cc0000" },
    })
      .png()
      .toBuffer();
    const jpeg = await convertDefectivePhotoToJpeg(source);
    const metadata = await sharp(jpeg).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(1600);
    expect(buildDefectivePhotoKey("abc1234", 0)).toBe(
      "defective/ABC1234/01.jpg"
    );
  });

  it("accepts zero photos with a defect tag and rejects a tagless defect", () => {
    expect(
      inboundInspectionInputSchema.safeParse({
        labelId: "ABC1234",
        outcome: "defective",
        defectTags: ["起動しない"],
        defectPhotos: [],
      }).success
    ).toBe(true);
    expect(
      inboundInspectionInputSchema.safeParse({
        labelId: "ABC1234",
        outcome: "defective",
        defectPhotos: [],
      }).success
    ).toBe(false);
  });

  it("uploads converted bytes under the product-scoped key", async () => {
    const source = await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#00cc00" },
    })
      .png()
      .toBuffer();
    let captured: { key: string; contentType: string; format?: string } | null =
      null;
    const photos = await uploadDefectivePhotos(
      "abc1234",
      [
        {
          base64: source.toString("base64"),
          mimeType: "image/png",
          kind: "whole",
        },
      ],
      async (key, body, contentType) => {
        captured = {
          key,
          contentType,
          format: (await sharp(body).metadata()).format,
        };
        return `https://storage.test/${key}`;
      }
    );
    expect(captured).toEqual({
      key: "defective/ABC1234/01.jpg",
      contentType: "image/jpeg",
      format: "jpeg",
    });
    expect(photos[0]).toEqual({
      key: "defective/ABC1234/01.jpg",
      url: "https://storage.test/defective/ABC1234/01.jpg",
      kind: "whole",
    });
  });

  it("retries and follows the Apps Script redirect", async () => {
    let calls = 0;
    const fetchImpl = async (
      _input: string | URL | Request,
      init?: RequestInit
    ) => {
      calls += 1;
      if (calls === 1) throw new Error("temporary");
      if (init?.method === "POST") {
        return new Response("", {
          status: 302,
          headers: { location: "https://example.test/result" },
        });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    };
    const result = await postGasAction(
      { action: "writeDefectiveRow" },
      {
        gasUrl: "https://example.test/gas",
        secret: "test",
        fetchImpl: fetchImpl as typeof fetch,
        sleep: async () => {},
      }
    );
    expect(result.success).toBe(true);
    expect(calls).toBe(3);
  });
});
