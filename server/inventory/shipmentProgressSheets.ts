import {
  type TradeShipmentProgressEntry,
  parseShipmentProgressSheetRows,
} from "@shared/tradeSheetStatus";
import { google } from "googleapis";

const TRADE_SHIPMENT_SPREADSHEET_ID =
  "133cDct4krrsJDeXpO9l0fIrd3-ZYDc39u6-JpQvcxv4";

const TRADE_SHIPMENT_SHEET_NAME_KEYWORD = "発送管理";

let orderManagementShipmentProgressCache: {
  expiresAt: number;
  data: Map<string, TradeShipmentProgressEntry[]>;
} | null = null;

function fixGoogleServiceAccountJson(raw: string) {
  const credentials = JSON.parse(raw);
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key
      .replace(/-----BEGINPRIVATEKEY-----/g, "-----BEGIN PRIVATE KEY-----")
      .replace(/-----ENDPRIVATEKEY-----/g, "-----END PRIVATE KEY-----")
      .replace(
        /-----BEGINRSAPRIVATEKEY-----/g,
        "-----BEGIN RSA PRIVATE KEY-----"
      )
      .replace(/-----ENDRSAPRIVATEKEY-----/g, "-----END RSA PRIVATE KEY-----")
      .replace(/\\n/g, "\n");
  }
  return credentials;
}

function getInventorySheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const auth = new google.auth.GoogleAuth({
    credentials: fixGoogleServiceAccountJson(raw),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function getShipmentSheetAccessError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  if (status === "403" || message.toLowerCase().includes("permission")) {
    return new Error(
      `Google Sheetsの権限がありません。スプシID ${TRADE_SHIPMENT_SPREADSHEET_ID} をサービスアカウントに共有してください。詳細: ${message}`
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function quoteShipmentSheetName(sheetName: string) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function isShipmentProgressSheet(sheet: { title: string; hidden?: boolean }) {
  return (
    Boolean(sheet.title) &&
    !sheet.hidden &&
    sheet.title.includes(TRADE_SHIPMENT_SHEET_NAME_KEYWORD)
  );
}

export async function getOrderManagementShipmentProgressByInvoice() {
  const sheets = getInventorySheetsClient();
  if (!sheets) return new Map<string, TradeShipmentProgressEntry[]>();

  const now = Date.now();
  if (
    orderManagementShipmentProgressCache &&
    orderManagementShipmentProgressCache.expiresAt > now
  ) {
    return orderManagementShipmentProgressCache.data;
  }

  const metadata = await sheets.spreadsheets
    .get({
      spreadsheetId: TRADE_SHIPMENT_SPREADSHEET_ID,
      fields: "sheets.properties(title,index,hidden)",
    })
    .catch(error => {
      throw getShipmentSheetAccessError(error);
    });

  const tabs = (metadata.data.sheets ?? [])
    .map(sheet => ({
      title: sheet.properties?.title ?? "",
      index: sheet.properties?.index ?? 0,
      hidden: sheet.properties?.hidden ?? false,
    }))
    .filter(isShipmentProgressSheet)
    .sort((a, b) => a.index - b.index);

  if (tabs.length === 0) {
    const empty = new Map<string, TradeShipmentProgressEntry[]>();
    orderManagementShipmentProgressCache = {
      expiresAt: now + 20_000,
      data: empty,
    };
    return empty;
  }

  const response = await sheets.spreadsheets.values
    .batchGet({
      spreadsheetId: TRADE_SHIPMENT_SPREADSHEET_ID,
      ranges: tabs.map(tab => `${quoteShipmentSheetName(tab.title)}!B:G`),
      valueRenderOption: "FORMATTED_VALUE",
    })
    .catch(error => {
      throw getShipmentSheetAccessError(error);
    });

  const progressByInvoice = parseShipmentProgressSheetRows(
    (response.data.valueRanges ?? []).map(valueRange => valueRange.values ?? [])
  );
  orderManagementShipmentProgressCache = {
    expiresAt: now + 20_000,
    data: progressByInvoice,
  };
  return progressByInvoice;
}
