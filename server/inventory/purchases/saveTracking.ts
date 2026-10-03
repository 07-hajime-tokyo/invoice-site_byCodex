import { isZaicoEnabled, upsertPurchaseExtra } from "../db";
import { resolveWorkOperatorName } from "../workOperator";
import { syncLocalPurchaseTrackingFromExtra } from "./trackingSync";
import {
  assertLocalPurchaseTrackingSynced,
  buildPurchaseTrackingUpdate,
  type PurchaseTrackingSyncInput,
} from "./trackingFields";
import type {
  PurchaseTrackingInput,
  PurchaseTrackingBulkInput,
} from "./saveInput";
type TrackingActor = { name?: string | null; email?: string | null };

export async function savePurchaseTracking(
  input: PurchaseTrackingInput,
  actor: TrackingActor
) {
  const operatorName = resolveWorkOperatorName(
    undefined,
    actor.name ?? actor.email ?? null
  );
  const auditInput: PurchaseTrackingSyncInput = {
    ...input,
    operatorName,
    createdBy: actor.email ?? operatorName,
  };
  const zaicoEnabled = await isZaicoEnabled();
  if (!zaicoEnabled) {
    const syncResult = await syncLocalPurchaseTrackingFromExtra(auditInput);
    assertLocalPurchaseTrackingSynced(auditInput, syncResult.updatedCount);
    return { success: true, localUpdatedCount: syncResult.updatedCount };
  }
  const trackingUpdate = buildPurchaseTrackingUpdate(auditInput);
  if (Object.keys(trackingUpdate).length > 0) {
    await upsertPurchaseExtra({ zaicoId: input.zaicoId, ...trackingUpdate });
    if (input.inventoryId && input.inventoryId !== input.zaicoId) {
      await upsertPurchaseExtra({
        zaicoId: input.inventoryId,
        ...trackingUpdate,
      });
    }
  }
  const syncResult = await syncLocalPurchaseTrackingFromExtra(auditInput);
  return { success: true, localUpdatedCount: syncResult.updatedCount };
}

export async function savePurchaseTrackingBulk(
  input: PurchaseTrackingBulkInput,
  actor: TrackingActor
) {
  const operatorName = resolveWorkOperatorName(
    undefined,
    actor.name ?? actor.email ?? null
  );
  const auditBase: Omit<PurchaseTrackingSyncInput, "zaicoId"> = {
    operatorName,
    createdBy: actor.email ?? operatorName,
  };
  if (Object.prototype.hasOwnProperty.call(input, "shipDate"))
    auditBase.shipDate = input.shipDate;
  if (Object.prototype.hasOwnProperty.call(input, "trackingNumber"))
    auditBase.trackingNumber = input.trackingNumber;
  if (Object.prototype.hasOwnProperty.call(input, "carrier"))
    auditBase.carrier = input.carrier;
  if (Object.prototype.hasOwnProperty.call(input, "note"))
    auditBase.note = input.note;
  const trackingUpdate = buildPurchaseTrackingUpdate({
    zaicoId: input.zaicoIds[0],
    ...auditBase,
  });
  const zaicoEnabled = await isZaicoEnabled();
  if (!zaicoEnabled) {
    const syncResults = await Promise.all(
      input.zaicoIds.map(zaicoId =>
        syncLocalPurchaseTrackingFromExtra({ ...auditBase, zaicoId })
      )
    );
    const localUpdatedCount = syncResults.reduce(
      (sum, result) => sum + result.updatedCount,
      0
    );
    assertLocalPurchaseTrackingSynced(
      { ...auditBase, zaicoId: input.zaicoIds[0] },
      localUpdatedCount
    );
    return { success: true, count: input.zaicoIds.length, localUpdatedCount };
  }
  await Promise.all(
    Object.keys(trackingUpdate).length > 0
      ? input.zaicoIds.map(zaicoId =>
          upsertPurchaseExtra({ zaicoId, ...trackingUpdate })
        )
      : []
  );
  const syncResults = await Promise.all(
    input.zaicoIds.map(zaicoId =>
      syncLocalPurchaseTrackingFromExtra({ ...auditBase, zaicoId })
    )
  );
  const localUpdatedCount = syncResults.reduce(
    (sum, result) => sum + result.updatedCount,
    0
  );
  return { success: true, count: input.zaicoIds.length, localUpdatedCount };
}
