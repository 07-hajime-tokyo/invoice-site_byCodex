import { google } from "googleapis";
import { ZodError, type z } from "zod";
import { RECEIPT_ACK_SITES } from "@shared/receiptAck";
import { getSystemSetting, setSystemSetting } from "./db";
import { ingestReceiptAckCrawlResult, receiptAckIngestSchema } from "./receiptAck";

const RECEIPT_ACK_DRIVE_FOLDER_NAME = "取引ハブ巡回結果";
const LAST_IMPORTED_CRAWLED_SETTING_KEY = "receiptAckDriveLastImportedCrawledAt";
export const RECEIPT_ACK_DRIVE_MAX_AGE_HOURS = 24;

type ReceiptAckIngestPayload = z.infer<typeof receiptAckIngestSchema>;

type ReceiptAckDriveFile = {
  id: string;
  name: string;
  createdTime: string | null;
};

type ValidatedReceiptAckDrivePayload = {
  payload: ReceiptAckIngestPayload;
  crawledAt: Date;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function fixServiceAccountCredentials(raw: string) {
  const credentials = JSON.parse(raw) as Record<string, unknown>;
  if (typeof credentials.private_key === "string") {
    credentials.private_key = credentials.private_key
      .replace(/-----BEGINPRIVATEKEY-----/g, "-----BEGIN PRIVATE KEY-----")
      .replace(/-----ENDPRIVATEKEY-----/g, "-----END PRIVATE KEY-----")
      .replace(/-----BEGINRSAPRIVATEKEY-----/g, "-----BEGIN RSA PRIVATE KEY-----")
      .replace(/-----ENDRSAPRIVATEKEY-----/g, "-----END RSA PRIVATE KEY-----")
      .replace(/\\n/g, "\n");
  }
  return credentials;
}

function getServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  return fixServiceAccountCredentials(raw);
}

function getReceiptAckDriveFolderId() {
  const folderId = cleanText(process.env.RECEIPT_ACK_DRIVE_FOLDER_ID);
  if (!folderId) throw new Error("RECEIPT_ACK_DRIVE_FOLDER_ID is not configured");
  return folderId;
}

function getServiceAccountInfo() {
  try {
    const credentials = getServiceAccountCredentials() as { client_email?: string; project_id?: string };
    return {
      email: credentials.client_email ?? "不明",
      projectId: credentials.project_id ?? "不明",
    };
  } catch {
    return { email: "不明", projectId: "不明" };
  }
}

