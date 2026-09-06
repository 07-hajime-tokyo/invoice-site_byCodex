import { afterEach, describe, expect, it, vi } from "vitest";
import type { Express, NextFunction, Request, Response } from "express";
import { registerCronRoutes } from "./_core/cron";
import { registerGasWebhookRoutes } from "./_core/gasWebhook";
import { registerReceiptAckIngestRoutes } from "./_core/receiptAckIngest";
import { productionOnly } from "./_core/productionOnly";

afterEach(() => vi.unstubAllEnvs());

function responseRecorder() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
}

describe("production-only integration guard", () => {
  it("returns 403 outside production and when the environment is invalid", () => {
    for (const appEnv of ["staging", "not-an-environment"]) {
      vi.stubEnv("APP_ENV", appEnv);
      vi.stubEnv("VERCEL_ENV", "");
      const res = responseRecorder();
      const next = vi.fn() as NextFunction;

      productionOnly({} as Request, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: "Forbidden" });
      expect(next).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    }
  });

  it("preserves production routes by calling next", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    const res = responseRecorder();
    const next = vi.fn() as NextFunction;

    productionOnly({} as Request, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("registers each guard before the routes it protects", () => {
    const calls: Array<{
      method: "use" | "get" | "post";
      path: string;
      handler: unknown;
    }> = [];
    const app = {
      use: (path: string, handler: unknown) =>
        calls.push({ method: "use", path, handler }),
      get: (path: string, handler: unknown) =>
        calls.push({ method: "get", path, handler }),
      post: (path: string, handler: unknown) =>
        calls.push({ method: "post", path, handler }),
    } as unknown as Express;

    registerCronRoutes(app);
    expect(calls[0]).toEqual({
      method: "use",
      path: "/api/cron",
      handler: productionOnly,
    });
    expect(calls.slice(1)).not.toHaveLength(0);
    expect(
      calls.slice(1).every(({ method, path }) =>
        method === "get" && path.startsWith("/api/cron/")
      )
    ).toBe(true);

    calls.length = 0;
    registerGasWebhookRoutes(app);
    expect(calls.slice(0, 2)).toEqual([
      { method: "use", path: "/api/gas", handler: productionOnly },
      { method: "use", path: "/api/gas-webhook", handler: productionOnly },
    ]);
    expect(calls.slice(2)).not.toHaveLength(0);
    expect(
      calls.slice(2).every(({ method, path }) =>
        (method === "get" || method === "post") &&
        (path.startsWith("/api/gas/") || path.startsWith("/api/gas-webhook/"))
      )
    ).toBe(true);

    calls.length = 0;
    registerReceiptAckIngestRoutes(app);
    expect(calls.slice(0, 1)).toEqual([
      {
        method: "use",
        path: "/api/ingest/receipt-ack",
        handler: productionOnly,
      },
    ]);
    expect(calls.slice(1)).not.toHaveLength(0);
    expect(
      calls.slice(1).every(({ method, path }) =>
        (method === "get" || method === "post") &&
        path === "/api/ingest/receipt-ack"
      )
    ).toBe(true);
  });
});
