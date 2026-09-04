import { describe, expect, it } from "vitest";
import {
  isReceiptAckDrivePayloadTooOld,
  isReceiptAckDriveTestPayload,
  validateReceiptAckDrivePayload,
} from "./receiptAckDrive";

const completePayload = {
  crawledAt: "2026-09-04T02:20:00.000Z",
  sites: [
    { site: "yahuoku", ok: true, items: [{ itemId: "h1242058001", status: "completed", isStore: true }] },
    { site: "mercari", ok: false, error: "list_not_loaded", items: [] },
    { site: "yahoo_fleamarket", ok: true, items: [{ itemId: "z612433032", status: "awaiting_review" }] },
  ],
};

describe("receiptAckDrive helpers", () => {
  it("test:true の巡回結果を判別できる", () => {
    expect(isReceiptAckDriveTestPayload({ test: true })).toBe(true);
    expect(isReceiptAckDriveTestPayload({ test: false })).toBe(false);
  });

  it("3サイト揃ったDrive巡回結果を受け付け、ok:falseを不備扱いしない", () => {
    const validated = validateReceiptAckDrivePayload(completePayload);

    expect(validated.crawledAt.toISOString()).toBe("2026-09-04T02:20:00.000Z");
    expect(validated.payload.sites.find(site => site.site === "mercari")?.ok).toBe(false);
  });

  it("crawledAt が無いDrive巡回結果は取り込まない", () => {
    expect(() => validateReceiptAckDrivePayload({ ...completePayload, crawledAt: undefined })).toThrow("crawledAt");
  });

  it("3サイト分の結果が揃っていない場合は取り込まない", () => {
    expect(() =>
      validateReceiptAckDrivePayload({
        ...completePayload,
        sites: completePayload.sites.filter(site => site.site !== "mercari"),
      })
    ).toThrow("mercari");
  });

  it("24時間を超えたDrive巡回結果を古い扱いにする", () => {
    const now = new Date("2026-09-05T02:20:01.000Z");

    expect(isReceiptAckDrivePayloadTooOld(new Date("2026-09-04T02:20:00.000Z"), now)).toBe(true);
    expect(isReceiptAckDrivePayloadTooOld(new Date("2026-09-04T02:20:01.000Z"), now)).toBe(false);
  });
});
