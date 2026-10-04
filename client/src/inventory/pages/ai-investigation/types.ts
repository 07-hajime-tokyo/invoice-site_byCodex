/**
 * AI調査画面の型定義。
 * AiInvestigation.tsx から逐語移動。
 */
export type EvidenceRow = Record<string, string | number | boolean | null>;
export type EvidenceSection = { title: string; rows: EvidenceRow[] };
export type InvestigationResult = {
  answer: string;
  evidence: EvidenceSection[];
  ebayOrders?: Array<{
    orderId: string;
    ok: boolean;
    status?: {
      orderFulfillmentStatus?: string | null;
      orderPaymentStatus?: string | null;
      cancelState?: string | null;
      refundStatus?: string | null;
      refundCount?: number;
      cancelRequestCount?: number;
    };
    error?: string;
  }>;
};
export type InvestigationHistoryItem = {
  id: string;
  question: string;
  includeEbay: boolean;
  createdAt: string;
  result: InvestigationResult;
  messages?: InvestigationChatMessage[];
  updatedAt?: string;
};
export type InvestigationChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  result?: InvestigationResult;
};
