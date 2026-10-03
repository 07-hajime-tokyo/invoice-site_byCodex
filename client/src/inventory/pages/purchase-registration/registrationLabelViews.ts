import { createPurchaseLabelBuilders } from "./purchaseLabelViews";
import { actualProductTitle } from "./productTitles";

export const { buildLabelViews, buildClosedInvoiceInventoryLabelViews } = createPurchaseLabelBuilders(actualProductTitle);
