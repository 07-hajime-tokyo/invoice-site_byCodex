import { createZeroStockPurchaseBuilder, createZeroStockPurchaseItemsFilter } from "./stockWaiting";
import { createStockProposalBuilder } from "./stockProposalGroups";
import { actualProductTitle } from "./productTitles";

export const buildZeroStockPurchaseItemViewsFromRows = createZeroStockPurchaseBuilder(actualProductTitle);

export const zeroStockPurchaseItems = createZeroStockPurchaseItemsFilter(actualProductTitle);

export const buildStockProposalGroups = createStockProposalBuilder(actualProductTitle);
