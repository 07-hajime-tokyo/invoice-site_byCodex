import { describe, expect, it } from "vitest";
import {
  buildInboundInvoiceRollups,
  groupInboundBoxes,
  invoiceAllocation,
  matchInboundLabels,
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
