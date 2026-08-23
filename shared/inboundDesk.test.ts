import { describe, expect, it } from "vitest";
import {
  buildInboundInvoiceRollups,
  filterActiveInvoiceRollups,
  groupInboundBoxes,
  invoiceAllocation,
  matchInboundLabels,
  summarizeIncoming,
  type InboundInvoiceRollup,
  type InboundLabel,
} from "../client/src/inventory/lib/inboundDesk";

function label(overrides: Partial<InboundLabel>): InboundLabel {
  return {
    labelId: "ABCDEFG",
    status: "ordered",
    title: "3DS LL シルバー×ブラック",
    legacyManagementNo: "403_サイモン_3DSLL_1/10",
    purchaseId: 1,
    localInventoryId: 1,
    trackingNumber: "659008376073",
    carrier: "yamato",
    supplierName: "テスト仕入先",
    category: "ゲーム機本体",
    receivedAt: null,
    updatedAt: "2026-08-13T00:00:00.000Z",
    inventoryCounted: false,
    ...overrides,
  };
}

describe("matchInboundLabels", () => {
  const labels = [
    label({ labelId: "ZVRLNMJ", trackingNumber: "659008376073" }),
    label({
      labelId: "DBAMQZW",
      trackingNumber: "491831335881",
      legacyManagementNo: "401_マキシム_3DS_1/1",
    }),
    label({
      labelId: "WUNWUUE",
      trackingNumber: "DA2021274367",
      title: "3DS LL ミント×ホワイト",
    }),
    label({ labelId: "LYUFNPS", trackingNumber: "DA6610382648" }),
    label({ labelId: "LWLHUKS", trackingNumber: "DA6610382648" }),
    label({ labelId: "ADWZYVX", trackingNumber: "DA6610382648" }),
  ];

  it.each([
    ["B659008376073B", ["ZVRLNMJ"]],
    ["C7151211DD491831335881D", ["DBAMQZW"]],
    ["DA2021274367SDｒ５ｓDvGC8=001=v", ["WUNWUUE"]],
    ["A03044366A", []],
    ["DA6610382648", ["ADWZYVX", "LWLHUKS", "LYUFNPS"]],
  ])("matches %s", (scan, expected) => {
    expect(
      matchInboundLabels(scan, labels)
        .map(item => item.labelId)
        .sort()
    ).toEqual(expected);
  });
});

describe("inbound desk aggregation", () => {
  it("creates replacement work only for invoice allocations", () => {
    expect(invoiceAllocation("403_サイモン_3DSLL_1/10")).toMatchObject({
      invoiceNo: "403",
      partner: "サイモン",
    });
    expect(invoiceAllocation("在庫_3DSLL_1/10")).toMatchObject({
      invoiceNo: null,
      label: "在庫用",
    });
  });

  it("groups received labels by tracking number without a work-day boundary", () => {
    const boxes = groupInboundBoxes([
      label({
        labelId: "AAAAAAA",
        status: "received",
        trackingNumber: "DA6610382648",
        receivedAt: "2026-08-12T03:00:00Z",
      }),
      label({
        labelId: "BBBBBBB",
        status: "received",
        trackingNumber: "DA6610382648",
        receivedAt: "2026-08-13T03:00:00Z",
      }),
    ]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].labels).toHaveLength(2);
    expect(boxes[0].receivedAt).toBe("2026-08-12T03:00:00Z");
  });

  it("projects invoice completion while removing legacy counted pending stock", () => {
    const rollups = buildInboundInvoiceRollups(
      [
        {
          key: "403",
          partner: "サイモン",
          csvOrderQty: 16,
          deliveredCount: 0,
          stockCount: 2,
          orderedCount: 5,
          purchasedCount: 2,
          csvProducts: [],
        },
      ],
      [
        label({
          labelId: "AAAAAAA",
          status: "received",
          inventoryCounted: true,
        }),
        label({
          labelId: "BBBBBBB",
          status: "received",
          inventoryCounted: false,
        }),
      ]
    );
    expect(rollups[0]).toMatchObject({
      stockCountBeforeInspection: 1,
      remainingBeforeInbound: 15,
      inboundCount: 2,
      stillShortAfterInbound: 13,
    });
  });
});

describe("filterActiveInvoiceRollups", () => {
  function rollup(overrides: Partial<InboundInvoiceRollup>): InboundInvoiceRollup {
    return {
      key: "405",
      partner: "マキシム",
      csvOrderQty: 10,
      deliveredCount: 0,
      stockCount: 0,
      orderedCount: 0,
      purchasedCount: 0,
      csvProducts: [],
      inboundCount: 0,
      countedPendingCount: 0,
      stockCountBeforeInspection: 0,
      remainingBeforeInbound: 10,
      stillShortAfterInbound: 10,
      finalRemaining: 10,
      ...overrides,
    };
  }

  it("No.399以下は出庫登録が無くても隠す", () => {
    // 出庫登録の仕組みができる前の取引。deliveredCount が 0 のままなので
    // 「不足数 > 0」だけで判定すると永久に残ってしまう。
    const rollups = [rollup({ key: "123", deliveredCount: 0 }), rollup({ key: "405" })];
    expect(filterActiveInvoiceRollups(rollups).map(row => row.key)).toEqual(["405"]);
  });

  it("400番台でも受注数まで出庫し終えたものは隠す", () => {
    const rollups = [
      rollup({ key: "401", csvOrderQty: 29, deliveredCount: 29 }),
      rollup({ key: "408", csvOrderQty: 25, deliveredCount: 1 }),
    ];
    expect(filterActiveInvoiceRollups(rollups).map(row => row.key)).toEqual(["408"]);
  });

  it("受注数0の取引は残す（数量未確定のため完了と判断しない）", () => {
    const rollups = [rollup({ key: "409", csvOrderQty: 0, deliveredCount: 0 })];
    expect(filterActiveInvoiceRollups(rollups)).toHaveLength(1);
  });
});

describe("summarizeIncoming", () => {
  it("追跡番号ありの未荷受けを箱にまとめ、未登録は別に出す", () => {
    const result = summarizeIncoming([
      label({ labelId: "AAAAAAA", status: "ordered", trackingNumber: "390849156143" }),
      label({ labelId: "BBBBBBB", status: "ordered", trackingNumber: "3908-4915-6143" }),
      label({ labelId: "CCCCCCC", status: "ordered", trackingNumber: "" }),
      label({ labelId: "DDDDDDD", status: "received", trackingNumber: "659008376073" }),
    ]);

    // ハイフン入りは同じ荷物として1箱にまとまる
    expect(result.boxes).toHaveLength(1);
    expect(result.boxes[0].labels.map(row => row.labelId)).toEqual(["AAAAAAA", "BBBBBBB"]);
    expect(result.labelCount).toBe(2);
    // 荷受け済み（received）は到着予定に含めない
    expect(result.untrackedLabels.map(row => row.labelId)).toEqual(["CCCCCCC"]);
  });
});
