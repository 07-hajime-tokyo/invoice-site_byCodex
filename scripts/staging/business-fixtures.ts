import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  actionItems,
  customers,
  deliveryHistories,
  fedexShipments,
  invoiceClients,
  invoiceItems,
  invoices,
  inventoryItemLabels,
  localInventories,
  localPurchases,
  outboundBoxes,
  purchaseHistories,
  shipmentItems,
  shipments,
  tradeRecords,
  workLogs,
} from "../../drizzle/schema";

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export const BUSINESS_FIXTURE_ID_BASE = 9_600_000;
export const BUSINESS_FIXTURE_INVOICE_NO = 96_001;
export const BUSINESS_FIXTURE_VERSION = 1;

export type BusinessFixtureTables = {
  invoice_clients: Insert<typeof invoiceClients>[];
  invoices: Insert<typeof invoices>[];
  invoice_items: Insert<typeof invoiceItems>[];
  trade_records: Insert<typeof tradeRecords>[];
  customers: Insert<typeof customers>[];
  local_inventories: Insert<typeof localInventories>[];
  local_purchases: Insert<typeof localPurchases>[];
  purchase_histories: Insert<typeof purchaseHistories>[];
  inventory_item_labels: Insert<typeof inventoryItemLabels>[];
  outbound_boxes: Insert<typeof outboundBoxes>[];
  delivery_histories: Insert<typeof deliveryHistories>[];
  shipments: Insert<typeof shipments>[];
  shipment_items: Insert<typeof shipmentItems>[];
  fedex_shipments: Insert<typeof fedexShipments>[];
  action_items: Insert<typeof actionItems>[];
  work_logs: Insert<typeof workLogs>[];
};

export type DeclarationSummary = {
  matchedQuantity: number;
  unmatchedLabelIds: string[];
  totals: Array<{ currency: string; quantity: number; amount: number }>;
};

export type BusinessFixtureBundle = {
  format: "staging-business-fixtures";
  version: typeof BUSINESS_FIXTURE_VERSION;
  generatedAt: string;
  idPolicy: { minimum: number; maximum: number; invoiceNo: number };
  scenarioExpectations: {
    orderedNotReceived: { purchaseId: number; ordered: 5; received: 0 };
    partiallyReceived: { purchaseId: number; ordered: 5; received: 2 };
    fullyReceived: { purchaseId: number; ordered: 5; received: 5 };
    partiallyShipped: {
      purchaseId: number;
      ordered: 10;
      shipped: 5;
      remaining: 5;
    };
    lateInvoiceAssignment: {
      boxId: number;
      labelId: string;
      before: DeclarationSummary;
      after: DeclarationSummary;
    };
  };
  tables: BusinessFixtureTables;
  afterLateInvoiceAssignment: {
    inventory_item_labels: BusinessFixtureTables["inventory_item_labels"];
  };
  coverage: {
    coveredTables: Array<keyof BusinessFixtureTables>;
    uncoveredTableCount: number;
    note: string;
  };
};

const at = (iso: string) => new Date(iso);
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function labelId(index: number): string {
  let value = index;
  let suffix = "";
  for (let position = 0; position < 4; position += 1) {
    suffix = ALPHABET[value % ALPHABET.length] + suffix;
    value = Math.floor(value / ALPHABET.length);
  }
  return `ZZZ${suffix}`;
}

type ProductPlan = {
  offset: number;
  title: string;
  ordered: number;
  received: number;
  shipped: number;
  managementNo: string;
  unitCost: number;
};

const plans: ProductPlan[] = [
  {
    offset: 10,
    title: "架空ゲーム機 未入庫モデル",
    ordered: 5,
    received: 0,
    shipped: 0,
    managementNo: "96001_架空商会_未入庫",
    unitCost: 11_000,
  },
  {
    offset: 20,
    title: "架空ゲーム機 部分入庫モデル",
    ordered: 5,
    received: 2,
    shipped: 0,
    managementNo: "96001_架空商会_部分入庫",
    unitCost: 12_000,
  },
  {
    offset: 30,
    title: "架空ゲーム機 全部入庫モデル",
    ordered: 5,
    received: 5,
    shipped: 0,
    managementNo: "96001_架空商会_全部入庫",
    unitCost: 13_000,
  },
  {
    offset: 40,
    title: "架空ゲーム機 部分発送モデル",
    ordered: 10,
    received: 10,
    shipped: 5,
    managementNo: "96001_架空商会_部分発送",
    unitCost: 14_000,
  },
];

