import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createGatedSheetsClient, safeFetch } from "./gatedClients";
import { google } from "googleapis";

describe("Gated Clients", () => {
  const originalAppEnv = process.env.APP_ENV;

  afterEach(() => {
    process.env.APP_ENV = originalAppEnv;
  });

  describe("createGatedSheetsClient", () => {
    const mockAuth = {
      client_email: "test@test.com",
      private_key: "test-key",
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns real client when APP_ENV=production", () => {
      process.env.APP_ENV = "production";
      const auth = new google.auth.JWT(
        mockAuth.client_email,
        undefined,
        mockAuth.private_key,
        ["https://www.googleapis.com/auth/spreadsheets"]
      );
      const client = createGatedSheetsClient(auth);
      expect(client).toBeDefined();
      expect(client.spreadsheets).toBeDefined();
    });

    it("returns gated client when APP_ENV=staging", () => {
      process.env.APP_ENV = "staging";
      const auth = new google.auth.JWT(
        mockAuth.client_email,
        undefined,
        mockAuth.private_key,
        ["https://www.googleapis.com/auth/spreadsheets"]
      );
      const client = createGatedSheetsClient(auth);
      expect(client).toBeDefined();
      expect(client.spreadsheets.values).toBeDefined();
    });

    it("blocks spreadsheets.batchUpdate in staging", async () => {
      process.env.APP_ENV = "staging";
      const auth = new google.auth.JWT(
        mockAuth.client_email,
        undefined,
        mockAuth.private_key,
        ["https://www.googleapis.com/auth/spreadsheets"]
      );
      const client = createGatedSheetsClient(auth);
      
      const result = await client.spreadsheets.batchUpdate({
        spreadsheetId: "test",
        requestBody: { requests: [] },
      });
      
      expect(result.data.spreadsheetId).toBe("mock-staging");
    });

    it("blocks spreadsheets.values.update in staging", async () => {
      process.env.APP_ENV = "staging";
      const auth = new google.auth.JWT(
        mockAuth.client_email,
        undefined,
        mockAuth.private_key,
        ["https://www.googleapis.com/auth/spreadsheets"]
      );
      const client = createGatedSheetsClient(auth);
      
      const result = await client.spreadsheets.values.update({
        spreadsheetId: "test",
        range: "A1",
        requestBody: { values: [["test"]] },
      });
      
      expect(result.data.updatedCells).toBe(0);
    });

    it("blocks spreadsheets.values.append in staging", async () => {
      process.env.APP_ENV = "staging";
      const auth = new google.auth.JWT(
        mockAuth.client_email,
        undefined,
        mockAuth.private_key,
        ["https://www.googleapis.com/auth/spreadsheets"]
      );
      const client = createGatedSheetsClient(auth);
      
      const result = await client.spreadsheets.values.append({
        spreadsheetId: "test",
        range: "A1",
        requestBody: { values: [["test"]] },
      });
      
      expect(result.data.updates?.updatedCells).toBe(0);
    });
  });

  describe("safeFetch", () => {
    const realFetch = global.fetch;

    afterEach(() => {
      global.fetch = realFetch;
    });

    it("allows GET requests to external APIs", async () => {
      process.env.APP_ENV = "staging";
      
      let fetchCalled = false;
      global.fetch = vi.fn(async () => {
        fetchCalled = true;
        return {
          ok: true,
          json: async () => ({ data: "test" }),
        } as Response;
      });
      
      await safeFetch("https://api.example.com/data", { method: "GET" });
      
      expect(fetchCalled).toBe(true);
    });

    it("blocks POST requests to external APIs in staging", async () => {
      process.env.APP_ENV = "staging";
      
      const response = await safeFetch("https://api.ebay.com/sell", {
        method: "POST",
        body: JSON.stringify({ test: "data" }),
      });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.blocked).toBe(true);
    });

    it("blocks PUT requests to eBay API in staging", async () => {
      process.env.APP_ENV = "staging";
      
      const response = await safeFetch("https://api.ebay.com/order/123", {
        method: "PUT",
        body: JSON.stringify({ status: "shipped" }),
      });
      
      const data = await response.json();
      expect(data.blocked).toBe(true);
    });

    it("blocks POST to Gemini API in staging", async () => {
      process.env.APP_ENV = "staging";
      
      const response = await safeFetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent",
        {
          method: "POST",
          body: JSON.stringify({ prompt: "test" }),
        }
      );
      
      const data = await response.json();
      expect(data.blocked).toBe(true);
    });

    it("allows localhost requests in staging", async () => {
      process.env.APP_ENV = "staging";
      
      let fetchCalled = false;
      global.fetch = vi.fn(async () => {
        fetchCalled = true;
        return {
          ok: true,
          json: async () => ({ data: "test" }),
        } as Response;
      });
      
      await safeFetch("http://localhost:3000/api/test", { method: "POST" });
      
      expect(fetchCalled).toBe(true);
    });

    it("allows writes when APP_ENV=production", async () => {
      const originalEnv = process.env.APP_ENV;
      process.env.APP_ENV = "production";
      
      let fetchCalled = false;
      const originalFetch = global.fetch;
      global.fetch = vi.fn(async () => {
        fetchCalled = true;
        return {
          ok: true,
          json: async () => ({ success: true }),
        } as Response;
      });
      
      try {
        await safeFetch("https://api.ebay.com/order", {
          method: "POST",
          body: JSON.stringify({ test: "data" }),
        });
        
        expect(fetchCalled).toBe(true);
      } finally {
        global.fetch = originalFetch;
        process.env.APP_ENV = originalEnv;
      }
    });

    it("blocks GAS script.google.com even for GET requests", async () => {
      process.env.APP_ENV = "staging";
      
      const response = await safeFetch("https://script.google.com/macros/s/test/exec", {
        method: "GET",
      });
      
      const data = await response.json();
      expect(data.blocked).toBe(true);
      expect(data.message).toContain("GAS script blocked");
    });
  });
});
