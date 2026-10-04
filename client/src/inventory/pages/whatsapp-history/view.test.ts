/**
 * WhatsApp会話履歴画面の表示用純関数の基準テスト。
 * 抽出前の WhatsappHistory.tsx と同じ出力であることを固定する。
 * 時刻系は「壁時計をUTCとして読む」仕様のため、UTC固定のISO文字列で検証できる。
 */
import { describe, expect, it } from "vitest";
import {
  EXPAND_MONTHS,
  RECENT_DAYS,
  SELECTED_KEY,
  VIEW_MODES,
  WALL_CLOCK_TZ,
  formatDateTime,
  formatDay,
  formatTime,
  tidy,
} from "./view";

describe("whatsapp-history/view 定数", () => {
  it("表示モードは 両方→和訳→原文 の順", () => {
    expect(VIEW_MODES).toEqual([
      { value: "both", label: "原文＋和訳" },
      { value: "ja", label: "和訳だけ" },
      { value: "original", label: "原文だけ" },
    ]);
  });

  it("localStorageキーとサーバ窓の表示値は既存のまま", () => {
    expect(SELECTED_KEY).toBe("invoice-site-whatsapp-selected-conversation");
    expect(RECENT_DAYS).toBe(14);
    expect(EXPAND_MONTHS).toBe(3);
    expect(WALL_CLOCK_TZ).toBe("UTC");
  });
});

describe("formatDateTime", () => {
  it("null / undefined / 不正文字列は —", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });

  it("壁時計＝UTCとして年月日時分を出す（文字列・Dateどちらも）", () => {
    expect(formatDateTime("2026-09-20T10:05:00.000Z")).toBe("2026/09/20 10:05");
    expect(formatDateTime(new Date("2026-09-20T10:05:00.000Z"))).toBe("2026/09/20 10:05");
  });
});

describe("formatDay", () => {
  it("和暦ではなく西暦の長い月表記＋短い曜日（UTCで読む）", () => {
    // 2026-09-20 はUTCで日曜日
    expect(formatDay("2026-09-20T00:00:00.000Z")).toBe("2026年9月20日(日)");
    // ローカルTZに引っ張られないこと（UTC 23時でも同じ日）
    expect(formatDay("2026-09-20T23:30:00.000Z")).toBe("2026年9月20日(日)");
  });
});

describe("formatTime", () => {
  it("UTCの時:分だけを出す", () => {
    expect(formatTime("2026-09-20T10:05:00.000Z")).toBe("10:05");
    expect(formatTime(new Date("2026-09-20T23:59:00.000Z"))).toBe("23:59");
  });
});

describe("tidy", () => {
  it("行末の空白を落とし、3連以上の改行を2つへ詰め、前後をtrimする", () => {
    expect(tidy("hello  \nworld")).toBe("hello\nworld");
    expect(tidy("a\n\n\n\nb")).toBe("a\n\nb");
    expect(tidy("  \n line \t\n\n\n text \n ")).toBe("line\n\n text");
  });

  it("2連改行はそのまま", () => {
    expect(tidy("a\n\nb")).toBe("a\n\nb");
  });
});
