import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
dotenv.config();

describe("Gemini API connection", () => {
  it("should connect to Gemini API and return a response", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    expect(apiKey, "GEMINI_API_KEY must be set").toBeTruthy();

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply with just the word: OK" }] }],
        }),
      }
    );
    expect(res.ok, `Gemini API returned status ${res.status}`).toBe(true);
    const data = await res.json() as any;
    expect(data.candidates?.[0]?.content?.parts?.[0]?.text).toBeTruthy();
  });
});
