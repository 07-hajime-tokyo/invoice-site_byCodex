export function parseWhatsAppChat(chatText: string): Array<{
  description: string;
  quantity: number;
  unitPrice: number;
  currency: string;
}> {
  // Split into message blocks by timestamp
  // Each block starts with a line matching [HH:MM, YYYY/M/D]
  const timestampRe = /^\[\d{1,2}:\d{2},\s*\d{4}\/\d{1,2}\/\d{1,2}\]/;

  const blocks: string[][] = [];
  let current: string[] = [];
  for (const rawLine of chatText.split("\n")) {
    if (timestampRe.test(rawLine.trim())) {
      if (current.length) blocks.push(current);
      current = [rawLine];
    } else {
      current.push(rawLine);
    }
  }
  if (current.length) blocks.push(current);

  // Build a price map from ALL blocks (price-list lines)
  const priceMap = new Map<string, { price: number; currency: string }>();
  const priceLineRe = /^\*?\s*(.+?):\s*([\d,]+(?:\.\d+)?)\s*(Euros?|EUR|USD|Dollars?|\$|€)?$/i;
  for (const block of blocks) {
    for (const rawLine of block) {
      const line = rawLine.trim();
      const m = line.match(priceLineRe);
      if (m) {
        const desc = m[1].trim().replace(/^\*\s*/, "").toLowerCase();
        const price = parseFloat(m[2].replace(/,/g, ""));
        const currRaw = (m[3] ?? "").toLowerCase();
        const currency = currRaw.startsWith("usd") || currRaw.startsWith("dollar") || currRaw === "$" ? "USD" : "EUR";
        priceMap.set(desc, { price, currency });
      }
    }
  }

  // Find the order block: contains "invoice me" or has multiple qty-first lines
  const qtyFirstRe = /^(\d+)\s+(.+)$/;
  const skipWords = new Set(["please", "also", "could", "hey", "hi", "below", "once", "if", "we", "i", "is", "are", "the", "and", "for", "with", "can", "that", "this", "from", "to", "be", "psp"]);

  let orderBlock: string[] | null = null;
  for (const block of blocks) {
    const text = block.join(" ").toLowerCase();
    if (text.includes("invoice me") || text.includes("please invoice")) {
      orderBlock = block;
      break;
    }
  }
  // Fallback: find block with most qty-first lines
  if (!orderBlock) {
    let best = 0;
    for (const block of blocks) {
      let count = 0;
      for (const line of block) {
        const m = line.trim().match(qtyFirstRe);
        if (m && !skipWords.has((m[2].split(/\s+/)[0] ?? "").toLowerCase())) count++;
      }
      if (count > best) { best = count; orderBlock = block; }
    }
  }

  if (!orderBlock) return [];

  const items: Array<{ description: string; quantity: number; unitPrice: number; currency: string }> = [];

  for (const rawLine of orderBlock) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip timestamp header line
    if (timestampRe.test(line)) continue;

    const m = line.match(qtyFirstRe);
    if (!m) continue;
    const qty = parseInt(m[1], 10);
    const desc = m[2].trim();
    if (desc.length < 2) continue;
    const firstWord = (desc.split(/\s+/)[0] ?? "").toLowerCase();
    if (skipWords.has(firstWord)) continue;

    // Try to find unit price from price map by fuzzy match
    let unitPrice = 0;
    let currency = "EUR";
    const descLower = desc.toLowerCase();
    for (const [key, val] of Array.from(priceMap.entries())) {
      // Simple containment match
      if (descLower.includes(key) || key.includes(descLower)) {
        unitPrice = val.price;
        currency = val.currency;
        break;
      }
    }

    items.push({ description: desc, quantity: qty, unitPrice, currency });
  }

  return items;
}

export function extractSenderFromChat(chatText: string): string | null {
  const lines = chatText.split("\n");
  const timestampRe = /^\[(\d{1,2}:\d{2}),\s*\d{4}\/\d{1,2}\/\d{1,2}\]\s+([^:]+):/;
  let currentSender: string | null = null;
  for (const line of lines) {
    const m = line.match(timestampRe);
    if (m) currentSender = m[2].trim();
    const lower = line.toLowerCase();
    if (lower.includes("invoice me") || lower.includes("please invoice") || lower.includes("invoice for")) {
      return currentSender;
    }
  }
  return null;
}

export function detectPaymentsFromChat(chatText: string): Array<{ invoiceNumber: string; confidence: "high" | "medium"; rawText: string }> {
  const results: Array<{ invoiceNumber: string; confidence: "high" | "medium"; rawText: string }> = [];
  const lines = chatText.split("\n");
  const paymentKeywords = ["paid", "payment sent", "transferred", "wire transfer", "bank transfer", "i have paid", "i've paid", "payment done", "payment made", "sent the payment", "sent payment", "money sent", "already paid"];
  const invoiceRe = /(?:invoice|inv)[\s\-#]*([0-9]{3,6})/gi;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    const isPaymentLine = paymentKeywords.some(kw => line.includes(kw));
    if (!isPaymentLine) continue;
    const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join(" ");
    const rawText = lines[i].trim();
    let match;
    invoiceRe.lastIndex = 0;
    const foundNums: string[] = [];
    while ((match = invoiceRe.exec(context)) !== null) {
      const num = match[1].padStart(4, "0");
      foundNums.push(num);
      results.push({ invoiceNumber: num, confidence: "high", rawText });
    }
    if (foundNums.length === 0) {
      results.push({ invoiceNumber: "", confidence: "medium", rawText });
    }
  }
  const seen = new Set<string>();
  return results.filter(r => {
    const key = r.invoiceNumber + r.rawText;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
