import { ALMA_SCHEMA_VERSION } from "../data-model/versions";
import type { CanonicalEvent, PlannedEvent, Presence } from "../data-model/types";

export type PlannedEventConfirmation = "happened" | "cancelled" | "unknown";

export interface PlannedEventResolution {
  plannedEvent: PlannedEvent;
  actualEvent?: CanonicalEvent;
}

/**
 * Planned entries stay out of historical evidence. Only an explicit
 * confirmation materializes a factual event.
 */
export function resolvePlannedEvent(input: {
  plannedEvent: PlannedEvent;
  confirmation: PlannedEventConfirmation;
  confirmedAt: string;
  actualStartAt?: string;
  actualEndAt?: string;
  presence?: Presence;
}): PlannedEventResolution {
  const { plannedEvent, confirmation, confirmedAt } = input;
  const status: PlannedEvent["status"] = confirmation === "happened"
    ? "confirmed_happened"
    : confirmation === "cancelled"
      ? "confirmed_cancelled"
      : "expired_unknown";
  const updated: PlannedEvent = {
    ...plannedEvent,
    status,
    version: plannedEvent.version + 1,
    updatedAt: confirmedAt,
  };
  if (confirmation !== "happened") return { plannedEvent: updated };

  const occurredAt = input.actualStartAt ?? plannedEvent.plannedStartAt;
  return {
    plannedEvent: updated,
    actualEvent: {
      id: stableActualEventId(plannedEvent.id),
      userId: plannedEvent.userId,
      version: 1,
      createdAt: confirmedAt,
      updatedAt: confirmedAt,
      origin: plannedEvent.origin,
      entityDefinitionId: plannedEvent.entityDefinitionId,
      localDate: plannedEvent.localDate,
      occurredAt,
      occurredEndAt: input.actualEndAt ?? plannedEvent.plannedEndAt,
      timezone: plannedEvent.timezone,
      timePrecision: "exact_time",
      presence: input.presence ?? "present",
      attributes: plannedEvent.attributes,
      source: {
        sourceId: "planned_event_confirmation",
        sourceRecordId: plannedEvent.id,
      },
      epistemicStatus: "user_confirmed",
      confidence: 1,
      convertedFromPlannedEventId: plannedEvent.id,
      schemaVersion: ALMA_SCHEMA_VERSION,
    },
  };
}

function stableActualEventId(plannedEventId: string) {
  return `actual-${plannedEventId}`;
}
