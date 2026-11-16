import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyReviewedTargets, verifyReviewedTargets } from "./soft-delete-shipped-zero-inventory.mjs";

const targets = Array.from({ length: 57 }, (_, index) => ({
  id: index + 1, managementNo: `stock-${index}`, title: "Fixture",
}));
const manifest = { schema: "invoice_site_by_codex", targets, labelsToPreserve: 58 };
const labels = [...targets, targets[0]].map(({ id }, index) => ({
  id: index + 100, localInventoryId: id, status: "shipped",
}));

test("review gate checks count, IDs and current values", () => {
  assert.equal(verifyReviewedTargets(manifest, [...targets].reverse()).length, 57);
  assert.throws(() => verifyReviewedTargets(manifest, targets.slice(1)), /Expected 57/);
  const changed = [{ ...targets[0], title: "Changed" }, ...targets.slice(1)];
  assert.throws(() => verifyReviewedTargets(manifest, changed), /changed \[1\]/);
  changed[0].id = 8130002;
  assert.throws(() => verifyReviewedTargets(manifest, changed), /excluded/);
});

function fixture(snapshot, { updateCount = 57, conflictingLabel = false, queriedTargets = targets } = {}) {
  const mutations = [];
  const calls = [];
  const connection = {
    async query(sql) {
      if (sql.startsWith("START TRANSACTION")) {
        calls.push("begin");
        return [];
      }
      if (sql.includes("inventory_item_labels")) return [queriedTargets];
      if (sql.includes("FROM work_logs")) return [[{ purchases: 100, receipts: 100, deliveries: 50, outboundBoxes: 2, workLogs: 70 }]];
      throw new Error("Unexpected query");
    },
    async execute(sql, args) {
      if (sql.includes("SELECT i.*")) {
        return [targets.map(row => ({ ...row, isDeleted: 0, quantity: 0, zaicoId: null }))];
      }
      if (sql.includes("SELECT id, zaicoId")) return [[]];
      if (sql.trimStart().startsWith("SELECT * FROM inventory_item_labels")) {
        return [conflictingLabel ? [{ ...labels[0], status: "ordered" }, ...labels.slice(1)] : labels];
      }
      if (sql.trimStart().startsWith("INSERT") || sql.trimStart().startsWith("UPDATE")) {
        assert.equal(JSON.parse(readFileSync(snapshot, "utf8")).labels.length, 58);
        mutations.push({ sql: sql.trim(), args });
        return [{ affectedRows: sql.includes("UPDATE") ? updateCount : 57 }];
      }
      if (sql.includes("AS restoreEntries")) return [[{ deleted: 57, restoreEntries: 57 }]];
      throw new Error("Unexpected statement");
    },
    async commit() { calls.push("commit"); },
    async rollback() { calls.push("rollback"); },
  };
  return { connection, calls, mutations };
}

function snapshotPath() {
  return join(mkdtempSync(join(tmpdir(), "shipped-zero-test-")), "snapshot.json");
}

test("backs up before writing, and only writes inventory flag and restore entries", async () => {
  const snapshot = snapshotPath();
  const { connection, calls, mutations } = fixture(snapshot);
  const result = await applyReviewedTargets(connection, manifest, snapshot, true);
  assert.deepEqual(calls, ["begin", "commit"]);
  assert.equal(result.labelsPreserved, 58);
  assert.equal(mutations.length, 2);
  assert.match(mutations[0].sql, /^INSERT INTO deleted_inventories/);
  assert.match(mutations[1].sql, /^UPDATE local_inventories AS i SET isDeleted = 1/);
  assert.deepEqual(mutations[1].args, targets.map(row => row.id));
});

test("a changed row count during update rolls back both writes", async () => {
  const snapshot = snapshotPath();
  const { connection, calls } = fixture(snapshot, { updateCount: 56 });
  await assert.rejects(applyReviewedTargets(connection, manifest, snapshot, true), /write count/);
  assert.deepEqual(calls, ["begin", "rollback"]);
  assert.equal(existsSync(snapshot), true);
});

test("stops without a backup or writes if targets or their label status changed", async () => {
  const snapshot = snapshotPath();
  for (const change of [{ queriedTargets: targets.slice(1) }, { conflictingLabel: true }]) {
    const { connection, calls, mutations } = fixture(snapshot, change);
    await assert.rejects(applyReviewedTargets(connection, manifest, snapshot, true), /Expected 57|Label eligibility/);
    assert.deepEqual(calls, ["begin", "rollback"]);
    assert.equal(mutations.length, 0);
    assert.equal(existsSync(snapshot), false);
  }
});
