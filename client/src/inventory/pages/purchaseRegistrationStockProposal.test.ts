import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  normalizeStockProposalTitleForGrouping,
  stockProposalProductKey,
} from "./purchaseRegistrationStockProposal";

describe("purchase registration stock proposal grouping", () => {
  it("Vita1100 is grouped as Vita1000", () => {
    assert.equal(
      normalizeStockProposalTitleForGrouping("Vita 1100 コズミックレッド"),
      "Vita 1000 コズミックレッド",
    );
    assert.equal(
      stockProposalProductKey("Vita 1100 コズミックレッド"),
      stockProposalProductKey("Vita 1000 コズミックレッド"),
    );
  });

  it("treats cosmic red with and without middle dot as the same product", () => {
    assert.equal(
      stockProposalProductKey("Vita 1000 コズミック・レッド"),
      stockProposalProductKey("Vita 1000 コズミックレッド"),
    );
  });
});
