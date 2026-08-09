import { eq, sql } from "drizzle-orm";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';
import { createDrizzleDatabase, type AppDatabase } from "./_core/database";

let _db: AppDatabase | null = null;
let _schemaReady: Promise<void> | null = null;

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
    } else if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (typeof record.message === "string") parts.push(record.message);
      if (typeof record.code === "string") parts.push(record.code);
      current = record.cause;
    } else {
      parts.push(String(current));
      current = undefined;
    }
  }
  return parts.join(" ");
}

function isAlreadyAppliedError(message: string): boolean {
  return (
    message.includes("Duplicate column") ||
    message.includes("ER_DUP_FIELDNAME") ||
    message.includes("already exists") ||
    message.includes("1060")
  );
}

async function ensureShipmentItemsTradeRecordId(db: AppDatabase) {
  const existing = await db.execute(sql`SHOW COLUMNS FROM shipment_items LIKE 'tradeRecordId'`);
  const rows = Array.isArray(existing) ? existing : ((existing as { rows?: unknown[] }).rows ?? []);
  if (Array.isArray(rows) && rows.length > 0) return;
  await db.execute(sql`ALTER TABLE shipment_items ADD COLUMN tradeRecordId int`);
}

/**
 * WhatsApp会話履歴のテーブル（drizzle/0023）。
 * 本番は `pnpm db:push` を回さずGitHub連携デプロイだけで上がるので、
 * 起動時に IF NOT EXISTS で作っておく。
 */
async function ensureWhatsappConversationTables(db: AppDatabase) {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS whatsapp_conversations (
      id int AUTO_INCREMENT PRIMARY KEY NOT NULL,
      name varchar(255) NOT NULL,
      isGroup boolean NOT NULL DEFAULT false,
      lastMessageAt timestamp NULL,
      firstMessageAt timestamp NULL,
      importedAt timestamp NULL,
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT whatsapp_conversations_name_unique UNIQUE(name)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id int AUTO_INCREMENT PRIMARY KEY NOT NULL,
      conversationId int NOT NULL,
      sender varchar(255) NOT NULL,
      isOutgoing boolean NOT NULL DEFAULT false,
      sentAt timestamp NOT NULL,
      body mediumtext NOT NULL,
      bodyJa mediumtext,
      translationSkipped boolean NOT NULL DEFAULT false,
      dedupeKey varchar(64) NOT NULL,
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT whatsapp_messages_dedupeKey_unique UNIQUE(dedupeKey),
      INDEX idx_whatsapp_messages_conversation (conversationId, sentAt)
    )
  `);
}

async function ensureRuntimeSchema(db: AppDatabase) {
  const steps: Array<[string, () => Promise<void>]> = [
    ["shipment_items.tradeRecordId", () => ensureShipmentItemsTradeRecordId(db)],
    ["whatsapp conversation tables", () => ensureWhatsappConversationTables(db)],
  ];
  for (const [label, run] of steps) {
    try {
      await run();
    } catch (error) {
      const message = errorText(error);
      if (isAlreadyAppliedError(message)) continue;
      console.warn(`[Database] Runtime schema check skipped (${label}):`, message);
    }
  }
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = createDrizzleDatabase(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  if (_db) {
    _schemaReady ??= ensureRuntimeSchema(_db);
    await _schemaReady;
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.
