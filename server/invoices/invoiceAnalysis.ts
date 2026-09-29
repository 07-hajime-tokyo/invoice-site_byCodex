import { analyzeInvoiceImageWithGemini } from "./imageAnalysis";
import {
  parseWhatsAppChat,
  extractSenderFromChat,
  detectPaymentsFromChat,
} from "./chatParsing";
import { generateInvoiceNumber } from "./numbering";
import type {
  InvoiceChatInput,
  InvoiceImageInput,
  InvoiceRateInput,
} from "./invoiceInput";

export async function parseInvoiceChat({ input }: { input: InvoiceChatInput }) {
  const parsed = parseWhatsAppChat(input.chatText);
  const detectedSender = extractSenderFromChat(input.chatText);
  return {
    items: parsed,
    invoiceNumber: generateInvoiceNumber(),
    detectedSender,
  };
}

export async function detectInvoicePayments({
  input,
}: {
  input: InvoiceChatInput;
}) {
  return detectPaymentsFromChat(input.chatText);
}

export function getInvoiceImageAnalysisStatus() {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasForge = Boolean(
    process.env.BUILT_IN_FORGE_API_URL && process.env.BUILT_IN_FORGE_API_KEY
  );
  return {
    enabled: hasGemini || hasForge,
    provider: hasGemini ? "gemini" : hasForge ? "forge" : null,
  };
}

export async function analyzeInvoiceScreenshot({
  input,
}: {
  input: InvoiceImageInput;
}) {
  const geminiResult = await analyzeInvoiceImageWithGemini(input);
  if (geminiResult) return geminiResult;

  const forgeUrl = process.env.BUILT_IN_FORGE_API_URL;
  const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "画像解析APIが未設定です。無料枠で使う場合は GEMINI_API_KEY を設定してください。"
    );
  }
  const res = await fetch(`${forgeUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${forgeKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are an invoice extraction assistant. Analyze this WhatsApp chat screenshot carefully and extract all order/invoice information.

Return a JSON object with this EXACT format:
{
  "items": [
    { "description": "product name", "subText": "color or variant", "quantity": 10, "unitPrice": 25.00, "currency": "EUR" }
  ],
  "detectedSender": "name or phone number of the buyer (not the seller/Murakami)",
  "invoiceNumbers": [372, 373],
  "totalAmount": 250.00,
  "currency": "EUR"
}

Extraction rules:
- items.description: FULL product name, expanded from abbreviations/slang:
  * "N2dsll" or "n2dsll" → "New 2DS LL"
  * "N3dsxl" → "New 3DS XL"
  * "N3ds" → "New 3DS"
  * "PSVita" → "PS Vita"
  * "PSPGO" or "PSPGo" → "PSP Go"
  * "WiiU" → "Wii U"
  * Other abbreviations: expand to full official product name
- items.subText: color, variant, or condition mentioned in the conversation for this item.
  * Look in the ENTIRE conversation for color/variant info, not just the order line.
  * Examples: "turquoise", "black", "white", "random color", "coral pink", "like new"
  * Leave empty string "" if no color/variant info found.
- items.quantity: number of units ordered
- items.unitPrice: unit price if visible (e.g. "€25 each", "25 EUR/pc", "160 euros per"). Set to 0 if not shown.
- items.currency: currency code (EUR, USD, GBP, JPY). Default EUR.
- detectedSender: the BUYER's name or phone number. The seller is typically "Murakami" or "村上" - exclude them.
- invoiceNumbers: any invoice numbers like "Invoice - 0372.pdf" → [372]
- totalAmount: total order amount if visible (e.g. "Total: €500" → 500)
- currency: overall currency of the transaction

Return ONLY valid JSON, no markdown, no explanation.`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${input.mimeType};base64,${input.base64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 1024,
    }),
  });
  if (!res.ok) throw new Error(`Forge API error: ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "{}";
  try {
    const clean = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    return JSON.parse(clean) as {
      items: Array<{
        description: string;
        subText?: string;
        quantity: number;
        unitPrice: number;
        currency: string;
      }>;
      detectedSender: string | null;
      invoiceNumbers: number[];
      totalAmount: number | null;
      currency: string | null;
    };
  } catch {
    return { items: [], detectedSender: null, invoiceNumbers: [] };
  }
}

export async function getInvoiceExchangeRate({
  input,
}: {
  input: InvoiceRateInput;
}) {
  const { currency } = input;
  if (currency === "JPY")
    return {
      rate: 1,
      currency: "JPY",
      date: new Date().toISOString().slice(0, 10),
    };
  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=${currency}&to=JPY`
    );
    if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`);
    const data = (await res.json()) as {
      rates: Record<string, number>;
      date: string;
    };
    const rate = data.rates["JPY"];
    if (!rate) throw new Error(`No JPY rate for ${currency}`);
    return { rate, currency, date: data.date };
  } catch (e) {
    throw new Error(
      `為替レートの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
