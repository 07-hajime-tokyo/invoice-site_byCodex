import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appEnvironment,
  assertConnectionEnvironment,
  assertDatabaseTarget,
  gasWebhookUrl,
  publicSiteUrl,
  receiptAckFolderId,
  spreadsheetId,
} from "./_core/connections";

const staging = { APP_ENV: "staging" };
const dbEnv = {
  ...staging,
  NON_PRODUCTION_DATABASE_TARGET: "mysql://localhost:3306/invoice_test",
};
afterEach(() => vi.unstubAllEnvs());

describe("connection boundaries", () => {
  it("does not treat a production-mode preview as production", () => {
    expect(
      appEnvironment({ NODE_ENV: "production", VERCEL_ENV: "preview" })
    ).toBe("staging");
    expect(appEnvironment({ NODE_ENV: "production" })).toBe("staging");
  });
  it("rejects contradictory or mistyped environments", () => {
    expect(() => appEnvironment({ APP_ENV: "prod" })).toThrow("APP_ENV");
    expect(() =>
      appEnvironment({ APP_ENV: "production", VERCEL_ENV: "preview" })
    ).toThrow();
    expect(() =>
      appEnvironment({ APP_ENV: "staging", VERCEL_ENV: "production" })
    ).toThrow();
  });
  it("preserves existing Vercel production sheet defaults", () => {
    const env = { VERCEL_ENV: "production" };
    expect(spreadsheetId("TRADE_SOURCE_SPREADSHEET_ID", env)).toBe(
      "1yOBlT5PbKGQOILcd0LUqo0_Ql_27g6MbQLb-g5cHVyw"
    );
    expect(publicSiteUrl(env)).toBe("https://invoice-site-bycodex.vercel.app");
    expect(() =>
      assertDatabaseTarget("existing-production-connection", env)
    ).not.toThrow();
  });
  it("has no implicit sheet target outside production", () => {
    expect(spreadsheetId("TRADE_SOURCE_SPREADSHEET_ID", staging)).toBe("");
    expect(() =>
      spreadsheetId("TRADE_SOURCE_SPREADSHEET_ID", {
        ...staging,
        GOOGLE_SERVICE_ACCOUNT_JSON: "configured",
      })
    ).toThrow("required");
  });
  it("rejects every known production sheet even in a different slot", () => {
    for (const key of [
      "TRADE_SOURCE_SPREADSHEET_ID",
      "TRADE_SHIPMENT_SPREADSHEET_ID",
      "YAHOO_LISTING_SPREADSHEET_ID",
    ] as const) {
      const id = spreadsheetId(key, { VERCEL_ENV: "production" });
      expect(() =>
        spreadsheetId("TRADE_SOURCE_SPREADSHEET_ID", {
          ...staging,
          TRADE_SOURCE_SPREADSHEET_ID: id,
        })
      ).toThrow("production");
    }
  });
  it("accepts a configured independent sheet", () => {
    expect(
      spreadsheetId("TRADE_SOURCE_SPREADSHEET_ID", {
        ...staging,
        TRADE_SOURCE_SPREADSHEET_ID: "dummy-sheet",
      })
    ).toBe("dummy-sheet");
  });
  it("requires explicit database approval", () => {
    expect(() =>
      assertDatabaseTarget(
        "mysql://user:secret@localhost/invoice_test",
        staging
      )
    ).toThrow("required");
  });
  it("allows credentials only in the actual connection, normalizing the default port", () => {
    expect(() =>
      assertDatabaseTarget("mysql://user:secret@localhost/invoice_test", dbEnv)
    ).not.toThrow();
  });
  it.each([
    "mysql://user:secret@other-host/invoice_test",
    "mysql://user:secret@localhost/production",
    "mysql://user:secret@localhost:3307/invoice_test",
    "mysql://user:secret@localhost/invoice_test?database=production",
    "mysql://user:secret@localhost/invoice_test#fragment",
    "https://localhost/invoice_test",
    "not a URL",
  ])("blocks unexpected database targets without leaking values", actual => {
    expect(() => assertDatabaseTarget(actual, dbEnv)).toThrow(
      "Database target is not the approved non-production target"
    );
  });
  it("rejects credentials in the approval target", () => {
    expect(() =>
      assertDatabaseTarget("mysql://localhost/invoice_test", {
        ...staging,
        NON_PRODUCTION_DATABASE_TARGET: "mysql://secret@localhost/invoice_test",
      })
    ).toThrow();
  });
  it("requires separate GAS and Drive approval", () => {
    expect(gasWebhookUrl(staging)).toBe("");
    expect(() =>
      gasWebhookUrl({
        ...staging,
        GAS_WEBHOOK_URL: "https://example.invalid/gas",
      })
    ).toThrow();
    expect(
      gasWebhookUrl({
        ...staging,
        GAS_WEBHOOK_URL: "https://example.invalid/gas",
        NON_PRODUCTION_GAS_URL: "https://example.invalid/gas",
      })
    ).toBe("https://example.invalid/gas");
    expect(() =>
      receiptAckFolderId({ ...staging, RECEIPT_ACK_DRIVE_FOLDER_ID: "folder" })
    ).toThrow();
    expect(
      receiptAckFolderId({
        ...staging,
        RECEIPT_ACK_DRIVE_FOLDER_ID: "folder",
        NON_PRODUCTION_RECEIPT_ACK_FOLDER_ID: "folder",
      })
    ).toBe("folder");
  });
  it.each([
    undefined,
    "https://invoice-site-bycodex.vercel.app/",
    "https://user:secret@example.invalid",
    "file:///tmp",
    "https://example.invalid/path",
  ])("blocks missing or unsafe public origins", url => {
    expect(() => publicSiteUrl({ ...staging, PUBLIC_SITE_URL: url })).toThrow();
  });
  it("accepts the explicit test origin", () => {
    expect(
      publicSiteUrl({ ...staging, PUBLIC_SITE_URL: "http://localhost:3000/" })
    ).toBe("http://localhost:3000");
  });
  it.each(["https://example.invalid?", "https://example.invalid#"])(
    "normalizes an empty URL delimiter to the non-production origin",
    url => {
      expect(publicSiteUrl({ ...staging, PUBLIC_SITE_URL: url })).toBe(
        "https://example.invalid"
      );
    }
  );
  it("validates configured integrations at startup", () => {
    expect(() =>
      assertConnectionEnvironment({
        ...dbEnv,
        DATABASE_URL: "mysql://localhost/production",
      })
    ).toThrow();
  });
});

describe("database factory", () => {
  it("rejects a mismatched DB before creating a network pool", async () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv(
      "NON_PRODUCTION_DATABASE_TARGET",
      "mysql://localhost/invoice_test"
    );
    const { createDrizzleDatabase } = await import("./_core/database");
    expect(() => createDrizzleDatabase("mysql://localhost/production")).toThrow(
      "approved"
    );
  });
});
