import { load } from "cheerio";

export type YahooClosedPriceSample = {
  title: string;
  price: number;
  startPrice: number;
  bids: number;
  endedAt: string;
  url: string;
};

export type YahooClosedPrices = {
  keyword: string;
  fetchedAt: string;
  summary180d: { min: number; avg: number; max: number; count: number };
  adopted: {
    count: number;
    median: number | null;
    min: number | null;
    max: number | null;
  };
  samples: YahooClosedPriceSample[];
};

type RawYahooItem = YahooClosedPriceSample & { isStore: boolean };

const EXCLUDED_WORDS = ["まとめ", "セット", "大量", "一括", "部品取り"];
const QUANTITY_EXPRESSION = /\d+\s*(?:台|個|点|枚|本|セット)/u;
const YAHOO_CLOSED_SEARCH =
  "https://auctions.yahoo.co.jp/closedsearch/closedsearch";
const USER_AGENT =
  "invoice-site-bycodex/1.0 (+public-market-research; no-cookie)";
const MIN_REQUEST_INTERVAL_MS = 2_000;

let lastRequestStartedAt = 0;

function amount(value: unknown): number {
  const parsed = Number(
    String(value ?? "")
      .normalize("NFKC")
      .replace(/[^\d.-]/g, "")
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function walkObjects(
  value: unknown,
  visit: (record: Record<string, unknown>) => void
) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visit);
    return;
  }
  const record = value as Record<string, unknown>;
  visit(record);
  for (const child of Object.values(record)) walkObjects(child, visit);
}

function parseEmbeddedItems(html: string, fetchedAt: Date): RawYahooItem[] {
  const $ = load(html);
  const rawNextData = $("script#__NEXT_DATA__").text();
  if (!rawNextData) return [];

  let nextData: unknown;
  try {
    nextData = JSON.parse(rawNextData);
  } catch {
    return [];
  }

  const byAuctionId = new Map<string, RawYahooItem>();
  walkObjects(nextData, record => {
    const auctionId =
      typeof record.auctionId === "string" ? record.auctionId : "";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const endedAt = typeof record.endTime === "string" ? record.endTime : "";
    const price = amount(record.price);
    const seller = record.seller as Record<string, unknown> | undefined;
    if (!auctionId || !title || !endedAt || !price || !seller) return;

    const endedTime = Date.parse(endedAt);
    if (
      !Number.isFinite(endedTime) ||
      endedTime > fetchedAt.getTime() + 5 * 60_000
    )
      return;
    byAuctionId.set(auctionId, {
      title,
      price,
      startPrice: amount(record.initPriceNoTax),
      bids: amount(record.bidCount),
      endedAt: new Date(endedTime).toISOString(),
      url: `https://auctions.yahoo.co.jp/jp/auction/${encodeURIComponent(auctionId)}`,
      isStore: seller.isStore === true,
    });
  });
  return Array.from(byAuctionId.values());
}

function summaryValue(html: string, label: string): number {
  const $ = load(html);
  const term = $("dt")
    .filter((_index, element) => $(element).text().trim() === label)
    .first();
  return amount(term.next("dd").text());
}

function parseSummary(html: string) {
  const $ = load(html);
  const description = $('meta[name="description"]').attr("content") ?? "";
  const countMatch =
    description.match(/約?([\d,]+)件/u) ?? $.text().match(/約?([\d,]+)件/u);
  return {
    min: summaryValue(html, "最安"),
    avg: summaryValue(html, "平均"),
    max: summaryValue(html, "最高"),
    count: amount(countMatch?.[1]),
  };
}

export function isAdoptedYahooItem(
  item: Pick<RawYahooItem, "title" | "isStore">
) {
  if (EXCLUDED_WORDS.some(word => item.title.includes(word))) return false;
  if (QUANTITY_EXPRESSION.test(item.title.normalize("NFKC"))) return false;
  if (item.isStore) return false;
  return true;
}

export function parseYahooClosedPricesHtml(
  html: string,
  keyword: string,
  fetchedAt = new Date()
): YahooClosedPrices {
  const adoptedItems = parseEmbeddedItems(html, fetchedAt)
    .filter(isAdoptedYahooItem)
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
  const prices = adoptedItems.map(item => item.price);
  return {
    keyword,
    fetchedAt: fetchedAt.toISOString(),
    summary180d: parseSummary(html),
    adopted: {
      count: adoptedItems.length,
      median: median(prices),
      min: prices.length > 0 ? Math.min(...prices) : null,
      max: prices.length > 0 ? Math.max(...prices) : null,
    },
    samples: adoptedItems
      .slice(0, 5)
      .map(({ isStore: _isStore, ...item }) => item),
  };
}

function emptyResult(keyword: string, fetchedAt: Date): YahooClosedPrices {
  return {
    keyword,
    fetchedAt: fetchedAt.toISOString(),
    summary180d: { min: 0, avg: 0, max: 0, count: 0 },
    adopted: { count: 0, median: null, min: null, max: null },
    samples: [],
  };
}

async function waitForRateLimit(
  now: () => number,
  sleep: (ms: number) => Promise<void>
) {
  const remaining = MIN_REQUEST_INTERVAL_MS - (now() - lastRequestStartedAt);
  if (remaining > 0) await sleep(remaining);
  lastRequestStartedAt = now();
}

export async function fetchYahooClosedPrices(
  keyword: string,
  options: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {}
): Promise<YahooClosedPrices> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const normalizedKeyword = keyword.normalize("NFKC").trim();
  const url = new URL(YAHOO_CLOSED_SEARCH);
  url.searchParams.set("p", normalizedKeyword);
  url.searchParams.set("va", normalizedKeyword);
  url.searchParams.set("b", "1");
  url.searchParams.set("n", "100");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fetchedAt = new Date(now());
    try {
      await waitForRateLimit(now, sleep);
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
      });
      if (!response.ok)
        throw new Error(`Yahoo closed search returned HTTP ${response.status}`);
      return parseYahooClosedPricesHtml(
        await response.text(),
        normalizedKeyword,
        fetchedAt
      );
    } catch (error) {
      console.warn(`[yahoo-closed-prices] attempt ${attempt + 1}/3 failed`, {
        keyword: normalizedKeyword,
        error: error instanceof Error ? error.message : String(error),
      });
      if (attempt < 2) await sleep(2 ** attempt * 1_000);
    }
  }
  return emptyResult(normalizedKeyword, new Date(now()));
}
