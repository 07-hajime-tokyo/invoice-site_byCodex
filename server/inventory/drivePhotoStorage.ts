import { Readable } from "node:stream";
import { google } from "googleapis";

/**
 * 出品写真の保存先。Googleドライブの専用フォルダへ置く。
 *
 * 以前は BUILT_IN_FORGE_API_* のストレージを使う作りだったが、本番にその鍵が
 * 設定されておらず、写真は一度も保存できていなかった（2026-08-18にログで判明）。
 * スプレッドシートで既に動いているサービスアカウントを使い回す形へ寄せた。
 *
 * スプレッドシートの =IMAGE() で表示するため、各ファイルは「リンクを知っている全員」に
 * 読み取りを許可する。出品写真なのでヤフオクに載る時点で公開されるが、
 * 保存した時点で公開になることは意識しておく。
 */
export const YAHOO_PHOTO_FOLDER_ID = "19HDoGqLHcqPDLPpVy1x0KV9bQbh2pP2M";

function getServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getDriveClient() {
  const credentials = getServiceAccountCredentials();
  if (!credentials) return null;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

type DriveClient = NonNullable<ReturnType<typeof getDriveClient>>;

/** 同じ名前のファイルが既にあれば中身を差し替える。撮り直しで二重に増やさないため */
async function findExisting(drive: DriveClient, name: string) {
  const escaped = name.replace(/'/g, "\'");
  const response = await drive.files.list({
    q: `name = '${escaped}' and '${YAHOO_PHOTO_FOLDER_ID}' in parents and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return response.data.files?.[0]?.id ?? null;
}

export async function putYahooListingPhoto(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const drive = getDriveClient();
  if (!drive) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSONが未設定です");

  // key は defective/ABC1234/01.jpg 形式。ドライブは階層を作らずファイル名へ畳む
  const name = key.replace(/^defective\//, "").replace(/\//g, "_");
  const existingId = await findExisting(drive, name);
  const media = { mimeType: contentType, body: Readable.from(body) };

  const fileId = existingId
    ? (
        await drive.files.update({
          fileId: existingId,
          media,
          fields: "id",
          supportsAllDrives: true,
        })
      ).data.id
    : (
        await drive.files.create({
          requestBody: { name, parents: [YAHOO_PHOTO_FOLDER_ID] },
          media,
          fields: "id",
          supportsAllDrives: true,
        })
      ).data.id;

  if (!fileId) throw new Error("Googleドライブへ写真を保存できませんでした");

  if (!existingId) {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    });
  }

  // =IMAGE() から読める直リンク。drive.google.com/uc は失敗することがある
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}
