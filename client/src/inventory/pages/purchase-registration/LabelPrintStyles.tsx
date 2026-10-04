export function LabelPrintStyles() {
  return (
    <style>{`
      .label-print-root {
        display: none;
      }

      .checklist-print-root {
        display: none;
      }

      @media print {
        @page {
          size: 210mm 297mm;
          margin: 0;
        }

        html,
        body {
          width: 210mm !important;
          min-width: 210mm !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
        }

        body {
          overflow: visible !important;
        }

        body > *:not(.label-print-root):not(.checklist-print-root):not(.docpack-print-root) {
          display: none !important;
        }

        .label-print-root {
          display: block !important;
          position: static !important;
          box-sizing: border-box;
          width: 210mm !important;
          min-height: 0;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
          color: #0f172a !important;
        }

        .label-print-sheet {
          box-sizing: border-box;
          display: grid !important;
          grid-template-columns: repeat(3, 66mm);
          grid-template-rows: repeat(8, 33.9mm);
          column-gap: 3mm;
          row-gap: 0;
          width: 210mm !important;
          height: 297mm !important;
          min-height: 297mm !important;
          margin: 0 !important;
          padding: 12.9mm 3mm;
          align-content: start;
          justify-content: start;
          overflow: hidden;
        }

        .label-print-sheet:not(:last-child) {
          break-after: page;
          page-break-after: always;
        }

        .label-print-sheet:last-child {
          break-after: auto;
          page-break-after: auto;
        }

        .label-print-item {
          box-sizing: border-box;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) 20mm;
          column-gap: 2mm;
          align-items: center;
          width: 66mm;
          height: 33.9mm;
          overflow: hidden;
          padding: 2.4mm 2.8mm;
          break-inside: avoid;
          page-break-inside: avoid;
          color: #0f172a;
          background: #fff;
          font-family: Arial, sans-serif;
        }

        .label-print-box {
          border: 1.2mm solid #0f172a;
          padding: 1.4mm 1.8mm;
        }

        .label-print-box .label-print-id {
          font-size: 17pt;
          letter-spacing: 0.12em;
        }

        .label-print-id {
          margin-bottom: 1.2mm;
          font-family: Consolas, "Courier New", monospace;
          font-size: 13pt;
          font-weight: 700;
          line-height: 1.05;
          letter-spacing: 0.08em;
        }

        .label-print-ref {
          margin-bottom: 1mm;
          overflow: hidden;
          font-size: 6.6pt;
          line-height: 1.15;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .label-print-title {
          max-height: 11mm;
          overflow: hidden;
          font-size: 7.3pt;
          font-weight: 700;
          line-height: 1.18;
        }

        .label-print-qr {
          width: 20mm;
          height: 20mm;
          justify-self: end;
        }

        .label-print-qr svg {
          display: block !important;
          width: 100% !important;
          height: 100% !important;
        }

        .checklist-print-root {
          display: block !important;
          box-sizing: border-box;
          width: 210mm !important;
          padding: 10mm 8mm;
          color: #0f172a !important;
          background: #fff !important;
          font-family: Arial, sans-serif;
        }

        .checklist-print-head {
          margin-bottom: 4mm;
          font-size: 11pt;
          font-weight: 700;
        }

        .checklist-print-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 8.6pt;
        }

        .checklist-print-table th,
        .checklist-print-table td {
          border: 0.2mm solid #94a3b8;
          padding: 1.3mm 1.6mm;
          text-align: left;
        }

        /* ページをまたいでも見出し行を繰り返す */
        .checklist-print-table thead {
          display: table-header-group;
        }

        .checklist-print-table tr {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .checklist-print-group td {
          background: #e2e8f0;
          font-weight: 700;
        }

        .checklist-print-check {
          width: 9mm;
        }

        .checklist-print-idcol {
          width: 26mm;
          font-family: Consolas, "Courier New", monospace;
          font-weight: 700;
        }
      }
    `}</style>
  );
}
