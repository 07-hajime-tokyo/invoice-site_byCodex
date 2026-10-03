/** Explicit disposable targets; arbitrary database names are never accepted. */
const targets = Object.freeze({
  main: Object.freeze({ database: "invoice_remake_test", username: "invoice_test" }),
  registration: Object.freeze({ database: "invoice_remake_test_registration", username: "invoice_test_registration" }),
  invoices: Object.freeze({ database: "invoice_remake_test_invoices", username: "invoice_test_invoices" }),
});

export function resolveTestTarget(key = process.env.LOCAL_TEST_TARGET ?? "main") {
  if (!Object.prototype.hasOwnProperty.call(targets, key)) {
    throw new Error("Unknown isolated regression target");
  }
  return targets[key];
}

export const testDatabaseName = resolveTestTarget().database;

export function assertTestDatabase(
  databaseUrl = process.env.DATABASE_URL ?? "",
  targetKey = process.env.LOCAL_TEST_TARGET ?? "main"
) {
  const target = resolveTestTarget(targetKey);
  const url = new URL(databaseUrl);
  if (
    url.protocol !== "mysql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "33067" ||
    url.pathname !== `/${target.database}` ||
    url.username !== target.username
  ) {
    throw new Error(
      `Regression tests require ${target.username}@127.0.0.1:33067/${target.database}`
    );
  }
  return url;
}
