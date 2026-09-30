import { describe, expect, it } from "vitest";
import { getCurrencyForPartner, normalizeCurrency } from "./editTradeModel";

describe("getCurrencyForPartner（Edit版）", () => {
  it("ルカ/サイモン/マキシム/ネレ系はユーロ", () => {
    expect(getCurrencyForPartner("ルカ")).toBe("ユーロ");
    expect(getCurrencyForPartner("Luca")).toBe("ユーロ");
    expect(getCurrencyForPartner("マキシム")).toBe("ユーロ");
  });

  it("サミー/デボン系はドル、該当なしは null（Add版と異なる）", () => {
    expect(getCurrencyForPartner("サミー")).toBe("ドル");
    expect(getCurrencyForPartner("Devon")).toBe("ドル");
    expect(getCurrencyForPartner("unknown")).toBeNull();
  });
});

describe("normalizeCurrency", () => {
  it("取引相手から通貨が決まる場合は入力より優先する", () => {
    expect(normalizeCurrency("ドル", "ルカ")).toBe("ユーロ");
    expect(normalizeCurrency("ユーロ", "サミー")).toBe("ドル");
  });

  it("相手で決まらない場合はドル指定のみドル、他はユーロ", () => {
    expect(normalizeCurrency("ドル", "unknown")).toBe("ドル");
    expect(normalizeCurrency("ユーロ")).toBe("ユーロ");
    expect(normalizeCurrency("US$")).toBe("ユーロ");
  });
});
