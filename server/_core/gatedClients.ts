/**
 * Gated external API clients for staging environment.
 * 
 * All external writes are blocked when APP_ENV !== "production".
 * This module provides wrapped clients that enforce the gate at the choke point.
 */

import { google, type sheets_v4, type Auth } from "googleapis";
import { allowExternalWrites } from "./env";

type SheetsClient = sheets_v4.Sheets;

function logBlockedWrite(service: string, operation: string) {
  console.warn(`[staging] blocked external write: ${service} ${operation} (APP_ENV=${process.env.APP_ENV ?? 'undefined'})`);
}

/**
 * Creates a gated Google Sheets client.
 * All write methods are intercepted and blocked when allowExternalWrites() is false.
 */
export function createGatedSheetsClient(auth: Auth.GoogleAuth | Auth.JWT | Auth.OAuth2Client): SheetsClient {
  const realClient = google.sheets({ version: "v4", auth });
  
  if (allowExternalWrites()) {
    return realClient;
  }

  // In staging, use Proxy to intercept all write operations
  const gatedSpreadsheets = new Proxy(realClient.spreadsheets, {
    get(target, prop) {
      const original = target[prop as keyof typeof target];
      
      // Block write operations at spreadsheets level
      if (prop === "create") {
        return async () => {
          logBlockedWrite("Google Sheets", "spreadsheets.create");
          return { data: { spreadsheetId: "mock-staging", spreadsheetUrl: "https://staging-blocked" } };
        };
      }
      if (prop === "batchUpdate") {
        return async () => {
          logBlockedWrite("Google Sheets", "spreadsheets.batchUpdate");
          return { data: { spreadsheetId: "mock-staging", replies: [] } };
        };
      }
      
      // Intercept values namespace
      if (prop === "values" && typeof original === "object") {
        return new Proxy(original, {
          get(valuesTarget, valuesProp) {
            const valuesOriginal = valuesTarget[valuesProp as keyof typeof valuesTarget];
            
            if (valuesProp === "update") {
              return async () => {
                logBlockedWrite("Google Sheets", "spreadsheets.values.update");
                return { data: { updatedCells: 0, updatedRows: 0, updatedColumns: 0 } };
              };
            }
            if (valuesProp === "append") {
              return async () => {
                logBlockedWrite("Google Sheets", "spreadsheets.values.append");
                return { data: { updates: { updatedCells: 0, updatedRows: 0 } } };
              };
            }
            if (valuesProp === "batchUpdate") {
              return async () => {
                logBlockedWrite("Google Sheets", "spreadsheets.values.batchUpdate");
                return { data: { totalUpdatedCells: 0, responses: [] } };
              };
            }
            if (valuesProp === "clear") {
              return async () => {
                logBlockedWrite("Google Sheets", "spreadsheets.values.clear");
                return { data: { clearedRange: "" } };
              };
            }
            if (valuesProp === "batchClear") {
              return async () => {
                logBlockedWrite("Google Sheets", "spreadsheets.values.batchClear");
                return { data: { clearedRanges: [] } };
              };
            }
            
            // Allow read operations
            return valuesOriginal;
          },
        });
      }
      
      // Allow all other operations (reads)
      return original;
    },
  });

  return {
    ...realClient,
    spreadsheets: gatedSpreadsheets,
  } as SheetsClient;
}

/**
 * Gated fetch wrapper for external APIs.
 * Blocks write requests to external hosts when allowExternalWrites() is false.
 * Also blocks GAS script.google.com (GET included, as doGet can trigger writes).
 */
export async function gatedFetch(
  url: string | URL,
  init?: RequestInit
): Promise<Response> {
  const urlString = typeof url === "string" ? url : url.toString();
  const method = init?.method?.toUpperCase() || "GET";
  
  // Parse hostname
  const parsedUrl = new URL(urlString);
  const hostname = parsedUrl.hostname;
  
  // Allow localhost and internal calls
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("192.168.") || hostname.startsWith("10.")) {
    return fetch(url, init);
  }
  
  // Check if this is our own storage/API (not external)
  const storageUrl = process.env.STORAGE_API_URL || "";
  const isOwnService = storageUrl && hostname.includes(new URL(storageUrl).hostname);
  if (isOwnService) {
    return fetch(url, init);
  }
  
  // Block GAS scripts entirely (GET can trigger writes via doGet) - only in staging
  if (hostname.includes("script.google.com") || hostname.includes("apps-script.google.com")) {
    if (!allowExternalWrites()) {
      logBlockedWrite("GAS Script", `${method} ${parsedUrl.pathname}`);
      return new Response(
        JSON.stringify({ success: true, blocked: true, message: "Staging environment - GAS script blocked" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    return fetch(url, init);
  }
  
  // Allow read operations for other external APIs
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return fetch(url, init);
  }
  
  // Block writes to external APIs in staging
  if (!allowExternalWrites()) {
    const service = hostname.includes("ebay") ? "eBay API"
      : hostname.includes("fedex") ? "FedEx API"
      : hostname.includes("zaico") ? "Zaico API"
      : hostname.includes("googleapis") ? "Google API"
      : hostname.includes("frankfurter") ? "Currency API"
      : hostname.includes("chatwork") ? "Chatwork API"
      : hostname.includes("slack") ? "Slack API"
      : `External API (${hostname})`;
    
    logBlockedWrite(service, `${method} ${parsedUrl.pathname}`);
    
    // Return mock response
    return new Response(
      JSON.stringify({ success: true, blocked: true, message: "Staging environment - external write blocked" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
  
  return fetch(url, init);
}

/**
 * Type-safe wrapper that preserves fetch signature.
 */
export const safeFetch: typeof fetch = gatedFetch as typeof fetch;
