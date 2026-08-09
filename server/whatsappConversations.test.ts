import { describe, expect, it } from "vitest";
import {
  isOwnerSender,
  looksJapanese,
  makeDedupeKey,
  parseWhatsAppExport,
} from "./whatsappConversations";

describe("parseWhatsAppExport", () => {
  it("WhatsApp Web形式（[時刻, 日付]）を読む", () => {
    const raw = [
      "[13:32, 2026/7/25] Simon traut: Thank You very much and no Problem",
      "[15:48, 2026/7/25] 自分: You're welcome!",
    ].join("\n");

    const messages = parseWhatsAppExport(raw);
    expect(messages).toHaveLength(2);
    expect(messages[0].sender).toBe("Simon traut");
    expect(messages[0].body).toBe("Thank You very much and no Problem");
    expect(messages[0].sentAt.toISOString()).toBe("2026-07-25T13:32:00.000Z");
    expect(messages[1].sender).toBe("自分");
  });

  it("iOS書き出し形式（[日付, 時刻:秒]）を読む", () => {
    const messages = parseWhatsAppExport("[2026/07/25, 13:32:05] Simon traut: hello");
    expect(messages).toHaveLength(1);
    expect(messages[0].sentAt.toISOString()).toBe("2026-07-25T13:32:05.000Z");
  });

  it("Android書き出し形式（日付, 時刻 - 送信者:）を読む", () => {
    const messages = parseWhatsAppExport("2026/07/25, 13:32 - Simon traut: hello");
    expect(messages).toHaveLength(1);
    expect(messages[0].sender).toBe("Simon traut");
    expect(messages[0].body).toBe("hello");
  });

  it("複数行の本文をひとつのメッセージにまとめる", () => {
    const raw = [
      "[18:38, 2026/8/6] Simon traut: Hello guys,",
      "",
      "We'd like to place another order.",
      "",
      "10x 3DS LL",
      "[20:35, 2026/8/6] 自分: Understood.",
    ].join("\n");

    const messages = parseWhatsAppExport(raw);
    expect(messages).toHaveLength(2);
    expect(messages[0].body).toContain("We'd like to place another order.");
    expect(messages[0].body).toContain("10x 3DS LL");
    expect(messages[1].body).toBe("Understood.");
  });

  it("システム行と空メッセージを落とす", () => {
    const raw = [
      "[10:00, 2026/8/1] Simon traut: Messages and calls are end-to-end encrypted.",
      "[10:01, 2026/8/1] Simon traut: このメッセージは削除されました",
      "[10:02, 2026/8/1] Simon traut: 本題です",
    ].join("\n");

    const messages = parseWhatsAppExport(raw);
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe("本題です");
  });

  it("本文にコロンが含まれていても壊れない", () => {
    const messages = parseWhatsAppExport("[9:05, 2026/8/1] Simon traut: Tracking: 779736697458");
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe("Tracking: 779736697458");
  });

  it("ヘッダのない行だけなら0件を返す", () => {
    expect(parseWhatsAppExport("just some text\nwithout headers")).toHaveLength(0);
  });
});

describe("isOwnerSender", () => {
  it("自分の名義を判定する", () => {
    expect(isOwnerSender("自分")).toBe(true);
    expect(isOwnerSender("Hajime")).toBe(true);
    expect(isOwnerSender("村上")).toBe(true);
    expect(isOwnerSender("Simon traut")).toBe(false);
  });

  it("追加の名義を受け付ける", () => {
    expect(isOwnerSender("Tokyo Media", ["Tokyo Media"])).toBe(true);
  });
});

describe("looksJapanese", () => {
  it("日本語は翻訳不要と判定する", () => {
    expect(looksJapanese("了解しました。明日発送します")).toBe(true);
    expect(looksJapanese("👍")).toBe(true);
  });

  it("英語は翻訳対象と判定する", () => {
    expect(looksJapanese("We'd like to place another order")).toBe(false);
  });
});

describe("makeDedupeKey", () => {
  it("同じ内容なら同じキー、違えば別のキーになる", () => {
    const at = new Date("2026-08-01T10:00:00Z");
    const a = makeDedupeKey("ConsoleBros", at, "hello");
    const b = makeDedupeKey("ConsoleBros", at, "hello");
    const c = makeDedupeKey("ConsoleBros", at, "hello!");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(32);
  });
});
