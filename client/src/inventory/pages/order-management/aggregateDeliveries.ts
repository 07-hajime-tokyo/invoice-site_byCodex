import { normalizeLooseText } from "./colorMatching";
import { findDeliveryCsvProduct } from "./csvProductMatching";
import { cleanDeliveryProductTitle, deliveryDateKey, sameValueOrLabel } from "./display";
import type { AggregatedDeliveryItem, SummaryItem } from "./types";

export function aggregateDeliveryItems(item: SummaryItem): AggregatedDeliveryItem[] {
  const groups = new Map<string, AggregatedDeliveryItem>();

  for (const delivery of item.deliveryItems) {
    const linkedProduct = findDeliveryCsvProduct(item, delivery);
    const title = linkedProduct?.name ?? cleanDeliveryProductTitle(delivery.title);
    const key = normalizeLooseText(title);
    const existing = groups.get(key);

    if (existing) {
      existing.quantity += delivery.quantity;
      existing.items.push(delivery);
    } else {
      groups.set(key, {
        key,
        title,
        quantity: delivery.quantity,
        deliveryNo: delivery.deliveryNo,
        managementNo: delivery.managementNo,
        deliveredAt: delivery.deliveredAt,
        deliveredDateKey: deliveryDateKey(delivery.deliveredAt),
        items: [delivery],
      });
    }
  }

  return Array.from(groups.values())
    .map((group) => {
      const dates = group.items.map((delivery) => deliveryDateKey(delivery.deliveredAt));
      return {
        ...group,
        deliveryNo: sameValueOrLabel(group.items.map((delivery) => delivery.deliveryNo), "複数"),
        managementNo: sameValueOrLabel(group.items.map((delivery) => delivery.managementNo), ""),
        deliveredAt: group.items[0]?.deliveredAt ?? "",
        deliveredDateKey: sameValueOrLabel(dates, ""),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "ja"));
}
