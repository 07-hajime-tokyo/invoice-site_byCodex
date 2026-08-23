import { describe, expect, it } from "vitest";
import {
  invoiceGroupKeyFromDeliveryNo,
  invoiceNoFromDeliveryNo,
  invoiceNoFromManagementNo,
  normalizeAssignedInvoiceNo,
  resolveDeliveryItemInvoiceNo,
} from "./invoiceKey";

describe("invoiceNoFromManagementNo", () => {
  it("管理番号の先頭から読む", () => {
    expect(invoiceNoFromManagementNo("405_マキシム_PSP1000ブラック_2/6")).toBe("405");
    expect(invoiceNoFromManagementNo("408_サイモン_3DSLL_11/15")).toBe("408");
  });

  it("4桁になっても読める（No.が繰り上がっても壊れない）", () => {
    expect(invoiceNoFromManagementNo("1002_マキシム_3DSLL_1/5")).toBe("1002");
  });

  it("在庫・eBay・シャフトは null", () => {
    expect(invoiceNoFromManagementNo("在庫0814_1")).toBeNull();
    expect(invoiceNoFromManagementNo("ebay_7696_2")).toBeNull();
    expect(invoiceNoFromManagementNo("シャフト_ebay_1709")).toBeNull();
    expect(invoiceNoFromManagementNo(null)).toBeNull();
  });
});

describe("invoiceNoFromDeliveryNo", () => {
  it("従来の出庫Noは接頭辞で読める", () => {
    expect(invoiceNoFromDeliveryNo("405_Maxim260807")).toBe("405");
    expect(invoiceNoFromDeliveryNo("No.403_samee20260701")).toBe("403");
    expect(invoiceNoFromDeliveryNo("391")).toBe("391");
  });

  it("箱IDは読めないので null（出庫No自体を返さない）", () => {
    expect(invoiceNoFromDeliveryNo("B000002")).toBeNull();
    expect(invoiceNoFromDeliveryNo("ebay_1709")).toBeNull();
    expect(invoiceNoFromDeliveryNo("")).toBeNull();
  });

  it("表示用のキーは読めないとき出庫Noそのものを返す", () => {
    expect(invoiceGroupKeyFromDeliveryNo("B000002")).toBe("B000002");
    expect(invoiceGroupKeyFromDeliveryNo("405_Maxim260807")).toBe("405");
  });
});

describe("resolveDeliveryItemInvoiceNo", () => {
  it("箱IDの出庫でも、明細ごとに別のインボイスへ振り分けられる", () => {
    // 野田さんが 8/19 に報告した B000002。403と408が同じ箱に入っている。
    expect(resolveDeliveryItemInvoiceNo({ managementNo: "403_サイモン_3DSLL_1/10" }, "B000002")).toBe("403");
    expect(resolveDeliveryItemInvoiceNo({ managementNo: "408_サイモン_New3DSLL_4/5" }, "B000002")).toBe("408");
  });

  it("明細に管理番号が無ければ在庫IDから引き直した管理番号を使う", () => {
    expect(resolveDeliveryItemInvoiceNo({}, "B000002", "406_マキシム_9/25")).toBe("406");
  });

  it("従来の出庫Noはそのまま当たる", () => {
    expect(resolveDeliveryItemInvoiceNo({}, "405_Maxim260807")).toBe("405");
  });

  it("出庫Noが宛先を示しているときは管理番号より優先する", () => {
    // 管理番号は「仕入れたときの引当先」であって「実際に出した先」ではない。
    // 実データの 400_Maxim260811 に 388_サミー の在庫を充てた明細がある。
    expect(
      resolveDeliveryItemInvoiceNo({ managementNo: "388_サミー_ブラック_5/5" }, "400_Maxim260811")
    ).toBe("400");
    expect(
      resolveDeliveryItemInvoiceNo({ managementNo: "386_ルカ_9/20" }, "390_samee20260623")
    ).toBe("390");
  });

  it("在庫から充当したぶんは推測せず null にする", () => {
    // どのインボイスの受注行に当たるかは機械的に決まらない。黙って寄せない。
    expect(resolveDeliveryItemInvoiceNo({ managementNo: "在庫0814_1" }, "B000002")).toBeNull();
  });
});

describe("人が指定した引当先", () => {
  it("推測より常に優先する", () => {
    // 401宛で仕入れた在庫を408サイモン宛で発送した実例（B000002 の MLKYDLH）。
    expect(
      resolveDeliveryItemInvoiceNo(
        { managementNo: "401_マキシム_3DSLL_4/4", assignedInvoiceNo: "408" },
        "B000002"
      )
    ).toBe("408");
    // 出庫Noに宛先が書いてあっても、明示指定が勝つ。
    expect(
      resolveDeliveryItemInvoiceNo(
        { managementNo: "388_サミー_ブラック_5/5", assignedInvoiceNo: "392" },
        "400_Maxim260811"
      )
    ).toBe("392");
  });

  it("在庫から充てたぶんも指定すれば数えられる", () => {
    expect(
      resolveDeliveryItemInvoiceNo({ managementNo: "在庫0722_4", assignedInvoiceNo: "403" }, "B000002")
    ).toBe("403");
  });

  it("空・不正な指定は無視して従来の推測に落ちる", () => {
    expect(normalizeAssignedInvoiceNo("")).toBeNull();
    expect(normalizeAssignedInvoiceNo("  ")).toBeNull();
    expect(normalizeAssignedInvoiceNo("403_サイモン")).toBeNull();
    expect(normalizeAssignedInvoiceNo(" 403 ")).toBe("403");
    expect(
      resolveDeliveryItemInvoiceNo({ managementNo: "在庫0722_4", assignedInvoiceNo: "" }, "405_Maxim260807")
    ).toBe("405");
  });
});
