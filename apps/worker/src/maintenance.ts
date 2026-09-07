import { Prisma, type DatabaseClient, writeAuditEntry } from "@repo/database";

interface ExpiredReservationRow {
  readonly id: string;
  readonly variantId: string;
  readonly quantity: number;
}

export interface ReservationExpiryResult {
  readonly expiredReservations: number;
  readonly releasedQuantity: number;
  readonly variantsChanged: number;
}

export async function expireInventoryReservations(
  database: DatabaseClient,
  limit = 200,
): Promise<ReservationExpiryResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Reservation expiry limit must be an integer between 1 and 1000.");
  }

  return database.$transaction(async (tx) => {
    const expired = await tx.$queryRaw<ExpiredReservationRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "InventoryReservation"
        WHERE "status" = 'HELD'::"InventoryReservationStatus"
          AND "expiresAt" <= NOW()
        ORDER BY "expiresAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "InventoryReservation" AS reservation
      SET
        "status" = 'EXPIRED'::"InventoryReservationStatus",
        "releasedAt" = NOW()
      FROM candidates
      WHERE reservation."id" = candidates."id"
        AND reservation."status" = 'HELD'::"InventoryReservationStatus"
      RETURNING reservation."id", reservation."variantId", reservation."quantity"
    `);

    if (expired.length === 0) {
      return { expiredReservations: 0, releasedQuantity: 0, variantsChanged: 0 };
    }

    const quantityByVariant = new Map<string, number>();
    for (const reservation of expired) {
      quantityByVariant.set(
        reservation.variantId,
        (quantityByVariant.get(reservation.variantId) ?? 0) + reservation.quantity,
      );
    }

    for (const [variantId, quantity] of quantityByVariant) {
      const changed = await tx.inventoryItem.updateMany({
        where: { variantId, reserved: { gte: quantity } },
        data: { reserved: { decrement: quantity }, version: { increment: 1 } },
      });
      if (changed.count !== 1) {
        throw new Error(`INVENTORY_RESERVED_INVARIANT:${variantId}`);
      }
    }

    const releasedQuantity = expired.reduce((sum, reservation) => sum + reservation.quantity, 0);
    await writeAuditEntry(tx, {
      actorType: "SYSTEM",
      action: "inventory.reservations.expired",
      entityType: "InventoryReservationBatch",
      entityId: expired[0]?.id ?? "none",
      metadata: {
        expiredReservations: expired.length,
        releasedQuantity,
        variantsChanged: quantityByVariant.size,
      },
    });

    return {
      expiredReservations: expired.length,
      releasedQuantity,
      variantsChanged: quantityByVariant.size,
    };
  });
}
