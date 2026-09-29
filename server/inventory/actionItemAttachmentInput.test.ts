import { describe, expect, it } from "vitest";
import { ACTION_ITEM_ATTACHMENT_MAX_BYTES } from "../../shared/actionItems";
import { validateAttachments } from "./actionItemAttachmentInput";

describe("添付の保存前検証", () => {
  it("データURIと空白を取り除き、ファイル名と画像形式を正規化する", () => {
    expect(validateAttachments([{ fileName: "  a  b.png ", contentType: " IMAGE/PNG ", dataBase64: "data:image/png;base64,Y Q==\n" }])).toEqual([{ fileName: "a b.png", contentType: "image/png", dataBase64: "YQ==" }]);
  });

  it("圧縮後8MBまでは許可し1バイト超は拒否する", () => {
    const input = { contentType: "image/jpeg", dataBase64: Buffer.alloc(ACTION_ITEM_ATTACHMENT_MAX_BYTES).toString("base64") };
    expect(validateAttachments([input])[0].fileName).toBe("screenshot");
    expect(() => validateAttachments([{ ...input, dataBase64: Buffer.alloc(ACTION_ITEM_ATTACHMENT_MAX_BYTES + 1).toString("base64") }])).toThrow(/8MB/);
  });
});
