/**
 * Environment configuration for the application.
 * 
 * APP_ENV determines the deployment environment:
 * - "production": Real production environment (uses production DB, enables crons, external writes)
 * - "staging": Preview/staging environment (uses staging DB, disables crons and external writes)
 * - undefined/other: Development environment
 * 
 * VERCEL_ENV is automatically set by Vercel:
 * - "production": Production deployment
 * - "preview": Preview deployment (PR previews, branch previews)
 * - "development": Local development
 */

const APP_ENV = process.env.APP_ENV?.toLowerCase();
const VERCEL_ENV = process.env.VERCEL_ENV;

export const ENV = {
  appId: process.env.VITE_APP_ID ?? process.env.APP_ID ?? "invoice-site-bycodex",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  
  /** True if this is the real production environment */
  isProductionEnv: APP_ENV === "production",
  
  /** True if this is a staging/preview environment */
  isStagingEnv: APP_ENV === "staging" || (VERCEL_ENV === "preview" && APP_ENV !== "production"),
  
  /** True if external side effects (crons, webhooks, external API writes) should be disabled */
  disableExternalWrites: APP_ENV !== "production",
};

/** 
 * Returns true if the app should perform external side effects.
 * Use this to gate cron jobs, GAS webhooks, Google Sheets writes, eBay/FedEx/zaico writes.
 */
export function allowExternalWrites(): boolean {
  return !ENV.disableExternalWrites;
}
