import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";
import { assertTestDatabase } from "./test-target.mjs";

/** Real Express + tRPC + MySQL; no mocked business logic. */
export async function startTestApi() {
  assertTestDatabase();
  const { createApiApp } = await import("../../../server/_core/apiApp");
  const server = createServer(await createApiApp());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const client = createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://127.0.0.1:${port}/api/trpc`,
        transformer: superjson,
      }),
    ],
  });
  return {
    client,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
