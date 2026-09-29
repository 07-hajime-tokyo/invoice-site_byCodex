import { connectTestDatabase, resetFixtures } from "./support/database";

const db = await connectTestDatabase();
try {
  await resetFixtures(db);
  console.log(
    "Restored seven synthetic purchases in invoice_remake_test only."
  );
} finally {
  await db.end();
}
