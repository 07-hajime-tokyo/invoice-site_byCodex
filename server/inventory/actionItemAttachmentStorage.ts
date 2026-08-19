import { eq } from "drizzle-orm";
import { actionItemAttachments } from "../../drizzle/schema";
import { getDb } from "./db";

export function actionItemAttachmentUrl(id: number) {
  return `/api/action-item-attachments/${encodeURIComponent(String(id))}`;
}

export async function readActionItemAttachment(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(actionItemAttachments)
    .where(eq(actionItemAttachments.id, id))
    .limit(1);
  if (!row) return null;
  return { contentType: row.contentType, body: Buffer.from(row.dataBase64, "base64") };
}
