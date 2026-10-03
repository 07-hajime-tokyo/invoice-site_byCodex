type InvoiceImageAnalysisResult = {
  items: Array<{ description: string; subText?: string; quantity: number; unitPrice: number; currency: string }>;
  detectedSender: string | null;
  invoiceNumbers: number[];
  totalAmount?: number | null;
  currency?: string | null;
  rawOrderText?: string | null;
};

function getInvoiceImageExtractionPrompt() {
  return `You are an expert OCR and invoice extraction assistant for WhatsApp order screenshots.
Read the visible chat screenshot carefully, including small text in message bubbles.

Goal:
Extract the buyer's order into invoice line items.

Return a JSON object with this EXACT format:
{
  "items": [
    { "description": "product name", "subText": "color or variant", "quantity": 10, "unitPrice": 25.00, "currency": "EUR" }
  ],
  "detectedSender": "name or phone number of the buyer (not the seller/Murakami)",
  "invoiceNumbers": [372, 373],
  "totalAmount": 250.00,
  "currency": "EUR",
  "rawOrderText": "the exact buyer message text used for the order"
}

Extraction rules:
- Identify the BUYER's actual order request. Prioritize messages with words like "invoice", "order", "take", "buy", "pcs", "pieces", "units", "please", or a quantity.
- Do NOT extract every product mentioned in the chat. Extract only products the buyer is asking to purchase or invoice.
- If the buyer asks "how much is X?" and later says a quantity like "10 pcs", treat X as the ordered product.
- If a seller message contains a price list or a price reply, use it only to fill unitPrice for the matching ordered product.
- If quantity is visible separately from the product name, combine nearby buyer messages when they refer to the same product.
- items.description: FULL product name, expanded from abbreviations/slang:
  * Do NOT add "New" unless the visible text explicitly says "New" or uses an "N" abbreviation such as "N3DSXL" or "N3DSLL".
  * "3dsxl" or "3ds xl" -> "3DS XL"
  * "N3dsxl" or "New 3DS XL" -> "New 3DS XL"
  * "3dsll" or "3ds ll" -> "3DS LL"
  * "N3dsll" or "New 3DS LL" -> "New 3DS LL"
  * "N2dsll" or "n2dsll" -> "New 2DS LL"
  * "N3ds" -> "New 3DS"
  * "PSVita" -> "PS Vita"
  * "PSPGO" or "PSPGo" -> "PSP Go"
  * "WiiU" -> "Wii U"
  * Other abbreviations: expand to full official product name
- items.subText: color, variant, or condition mentioned in the conversation for this item.
  * Look in the ENTIRE conversation for color/variant info, not just the order line.
  * Examples: "turquoise", "black", "white", "random color", "coral pink", "like new"
  * Leave empty string "" if no color/variant info found.
- items.quantity: number of units ordered
- items.unitPrice: unit price if visible (e.g. "€25 each", "25 EUR/pc", "160 euros per"). Set to 0 if not shown.
- items.currency: currency code (EUR, USD, GBP, JPY). Default EUR.
- detectedSender: the BUYER's WhatsApp display name shown on the buyer's message bubble. Strip leading "~". Include phone only if the name is unreadable. The seller is typically "Murakami" or "村上" - exclude them.
- invoiceNumbers: any invoice numbers like "Invoice - 0372.pdf" -> [372]
- totalAmount: total order amount if visible (e.g. "Total: €500" -> 500)
- currency: overall currency of the transaction
- rawOrderText: exact visible buyer message(s) used to determine product, quantity, and price.
- If you are uncertain, still return the most likely item instead of returning an empty items array.
- Use empty string "" for unknown text fields and 0 for unknown numeric fields.

Return ONLY valid JSON, no markdown, no explanation.`;
}

function cleanDetectedSender(value: unknown) {
  const text = String(value ?? "")
    .replace(/^~\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function normalizeExtractedProductName(description: string, rawOrderText: string | null | undefined) {
  const raw = String(rawOrderText ?? "").toLowerCase().replace(/\s+/g, "");
  if (!raw) return description;
  const mentionsPlain3dsXl = raw.includes("3dsxl");
  const mentionsNew3dsXl = raw.includes("new3dsxl") || raw.includes("n3dsxl");
  if (mentionsPlain3dsXl && !mentionsNew3dsXl && /^new\s+3ds\s+xl$/i.test(description.trim())) {
    return "3DS XL";
  }
  const mentionsPlain3dsLl = raw.includes("3dsll");
  const mentionsNew3dsLl = raw.includes("new3dsll") || raw.includes("n3dsll");
  if (mentionsPlain3dsLl && !mentionsNew3dsLl && /^new\s+3ds\s+ll$/i.test(description.trim())) {
    return "3DS LL";
  }
  return description;
}

function parseInvoiceImageAnalysisText(text: string): InvoiceImageAnalysisResult {
  const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const jsonText = clean.startsWith("{")
    ? clean
    : clean.slice(Math.max(0, clean.indexOf("{")), clean.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(jsonText || clean) as Partial<InvoiceImageAnalysisResult>;
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const rawOrderText = parsed.rawOrderText ? String(parsed.rawOrderText).trim() : null;
    const items = rawItems
      .map((item) => ({
        description: normalizeExtractedProductName(String(item.description ?? "").trim(), rawOrderText),
        subText: String(item.subText ?? "").trim(),
        quantity: Number(item.quantity ?? 0),
        unitPrice: Number(item.unitPrice ?? 0),
        currency: String(item.currency ?? parsed.currency ?? "EUR").trim().toUpperCase() || "EUR",
      }))
      .filter((item) => item.description.length > 0);
    return {
      items,
      detectedSender: cleanDetectedSender(parsed.detectedSender),
      invoiceNumbers: Array.isArray(parsed.invoiceNumbers)
        ? parsed.invoiceNumbers.map((n) => Number(n)).filter(Number.isFinite)
        : [],
      totalAmount: parsed.totalAmount == null ? null : Number(parsed.totalAmount),
      currency: parsed.currency ? String(parsed.currency).trim().toUpperCase() : null,
      rawOrderText,
    };
  } catch {
    return { items: [], detectedSender: null, invoiceNumbers: [] };
  }
}

const invoiceImageResponseSchema = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          subText: { type: "STRING" },
          quantity: { type: "NUMBER" },
          unitPrice: { type: "NUMBER" },
          currency: { type: "STRING" },
        },
        required: ["description", "subText", "quantity", "unitPrice", "currency"],
      },
    },
    detectedSender: { type: "STRING" },
    invoiceNumbers: {
      type: "ARRAY",
      items: { type: "INTEGER" },
    },
    totalAmount: { type: "NUMBER" },
    currency: { type: "STRING" },
    rawOrderText: { type: "STRING" },
  },
  required: ["items", "detectedSender", "invoiceNumbers", "currency", "rawOrderText"],
};

export async function analyzeInvoiceImageWithGemini(input: { base64: string; mimeType: string }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: input.mimeType,
              data: input.base64,
            },
          },
          { text: getInvoiceImageExtractionPrompt() },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: invoiceImageResponseSchema,
        temperature: 0.1,
        maxOutputTokens: 512,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini API error: ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "{}";
  return parseInvoiceImageAnalysisText(text);
}
