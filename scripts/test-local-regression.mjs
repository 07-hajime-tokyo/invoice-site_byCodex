import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
import { assertTestDatabase } from "../tests/regression/support/test-target.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = parse(fs.readFileSync(path.join(root, ".local/test.env")));
assertTestDatabase(config.DATABASE_URL ?? "");
const mode = process.argv[2] ?? "test";
if (!["test", "schema", "seed"].includes(mode)) throw new Error("Unknown mode");
const env = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  DATABASE_URL: config.DATABASE_URL,
  DATABASE_SSL: "false",
  NODE_ENV: "test",
  LOCAL_AUTH_BYPASS: "true",
  RUN_RUNTIME_SCHEMA_CHECK: "true",
  JWT_SECRET: "local-regression-only-not-a-production-secret",
  NODE_OPTIONS: "--import=./tests/regression/support/network-guard.mjs",
};
const command =
  mode === "schema"
    ? ["node_modules/drizzle-kit/bin.cjs", "push", "--force"]
    : mode === "seed"
      ? ["--import", "tsx", "tests/regression/seed.ts"]
      : [
          "node_modules/vitest/vitest.mjs",
          "run",
          "--config",
          "tests/regression/vitest.config.ts",
        ];
const result = spawnSync(process.execPath, command, {
  cwd: root,
  env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
