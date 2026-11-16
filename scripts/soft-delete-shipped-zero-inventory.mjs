import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const schema = "invoice_site_by_codex";
const expected = 57;
const excluded = new Set([8130002, 8130003, 6240002, 4290002, 4380003]);
const eligible = `i.isDeleted = 0 AND i.quantity = 0
  AND EXISTS (SELECT 1 FROM inventory_item_labels l WHERE l.localInventoryId = i.id)
  AND NOT EXISTS (
    SELECT 1 FROM inventory_item_labels l WHERE l.localInventoryId = i.id
      AND (l.status IS NULL OR BINARY l.status <> 'shipped')
  )`;
const managementNoSql = "TRIM(SUBSTRING_INDEX(COALESCE(i.etc, ''), ',', 1))";
const placeholders = length => Array(length).fill("?").join(", ");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function saveJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx", mode: 0o600, flush: true,
  });
}

function sortedTargets(targets) {
  if (!Array.isArray(targets)) throw new Error("Expected an array of targets.");
  return targets.map(({ id, managementNo, title }) => {
    if (!Number.isSafeInteger(id) || id <= 0 || typeof managementNo !== "string" || typeof title !== "string") {
      throw new Error("Invalid target in manifest or query result.");
    }
    return { id, managementNo, title };
  }).sort((a, b) => a.id - b.id);
}

export function verifyReviewedTargets(manifest, current) {
  if (manifest?.schema !== schema) throw new Error("Manifest database does not match.");
  const reviewed = sortedTargets(manifest.targets);
  const actual = sortedTargets(current);
  if (reviewed.length !== expected || new Set(reviewed.map(row => row.id)).size !== expected) {
    throw new Error(`Expected ${expected} unique reviewed targets; got ${reviewed.length}. No changes made.`);
  }
  const excludedIds = [...new Set([...reviewed, ...actual].map(row => row.id).filter(id => excluded.has(id)))];
  if (excludedIds.length) throw new Error(`An excluded inventory ID was found: ${excludedIds.join(", ")}.`);
  const byId = new Map(reviewed.map(row => [row.id, row]));
  const actualIds = new Set(actual.map(row => row.id));
  const added = actual.filter(row => !byId.has(row.id)).map(row => row.id);
  const removed = reviewed.filter(row => !actualIds.has(row.id)).map(row => row.id);
  const changed = actual.filter(row => {
    const before = byId.get(row.id);
    return before && (before.title !== row.title || before.managementNo !== row.managementNo);
  }).map(row => row.id);
  if (actual.length !== expected || actualIds.size !== expected || added.length || removed.length || changed.length) {
    throw new Error(`Expected ${expected} unique targets; got ${actual.length} rows (${actualIds.size} unique). ` +
      `Target mismatch: added [${added}], removed [${removed}], changed [${changed}].`);
  }
  return actual.map(row => row.id);
}

async function listTargets(conn) {
  const [rows] = await conn.query(`
    SELECT i.id, ${managementNoSql} AS managementNo, i.title
    FROM local_inventories i WHERE ${eligible} ORDER BY i.id
  `);
  return sortedTargets(rows);
}

async function readLabelRows(conn, inSql, ids, forUpdate = false) {
  const [rows] = await conn.execute(`
    SELECT * FROM inventory_item_labels WHERE localInventoryId IN (${inSql})
    ORDER BY id${forUpdate ? " FOR UPDATE" : ""}
  `, ids);
  return rows;
}

async function readPreservedCounts(conn) {
  const [[counts]] = await conn.query(`
    SELECT (SELECT COUNT(*) FROM local_purchases) AS purchases,
           (SELECT COUNT(*) FROM purchase_histories) AS receipts,
           (SELECT COUNT(*) FROM delivery_histories) AS deliveries,
           (SELECT COUNT(*) FROM outbound_boxes) AS outboundBoxes,
           (SELECT COUNT(*) FROM work_logs) AS workLogs
  `);
  return counts;
}

