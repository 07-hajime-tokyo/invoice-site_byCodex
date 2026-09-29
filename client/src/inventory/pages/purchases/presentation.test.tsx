import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Purchases from "../Purchases";
import { TrackingNumberPanel } from "./TrackingNumberPanel";
import { PurchaseCardMobile } from "./PurchaseCardMobile";
import { InboundRowControls } from "./InboundRowControls";
import { ItemLabelsBlock } from "./ItemLabelsBlock";
import { filterPurchasesForView, countInboundTabsForClient } from "./filters";
import { parseEtc, cleanManagementNo, formatUnitPrice } from "./format";
import { getPurchaseCarrierMeta } from "./carrier";
import { CARRIER_OPTIONS } from "./constants";
import { type Purchase } from "./types";

vi.mock("wouter", () => ({
  useLocation: () => ["/inventory/purchases", vi.fn()],
}));
vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.mock("@/inventory/components/EbayListingUrlEditor", () => ({
  EbayListingUrlEditor: () => <span data-test="listing-editor" />,
}));
const scenario = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/lib/trpc", () => {
  const methods = new Proxy(
    {},
    {
      get: (_target, name) => ({
        useQuery: () => ({
          data:
            name === "getPurchasesWithCategoryPage"
              ? {
                  items: scenario.rows,
                  allCount: scenario.rows.length,
                  totalCount: scenario.rows.length,
                  totalPages: 1,
                  page: 1,
                  grandTotal: 1234,
                  categoryTotals: [],
                  tabCounts: {},
                }
              : name === "getOperators"
                ? [
                    {
                      key: "default",
                      name: "テスト",
                      email: "test@example.invalid",
                    },
                  ]
                : name === "me"
                  ? { name: "テスト", email: "test@example.invalid" }
                  : [],
          isLoading: false,
          isFetching: false,
          refetch: vi.fn(),
        }),
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
        invalidate: vi.fn(),
        fetch: vi.fn(),
      }),
    }
  );
  return {
    trpc: {
      useUtils: () => ({ inventory: { zaico: methods } }),
      inventory: { zaico: methods, purchaseExtra: methods },
      auth: methods,
    },
  };
});
const makePurchase = (patch: Partial<Purchase> = {}): Purchase => ({
  id: 1,
  num: "TEST-A",
  customer_name: "架空仕入先",
  status: "ordered",
  purchase_date: "2026-09-01",
  estimated_purchase_date: null,
  inboundClass: "ebay",
  classSource: "manual",
  stage: "received",
  csvSupplierName: "架空",
  csvSupplierUrl: "https://supplier.invalid",
  purchase_items: [
    {
      id: 1,
      inventory_id: 10,
      title: '架空,"商品A"',
      quantity: "2",
      unit: "個",
      unit_price: "100.25",
      status: "ordered",
      purchase_date: null,
      estimated_purchase_date: null,
      etc: " TEST-A ,2026-09-01,架空サイト",
      category: "テスト",
      itemLabels: [{ labelId: "TESTAA" }],
    },
  ],
  extra: null,
  ...patch,
});
const tracking = (carrier: string | null) => ({
  id: 1,
  zaicoId: 1,
  shipDate: "2026-09-02",
  trackingNumber: "1234-5678-9012",
  carrier,
  note: "架空メモ",
});
const stableHtml = (node: React.ReactNode) =>
  renderToStaticMarkup(node)
    .replace(/_R_[^"\s<>]+/g, "STABLE_ID")
    .replace(/radix-[^"\s<>]+/g, "RADIX_ID");
const noop = () => {};

describe("入庫画面の整理前表示契約", () => {
  for (const [name, purchase] of [
    ["未発送", makePurchase()],
    ["発送", makePurchase({ extra: tracking("yamato") })],
    ["入庫済み", makePurchase({ status: "purchased", stage: "registered" })],
    ["完了", makePurchase({ stage: "packed" })],
    ["未仕訳", makePurchase({ inboundClass: null })],
  ] as const) {
    it(`${name}の行・分類操作・ラベル表示を維持する`, () => {
      expect(
        stableHtml(
          <PurchaseCardMobile
            purchase={purchase}
            managementNo="TEST-A"
            supplierSite="架空"
            checked={false}
            onToggleCheck={noop}
            onComplete={noop}
            processing={false}
            deleting={new Set()}
            onDeleteInventory={noop}
            statusLabel={{ ordered: "発注済み" }}
            CARRIER_OPTIONS={CARRIER_OPTIONS}
            getStatusClass={() => "status"}
            getEffectiveStatusLabel={() => "状態"}
          />
        )
      ).toMatchSnapshot();
      expect(
        stableHtml(
          <InboundRowControls
            purchase={purchase}
            busy={false}
            onSetClass={noop}
            onAdvance={noop}
            onSeparateShaft={noop}
          />
        )
      ).toMatchSnapshot();
      expect(
        stableHtml(<ItemLabelsBlock item={purchase.purchase_items[0]} />)
      ).toMatchSnapshot();
    });
  }
  it("追跡番号一覧の開閉と番号なしの表示を維持する", () => {
    const purchases = [
      makePurchase(),
      makePurchase({ id: 2, extra: tracking("sagawa") }),
    ];
    expect(
      stableHtml(
        <TrackingNumberPanel
          purchases={purchases}
          isOpen={true}
          onToggle={noop}
        />
      )
    ).toMatchSnapshot();
    expect(
      stableHtml(
        <TrackingNumberPanel
          purchases={purchases}
          isOpen={false}
          onToggle={noop}
        />
      )
    ).toMatchSnapshot();
  });
  it("画面全体の初期表示を維持する", () => {
    scenario.rows = [
      makePurchase({ inboundClass: null }),
      makePurchase({ id: 2, extra: tracking("yamato") }),
    ];
    expect(stableHtml(<Purchases />)).toMatchSnapshot();
    scenario.rows = [];
    expect(stableHtml(<Purchases />)).toMatchSnapshot();
  });
  it("画面とCSVの検索・分類・完了判定を維持する", () => {
    const rows = [
      makePurchase({ inboundClass: null }),
      makePurchase({ id: 2, extra: tracking("yamato") }),
      makePurchase({ id: 3, status: "purchased" }),
      makePurchase({ id: 4, stage: "packed" }),
    ];
    expect([
      filterPurchasesForView(rows, "すべて", null, ""),
      filterPurchasesForView(rows, "テスト", "shipped", "1234"),
      filterPurchasesForView(rows, "すべて", null, "TESTAA"),
      filterPurchasesForView(rows, "存在しない", null, ""),
      countInboundTabsForClient(rows),
    ]).toMatchSnapshot();
  });
  it("管理番号・価格・配送業者の既存表示を維持する", () => {
    expect(
      [undefined, "", " TEST A / 旧表記 ,日付,仕入先", "402_マキシム_1/2"].map(
        value => [cleanManagementNo(value), parseEtc(value)]
      )
    ).toMatchSnapshot();
    expect(
      [null, undefined, "", 0, "0", "1000.25", "bad"].map(formatUnitPrice)
    ).toMatchSnapshot();
    expect(
      [null, "auto", "yamato", "ecohai", "legacy"].map(carrier =>
        getPurchaseCarrierMeta(
          makePurchase({ extra: tracking(carrier) }),
          "123456789012"
        )
      )
    ).toMatchSnapshot();
  });
});
