import { google } from "googleapis";
import type { DefectiveSheetPayload } from "./defectiveListing";

/**
 * ヤフオク出品用スプレッドシート。仕入れ候補とは別ファイルにしている。
 * GASは経由せず、サービスアカウントでSheets APIを直接叩く。
 * 共有ドライブ 0AM4oG1O4rVpLUk9PVA の中にあるので、サービスアカウントは
 * ドライブのメンバー権限でそのまま書き込める（個別共有は不要）。
 */
export const YAHOO_LISTING_SPREADSHEET_ID =
  "1y6g_HJNZm_BW1X_3M3bY28ZLMR-JKD0cBhBPfIsUCKs";

export const YAHOO_LISTING_SHEET_NAME = "出品待ち";

/** サイトが毎回上書きする列 */
const SITE_HEADERS = [
  "商品ID", "検品日", "商品名", "出品区分", "不良タグ", "不良メモ",
  "写真1", "写真2", "写真3", "写真4", "写真5",
  "写真6", "写真7", "写真8", "写真9", "写真10",
  "写真枚数", "仕入単価", "検索キーワード", "落札相場リンク",
  "相場_採用件数", "相場_中央値", "相場_最安", "相場_最高",
  "落札実績1", "落札実績2", "落札実績3", "落札実績4", "落札実績5",
  "相場取得日", "出品タイトル案", "出品説明案", "発送状況", "発送日",
] as const;

/** 人が入れる列。サイトからは絶対に書かない */
const HUMAN_HEADERS = ["開始価格", "出品ステータス", "出品URL", "落札額"] as const;

const ALL_HEADERS = [...SITE_HEADERS, ...HUMAN_HEADERS];

/** Googleスプレッドシートの既定の行の高さ */
const DEFAULT_ROW_HEIGHT_PX = 21;
/**
 * 写真がある行だけ少し高くする。
 * 既定の21pxだと =IMAGE() が21px角のサムネイルになり、撮れているかを一覧で判別できない。
 * 説明文は折り返さないので、伸びるのは写真のある行だけで済む（村上さん指示・2026-08-18）。
 */
const PHOTO_ROW_HEIGHT_PX = 60;

export function yahooListingSheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${YAHOO_LISTING_SPREADSHEET_ID}/edit`;
}

function getServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getSheetsClient() {
  const credentials = getServiceAccountCredentials();
  if (!credentials) return null;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function formulaText(value: unknown) {
  return String(value ?? "").replace(/"/g, '""');
}

function imageCell(url: string | undefined) {
  // モード4（高さ・幅指定）だと行が伸びる。既定のモード1はセルに合わせて縮む
  return url ? `=IMAGE("${formulaText(url)}")` : "";
}

function sampleCell(sample: DefectiveSheetPayload["samples"][number] | undefined) {
  if (!sample) return "";
  const endedAt = sample.endedAt ? sample.endedAt.slice(0, 10) : "";
  const label = [
    sample.title,
    `${Math.round(Number(sample.price ?? 0)).toLocaleString("ja-JP")}円`,
    `${Number(sample.bids ?? 0)}入札`,
    endedAt,
  ].join(" / ");
  // 終了したオークションの個別ページはYahooが消すので、リンクしても404になる
  // （2026-08-18に3つのURL形式で実測）。落札相場の検索結果へ飛ばすと後からでも見られる
  const search = new URL("https://auctions.yahoo.co.jp/closedsearch/closedsearch");
  search.searchParams.set("p", sample.title);
  search.searchParams.set("va", sample.title);
  return `=HYPERLINK("${formulaText(search.toString())}","${formulaText(label)}")`;
}

/** 検索語そのものの落札一覧へのリンク。実績5件だけでは判断できないときに開く */
function closedSearchCell(keyword: string) {
  if (!keyword) return "";
  const search = new URL("https://auctions.yahoo.co.jp/closedsearch/closedsearch");
  search.searchParams.set("p", keyword);
  search.searchParams.set("va", keyword);
  search.searchParams.set("b", "1");
  search.searchParams.set("n", "100");
  return `=HYPERLINK("${formulaText(search.toString())}","落札一覧を開く")`;
}

function japanDate(value: string | undefined, withTime = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1_000);
  const day = jst.toISOString().slice(0, 10);
  return withTime ? `${day} ${jst.toISOString().slice(11, 16)}` : day;
}

function siteCells(payload: DefectiveSheetPayload): Record<string, string | number> {
  const photos = payload.photos ?? [];
  const samples = payload.samples ?? [];
  return {
    商品ID: payload.productId,
    検品日: japanDate(payload.inspectedAt),
    商品名: payload.productName,
    出品区分: payload.listingKind,
    不良タグ: payload.defectTags,
    不良メモ: payload.defectNote,
    写真1: imageCell(photos[0]),
    写真2: imageCell(photos[1]),
    写真3: imageCell(photos[2]),
    写真4: imageCell(photos[3]),
    写真5: imageCell(photos[4]),
    写真6: imageCell(photos[5]),
    写真7: imageCell(photos[6]),
    写真8: imageCell(photos[7]),
    写真9: imageCell(photos[8]),
    写真10: imageCell(photos[9]),
    写真枚数: payload.photoCount,
    仕入単価: payload.unitPrice ?? "",
    検索キーワード: payload.keyword,
    落札相場リンク: closedSearchCell(payload.keyword),
    相場_採用件数: payload.adoptedCount,
    相場_中央値: payload.median,
    相場_最安: payload.marketMin,
    相場_最高: payload.marketMax,
    落札実績1: sampleCell(samples[0]),
    落札実績2: sampleCell(samples[1]),
    落札実績3: sampleCell(samples[2]),
    落札実績4: sampleCell(samples[3]),
    落札実績5: sampleCell(samples[4]),
    相場取得日: japanDate(payload.fetchedAt, true),
    出品タイトル案: payload.listingTitle,
    出品説明案: payload.listingDescription,
    発送状況: payload.shipmentStatus,
    発送日: payload.shippedOn,
  };
}

type SheetsClient = NonNullable<ReturnType<typeof getSheetsClient>>;

async function ensureSheet(sheets: SheetsClient) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: YAHOO_LISTING_SPREADSHEET_ID,
    fields: "sheets.properties(sheetId,title)",
  });
  const existing = (metadata.data.sheets ?? []).find(
    sheet => sheet.properties?.title === YAHOO_LISTING_SHEET_NAME
  );
  if (existing?.properties?.sheetId != null) {
    return existing.properties.sheetId;
  }
  const created = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: YAHOO_LISTING_SPREADSHEET_ID,
    requestBody: {
      requests: [
        { addSheet: { properties: { title: YAHOO_LISTING_SHEET_NAME } } },
      ],
    },
  });
  const sheetId =
    created.data.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
  if (sheetId == null) throw new Error("出品待ちシートを作成できませんでした");
  return sheetId;
}

async function ensureHeaders(sheets: SheetsClient, sheetId: number) {
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: YAHOO_LISTING_SPREADSHEET_ID,
    range: `${YAHOO_LISTING_SHEET_NAME}!1:1`,
  });
  const headers = (current.data.values?.[0] ?? []).map(value => String(value));
  const merged = [...headers];
  for (const header of ALL_HEADERS) {
    if (!merged.includes(header)) merged.push(header);
  }
  if (merged.length !== headers.length || merged.some((h, i) => h !== headers[i])) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: YAHOO_LISTING_SPREADSHEET_ID,
      range: `${YAHOO_LISTING_SHEET_NAME}!1:1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [merged] },
    });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: YAHOO_LISTING_SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
        ],
      },
    });
  }
  return merged;
}

