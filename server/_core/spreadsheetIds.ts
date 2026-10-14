/**
 * Single Source of Truth for Google Spreadsheet IDs.
 * 
 * In production (APP_ENV=production), uses hardcoded production IDs.
 * In staging (APP_ENV=staging), uses staging IDs from environment variables.
 * If a staging ID is missing, writes are blocked rather than falling back to production.
 */

import { allowExternalWrites } from "./env";

/**
 * Production spreadsheet IDs (hardcoded).
 */
const PRODUCTION_IDS = {
  /**
   * 取引管理シート（全体）
   * - Purpose: Trade records management
   * - Tabs: "全体" (main)
   * - Read: Trade list, rates
   * - Write: New trade entries, rate updates
   */
  TRADE_MANAGEMENT: "1yOBlT5PbKGQOILcd0LUqo0_Ql_27g6MbQLb-g5cHVyw",
  
  /**
   * 取引ビュー・発送管理シート
   * - Purpose: Trade view and shipment management across multiple partners
   * - Tabs: "独発送管理", "サミー発送管理", "デボン発送管理", "サイモン発送管理", "ネレ発送管理"
   * - Read: Shipment progress, invoice status
   * - Write: Shipment progress updates, cell edits
   */
  TRADE_VIEW_SHIPMENT: "133cDct4krrsJDeXpO9l0fIrd3-ZYDc39u6-JpQvcxv4",
  
  /**
   * Yahoo出品シート
   * - Purpose: Yahoo auction listing management
   * - Tabs: "出品待ち" (listing queue)
   * - Read: Current listings
   * - Write: Upsert defective item listings
   */
  YAHOO_LISTING: "1y6g_HJNZm_BW1X_3M3bY28ZLMR-JKD0cBhBPfIsUCKs",
} as const;

type SpreadsheetName = keyof typeof PRODUCTION_IDS;

/**
 * Environment variable names for staging spreadsheet IDs.
 * Set these in Vercel Preview environment to redirect writes to staging sheets.
 */
export const STAGING_ENV_VAR_NAMES: Record<SpreadsheetName, string> = {
  TRADE_MANAGEMENT: "STAGING_SHEET_ID_TRADE_MANAGEMENT",
  TRADE_VIEW_SHIPMENT: "STAGING_SHEET_ID_TRADE_VIEW_SHIPMENT",
  YAHOO_LISTING: "STAGING_SHEET_ID_YAHOO_LISTING",
};

/**
 * Gets the spreadsheet ID for the current environment.
 * 
 * In production: returns hardcoded production ID.
 * In staging: returns ID from environment variable, or throws if not set.
 * 
 * @throws Error if staging env var is not set (prevents fallback to production)
 */
export function getSpreadsheetId(name: SpreadsheetName): string {
  if (allowExternalWrites()) {
    // Production: use hardcoded IDs
    return PRODUCTION_IDS[name];
  }
  
  // Staging: use env var or throw
  const envVarName = STAGING_ENV_VAR_NAMES[name];
  const stagingId = process.env[envVarName]?.trim();
  
  if (!stagingId) {
    throw new Error(
      `Staging spreadsheet ID not configured: ${envVarName} is not set. ` +
      `Please set this environment variable in Vercel Preview settings to a copy of the production sheet (${PRODUCTION_IDS[name]}).`
    );
  }
  
  return stagingId;
}

/**
 * Legacy exports for backwards compatibility.
 * These will resolve to staging IDs when APP_ENV=staging.
 */
export const SPREADSHEET_ID = () => getSpreadsheetId("TRADE_MANAGEMENT");
export const TRADE_VIEW_SPREADSHEET_ID = () => getSpreadsheetId("TRADE_VIEW_SHIPMENT");
export const YAHOO_LISTING_SPREADSHEET_ID = () => getSpreadsheetId("YAHOO_LISTING");

/**
 * Gets all spreadsheet configuration for documentation/setup.
 */
export function getAllSpreadsheetConfig() {
  return Object.entries(PRODUCTION_IDS).map(([name, productionId]) => ({
    name: name as SpreadsheetName,
    productionId,
    stagingEnvVar: STAGING_ENV_VAR_NAMES[name as SpreadsheetName],
    url: `https://docs.google.com/spreadsheets/d/${productionId}/edit`,
  }));
}
