import { createPortal } from "react-dom";
import type { InboundInvoiceRollup } from "../lib/inboundDesk";

/**
 * 充足一覧とインボイス内訳を紙に出す。
 *
 * 方針（2026-08-15 村上さん決定）:
 * - 1ページに4枚。既定は「一覧1枚＋内訳3枚」
 * - 余白は詰めてよい。レターヘッド・ロゴ・装飾は載せない
 * - 読めればよいのは内訳・数量。机の上で数を突き合わせるための紙
 */

export type PrintPackMode = "summary" | "full" | "daily";

export type DailyActivityEntry = {
  id: number;
  kind: "receipt" | "inspection";
  labelId: string;
  title: string;
  legacyManagementNo: string;
  worker: string;
  outcome: string | null;
  requestReplacement: boolean | null;
  at: string | null;
};

export type DailyActivity = {
  date: string;
  receipts: DailyActivityEntry[];
  inspections: DailyActivityEntry[];
};

const CARDS_PER_PAGE = 4;

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

export function InvoicePrintPackStyles() {
  return (
    <style>{`
      .docpack-print-root { display: none; }

      @media print {
        @page { size: 210mm 297mm; margin: 6mm; }

        html, body {
          width: 210mm !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
        }

        /*
         * 印刷ルートは複数ある（ラベル・確認シート・この一覧）。
         * ここで自分以外を全部隠すと、同じ画面に同居している他の印刷ルートまで消えて白紙になる。
         * 実際に荷受け画面で箱シールが白紙で出た（2026-08-15）。3つとも除外する。
         */
        body > *:not(.docpack-print-root):not(.label-print-root):not(.checklist-print-root) {
          display: none !important;
        }

        .docpack-print-root {
          display: block !important;
          color: #0f172a !important;
          font-size: 8pt;
          line-height: 1.25;
        }

        .docpack-page {
          box-sizing: border-box;
          display: grid !important;
          grid-template-columns: repeat(2, 1fr);
          grid-template-rows: repeat(2, 1fr);
          gap: 3mm;
          height: 279mm;
          page-break-after: always;
          break-after: page;
        }

        .docpack-page:last-child { page-break-after: auto; break-after: auto; }

        .docpack-card {
          box-sizing: border-box;
          border: 0.3mm solid #94a3b8;
          padding: 2.5mm;
          overflow: hidden;
        }

        .docpack-card-head {
          font-size: 9pt;
          font-weight: 700;
          border-bottom: 0.3mm solid #cbd5e1;
          padding-bottom: 1mm;
          margin-bottom: 1.5mm;
        }

        .docpack-card-sub {
          font-size: 7pt;
          font-weight: 400;
          color: #475569;
        }

        .docpack-table { width: 100%; border-collapse: collapse; }

        .docpack-table th,
        .docpack-table td {
          border-bottom: 0.2mm solid #e2e8f0;
          padding: 0.8mm 1mm;
          text-align: left;
          vertical-align: top;
        }

        .docpack-table th {
          font-size: 7pt;
          font-weight: 600;
          color: #475569;
          white-space: nowrap;
        }

        .docpack-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .docpack-short { color: #b91c1c; font-weight: 700; }
        .docpack-name { word-break: break-all; }
      }
    `}</style>
  );
}

