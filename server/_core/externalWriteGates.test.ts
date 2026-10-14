import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  gateGoogleSheetsWrite,
  gateGASWebhook,
  gateCronJob,
  gateFedExWrite,
  gateZaicoWrite,
} from "./externalWriteGates";

describe("External Write Gates", () => {
  const originalAppEnv = process.env.APP_ENV;

  afterEach(() => {
    process.env.APP_ENV = originalAppEnv;
  });

  describe("APP_ENV=staging", () => {
    beforeEach(() => {
      process.env.APP_ENV = "staging";
    });

    it("blocks Google Sheets writes", async () => {
      let called = false;
      const result = await gateGoogleSheetsWrite(
        "test-operation",
        async () => {
          called = true;
          return { data: "real" };
        },
        { data: "mock" }
      )();

      expect(called).toBe(false);
      expect(result).toEqual({ data: "mock" });
    });

    it("blocks GAS webhooks", () => {
      const result = gateGASWebhook("test-webhook");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("staging");
    });

    it("blocks cron jobs", () => {
      const result = gateCronJob("test-job");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("staging");
    });

    it("blocks FedEx writes", async () => {
      let called = false;
      const result = await gateFedExWrite(
        "test-shipment",
        async () => {
          called = true;
          return { shipmentId: "real" };
        },
        { shipmentId: "mock" }
      )();

      expect(called).toBe(false);
      expect(result).toEqual({ shipmentId: "mock" });
    });

    it("blocks Zaico writes", async () => {
      let called = false;
      const result = await gateZaicoWrite(
        "test-create",
        async () => {
          called = true;
          return { inventoryId: "real" };
        },
        { inventoryId: "mock" }
      )();

      expect(called).toBe(false);
      expect(result).toEqual({ inventoryId: "mock" });
    });
  });

  describe("APP_ENV=production", () => {
    beforeEach(() => {
      process.env.APP_ENV = "production";
    });

    it("allows Google Sheets writes", async () => {
      let called = false;
      const result = await gateGoogleSheetsWrite(
        "test-operation",
        async () => {
          called = true;
          return { data: "real" };
        }
      )();

      expect(called).toBe(true);
      expect(result).toEqual({ data: "real" });
    });

    it("allows GAS webhooks", () => {
      const result = gateGASWebhook("test-webhook");
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("allows cron jobs", () => {
      const result = gateCronJob("test-job");
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("allows FedEx writes", async () => {
      let called = false;
      const result = await gateFedExWrite(
        "test-shipment",
        async () => {
          called = true;
          return { shipmentId: "real" };
        }
      )();

      expect(called).toBe(true);
      expect(result).toEqual({ shipmentId: "real" });
    });

    it("allows Zaico writes", async () => {
      let called = false;
      const result = await gateZaicoWrite(
        "test-create",
        async () => {
          called = true;
          return { inventoryId: "real" };
        }
      )();

      expect(called).toBe(true);
      expect(result).toEqual({ inventoryId: "real" });
    });
  });

  describe("APP_ENV undefined (defaults to staging behavior when VERCEL_ENV=preview)", () => {
    beforeEach(() => {
      delete process.env.APP_ENV;
      process.env.VERCEL_ENV = "preview";
    });

    afterEach(() => {
      delete process.env.VERCEL_ENV;
    });

    it("blocks writes by default on Vercel preview", async () => {
      let called = false;
      const result = await gateGoogleSheetsWrite(
        "test-operation",
        async () => {
          called = true;
          return { data: "real" };
        },
        { data: "mock" }
      )();

      expect(called).toBe(false);
    });
  });
});
