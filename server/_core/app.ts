import type { Server } from "http";
import { serveStatic, setupVite } from "./vite";
import { createApiApp } from "./apiApp";

type CreateAppOptions = {
  server?: Server;
  serveClient?: boolean;
};

export async function createApp(options: CreateAppOptions = {}) {
  const app = await createApiApp();

  if (options.serveClient) {
    if (process.env.NODE_ENV === "development") {
      if (!options.server) {
        throw new Error("A server instance is required for Vite middleware");
      }
      await setupVite(app, options.server);
    } else {
      serveStatic(app);
    }
  }

  return app;
}