export async function applyReviewedTargets(conn, manifest, snapshotPath, isTiDB) {
  const batch = `shipped-zero:${randomUUID()}`;
  // TiDB needs a pessimistic transaction for SELECT ... FOR UPDATE to lock rows.
  if (isTiDB) await conn.query("BEGIN PESSIMISTIC");
  else await conn.beginTransaction();
  let committed = false;
  try {
    const ids = verifyReviewedTargets(manifest, await listTargets(conn));
    const inSql = placeholders(ids.length);
    const [locked] = await conn.execute(`
      SELECT i.*, ${managementNoSql} AS managementNo FROM local_inventories i
      WHERE i.id IN (${inSql}) AND i.isDeleted = 0 AND i.quantity = 0 ORDER BY i.id FOR UPDATE
    `, ids);
    verifyReviewedTargets(manifest, locked);
    const inventories = locked.map(({ managementNo, ...inventory }) => inventory);
    const restoreKeys = inventories.map(row => row.zaicoId ?? row.id);
    if (new Set(restoreKeys).size !== expected) throw new Error("Duplicate restore keys.");
    const inventoryByKey = new Map(inventories.map(row => [row.zaicoId ?? row.id, row.id]));
    const [keyMatches] = await conn.execute(`
      SELECT id, zaicoId FROM local_inventories
      WHERE zaicoId IN (${inSql}) ORDER BY id FOR UPDATE
    `, restoreKeys);
    if (keyMatches.some(row => inventoryByKey.get(row.zaicoId) !== row.id)) {
      throw new Error("A restore key resolves to a different inventory.");
    }

    const labels = await readLabelRows(conn, inSql, ids, true);
    if (new Set(labels.map(row => row.localInventoryId)).size !== expected ||
      labels.some(row => row.status !== "shipped") ||
      (manifest.labelsToPreserve != null && Number(manifest.labelsToPreserve) !== labels.length)) {
      throw new Error("Label eligibility changed. No changes made.");
    }
    const counts = await readPreservedCounts(conn);
    saveJson(snapshotPath, { schema, batch, capturedAt: new Date().toISOString(), inventories, labels, counts });

    // A new restore record preserves the current snapshot without changing any older restore history.
    const values = inventories.flatMap(row => [
      row.zaicoId ?? row.id, row.title, row.category, row.place, String(row.quantity),
      row.unit, row.unitPrice, row.etc, JSON.stringify(row), batch,
    ]);
    const [restores] = await conn.execute(`
      INSERT INTO deleted_inventories
        (zaicoId, title, category, place, quantity, unit, unitPrice, etc, snapshotJson, deletedBy)
      VALUES ${inventories.map(() => `(${placeholders(10)})`).join(", ")}
    `, values);
    const [update] = await conn.execute(`
      UPDATE local_inventories AS i SET isDeleted = 1
      WHERE i.id IN (${inSql}) AND ${eligible}
    `, ids);
    if (restores.affectedRows !== expected || update.affectedRows !== expected) {
      throw new Error("Unexpected write count. Rolling back.");
    }

    const [[countsAfter]] = await conn.execute(`
      SELECT (SELECT COUNT(*) FROM local_inventories WHERE id IN (${inSql}) AND isDeleted = 1 AND quantity = 0) AS deleted,
             (SELECT COUNT(*) FROM deleted_inventories WHERE deletedBy = ?) AS restoreEntries
    `, [...ids, batch]);
    const labelsAfter = await readLabelRows(conn, inSql, ids);
    if (Number(countsAfter.deleted) !== expected || Number(countsAfter.restoreEntries) !== expected ||
      JSON.stringify(labelsAfter) !== JSON.stringify(labels) ||
      JSON.stringify(await readPreservedCounts(conn)) !== JSON.stringify(counts)) {
      throw new Error("Post-write checks failed. Rolling back.");
    }
    await conn.commit();
    committed = true;
    return { schema, batch, deleted: expected, restoreEntries: expected, labelsPreserved: labels.length, counts };
  } finally {
    if (!committed) await conn.rollback();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      env: { type: "string" },
      apply: { type: "boolean", default: false },
      manifest: { type: "string" },
      "manifest-out": { type: "string" },
      snapshot: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log("Dry run: node scripts/soft-delete-shipped-zero-inventory.mjs [--env <file>] [--manifest-out <new.json>]");
    console.log("Apply: add --apply --manifest <reviewed.json> --snapshot <new-backup.json> (use a quiet inventory window).");
    return;
  }
  if (values.apply ? !values.manifest || !values.snapshot || values["manifest-out"] : values.manifest || values.snapshot) {
    throw new Error("Use --apply only with --manifest and --snapshot, and without --manifest-out.");
  }
  const manifest = values.apply ? readJson(values.manifest) : null;
  if (manifest) verifyReviewedTargets(manifest, manifest.targets);
  const url = values.env ? dotenv.parse(readFileSync(values.env)).DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL or supply --env with a non-empty DATABASE_URL.");
  if (new URL(url).protocol !== "mysql:") throw new Error("DATABASE_URL must use mysql:.");
  const conn = await mysql.createConnection({
    uri: url, ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true }, connectTimeout: 8000,
  });
  try {
    const [[database]] = await conn.query("SELECT DATABASE() AS name, VERSION() AS version");
    if (database.name !== schema) throw new Error(`Refusing to use a database other than ${schema}.`);
    if (values.apply) {
      console.log(JSON.stringify(await applyReviewedTargets(conn, manifest, values.snapshot, /TiDB/i.test(database.version)), null, 2));
      return;
    }
    await conn.query("START TRANSACTION READ ONLY");
    try {
      const targets = await listTargets(conn);
      const ids = targets.map(row => row.id);
      const labels = ids.length ? await readLabelRows(conn, placeholders(ids.length), ids) : [];
      const result = { schema, countedAt: new Date().toISOString(), expected, count: targets.length,
        labelsToPreserve: labels.length, targets };
      if (values["manifest-out"]) saveJson(values["manifest-out"], result);
      console.log(JSON.stringify(result, null, 2));
      if (targets.length !== expected || targets.some(row => excluded.has(row.id))) process.exitCode = 2;
    } finally {
      await conn.rollback();
    }
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Database error details can include connection or SQL parameter data.
    console.error(error.code ? `Cleanup stopped (${error.code}).` : error.message);
    process.exitCode = 1;
  });
}