function purchaseItem(plan: ProductPlan, inventoryId: number) {
  return {
    id: 0,
    title: plan.title,
    quantity: String(plan.ordered),
    unit_price: plan.unitCost,
    etc: plan.managementNo,
    status: plan.received === plan.ordered ? "purchased" : "ordered",
    inventory_id: inventoryId,
    inventoryId,
  };
}

export function calculateDeclarationSummary(
  labels: Array<
    Pick<
      Insert<typeof inventoryItemLabels>,
      "labelId" | "assignedInvoiceNo" | "legacyManagementNo" | "title"
    >
  >,
  trades: Array<
    Pick<
      Insert<typeof tradeRecords>,
      "no" | "currency" | "unitPrice" | "productName"
    >
  >
): DeclarationSummary {
  const totals = new Map<
    string,
    { currency: string; quantity: number; amount: number }
  >();
  const unmatchedLabelIds: string[] = [];
  for (const label of labels) {
    const assigned = String(label.assignedInvoiceNo ?? "").trim();
    const inferred =
      String(label.legacyManagementNo ?? "").match(/^(\d{3,5})(?:_|$)/)?.[1] ??
      "";
    const invoiceNo = assigned || inferred;
    const trade = trades.find(
      row =>
        Number(row.no) === Number(invoiceNo) &&
        String(row.productName ?? "").trim() === String(label.title).trim()
    );
    if (!trade || trade.unitPrice == null) {
      unmatchedLabelIds.push(String(label.labelId));
      continue;
    }
    const currency = String(trade.currency ?? "").trim() || "JPY";
    const current = totals.get(currency) ?? {
      currency,
      quantity: 0,
      amount: 0,
    };
    current.quantity += 1;
    current.amount += Number(trade.unitPrice);
    totals.set(currency, current);
  }
  return {
    matchedQuantity: labels.length - unmatchedLabelIds.length,
    unmatchedLabelIds,
    totals: [...totals.values()].sort((a, b) =>
      a.currency.localeCompare(b.currency)
    ),
  };
}

