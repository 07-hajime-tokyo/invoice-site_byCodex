import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DumpRow = Record<string, unknown>;

let cachedTables: Map<string, DumpRow[]> | null = null;

export async function getLocalDumpTable<T extends DumpRow = DumpRow>(tableName: string): Promise<T[]> {
  const tables = await loadLocalDump();
  return ((tables.get(tableName) ?? []) as T[]).map((row) => ({ ...row }));
}

export async function hasLocalDump(): Promise<boolean> {
  const tables = await loadLocalDump();
  return tables.size > 0;
}

async function loadLocalDump(): Promise<Map<string, DumpRow[]>> {
  if (cachedTables) return cachedTables;

  cachedTables = new Map();
  const dumpPath = getDumpPath();

  let sql: string;
  try {
    sql = await fs.readFile(dumpPath, "utf8");
  } catch {
    return cachedTables;
  }

  const insertRe = /^INSERT INTO `([^`]+)` \((.*?)\) VALUES ([\s\S]*?);$/gm;
  const insertMatches = Array.from(sql.matchAll(insertRe)) as RegExpMatchArray[];
  for (const match of insertMatches) {
    const [, tableName, rawColumns, rawValues] = match;
    const columnMatches = Array.from(rawColumns.matchAll(/`([^`]+)`/g)) as RegExpMatchArray[];
    const columns = columnMatches.map((m) => m[1]);
    const rows = parseRows(rawValues).map((values) => {
      const row: DumpRow = {};
      columns.forEach((column, index) => {
        const value = values[index] ?? null;
        row[column] = value;
        const camelColumn = toCamelCase(column);
        if (camelColumn !== column) row[camelColumn] = value;
      });
      return row;
    });
    cachedTables.set(tableName, [...(cachedTables.get(tableName) ?? []), ...rows]);
  }

  return cachedTables;
}

function getDumpPath() {
  if (process.env.LOCAL_DUMP_SQL) return path.resolve(process.env.LOCAL_DUMP_SQL);
  const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  return path.resolve(
    projectRoot,
    "..",
    "migration-input",
    "zaico_db_migration",
    "zaico_inventory_full.import.sql",
  );
}

function toCamelCase(value: string) {
  return value.replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase());
}

function parseRows(valuesSql: string): unknown[][] {
  const rows: unknown[][] = [];
  let currentRow: unknown[] | null = null;
  let token = "";
  let depth = 0;
  let inString = false;
  let escaped = false;

  const pushToken = () => {
    if (!currentRow) return;
    currentRow.push(parseValue(token));
    token = "";
  };

  for (let i = 0; i < valuesSql.length; i += 1) {
    const char = valuesSql[i];

    if (inString) {
      token += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "'") {
        inString = false;
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      token += char;
      continue;
    }

    if (char === "(") {
      if (depth === 0) {
        currentRow = [];
        token = "";
      } else {
        token += char;
      }
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        pushToken();
        if (currentRow) rows.push(currentRow);
        currentRow = null;
      } else {
        token += char;
      }
      continue;
    }

    if (char === "," && depth === 1) {
      pushToken();
      continue;
    }

    if (depth > 0) token += char;
  }

  return rows;
}

function parseValue(raw: string): unknown {
  const value = raw.trim();
  if (value === "NULL") return null;
  if (value.startsWith("'") && value.endsWith("'")) {
    return unescapeMysqlString(value.slice(1, -1));
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function unescapeMysqlString(value: string): string {
  return value.replace(/\\([0bnrtZ'"\\])/g, (_match, escaped: string) => {
    switch (escaped) {
      case "0":
        return "\0";
      case "b":
        return "\b";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "Z":
        return "\x1a";
      default:
        return escaped;
    }
  });
}
