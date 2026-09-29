import { describe, expect, it } from "vitest";
import { withStoredPurchaseExtra, type PurchaseExtraView } from "./storedExtra";

const purchase = () => ({
  id: 10,
  zaicoId: 20,
  localInventoryId: 30,
  shipDate: null as string | null,
  trackingNumber: null as string | null,
  carrier: null as string | null,
  note: null as string | null,
});

describe("保存済み発注追加情報の補完", () => {
  it("発注ID、外部ID、在庫IDの順で一致する1レコードを選ぶ", () => {
    const extras = new Map<number, PurchaseExtraView>([
      [10, { zaicoId: 10, trackingNumber: "LOCAL" }],
      [20, { zaicoId: 20, trackingNumber: "EXTERNAL" }],
      [30, { zaicoId: 30, trackingNumber: "INVENTORY" }],
    ]);
    expect(withStoredPurchaseExtra(purchase(), extras).trackingNumber).toBe(
      "LOCAL"
    );
    extras.delete(10);
    expect(withStoredPurchaseExtra(purchase(), extras).trackingNumber).toBe(
      "EXTERNAL"
    );
    extras.delete(20);
    expect(withStoredPurchaseExtra(purchase(), extras).trackingNumber).toBe(
      "INVENTORY"
    );
  });

  it("空欄だけを補い、空白でない保存値はそのまま保持する", () => {
    const row = {
      ...purchase(),
      trackingNumber: "  ",
      note: " 発注側 ",
      shipDate: "2026-09-01",
    };
    const original = { ...row };
    const merged = withStoredPurchaseExtra(
      row,
      new Map([
        [
          10,
          {
            zaicoId: 10,
            trackingNumber: "TRACK",
            note: "追加側",
            shipDate: "2026-09-02",
            carrier: "yamato",
          },
        ],
      ])
    );
    expect(merged).toMatchObject({
      trackingNumber: "TRACK",
      note: " 発注側 ",
      shipDate: "2026-09-01",
      carrier: "yamato",
    });
    expect(row).toEqual(original);
  });

  it("選んだ追加情報が空欄でも別IDの値を混ぜず、追加情報がなければ元の行を返す", () => {
    const row = purchase();
    expect(withStoredPurchaseExtra(row, new Map())).toBe(row);
    expect(
      withStoredPurchaseExtra(
        row,
        new Map([
          [10, { zaicoId: 10, trackingNumber: null }],
          [20, { zaicoId: 20, trackingNumber: "DO-NOT-MIX" }],
        ])
      ).trackingNumber
    ).toBeNull();
  });
});
