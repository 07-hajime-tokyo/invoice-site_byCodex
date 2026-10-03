import { z } from "zod";
import {
  ACTION_ITEM_ATTACHMENT_MAX_BYTES as MAX_ATTACHMENT_BYTES,
  normalizeActionItemSingleLineText,
} from "@shared/actionItems";

export const MAX_ATTACHMENTS_PER_REQUEST = 10;

const MAX_ATTACHMENT_BASE64_LENGTH = 12 * 1024 * 1024;

const allowedImageTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export const actionItemAttachmentInputSchema = z.object({
  fileName: z.string().max(255).optional(),
  contentType: z.string().min(1).max(100),
  dataBase64: z.string().min(1).max(MAX_ATTACHMENT_BASE64_LENGTH),
});

function cleanBase64(value: string) {
  return value.replace(/^data:[^;]+;base64,/i, "").replace(/\s/g, "");
}

function validateAttachment(
  input: z.infer<typeof actionItemAttachmentInputSchema>
) {
  const contentType = input.contentType.trim().toLowerCase();
  if (!allowedImageTypes.has(contentType)) {
    throw new Error("添付できるのは画像ファイルだけです");
  }
  const dataBase64 = cleanBase64(input.dataBase64);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
    throw new Error("画像データの形式が正しくありません");
  }
  const byteLength = Buffer.byteLength(dataBase64, "base64");
  if (byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error("添付画像は1枚8MB以下にしてください");
  }
  return {
    fileName: normalizeActionItemSingleLineText(input.fileName ?? "") || "screenshot",
    contentType,
    dataBase64,
  };
}

type ValidatedAttachmentInput = ReturnType<typeof validateAttachment>;

export function validateAttachments(
  attachments: Array<z.infer<typeof actionItemAttachmentInputSchema>>
) {
  if (attachments.length > MAX_ATTACHMENTS_PER_REQUEST) {
    throw new Error(`添付は1回${MAX_ATTACHMENTS_PER_REQUEST}枚までです`);
  }
  return attachments.map(validateAttachment);
}

export function buildAttachmentRows(
  actionItemId: number,
  attachments: ValidatedAttachmentInput[],
  createdBy: string | null
) {
  return attachments.map(attachment => ({
    actionItemId,
    ...attachment,
    createdBy,
  }));
}
