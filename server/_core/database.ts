import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type PoolOptions } from "mysql2";

export type AppDatabase = ReturnType<typeof drizzle>;

function readBooleanEnv(name: string): boolean | undefined {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function shouldUseSsl(connectionString: string): boolean {
  const explicit = readBooleanEnv("DATABASE_SSL");
  if (explicit !== undefined) return explicit;

  try {
    const hostname = new URL(connectionString).hostname.toLowerCase();
    return hostname.includes("tidbcloud");
  } catch {
    return false;
  }
}

export function createDrizzleDatabase(connectionString: string): AppDatabase {
  const connectionLimit = Number(process.env.DATABASE_POOL_LIMIT ?? 10);
  const poolOptions: PoolOptions = {
    uri: connectionString,
    supportBigNumbers: true,
    waitForConnections: true,
    connectionLimit: Number.isFinite(connectionLimit) ? connectionLimit : 10,
  };

  if (shouldUseSsl(connectionString)) {
    poolOptions.ssl = {
      minVersion: "TLSv1.2",
      rejectUnauthorized:
        readBooleanEnv("DATABASE_SSL_REJECT_UNAUTHORIZED") ?? true,
    };
  }

  return drizzle(createPool(poolOptions));
}
