import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type PoolOptions } from "mysql2";

export type AppDatabase = ReturnType<typeof drizzle>;

let _sharedPool: AppDatabase | null = null;
let _sharedPoolKey: string | null = null;
let inFlightQueries = 0;
let peakInFlight = 0;

export type DatabaseQueryMetrics = {
  inFlightAtStart: number;
  readonly peakInFlight: number;
  finish: () => void;
};

export function startDatabaseQueryMetrics(): DatabaseQueryMetrics {
  inFlightQueries += 1;
  const inFlightAtStart = inFlightQueries;
  peakInFlight = Math.max(peakInFlight, inFlightQueries);
  let finished = false;
  return {
    inFlightAtStart,
    get peakInFlight() {
      return peakInFlight;
    },
    finish() {
      if (finished) return;
      finished = true;
      inFlightQueries = Math.max(0, inFlightQueries - 1);
    },
  };
}

function readBooleanEnv(name: string): boolean | undefined {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

export function shouldRunRuntimeSchemaCheck(): boolean {
  const explicit = readBooleanEnv("RUN_RUNTIME_SCHEMA_CHECK");
  if (explicit !== undefined) return explicit;
  return process.env.NODE_ENV !== "production";
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
  if (_sharedPool && _sharedPoolKey === connectionString) return _sharedPool;
  if (_sharedPool && _sharedPoolKey !== connectionString) {
    console.warn("[Database] createDrizzleDatabase called with a different connection string; creating a separate pool");
  }

  const connectionLimit = Number(process.env.DATABASE_POOL_LIMIT ?? 10);
  const poolOptions: PoolOptions = {
    uri: connectionString,
    supportBigNumbers: true,
    waitForConnections: true,
    connectionLimit: Number.isFinite(connectionLimit) ? connectionLimit : 10,
    connectTimeout: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10000),
  };

  if (shouldUseSsl(connectionString)) {
    poolOptions.ssl = {
      minVersion: "TLSv1.2",
      rejectUnauthorized:
        readBooleanEnv("DATABASE_SSL_REJECT_UNAUTHORIZED") ?? true,
    };
  }

  const pool = drizzle(createPool(poolOptions));
  if (!_sharedPool) {
    _sharedPool = pool;
    _sharedPoolKey = connectionString;
  }
  return pool;
}
