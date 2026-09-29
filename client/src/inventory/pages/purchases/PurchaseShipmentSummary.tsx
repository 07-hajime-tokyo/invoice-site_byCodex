import { getPurchaseTrackingInfo } from "./carrier";
import { ExternalLink } from "lucide-react";
import { getCarrierColor } from "@/inventory/lib/tracking";
import { type Purchase } from "./types";

export function PurchaseShipmentSummary({ purchase }: { purchase: Purchase }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      <span className="text-muted-foreground">
        <span className="font-medium">発送日:</span>{" "}
        {purchase.extra?.shipDate ?? (
          <span className="italic text-muted-foreground/60">未設定</span>
        )}
      </span>
      <span className="text-muted-foreground flex items-center gap-2">
        <span className="font-medium">追跡番号:</span>{" "}
        {purchase.extra?.trackingNumber ? (
          <>
            <span className="text-foreground font-bold">
              {purchase.extra.trackingNumber}
            </span>
            {(() => {
              const manualCarrier = purchase.extra?.carrier;
              const {
                carrierKey,
                carrierName,
                url: finalUrl,
              } = getPurchaseTrackingInfo(purchase)!;
              const colorClass = getCarrierColor(
                carrierKey as Parameters<typeof getCarrierColor>[0]
              );
              return (
                <>
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs font-medium ${colorClass}`}
                  >
                    {carrierName}
                    {manualCarrier && manualCarrier !== "auto" && (
                      <span className="ml-1 opacity-70">（手動）</span>
                    )}
                  </span>
                  {(finalUrl || carrierKey === "ecohai") &&
                    (carrierKey === "ecohai" ? (
                      <button
                        type="button"
                        onClick={() => {
                          const num = purchase
                            .extra!.trackingNumber!.trim()
                            .replace(/[\s-]/g, "");
                          const form = document.createElement("form");
                          form.method = "POST";
                          form.action =
                            "https://www.ecohai.co.jp/cargo_tracking/search";
                          form.target = "_blank";
                          const input = document.createElement("input");
                          input.type = "hidden";
                          input.name = "slip[]";
                          input.value = num;
                          form.appendChild(input);
                          document.body.appendChild(form);
                          form.submit();
                          document.body.removeChild(form);
                        }}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer ${getCarrierColor("ecohai")}`}
                      >
                        <ExternalLink className="h-3 w-3" />
                        追跡
                      </button>
                    ) : (
                      <a
                        href={finalUrl!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                        追跡
                      </a>
                    ))}
                </>
              );
            })()}
          </>
        ) : (
          <span className="italic text-muted-foreground/60">未設定</span>
        )}
      </span>
    </div>
  );
}
