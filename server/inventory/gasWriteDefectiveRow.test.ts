import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

class FakeRange {
  constructor(
    private sheet: FakeSheet,
    private row: number,
    private column: number,
    private rowCount = 1,
    private columnCount = 1
  ) {}

  getValues() {
    return Array.from({ length: this.rowCount }, (_unused, rowOffset) =>
      Array.from({ length: this.columnCount }, (_unusedColumn, columnOffset) =>
        this.sheet.value(this.row + rowOffset, this.column + columnOffset)
      )
    );
  }

  getDisplayValues() {
    return this.getValues().map(row => row.map(value => String(value ?? "")));
  }

  setValues(values: unknown[][]) {
    values.forEach((row, rowOffset) =>
      row.forEach((value, columnOffset) =>
        this.sheet.set(this.row + rowOffset, this.column + columnOffset, value)
      )
    );
    return this;
  }

  setValue(value: unknown) {
    this.sheet.set(this.row, this.column, value);
    return this;
  }

  setWrap(_value: boolean) {
    return this;
  }
}

class FakeSheet {
  rows: unknown[][] = [];

  value(row: number, column: number) {
    return this.rows[row - 1]?.[column - 1] ?? "";
  }

  set(row: number, column: number, value: unknown) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push("");
    this.rows[row - 1][column - 1] = value;
  }

  getLastRow() {
    let last = 0;
    this.rows.forEach((row, index) => {
      if (row.some(value => value !== "" && value != null)) last = index + 1;
    });
    return last;
  }

  getLastColumn() {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }

  getRange(row: number, column: number, rowCount = 1, columnCount = 1) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }

  setFrozenRows(_count: number) {}
}

describe("writeDefectiveRow.gs", () => {
  it("upserts by product ID and leaves the four human columns untouched", () => {
    const sheet = new FakeSheet();
    const spreadsheet = {
      getSheetByName: (_name: string) => (sheet.getLastRow() ? sheet : null),
      insertSheet: (_name: string) => sheet,
    };
    const context = {
      SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
      LockService: {
        getScriptLock: () => ({
          waitLock: (_ms: number) => {},
          releaseLock: () => {},
        }),
      },
      Utilities: {
        formatDate: (date: Date, _zone: string, format: string) =>
          format.includes("HH:mm")
            ? date.toISOString().slice(0, 16)
            : date.toISOString().slice(0, 10),
      },
    } as Record<string, unknown>;
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../gas/writeDefectiveRow.gs"),
      "utf8"
    );
    vm.runInNewContext(source, context);
    const handler = context.handleWriteDefectiveRow_ as (
      payload: Record<string, unknown>
    ) => unknown;
    const basePayload = {
      action: "writeDefectiveRow",
      productId: "ABC1234",
      inspectedAt: "2026-08-14T00:00:00Z",
      productName: "old",
      defectTags: "起動しない",
      photos: ["https://storage.test/1.jpg"],
      photoCount: 1,
      adoptedCount: 2,
      median: 2000,
      marketMin: 1000,
      marketMax: 3000,
      samples: [],
      fetchedAt: "2026-08-14T00:00:00Z",
      listingTitle: "title",
      listingDescription: "description",
    };
    handler(basePayload);

    const headers = sheet.rows[0] as string[];
    const humanValues: Record<string, unknown> = {
      開始価格: 1,
      出品ステータス: "出品中",
      出品URL: "https://auctions.test/item",
      落札額: 9250,
    };
    for (const [header, value] of Object.entries(humanValues)) {
      sheet.set(2, headers.indexOf(header) + 1, value);
    }
    handler({ ...basePayload, productName: "new", photoCount: 0, photos: [] });

    expect(sheet.getLastRow()).toBe(2);
    expect(sheet.value(2, headers.indexOf("商品名") + 1)).toBe("new");
    for (const [header, value] of Object.entries(humanValues)) {
      expect(sheet.value(2, headers.indexOf(header) + 1)).toBe(value);
    }
  });
});
