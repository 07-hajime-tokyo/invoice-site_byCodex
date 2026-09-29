/** The one disposable database allowed by this suite. */
export const testDatabaseName = "invoice_remake_test";

export function assertTestDatabase(
  databaseUrl = process.env.DATABASE_URL ?? ""
) {
  const url = new URL(databaseUrl);
  if (
    url.protocol !== "mysql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "33067" ||
    url.pathname !== `/${testDatabaseName}` ||
    url.username !== "invoice_test"
  ) {
    throw new Error(
      "Regression tests require invoice_test@127.0.0.1:33067/invoice_remake_test"
    );
  }
  return url;
}
