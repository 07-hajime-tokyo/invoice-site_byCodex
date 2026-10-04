import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { OUTBOUND_BOX_CODE_PATTERN } from "@shared/outboundBoxes";
import { clampLabelStartPosition, chunkArray, LABELS_PER_SHEET } from "./labelPrintLayout";
import type { LabelView } from "./viewTypes";
import { ProductQrCode } from "./ProductQrCode";

export function PrintableLabelSheet({ labels, startPosition = 1 }: { labels: LabelView[]; startPosition?: number }) {
  const printableLabels = labels.filter((label) => label.labelId.trim());
  if (printableLabels.length === 0) return null;

  // 使いかけシートの手前の面は空送りする。
  const blankCount = clampLabelStartPosition(startPosition) - 1;
  const slots: Array<LabelView | null> = [...Array<null>(blankCount).fill(null), ...printableLabels];
  const labelPages = chunkArray(slots, LABELS_PER_SHEET);
  const sheet = (
    <div className="label-print-root" aria-hidden="true">
      {labelPages.map((pageSlots, pageIndex) => (
        <div key={`label-page-${pageIndex}`} className="label-print-sheet">
          {pageSlots.map((label, slotIndex) =>
            label ? (
              <div
                key={label.key}
                className={cn(
                  "label-print-item",
                  // 箱ID（B+6桁）だけ枠を付ける。商品IDは英字7文字なので B 始まりが普通にある
                  // （BARDNSY など）。startsWith("B") だと商品ラベルまで黒枠になっていた。
                  OUTBOUND_BOX_CODE_PATTERN.test(label.labelId) && "label-print-box",
                )}
              >
                <div>
                  <div className="label-print-id">{label.labelId}</div>
                  {label.allocationLabel ? <div className="label-print-ref">{label.allocationLabel}</div> : null}
                  <div className="label-print-title">{label.printTitle}</div>
                </div>
                <div className="label-print-qr">
                  <ProductQrCode value={label.labelId} />
                </div>
              </div>
            ) : (
              <div key={`label-blank-${pageIndex}-${slotIndex}`} className="label-print-item label-print-blank" />
            ),
          )}
        </div>
      ))}
    </div>
  );

  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body);
}
