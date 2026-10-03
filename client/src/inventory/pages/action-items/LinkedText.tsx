import { Fragment, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizeExternalUrl } from "@/inventory/lib/supplier";

export function getDeliveryHistoryLink(item: {
  detail: string;
  sourceKey?: string | null;
}) {
  const historyId = item.sourceKey?.match(/^fedex-missing-history:(\d+)$/)?.[1];
  if (!historyId) return null;
  const deliveryNo = item.detail.match(/出庫No:\s*([^\n]+)/)?.[1]?.trim();
  if (!deliveryNo) return null;
  const group =
    deliveryNo.match(/^(\d{3,4})/)?.[1] ??
    deliveryNo.split("_")[0] ??
    deliveryNo;
  return {
    historyId,
    deliveryNo,
    url: `/inventory/delivery-history?group=${encodeURIComponent(group)}&historyId=${encodeURIComponent(historyId)}`,
  };
}

const DETAIL_MARKDOWN_LINK_RE = /\[([^\]\n]{1,40})\]\((https?:\/\/[^\s)]+)\)/g;

const DETAIL_RAW_URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

const TRAILING_URL_PUNCTUATION_RE = /[.,!?;:、。！？；：)\]\}」』】》]+$/;

function normalizeSafeDetailUrl(url: string) {
  const normalized = normalizeExternalUrl(url);
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

function splitUrlTrailingPunctuation(value: string): {
  urlText: string;
  trailingText: string;
} {
  const match = value.match(TRAILING_URL_PUNCTUATION_RE);
  if (!match?.[0]) return { urlText: value, trailingText: "" };
  return {
    urlText: value.slice(0, -match[0].length),
    trailingText: match[0],
  };
}

function detailExternalLink(label: string, url: string, key: string) {
  return (
    <a
      key={key}
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center break-all text-blue-700 underline underline-offset-2 hover:text-blue-900"
    >
      {label}
      <ExternalLink className="ml-1 h-3 w-3 shrink-0" />
    </a>
  );
}

function renderRawUrlText(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(DETAIL_RAW_URL_RE)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const { urlText, trailingText } = splitUrlTrailingPunctuation(raw);
    const url = normalizeSafeDetailUrl(urlText);
    if (!url) continue;

    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    parts.push(
      detailExternalLink(urlText, url, `${keyPrefix}-${index}-${url}`)
    );
    if (trailingText) parts.push(trailingText);
    lastIndex = index + raw.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function renderLinkedTextLine(line: string) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of line.matchAll(DETAIL_MARKDOWN_LINK_RE)) {
    const [raw, label, rawUrl] = match;
    const index = match.index ?? 0;
    const url = normalizeSafeDetailUrl(rawUrl);
    if (!url) continue;

    if (index > lastIndex) {
      parts.push(
        ...renderRawUrlText(line.slice(lastIndex, index), `text-${lastIndex}`)
      );
    }
    parts.push(detailExternalLink(label, url, `markdown-${index}-${url}`));
    lastIndex = index + raw.length;
  }

  if (lastIndex < line.length) {
    parts.push(...renderRawUrlText(line.slice(lastIndex), `text-${lastIndex}`));
  }
  return parts.length > 0 ? parts : line || "\u00a0";
}

export function LinkedText({ value }: { value: string }) {
  return (
    <>
      {value.split("\n").map((line, index) => (
        <Fragment key={`${index}-${line}`}>
          {index > 0 ? "\n" : null}
          {renderLinkedTextLine(line)}
        </Fragment>
      ))}
    </>
  );
}

export function ActionItemDetail({
  detail,
  deliveryLink,
  onNavigate,
}: {
  detail: string;
  deliveryLink: ReturnType<typeof getDeliveryHistoryLink>;
  onNavigate: (url: string) => void;
}) {
  return (
    <div className="text-sm whitespace-pre-wrap leading-6">
      {detail.split("\n").map((line, index) => {
        const lineDeliveryLink =
          deliveryLink && line.trim().startsWith("出庫No:")
            ? deliveryLink
            : null;
        return (
          <div key={`${index}-${line}`}>
            {lineDeliveryLink ? (
              <span>
                出庫No:{" "}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 align-baseline font-mono text-sm"
                  onClick={() => onNavigate(lineDeliveryLink.url)}
                >
                  {lineDeliveryLink.deliveryNo}
                  <ExternalLink className="ml-1 h-3 w-3" />
                </Button>
              </span>
            ) : (
              renderLinkedTextLine(line)
            )}
          </div>
        );
      })}
    </div>
  );
}
