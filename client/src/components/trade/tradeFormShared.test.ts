import { afterEach, describe, expect, it, vi } from "vitest";
import { STATUS_PRESETS, fetchFrankfurterRate, normalizeDate } from "./tradeFormShared";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeDate", () => {
  it("スラッシュ区切り・1桁月日を YYYY-MM-DD に正規化する", () => {
    expect(normalizeDate("2025/3/15")).toBe("2025-03-15");
    expect(normalizeDate(" 2026-4-1 ")).toBe("2026-04-01");
    expect(normalizeDate("2026-04-01")).toBe("2026-04-01");
  });

  it("形式外は null を返す", () => {
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("2026年4月1日")).toBeNull();
    expect(normalizeDate("04-01-2026")).toBeNull();
  });
});

describe("STATUS_PRESETS", () => {
  it("両ダイアログで使う既定リストを保持する", () => {
    expect(STATUS_PRESETS).toEqual(["complete", "途中", "残1台", "残2台", "残3台", "残5台", "残10台"]);
  });
});

describe("fetchFrankfurterRate", () => {
  function okResponse(rate: number) {
    return { ok: true, json: async () => ({ rates: { JPY: rate } }) };
  }

  it("EUR/USD 両レートを小数2桁へ丸めて返す", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse(163.4567))
      .mockResolvedValueOnce(okResponse(151.111));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFrankfurterRate("2026-04-01")).resolves.toEqual({ eur: 163.46, usd: 151.11 });
    expect(fetchMock).toHaveBeenCalledWith("https://api.frankfurter.dev/v1/2026-04-01?base=EUR&symbols=JPY");
    expect(fetchMock).toHaveBeenCalledWith("https://api.frankfurter.dev/v1/2026-04-01?base=USD&symbols=JPY");
  });

  it("日付未指定なら latest を問い合わせる", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse(160))
      .mockResolvedValueOnce(okResponse(150));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFrankfurterRate()).resolves.toEqual({ eur: 160, usd: 150 });
    expect(fetchMock).toHaveBeenCalledWith("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=JPY");
  });

  it("HTTPエラー・レート欠落・例外時は null を返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await expect(fetchFrankfurterRate()).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: {} }) }));
    await expect(fetchFrankfurterRate()).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(fetchFrankfurterRate()).resolves.toBeNull();
  });
});
