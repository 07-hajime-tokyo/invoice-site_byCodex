import type { InvoiceClientOption } from "./types";

export function getDefaultCurrencyForClient(client: { name?: string | null; company?: string | null } | null | undefined) {
  const text = `${client?.name ?? ""} ${client?.company ?? ""}`.normalize("NFKC").toLowerCase();
  return text.includes("luca") ||
    text.includes("ルカ") ||
    text.includes("simon") ||
    text.includes("サイモン") ||
    text.includes("hennes kamusien") ||
    text.includes("maxim") ||
    text.includes("マキシム") ||
    text.includes("nele") ||
    text.includes("ネレ")
    ? "EUR"
    : "USD";
}

export function normalizeClientLookupText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^~\s*/, "")
    .replace(/[^\p{L}\p{N}@+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function phoneDigits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

export function findClientByDetectedSender(clients: InvoiceClientOption[], detectedSender: string | null | undefined) {
  const sender = normalizeClientLookupText(detectedSender);
  if (!sender) return null;
  const senderDigits = phoneDigits(sender);

  return clients.find((client) => {
    const candidates = [client.name, client.company, client.email]
      .map(normalizeClientLookupText)
      .filter(Boolean);
    const textMatch = candidates.some((candidate) =>
      candidate.length >= 2 && (sender.includes(candidate) || candidate.includes(sender))
    );
    if (textMatch) return true;

    const clientDigits = phoneDigits(client.phone);
    return Boolean(
      senderDigits.length >= 7 &&
      clientDigits.length >= 7 &&
      (senderDigits.includes(clientDigits) || clientDigits.includes(senderDigits))
    );
  }) ?? null;
}