function columnLetter(index: number) {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/**
 * 商品IDを一意キーにした upsert。
 * 人が入れる4列（開始価格・出品ステータス・出品URL・落札額）には触らないので、
 * 何度送り直しても消えない。折り返しは付けないので行の高さは既定のまま。
 */
export async function writeYahooListingRow(payload: DefectiveSheetPayload) {
  const sheets = getSheetsClient();
  if (!sheets) {
    return { success: false, message: "GOOGLE_SERVICE_ACCOUNT_JSONが未設定" };
  }
  try {
    const sheetId = await ensureSheet(sheets);
    const headers = await ensureHeaders(sheets, sheetId);

    const productIdColumn = headers.indexOf("商品ID");
    const idRange = `${YAHOO_LISTING_SHEET_NAME}!${columnLetter(productIdColumn)}2:${columnLetter(productIdColumn)}`;
    const existingIds = await sheets.spreadsheets.values.get({
      spreadsheetId: YAHOO_LISTING_SPREADSHEET_ID,
      range: idRange,
    });
    const rows = existingIds.data.values ?? [];
    const matchIndex = rows.findIndex(
      row => String(row[0] ?? "").trim() === String(payload.productId).trim()
    );
    // 新しく足したものは一番上に来てほしい（村上さん指示・2026-08-18）。
    // 既存行は1つ下へずれるが、人が入れた4列も行ごと動くので対応関係は崩れない
    if (matchIndex < 0 && rows.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: YAHOO_LISTING_SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 },
                inheritFromBefore: false,
              },
            },
          ],
        },
      });
    }
    const targetRow = matchIndex >= 0 ? matchIndex + 2 : 2;

    // サイト側の列だけを1セルずつ狙って書く。人の列は範囲に含めない
    const cells = siteCells(payload);
    const data = SITE_HEADERS.map(header => {
      const column = headers.indexOf(header);
      return {
        range: `${YAHOO_LISTING_SHEET_NAME}!${columnLetter(column)}${targetRow}`,
        values: [[cells[header] ?? ""]],
      };
    }).filter(entry => !entry.range.includes("!undefined"));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: YAHOO_LISTING_SPREADSHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });

    // 説明文には改行が入るので、書いた直後にSheetsが行を自動で高くする。
    // 折り返しを切るだけでは既に付いた高さは戻らないため、高さも既定値へ戻す。
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: YAHOO_LISTING_SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: targetRow - 1,
                endRowIndex: targetRow,
                startColumnIndex: 0,
                endColumnIndex: headers.length,
              },
              cell: { userEnteredFormat: { wrapStrategy: "CLIP" } },
              fields: "userEnteredFormat.wrapStrategy",
            },
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: targetRow - 1,
                endIndex: targetRow,
              },
              properties: {
                pixelSize:
                  (payload.photos?.length ?? 0) > 0
                    ? PHOTO_ROW_HEIGHT_PX
                    : DEFAULT_ROW_HEIGHT_PX,
              },
              fields: "pixelSize",
            },
          },
        ],
      },
    });

    return { success: true, row: targetRow, productId: payload.productId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message };
  }
}