export function createBusinessFixtureBundle(): BusinessFixtureBundle {
  const createdAt = at("2026-09-01T00:00:00.000Z");
  const receivedAt = at("2026-09-03T01:00:00.000Z");
  const shippedAt = at("2026-09-05T02:00:00.000Z");
  const clientId = BUSINESS_FIXTURE_ID_BASE + 1;
  const invoiceId = BUSINESS_FIXTURE_ID_BASE + 2;
  const shipmentId = BUSINESS_FIXTURE_ID_BASE + 3;
  const boxId = BUSINESS_FIXTURE_ID_BASE + 4;
  const deliveryId = BUSINESS_FIXTURE_ID_BASE + 5;
  const fedexId = BUSINESS_FIXTURE_ID_BASE + 6;
  let nextLabelIndex = 0;

  const inventoryRows: BusinessFixtureTables["local_inventories"] = [];
  const purchaseRows: BusinessFixtureTables["local_purchases"] = [];
  const historyRows: BusinessFixtureTables["purchase_histories"] = [];
  const labels: BusinessFixtureTables["inventory_item_labels"] = [];

  for (const plan of plans) {
    const inventoryId = BUSINESS_FIXTURE_ID_BASE + plan.offset;
    const purchaseId = BUSINESS_FIXTURE_ID_BASE + plan.offset + 1;
    inventoryRows.push({
      id: inventoryId,
      zaicoId: null,
      title: plan.title,
      category: "検証用",
      place: "架空倉庫A",
      quantity: plan.received - plan.shipped,
      unit: "個",
      unitPrice: plan.unitCost.toFixed(2),
      etc: plan.managementNo,
      supplierUrl: null,
      supplierName: "架空仕入先",
      ebayListingUrl: null,
      ebayOrderUrl: null,
      ebayOrderStatus: "normal",
      isDeleted: 0,
      createdAt,
      updatedAt: createdAt,
    });
    purchaseRows.push({
      id: purchaseId,
      zaicoId: null,
      purchaseNum: `STG-${purchaseId}`,
      status: plan.received === plan.ordered ? "purchased" : "ordered",
      itemsJson: JSON.stringify([purchaseItem(plan, inventoryId)]),
      localInventoryId: inventoryId,
      title: plan.title,
      category: "検証用",
      quantity: plan.ordered,
      unitPrice: plan.unitCost.toFixed(2),
      managementNo: plan.managementNo,
      purchaseDate: "2026-09-01",
      receivedDate: plan.received === plan.ordered ? "2026-09-03" : null,
      shipDate: "2026-09-02",
      trackingNumber: `FAKE-IN-${plan.offset}`,
      carrier: "架空配送",
      note: "検証専用の架空発注",
      supplierUrl: null,
      supplierName: "架空仕入先",
      receiptAckStatus: "not_required",
      receiptAckSource: "manual",
      receiptAckAt: createdAt,
      receiptAckNote: "架空データ",
      inboundClass: "domestic",
      classSource: "manual",
      stage: plan.received === plan.ordered ? "received" : "ordered",
      stageUpdatedBy: "架空担当A",
      stageUpdatedAt: createdAt,
      shaftParentPurchaseId: null,
      createdAt,
      updatedAt: createdAt,
    });
    if (plan.received > 0) {
      historyRows.push({
        id: BUSINESS_FIXTURE_ID_BASE + 100 + plan.offset,
        zaicoId: BUSINESS_FIXTURE_ID_BASE + 200 + plan.offset,
        kanriNo: plan.managementNo,
        title: plan.title,
        category: "検証用",
        supplier: "架空仕入先",
        quantity: String(plan.received),
        unitPrice: String(plan.unitCost),
        purchaseDate: "2026-09-03",
        inventoryId,
        cancelled: 0,
        operatorName: "架空担当A",
        createdAt: receivedAt,
      });
    }
    for (let index = 0; index < plan.ordered; index += 1) {
      const isReceived = index < plan.received;
      const isShipped = index < plan.shipped;
      labels.push({
        id: BUSINESS_FIXTURE_ID_BASE + 1_000 + nextLabelIndex,
        labelId: labelId(nextLabelIndex++),
        purchaseId,
        localInventoryId: inventoryId,
        legacyManagementNo: plan.managementNo,
        assignedInvoiceNo: null,
        title: plan.title,
        status: isShipped ? "shipped" : isReceived ? "stocked" : "ordered",
        sourceKey: `staging-business:${purchaseId}`,
        outboundBoxId: isShipped ? boxId : null,
        receivedAt: isReceived ? receivedAt : null,
        shippedAt: isShipped ? shippedAt : null,
        createdAt,
        updatedAt: isShipped ? shippedAt : isReceived ? receivedAt : createdAt,
      });
    }
  }

  const shippedLabels = labels.filter(row => row.outboundBoxId === boxId);
  const lateAssignmentLabel = shippedLabels[0];
  if (!lateAssignmentLabel)
    throw new Error("Partially shipped fixture must contain a shipped label");
  lateAssignmentLabel.legacyManagementNo = "在庫_架空振替_1";

  const trades: BusinessFixtureTables["trade_records"] = [
    {
      id: BUSINESS_FIXTURE_ID_BASE + 500,
      month: "9",
      partner: "架空取引先",
      no: BUSINESS_FIXTURE_INVOICE_NO,
      paymentDate: "2026-09-01",
      productName: plans[3].title,
      quantity: "10.00",
      unitPrice: "200.0000",
      currency: "EUR",
      unitPriceJPY: "32000.0000",
      status: "incomplete",
      procurement: "進行中",
      shippingFromTokyo: "一部発送",
      totalSales: "320000.0000",
      procurementTotal: "140000.0000",
      refund: "0.0000",
      shippingCost: "0.0000",
      customsDuty: null,
      profitWithRefund: "180000.0000",
      cumulativeProfit: "180000.0000",
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const afterLabels = labels.map(row =>
    row.id === lateAssignmentLabel.id
      ? {
          ...row,
          assignedInvoiceNo: String(BUSINESS_FIXTURE_INVOICE_NO),
          updatedAt: at("2026-09-06T00:00:00.000Z"),
        }
      : { ...row }
  );
  const beforeSummary = calculateDeclarationSummary(shippedLabels, trades);
  const afterSummary = calculateDeclarationSummary(
    afterLabels.filter(row => row.outboundBoxId === boxId),
    trades
  );

  const deliveryItems = shippedLabels.map(row => ({
    inventoryId: row.localInventoryId,
    title: row.title,
    quantity: 1,
    labelId: row.labelId,
    managementNo: row.legacyManagementNo,
    assignedInvoiceNo: row.assignedInvoiceNo,
  }));
  const tables: BusinessFixtureTables = {
    invoice_clients: [
      {
        id: clientId,
        name: "架空顧客A",
        company: "架空取引先株式会社",
        email: "fixture@example.invalid",
        phone: "000-0000-0000",
        address: "架空町1-1",
        city: "架空市",
        country: "JP",
        notes: "検証専用",
        extraInfo: "FICTIONAL",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    invoices: [
      {
        id: invoiceId,
        invoiceNumber: String(BUSINESS_FIXTURE_INVOICE_NO),
        clientId,
        clientSnapshot: {
          name: "架空顧客A",
          company: "架空取引先株式会社",
          country: "JP",
        },
        invoiceDate: "2026-09-01",
        dueDate: "2026-09-30",
        currency: "EUR",
        showAmounts: true,
        notes: "検証専用の架空請求書",
        rawChat: null,
        status: "sent",
        accentColor: "#334155",
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    invoice_items: [
      {
        id: BUSINESS_FIXTURE_ID_BASE + 7,
        invoiceId,
        sortOrder: 0,
        description: plans[3].title,
        variant: "検証モデル",
        quantity: "10.00",
        unitPrice: "200.00",
        currency: "EUR",
        tax: "0.00",
        createdAt,
      },
    ],
    trade_records: trades,
    customers: [
      {
        id: BUSINESS_FIXTURE_ID_BASE + 8,
        displayName: "架空取引先",
        code: "fictional",
        keywords: "架空取引先",
        sortOrder: 960,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    local_inventories: inventoryRows,
    local_purchases: purchaseRows,
    purchase_histories: historyRows,
    inventory_item_labels: labels,
    outbound_boxes: [
      {
        id: boxId,
        boxCode: "B960001",
        status: "shipped",
        deliveryHistoryId: deliveryId,
        trackingNumber: "FAKE-TRACK-960001",
        fedexShipmentId: fedexId,
        operatorName: "架空担当B",
        openedAt: receivedAt,
        sealedAt: shippedAt,
        linkedAt: shippedAt,
        trackingUnlinkedAt: null,
        unsealedAt: null,
        discardedAt: null,
        createdAt: receivedAt,
        updatedAt: shippedAt,
      },
    ],
    delivery_histories: [
      {
        id: deliveryId,
        deliveryNo: "B960001",
        zaicoDeliveryId: null,
        itemsJson: JSON.stringify(deliveryItems),
        status: "success",
        errorMessage: null,
        deletedInventoryIdsJson: null,
        cancelledItemsJson: null,
        createdAt: shippedAt,
      },
    ],
    shipments: [
      {
        id: shipmentId,
        shippingDate: "2026-09-05",
        trackingNumber: "FAKE-TRACK-960001",
        shippingCost: "1234.00",
        notes: "架空の部分発送",
        createdAt: shippedAt,
        updatedAt: shippedAt,
      },
    ],
    shipment_items: [
      {
        id: BUSINESS_FIXTURE_ID_BASE + 9,
        shipmentId,
        invoiceNo: BUSINESS_FIXTURE_INVOICE_NO,
        tradeRecordId: BUSINESS_FIXTURE_ID_BASE + 500,
        quantity: 5,
        createdAt: shippedAt,
      },
    ],
    fedex_shipments: [
      {
        id: fedexId,
        deliveryNo: "B960001",
        sheetName: "独発送管理",
        shippingDate: "9/5",
        trackingNumber: "FAKE-TRACK-960001",
        itemsJson: JSON.stringify([
          {
            productNameJa: plans[3].title,
            productNameEn: "Fictional console",
            quantity: 5,
          },
        ]),
        spreadsheetStatus: "pending",
        spreadsheetError: null,
        operatorName: "架空担当B",
        historyId: deliveryId,
        cancelledAt: null,
        cancellationReason: null,
        createdAt: shippedAt,
        updatedAt: shippedAt,
      },
    ],
    action_items: [
      {
        id: BUSINESS_FIXTURE_ID_BASE + 600,
        title: "架空追跡の確認",
        assignee: "架空担当B",
        detail: "検証シナリオの追跡番号を確認する",
        status: "open",
        source: "staging-fixture",
        sourceKey: "staging-fixture:tracking",
        sourceQuestion: null,
        reviewerChecksJson: "{}",
        createdBy: "架空担当A",
        isPinned: false,
        completedAt: null,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    work_logs: [
      {
        id: BUSINESS_FIXTURE_ID_BASE + 700,
        workerName: "架空担当B",
        category: "出庫",
        status: "done",
        startedAt: shippedAt,
        endedAt: at("2026-09-05T02:15:00.000Z"),
        manualMinutes: 15,
        quantity: 5,
        memo: "架空箱B960001の部分発送",
        sourceType: "outbound-box",
        sourceId: "B960001",
        detailsJson: JSON.stringify({ boxCode: "B960001", quantity: 5 }),
        createdBy: "架空担当B",
        createdAt: shippedAt,
        updatedAt: shippedAt,
      },
    ],
  };

  const ids = Object.values(tables).flatMap(rows =>
    rows
      .map(row => (row as { id?: number }).id)
      .filter((id): id is number => id != null)
  );
  return {
    format: "staging-business-fixtures",
    version: BUSINESS_FIXTURE_VERSION,
    generatedAt: "2026-09-10T00:00:00.000Z",
    idPolicy: {
      minimum: Math.min(...ids),
      maximum: Math.max(...ids),
      invoiceNo: BUSINESS_FIXTURE_INVOICE_NO,
    },
    scenarioExpectations: {
      orderedNotReceived: {
        purchaseId: BUSINESS_FIXTURE_ID_BASE + 11,
        ordered: 5,
        received: 0,
      },
      partiallyReceived: {
        purchaseId: BUSINESS_FIXTURE_ID_BASE + 21,
        ordered: 5,
        received: 2,
      },
      fullyReceived: {
        purchaseId: BUSINESS_FIXTURE_ID_BASE + 31,
        ordered: 5,
        received: 5,
      },
      partiallyShipped: {
        purchaseId: BUSINESS_FIXTURE_ID_BASE + 41,
        ordered: 10,
        shipped: 5,
        remaining: 5,
      },
      lateInvoiceAssignment: {
        boxId,
        labelId: String(lateAssignmentLabel.labelId),
        before: beforeSummary,
        after: afterSummary,
      },
    },
    tables,
    afterLateInvoiceAssignment: { inventory_item_labels: afterLabels },
    coverage: {
      coveredTables: Object.keys(tables) as Array<keyof BusinessFixtureTables>,
      uncoveredTableCount: 54 - Object.keys(tables).length,
      note: "54テーブル中、対象業務を成立させる16テーブルだけを収録。認証、チャット、写真、月次レポート等は未収録。",
    },
  };
}

export async function writeBusinessFixtureJson(
  outputPath: string
): Promise<string> {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    `${JSON.stringify(createBusinessFixtureBundle(), null, 2)}\n`,
    "utf8"
  );
  return absolutePath;
}

async function main(): Promise<void> {
  const outputFlag = process.argv.indexOf("--output");
  const outputPath =
    outputFlag >= 0
      ? process.argv[outputFlag + 1]
      : "scripts/staging/generated/business-fixtures.json";
  if (!outputPath) throw new Error("--output requires a path");
  const written = await writeBusinessFixtureJson(outputPath);
  console.info(`Wrote offline staging business fixtures to ${written}`);
}

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (entryPath === import.meta.url) {
  main().catch(error => {
    console.error(
      error instanceof Error ? error.message : "Fixture generation failed"
    );
    process.exitCode = 1;
  });
}
