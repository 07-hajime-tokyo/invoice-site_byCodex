/** Runtime connection boundaries. Never include credentials or target values in errors. */
type Env = Record<string, string | undefined>;
export type AppEnvironment = "production" | "staging" | "development" | "test";

const productionSheets = {
  TRADE_SOURCE_SPREADSHEET_ID: "1yOBlT5PbKGQOILcd0LUqo0_Ql_27g6MbQLb-g5cHVyw",
  TRADE_SHIPMENT_SPREADSHEET_ID: "133cDct4krrsJDeXpO9l0fIrd3-ZYDc39u6-JpQvcxv4",
  YAHOO_LISTING_SPREADSHEET_ID: "1y6g_HJNZm_BW1X_3M3bY28ZLMR-JKD0cBhBPfIsUCKs",
} as const;
const productionSite = "https://invoice-site-bycodex.vercel.app";
const value = (env: Env, key: string) => env[key]?.trim() ?? "";

export function appEnvironment(env: Env = process.env): AppEnvironment {
  const explicit = value(env, "APP_ENV");
  const vercel = value(env, "VERCEL_ENV");
  if (
    explicit &&
    !["production", "staging", "development", "test"].includes(explicit)
  ) {
    throw new Error("Invalid APP_ENV");
  }
  if (vercel && vercel !== "production" && explicit === "production") {
    throw new Error(
      "Non-production Vercel deployments cannot use APP_ENV=production"
    );
  }
  if (vercel === "production" && explicit && explicit !== "production") {
    throw new Error("Production Vercel deployment conflicts with APP_ENV");
  }
  return (explicit ||
    (vercel === "production"
      ? "production"
      : vercel
        ? "staging"
        : env.NODE_ENV === "production"
          ? "staging"
          : env.NODE_ENV === "test"
            ? "test"
            : "development")) as AppEnvironment;
}

export function spreadsheetId(
  key: keyof typeof productionSheets,
  env: Env = process.env
): string {
  const configured = value(env, key);
  if (appEnvironment(env) === "production")
    return configured || productionSheets[key];
  if (
    Object.values(productionSheets).includes(
      configured as (typeof productionSheets)[keyof typeof productionSheets]
    )
  ) {
    throw new Error(`${key} cannot reference a production spreadsheet`);
  }
  if (!configured && value(env, "GOOGLE_SERVICE_ACCOUNT_JSON"))
    throw new Error(`${key} is required outside production`);
  return configured;
}

/** Requires an explicit credential-free target such as mysql://localhost:3306/invoice_test. */
export function assertDatabaseTarget(
  connectionString: string,
  env: Env = process.env
): void {
  if (appEnvironment(env) === "production") return;
  const allowed = value(env, "NON_PRODUCTION_DATABASE_TARGET");
  if (!allowed) throw new Error("NON_PRODUCTION_DATABASE_TARGET is required");
  try {
    const actual = new URL(connectionString);
    const target = new URL(allowed);
    const valid = (url: URL) =>
      url.protocol === "mysql:" &&
      Boolean(url.hostname) &&
      /^\/[A-Za-z0-9_-]+$/.test(url.pathname) &&
      !url.search &&
      !url.hash;
    if (
      !valid(actual) ||
      !valid(target) ||
      target.username ||
      target.password ||
      actual.hostname !== target.hostname ||
      (actual.port || "3306") !== (target.port || "3306") ||
      actual.pathname !== target.pathname
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      "Database target is not the approved non-production target"
    );
  }
}

export function gasWebhookUrl(env: Env = process.env): string {
  const url = value(env, "GAS_WEBHOOK_URL");
  if (
    appEnvironment(env) !== "production" &&
    url &&
    url !== value(env, "NON_PRODUCTION_GAS_URL")
  ) {
    throw new Error("GAS_WEBHOOK_URL must match NON_PRODUCTION_GAS_URL");
  }
  return url;
}

export function receiptAckFolderId(env: Env = process.env): string {
  const id = value(env, "RECEIPT_ACK_DRIVE_FOLDER_ID");
  if (
    appEnvironment(env) !== "production" &&
    id &&
    id !== value(env, "NON_PRODUCTION_RECEIPT_ACK_FOLDER_ID")
  ) {
    throw new Error(
      "Receipt acknowledgement folder is not approved for this environment"
    );
  }
  return id;
}

export function publicSiteUrl(env: Env = process.env): string {
  const url = value(env, "PUBLIC_SITE_URL");
  if (appEnvironment(env) === "production")
    return (url || productionSite).replace(/\/+$/, "");
  if (!url) throw new Error("PUBLIC_SITE_URL is required outside production");
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.hostname === new URL(productionSite).hostname ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    )
      throw new Error();
  } catch {
    throw new Error("PUBLIC_SITE_URL must be a non-production origin");
  }
  return parsed.origin;
}

export function assertConnectionEnvironment(env: Env = process.env): void {
  appEnvironment(env);
  if (value(env, "DATABASE_URL"))
    assertDatabaseTarget(value(env, "DATABASE_URL"), env);
  for (const key of Object.keys(productionSheets) as Array<
    keyof typeof productionSheets
  >)
    spreadsheetId(key, env);
  gasWebhookUrl(env);
  receiptAckFolderId(env);
  if (value(env, "PUBLIC_SITE_URL")) publicSiteUrl(env);
}
