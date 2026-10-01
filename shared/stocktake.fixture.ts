import type { StocktakeSnapshot } from "./stocktake";
export const fixture: StocktakeSnapshot = {
  capturedAt: "2026-10-01T00:00:00Z",
  rows: [
    {
      id: 1,
      title: "Vita",
      category: "ゲーム",
      managementNo: "在庫1",
      quantity: 2,
      unitPrice: 100.25,
      labelIds: ["AAAAAAA", "BBBBBBB"],
    },
    {
      id: 2,
      title: "QRなし",
      category: "ゴルフ",
      managementNo: "在庫2",
      quantity: 3,
      unitPrice: 50.1,
      labelIds: [],
    },
  ],
  labels: [
    {
      code: "AAAAAAA",
      title: "Vita",
      inventoryId: 1,
      status: "stocked",
      invoiceNo: "419",
      boxCode: null,
    },
    {
      code: "BBBBBBB",
      title: "Vita",
      inventoryId: 1,
      status: "stocked",
      invoiceNo: null,
      boxCode: null,
    },
    {
      code: "CCCCCCC",
      title: "封済み",
      inventoryId: 3,
      status: "shipped",
      invoiceNo: "419",
      boxCode: "B000001",
    },
    {
      code: "DDDDDDD",
      title: "購入済み未着",
      inventoryId: null,
      status: "ordered",
      invoiceNo: null,
      boxCode: null,
    },
  ],
  boxes: [{ code: "B000001", status: "sealed", labels: ["CCCCCCC"] }],
};
