/**
 * External service write gates for staging environment.
 * 
 * When APP_ENV != "production", all external writes are blocked
 * to prevent staging/preview deployments from affecting production systems.
 */

type BlockedResult<T> = T & { __blocked: true; __env: string };

function logBlockedWrite(service: string, operation: string) {
  console.warn(`[staging] blocked external write: ${service} ${operation} (APP_ENV=${process.env.APP_ENV ?? 'undefined'})`);
}

/**
 * Check if external writes are allowed (runtime check).
 */
function allowExternalWritesRuntime(): boolean {
  const appEnv = process.env.APP_ENV?.trim().toLowerCase();
  return appEnv === "production";
}

/**
 * Gates Google Sheets API writes.
 * Returns a mock success response when blocked.
 */
export function gateGoogleSheetsWrite<T extends () => Promise<unknown>>(
  operation: string,
  writeOperation: T,
  mockResponse?: unknown
): T {
  return (async () => {
    if (allowExternalWritesRuntime()) {
      return writeOperation();
    }
    logBlockedWrite('Google Sheets', operation);
    return mockResponse ?? { success: true, blocked: true };
  }) as T;
}

/**
 * Gates GAS Webhook writes.
 * Should be called at the webhook endpoint level.
 */
export function gateGASWebhook(operation: string): { allowed: boolean; reason?: string } {
  if (allowExternalWritesRuntime()) {
    return { allowed: true };
  }
  logBlockedWrite('GAS Webhook', operation);
  return { 
    allowed: false, 
    reason: `GAS webhooks are disabled in staging environment (APP_ENV=${process.env.APP_ENV ?? 'undefined'})`
  };
}

/**
 * Gates cron job execution.
 * Should be called at the beginning of each cron handler.
 */
export function gateCronJob(jobName: string): { allowed: boolean; reason?: string } {
  if (allowExternalWritesRuntime()) {
    return { allowed: true };
  }
  logBlockedWrite('Cron', jobName);
  return {
    allowed: false,
    reason: `Cron jobs are disabled in staging environment (APP_ENV=${process.env.APP_ENV ?? 'undefined'})`
  };
}

/**
 * Gates FedEx API writes (shipment creation, label generation).
 */
export function gateFedExWrite<T extends () => Promise<unknown>>(
  operation: string,
  writeOperation: T,
  mockResponse?: unknown
): T {
  return (async () => {
    if (allowExternalWritesRuntime()) {
      return writeOperation();
    }
    logBlockedWrite('FedEx API', operation);
    return mockResponse ?? { success: true, blocked: true, spreadsheetStatus: 'pending' };
  }) as T;
}

/**
 * Gates Zaico API writes (create/update/delete inventory/purchases).
 * Reads are allowed. This only gates writes.
 */
export function gateZaicoWrite<T extends () => Promise<unknown>>(
  operation: string,
  writeOperation: T,
  mockResponse?: unknown
): T {
  return (async () => {
    if (allowExternalWritesRuntime()) {
      return writeOperation();
    }
    logBlockedWrite('Zaico API', operation);
    return mockResponse ?? { success: true, blocked: true };
  }) as T;
}

/**
 * Gates eBay API writes (listing create/revise/end, order updates).
 * Reads are allowed. This only gates writes.
 */
export function gateEbayWrite<T extends () => Promise<unknown>>(
  operation: string,
  writeOperation: T,
  mockResponse?: unknown
): T {
  return (async () => {
    if (allowExternalWritesRuntime()) {
      return writeOperation();
    }
    logBlockedWrite('eBay API', operation);
    return mockResponse ?? { success: true, blocked: true };
  }) as T;
}

/**
 * Gates Yahoo-related writes (listing updates, etc).
 */
export function gateYahooWrite<T extends () => Promise<unknown>>(
  operation: string,
  writeOperation: T,
  mockResponse?: unknown
): T {
  return (async () => {
    if (allowExternalWritesRuntime()) {
      return writeOperation();
    }
    logBlockedWrite('Yahoo API', operation);
    return mockResponse ?? { success: true, blocked: true };
  }) as T;
}

/**
 * Gates email/notification sends.
 */
export function gateEmailSend<T extends () => Promise<unknown>>(
  operation: string,
  sendOperation: T,
  mockResponse?: unknown
): T {
  return (async () => {
    if (allowExternalWritesRuntime()) {
      return sendOperation();
    }
    logBlockedWrite('Email/Notification', operation);
    return mockResponse ?? { success: true, blocked: true };
  }) as T;
}

/**
 * Gates generic external writes not covered by specific gates above.
 */
export function gateExternalWrite<T extends () => Promise<unknown>>(
  service: string,
  operation: string,
  writeOperation: T,
  mockResponse?: unknown
): T {
  return (async () => {
    if (allowExternalWritesRuntime()) {
      return writeOperation();
    }
    logBlockedWrite(service, operation);
    return mockResponse ?? { success: true, blocked: true };
  }) as T;
}
