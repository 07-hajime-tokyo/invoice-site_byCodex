import { connectTestDatabase, resetFixtures } from "./support/database";
import { testDatabaseName } from "./support/test-target.mjs";

const db = await connectTestDatabase();
try {
  await resetFixtures(db);
  console.log(
    `Restored seven synthetic purchases in ${testDatabaseName} only.`
  );
} finally {
  await db.end();
}
