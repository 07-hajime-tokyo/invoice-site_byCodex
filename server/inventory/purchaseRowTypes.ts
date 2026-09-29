import { getLocalPurchases } from "./db";

export type LocalPurchaseRow = Awaited<
  ReturnType<typeof getLocalPurchases>
>[number];
