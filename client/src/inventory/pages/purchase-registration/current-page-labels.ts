/** Test-only compatibility adapter: all rules now come directly from production modules. */
import { actualProductTitle } from "./productTitles";
import { buildStockItemViewsFromInventories } from "./stockViews";

export type CurrentPageLabelRules = {
  actualProductTitle: typeof actualProductTitle;
  buildStockItemViewsFromInventories: typeof buildStockItemViewsFromInventories;
};

export function loadCurrentPageLabelRules(): CurrentPageLabelRules {
  return { actualProductTitle, buildStockItemViewsFromInventories };
}
