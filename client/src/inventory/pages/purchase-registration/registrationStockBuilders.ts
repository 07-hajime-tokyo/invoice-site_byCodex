import { createInboundWaitingStockBuilder } from "./stockWaiting";
import { createStockProposalBuilder } from "./stockProposalGroups";
import { actualProductTitle } from "./productTitles";

export const buildInboundWaitingStockItemViewsFromRows = createInboundWaitingStockBuilder(actualProductTitle);

export const buildStockProposalGroups = createStockProposalBuilder(actualProductTitle);