function SummaryCard({ rollups, printedAt }: { rollups: InboundInvoiceRollup[]; printedAt: string }) {
  return (
    <div className="docpack-card">
      <div className="docpack-card-head">
        引当先ごとの充足状況
        <span className="docpack-card-sub">　{printedAt} 時点</span>
      </div>
      <table className="docpack-table">
        <thead>
          <tr>
            <th>引当先</th>
            <th className="docpack-num">受注</th>
            <th className="docpack-num">出庫済</th>
            <th className="docpack-num">在庫確保</th>
            <th className="docpack-num">検品待ち</th>
            <th className="docpack-num">なお不足</th>
          </tr>
        </thead>
        <tbody>
          {rollups.map((rollup) => (
            <tr key={rollup.key}>
              <td className="docpack-name">
                No.{rollup.key} {rollup.partner}
              </td>
              <td className="docpack-num">{rollup.csvOrderQty}</td>
              <td className="docpack-num">{rollup.deliveredCount}</td>
              <td className="docpack-num">{rollup.stockCount}</td>
              <td className="docpack-num">{rollup.inboundCount}</td>
              <td className={rollup.stillShortAfterInbound > 0 ? "docpack-num docpack-short" : "docpack-num"}>
                {rollup.stillShortAfterInbound}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceCard({ rollup }: { rollup: InboundInvoiceRollup }) {
  return (
    <div className="docpack-card">
      <div className="docpack-card-head">
        No.{rollup.key} {rollup.partner}
        <span className="docpack-card-sub">
          　受注 {rollup.csvOrderQty} ／ 出庫済 {rollup.deliveredCount} ／ 在庫確保 {rollup.stockCount} ／ 検品待ち{" "}
          {rollup.inboundCount} ／ なお不足 {rollup.stillShortAfterInbound}
        </span>
      </div>
      <table className="docpack-table">
        <thead>
          <tr>
            <th>品目</th>
            <th className="docpack-num">数量</th>
            <th>状況</th>
          </tr>
        </thead>
        <tbody>
          {rollup.csvProducts.map((product, index) => (
            <tr key={`${rollup.key}-${product.name}-${index}`}>
              <td className="docpack-name">{product.name}</td>
              <td className="docpack-num">{product.qty}</td>
              <td>{product.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatClock(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function ActivityCard({
  heading,
  entries,
  showOutcome,
}: {
  heading: string;
  entries: DailyActivityEntry[];
  showOutcome: boolean;
}) {
  return (
    <div className="docpack-card">
      <div className="docpack-card-head">
        {heading}
        <span className="docpack-card-sub">　{entries.length}件</span>
      </div>
      {entries.length === 0 ? (
        <div className="docpack-card-sub">この日の記録はありません</div>
      ) : (
        <table className="docpack-table">
          <thead>
            <tr>
              <th className="docpack-num">時刻</th>
              <th>商品ID</th>
              <th>品名</th>
              {showOutcome ? <th>判定</th> : null}
              <th>担当</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="docpack-num">{formatClock(entry.at)}</td>
                <td>{entry.labelId}</td>
                <td className="docpack-name">{entry.title}</td>
                {showOutcome ? (
                  <td>
                    {entry.outcome ?? ""}
                    {entry.requestReplacement ? "／代替品依頼" : ""}
                  </td>
                ) : null}
                <td>{entry.worker}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function InvoicePrintPack({
  rollups,
  mode,
  printedAt,
  activity,
}: {
  rollups: InboundInvoiceRollup[];
  mode: PrintPackMode | null;
  printedAt: string;
  activity?: DailyActivity | null;
}) {
  if (!mode) return null;
  if (mode === "daily" && !activity) return null;
  if (mode !== "daily" && rollups.length === 0) return null;

  const cards: React.ReactNode[] = [];

  if (mode === "daily" && activity) {
    // 1枚に収まらないぶんは続きのカードへ送る。1カードあたり28行を目安にする。
    const ROWS_PER_CARD = 28;
    const push = (heading: string, entries: DailyActivityEntry[], showOutcome: boolean) => {
      const pages = entries.length === 0 ? [[]] : chunk(entries, ROWS_PER_CARD);
      pages.forEach((pageEntries, index) => {
        cards.push(
          <ActivityCard
            key={`${heading}-${index}`}
            heading={pages.length > 1 ? `${heading}（${index + 1}/${pages.length}）` : heading}
            entries={pageEntries}
            showOutcome={showOutcome}
          />
        );
      });
    };
    push(`${activity.date} 荷受け`, activity.receipts, false);
    push(`${activity.date} 動作確認`, activity.inspections, true);
  } else {
    cards.push(<SummaryCard key="summary" rollups={rollups} printedAt={printedAt} />);
    if (mode === "full") {
      for (const rollup of rollups) {
        cards.push(<InvoiceCard key={`invoice-${rollup.key}`} rollup={rollup} />);
      }
    }
  }

  const pages = chunk(cards, CARDS_PER_PAGE);
  const sheet = (
    <div className="docpack-print-root" aria-hidden="true">
      {pages.map((pageCards, pageIndex) => (
        <div key={`docpack-page-${pageIndex}`} className="docpack-page">
          {pageCards}
        </div>
      ))}
    </div>
  );

  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body);
}
