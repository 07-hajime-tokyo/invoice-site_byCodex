import { afterEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";
import { registerGasWebhookRoutes } from "./gasWebhook";

function normalizeOrder(body: Record<string, unknown>, path = "/api/gas/purchase-order") {
  const routes = new Map<string, (req: Request, res: Response) => void>();
  registerGasWebhookRoutes({
    get: () => undefined,
    post: (route: string, handler: (req: Request, res: Response) => void) => routes.set(route, handler),
  } as unknown as Express);
  vi.stubEnv("GAS_WEBHOOK_SECRET", "test-secret");
  return new Promise(resolve => {
    const res = { json: resolve, status: () => res };
    routes.get(path)!({
      body: { title: "Test", managementNo: "TEST_1", dryRun: true, ...body },
      header: (name: string) => name === "x-gas-secret" ? "test-secret" : undefined,
    } as unknown as Request, res as unknown as Response);
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("GAS stock quantity", () => {
  it.each([
    { quantity: 1, orderQuantity: 1 },
    { orderQuantity: 1, inventoryQuantity: 1 },
    { quantity: 1, row: { "在庫数": 1 } },
  ])("does not seed stock from an order payload: %j", async body => {
    expect(await normalizeOrder(body)).toMatchObject({
      success: true, normalized: { quantity: 1, inventoryQuantity: 0, markPurchased: false },
    });
  });

  it("keeps explicitly received quantities on the receipt endpoint", async () => {
    expect(await normalizeOrder({ quantity: 1 }, "/api/gas/purchase-receive")).toMatchObject({
      success: true, normalized: { quantity: 1, inventoryQuantity: 1, markPurchased: true },
    });
  });
});
