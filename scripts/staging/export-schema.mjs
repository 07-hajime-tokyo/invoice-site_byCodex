import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..", "..");
const schemaPath = resolve(projectRoot, "drizzle", "schema.ts");
const runName = process.argv[2] ?? `baseline-${new Date().toISOString().replace(/[:.]/g, "-")}`;

if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runName)) {
  throw new Error("Output name must contain only letters, numbers, dots, underscores, and hyphens");
}

const outputPath = resolve(import.meta.dirname, "generated", runName);
if (existsSync(outputPath)) {
  throw new Error("Schema output directory already exists; choose a new output name");
}

const drizzleCli = resolve(projectRoot, "node_modules", "drizzle-kit", "bin.cjs");
if (!existsSync(drizzleCli)) {
  throw new Error("drizzle-kit is not installed in node_modules");
}

const childEnv = { ...process.env };
delete childEnv.DATABASE_URL;
delete childEnv.NON_PRODUCTION_DATABASE_TARGET;

const result = spawnSync(
  process.execPath,
  [
    drizzleCli,
    "generate",
    "--dialect",
    "mysql",
    "--schema",
    schemaPath.replaceAll("\\", "/"),
    "--out",
    outputPath.replaceAll("\\", "/"),
    "--name",
    "baseline",
    "--prefix",
    "none",
  ],
  {
    cwd: projectRoot,
    env: childEnv,
    stdio: "inherit",
  },
);

if (result.error) {
  throw new Error("Failed to start drizzle-kit schema export");
}
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
