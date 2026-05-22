import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

function readBooleanEnv(name: string): boolean | undefined {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function shouldUseSsl(url: URL): boolean {
  const explicit = readBooleanEnv("DATABASE_SSL");
  if (explicit !== undefined) return explicit;
  return url.hostname.toLowerCase().includes("tidbcloud");
}

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getDbCredentials() {
  try {
    const url = new URL(connectionString);
    const database = decodeUrlPart(url.pathname.replace(/^\//, ""));
    if (!url.hostname || !database) {
      return { url: connectionString };
    }

    const credentials: {
      host: string;
      port?: number;
      user?: string;
      password?: string;
      database: string;
      ssl?: { minVersion: string; rejectUnauthorized: boolean };
    } = {
      host: url.hostname,
      database,
    };

    if (url.port) credentials.port = Number(url.port);
    if (url.username) credentials.user = decodeUrlPart(url.username);
    if (url.password) credentials.password = decodeUrlPart(url.password);
    if (shouldUseSsl(url)) {
      credentials.ssl = {
        minVersion: "TLSv1.2",
        rejectUnauthorized:
          readBooleanEnv("DATABASE_SSL_REJECT_UNAUTHORIZED") ?? true,
      };
    }

    return credentials;
  } catch {
    return { url: connectionString };
  }
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: getDbCredentials(),
});
