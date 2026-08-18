import { eq } from "drizzle-orm";
import { listingPhotos } from "../../drizzle/schema";
import { getDb } from "./db";

/**
 * 出品写真の保存先。
 *
 * 当初は BUILT_IN_FORGE_API_* のストレージ、次にGoogleドライブを試したが、どちらも使えなかった。
 * - Forge: 本番に鍵が無く、写真は一度も保存できていなかった（2026-08-18にログで判明）
 * - ドライブ: サービスアカウントは保存容量を持てず、逃げ道の共有ドライブは
 *   Google Workspace限定。07.hajime.tokyo は gmail.com なので作れない
 *
 * そこで、既に動いているDBへ実体を置き、認証なしのエンドポイントから配る。
 * スプレッドシートの =IMAGE() はGoogle側が取りに来るので、公開URLである必要がある。
 * 出品写真はヤフオクに載れば公開されるものだが、保存した時点で
 * URLを知っていれば見える状態になることは意識しておく。
 */
const PUBLIC_BASE_URL =
  process.env.PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
  "https://invoice-site-bycodex.vercel.app";

export function listingPhotoUrl(key: string) {
  return `${PUBLIC_BASE_URL}/api/listing-photos/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function putListingPhoto(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const labelId = key.split("/")[1] ?? null;
  const dataBase64 = body.toString("base64");

  // 撮り直しても行が増えないよう、キーで上書きする
  const [existing] = await db
    .select({ id: listingPhotos.id })
    .from(listingPhotos)
    .where(eq(listingPhotos.photoKey, key))
    .limit(1);
  if (existing) {
    await db
      .update(listingPhotos)
      .set({ contentType, dataBase64, labelId })
      .where(eq(listingPhotos.id, existing.id));
  } else {
    await db.insert(listingPhotos).values({ photoKey: key, labelId, contentType, dataBase64 });
  }
  return listingPhotoUrl(key);
}

export async function readListingPhoto(key: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(listingPhotos)
    .where(eq(listingPhotos.photoKey, key))
    .limit(1);
  if (!row) return null;
  return { contentType: row.contentType, body: Buffer.from(row.dataBase64, "base64") };
}