function getDriveAccessError(error: unknown, folderId: string) {
  const message = error instanceof Error ? error.message : String(error);
  const status = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  const serviceAccount = getServiceAccountInfo();

  if (status === "403" || message.toLowerCase().includes("permission")) {
    return new Error(
      `Google Driveの権限がありません。DriveフォルダID ${folderId}（${RECEIPT_ACK_DRIVE_FOLDER_NAME}）を ` +
        `${serviceAccount.email} に閲覧者権限で共有してください。` +
        `Vercelのサービスアカウント project_id: ${serviceAccount.projectId}。詳細: ${message}`
    );
  }

  if (status === "404" || message.toLowerCase().includes("not found")) {
    return new Error(
      `Google Driveのフォルダまたは巡回結果ファイルが見つかりません。DriveフォルダID ${folderId}（${RECEIPT_ACK_DRIVE_FOLDER_NAME}）が正しいか、` +
        `${serviceAccount.email} に閲覧者権限で共有されているか確認してください。詳細: ${message}`
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function getReceiptAckDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: getServiceAccountCredentials(),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

function quoteDriveQueryLiteral(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

async function listReceiptAckDriveFiles(folderId: string): Promise<ReceiptAckDriveFile[]> {
  const drive = getReceiptAckDriveClient();
  const response = await drive.files
    .list({
      q: [
        `${quoteDriveQueryLiteral(folderId)} in parents`,
        "trashed = false",
        "mimeType = 'application/json'",
        "name contains 'receipt-ack-'",
      ].join(" and "),
      orderBy: "createdTime desc",
      pageSize: 20,
      fields: "files(id,name,createdTime)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    .catch(error => {
      throw getDriveAccessError(error, folderId);
    });

  return (response.data.files ?? [])
    .map(file => ({
      id: cleanText(file.id),
      name: cleanText(file.name) || "名前なし",
      createdTime: file.createdTime ?? null,
    }))
    .filter(file => file.id);
}

function driveMediaToString(value: unknown) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return JSON.stringify(value);
}

async function downloadReceiptAckDriveFile(folderId: string, file: ReceiptAckDriveFile) {
  const drive = getReceiptAckDriveClient();
  const response = await drive.files
    .get(
      {
        fileId: file.id,
        alt: "media",
        supportsAllDrives: true,
      },
      { responseType: "text" }
    )
    .catch(error => {
      throw getDriveAccessError(error, folderId);
    });
  return driveMediaToString(response.data);
}

function formatZodIssues(error: ZodError) {
  return error.issues.map(issue => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

function parseJsonFile(text: string, file: ReceiptAckDriveFile) {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Drive巡回結果JSONをパースできません (${file.name}): ${message}`);
  }
}

function parseRequiredCrawledAt(value: unknown) {
  const raw = cleanText(value);
  if (!raw) throw new Error("Drive巡回結果に crawledAt がありません");
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Drive巡回結果の crawledAt が不正です: ${raw}`);
  return parsed;
}

function parseStoredDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isReceiptAckDriveTestPayload(rawPayload: unknown) {
  return Boolean(rawPayload && typeof rawPayload === "object" && (rawPayload as { test?: unknown }).test === true);
}

export function validateReceiptAckDrivePayload(rawPayload: unknown): ValidatedReceiptAckDrivePayload {
  const parsed = receiptAckIngestSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new Error(`Drive巡回結果の形式が正しくありません: ${formatZodIssues(parsed.error)}`);
  }

  const crawledAt = parseRequiredCrawledAt(parsed.data.crawledAt);
  const siteSet = new Set(parsed.data.sites.map(siteResult => siteResult.site));
  const missingSites = RECEIPT_ACK_SITES.filter(site => !siteSet.has(site));
  if (missingSites.length > 0) {
    throw new Error(`Drive巡回結果に必要なサイトが不足しています: ${missingSites.join(", ")}`);
  }

  return { payload: parsed.data, crawledAt };
}

export function isReceiptAckDrivePayloadTooOld(crawledAt: Date, now = new Date(), maxAgeHours = RECEIPT_ACK_DRIVE_MAX_AGE_HOURS) {
  return now.getTime() - crawledAt.getTime() > maxAgeHours * 60 * 60 * 1000;
}

function fileSummary(file: ReceiptAckDriveFile) {
  return {
    id: file.id,
    name: file.name,
    createdTime: file.createdTime,
  };
}

export async function importReceiptAckFromDrive(now = new Date()) {
  const folderId = getReceiptAckDriveFolderId();
  const files = await listReceiptAckDriveFiles(folderId);
  if (files.length === 0) {
    return {
      ok: true,
      imported: false,
      status: "not_arrived",
      message: "受取連絡の巡回結果ファイルはまだ届いていません",
      folderId,
      checkedFiles: 0,
      skippedTestFiles: 0,
    };
  }

  let skippedTestFiles = 0;
  for (const file of files) {
    const text = await downloadReceiptAckDriveFile(folderId, file);
    const rawPayload = parseJsonFile(text, file);
    if (isReceiptAckDriveTestPayload(rawPayload)) {
      skippedTestFiles += 1;
      continue;
    }

    const { payload, crawledAt } = validateReceiptAckDrivePayload(rawPayload);
    const lastImported = parseStoredDate(await getSystemSetting(LAST_IMPORTED_CRAWLED_SETTING_KEY));
    if (lastImported && crawledAt.getTime() <= lastImported.getTime()) {
      return {
        ok: true,
        imported: false,
        status: "already_imported",
        message: "この巡回結果はすでに取り込み済みです",
        folderId,
        file: fileSummary(file),
        crawledAt: crawledAt.toISOString(),
        lastImportedCrawledAt: lastImported.toISOString(),
        checkedFiles: skippedTestFiles + 1,
        skippedTestFiles,
      };
    }

    if (isReceiptAckDrivePayloadTooOld(crawledAt, now)) {
      return {
        ok: true,
        imported: false,
        status: "stale",
        warning: `Drive巡回結果の crawledAt が ${RECEIPT_ACK_DRIVE_MAX_AGE_HOURS} 時間以上前のため取り込みません`,
        folderId,
        file: fileSummary(file),
        crawledAt: crawledAt.toISOString(),
        maxAgeHours: RECEIPT_ACK_DRIVE_MAX_AGE_HOURS,
        checkedFiles: skippedTestFiles + 1,
        skippedTestFiles,
      };
    }

    const result = await ingestReceiptAckCrawlResult(payload);
    await setSystemSetting(LAST_IMPORTED_CRAWLED_SETTING_KEY, crawledAt.toISOString());

    return {
      ok: true,
      imported: true,
      status: "imported",
      folderId,
      file: fileSummary(file),
      crawledAt: crawledAt.toISOString(),
      lastImportedCrawledAt: crawledAt.toISOString(),
      checkedFiles: skippedTestFiles + 1,
      skippedTestFiles,
      result,
    };
  }

  return {
    ok: true,
    imported: false,
    status: "no_production_file",
    message: "本番取り込み対象の巡回結果ファイルはまだ届いていません",
    folderId,
    checkedFiles: files.length,
    skippedTestFiles,
  };
}
