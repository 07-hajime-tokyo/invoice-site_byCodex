import { type EditState } from "./types";

export function createEmptyEditState(): EditState {
  return {
    shipDate: "",
    trackingNumber: "",
    carrier: "auto",
    note: "",
    supplierName: "",
    supplierUrl: "",
    itemEdits: {},
  };
}
