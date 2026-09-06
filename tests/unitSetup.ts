import { vi } from "vitest";

// Unit tests must not inherit the developer's live connections.
for (const key of [
  "DATABASE_URL",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GAS_WEBHOOK_URL",
  "GAS_WEBHOOK_SECRET",
  "RECEIPT_ACK_DRIVE_FOLDER_ID",
  "RECEIPT_ACK_INGEST_SECRET",
  "LOCAL_DUMP_SQL",
  "GEMINI_API_KEY",
  "BUILT_IN_FORGE_API_URL",
  "BUILT_IN_FORGE_API_KEY",
  "PUBLIC_SITE_URL",
  "TRADE_SOURCE_SPREADSHEET_ID",
  "TRADE_SHIPMENT_SPREADSHEET_ID",
  "YAHOO_LISTING_SPREADSHEET_ID",
  "VERCEL_ENV",
])
  delete process.env[key];
process.env.APP_ENV = "test";
process.env.RUN_RUNTIME_SCHEMA_CHECK = "0";
process.env.RUN_INVENTORY_ONE_TIME_REPAIRS = "0";
vi.stubGlobal(
  "fetch",
  vi.fn(() => {
    throw new Error(
      "Real fetch is disabled in unit tests; inject a test transport"
    );
  })
);
