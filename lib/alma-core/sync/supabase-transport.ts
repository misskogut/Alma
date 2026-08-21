import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CanonicalEntity,
  CanonicalEvent,
  ContextPeriod,
  Observation,
  PlannedEvent,
  SymptomEpisode,
  UserProfileRecord,
  VersionedRecord,
} from "../data-model/types";
import type {
  RemoteChange,
  SyncPushResult,
  SyncTransport,
} from "./sync-engine";

export type SupabaseRow = Record<string, unknown>;

export interface SupabaseRecordStore {
  get(input: {
    table: string;
    userId: string;
    identityColumn: string;
    recordId: string;
  }): Promise<SupabaseRow | null>;
  upsert(input: {
    table: string;
    row: SupabaseRow;
    conflictColumn: string;
  }): Promise<SupabaseRow>;
  listChanged(input: {
    table: string;
    userId: string;
    after?: string;
    through: string;
  }): Promise<SupabaseRow[]>;
}

/** Thin network adapter; domain sync remains testable without Supabase. */
export class SupabaseJsRecordStore implements SupabaseRecordStore {
  constructor(private readonly client: SupabaseClient) {}

  async get(input: {
    table: string;
    userId: string;
    identityColumn: string;
    recordId: string;
  }) {
    const result = await this.client
      .from(input.table)
      .select("*")
      .eq("user_id", input.userId)
      .eq(input.identityColumn, input.recordId)
      .maybeSingle();
    if (result.error) throw result.error;
    return (result.data as SupabaseRow | null) ?? null;
  }

  async upsert(input: {
    table: string;
    row: SupabaseRow;
    conflictColumn: string;
  }) {
    const result = await this.client
      .from(input.table)
      .upsert(input.row, { onConflict: input.conflictColumn })
      .select("*")
      .single();
    if (result.error) throw result.error;
    return result.data as SupabaseRow;
  }

  async listChanged(input: {
    table: string;
    userId: string;
    after?: string;
    through: string;
  }) {
    let query = this.client
      .from(input.table)
      .select("*")
      .eq("user_id", input.userId)
      .lte("updated_at", input.through)
      .order("updated_at", { ascending: true })
      .limit(1000);
    if (input.after) query = query.gt("updated_at", input.after);
    const result = await query;
    if (result.error) throw result.error;
    return (result.data ?? []) as SupabaseRow[];
  }
}

interface RecordMapping<TRecord extends VersionedRecord = VersionedRecord> {
  table: string;
  identityColumn: string;
  conflictColumn: string;
  toRow(record: TRecord, userId: string): SupabaseRow;
  fromRow(row: SupabaseRow): TRecord;
}

const mappings: Record<string, RecordMapping> = {
  entities: {
    table: "alma_v2_entities",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: entityToRow as RecordMapping["toRow"],
    fromRow: rowToEntity,
  },
  profiles: {
    table: "alma_v2_profiles",
    identityColumn: "user_id",
    conflictColumn: "user_id",
    toRow: profileToRow as RecordMapping["toRow"],
    fromRow: rowToProfile,
  },
  observations: {
    table: "alma_v2_observations",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: observationToRow as RecordMapping["toRow"],
    fromRow: rowToObservation,
  },
  events: {
    table: "alma_v2_events",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: eventToRow as RecordMapping["toRow"],
    fromRow: rowToEvent,
  },
  symptoms: {
    table: "alma_v2_symptom_episodes",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: symptomToRow as RecordMapping["toRow"],
    fromRow: rowToSymptom,
  },
  plannedEvents: {
    table: "alma_v2_planned_events",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: plannedEventToRow as RecordMapping["toRow"],
    fromRow: rowToPlannedEvent,
  },
  contexts: {
    table: "alma_v2_context_periods",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: contextToRow as RecordMapping["toRow"],
    fromRow: rowToContext,
  },
};

function entityToRow(record: CanonicalEntity, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    canonical_key: record.canonicalKey,
    canonical_label: record.canonicalLabel,
    user_label: record.userLabel ?? null,
    kind: record.kind,
    domain: record.domain,
    custom: record.custom,
    registry_version: record.registryVersion,
  };
}

function rowToEntity(row: SupabaseRow): CanonicalEntity {
  return {
    ...versionedFromRow(row),
    canonicalKey: String(row.canonical_key),
    canonicalLabel: String(row.canonical_label),
    userLabel: optionalString(row.user_label),
    kind: row.kind as CanonicalEntity["kind"],
    domain: row.domain as CanonicalEntity["domain"],
    custom: Boolean(row.custom),
    registryVersion: String(row.registry_version),
  };
}

export function createSupabaseSyncTransport(input: {
  store: SupabaseRecordStore;
  userId: string;
  now?: () => string;
}): SyncTransport {
  const now = input.now ?? (() => new Date().toISOString());
  return {
    async push({ entry, record }): Promise<SyncPushResult> {
      const mapping = mappings[entry.recordType];
      if (!mapping) {
        return {
          status: "conflict",
          reason: `unsupported_record_type:${entry.recordType}`,
        };
      }
      const existingRow = await input.store.get({
        table: mapping.table,
        userId: input.userId,
        identityColumn: mapping.identityColumn,
        recordId: mapping.identityColumn === "user_id" ? input.userId : record.id,
      });
      const desiredRow = cleanRow(mapping.toRow(record, input.userId));
      if (existingRow) {
        const existing = mapping.fromRow(existingRow);
        if (rowsEquivalent(existingRow, desiredRow)) {
          return {
            status: "duplicate",
            record: existing,
            serverVersion: existing.version,
          };
        }
        if (
          entry.baseServerVersion == null ||
          existing.version !== entry.baseServerVersion
        ) {
          return {
            status: "conflict",
            record: existing,
            serverVersion: existing.version,
            reason: "server_version_changed",
          };
        }
      } else if (entry.baseServerVersion != null) {
        return {
          status: "conflict",
          reason: "server_record_missing",
        };
      }

      const saved = await input.store.upsert({
        table: mapping.table,
        row: desiredRow,
        conflictColumn: mapping.conflictColumn,
      });
      const remote = mapping.fromRow(saved);
      return {
        status: "accepted",
        record: remote,
        serverVersion: remote.version,
      };
    },

    async pull(cursor) {
      const through = now();
      const changes: RemoteChange[] = [];
      for (const [recordType, mapping] of Object.entries(mappings)) {
        const rows = await input.store.listChanged({
          table: mapping.table,
          userId: input.userId,
          after: cursor,
          through,
        });
        for (const row of rows) {
          changes.push({ recordType, record: mapping.fromRow(row) });
        }
      }
      changes.sort((left, right) =>
        left.record.updatedAt.localeCompare(right.record.updatedAt),
      );
      return { changes, cursor: through };
    },
  };
}

export function canonicalRecordToSupabaseRow(
  recordType: string,
  record: VersionedRecord,
  userId: string,
) {
  const mapping = mappings[recordType];
  if (!mapping) throw new Error(`Unsupported record type: ${recordType}`);
  return cleanRow(mapping.toRow(record, userId));
}

export function supabaseRowToCanonicalRecord(recordType: string, row: SupabaseRow) {
  const mapping = mappings[recordType];
  if (!mapping) throw new Error(`Unsupported record type: ${recordType}`);
  return mapping.fromRow(row);
}

function baseRow(record: VersionedRecord, userId: string) {
  return {
    id: record.id,
    user_id: userId,
    version: record.version,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    deleted_at: record.deletedAt ?? null,
  };
}

function profileToRow(record: UserProfileRecord, userId: string): SupabaseRow {
  return {
    user_id: userId,
    display_name: record.displayName,
    timezone: record.timezone,
    preferences: record.preferences,
    location_privacy: record.locationPrivacy,
    population_opt_in: record.populationOptIn,
    schema_version: record.schemaVersion,
    version: record.version,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    deleted_at: record.deletedAt ?? null,
  };
}

function rowToProfile(row: SupabaseRow): UserProfileRecord {
  return {
    ...versionedFromRow(row, String(row.user_id)),
    userId: String(row.user_id),
    displayName: String(row.display_name),
    timezone: String(row.timezone),
    preferences: (row.preferences ?? {}) as UserProfileRecord["preferences"],
    locationPrivacy: row.location_privacy as UserProfileRecord["locationPrivacy"],
    populationOptIn: Boolean(row.population_opt_in),
    schemaVersion: Number(row.schema_version),
  };
}

function observationToRow(record: Observation, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    definition_id: record.definitionId,
    occurred_at: record.occurredAt ?? null,
    occurred_end_at: record.occurredEndAt ?? null,
    local_date: record.localDate,
    timezone: record.timezone,
    time_precision: record.timePrecision,
    recorded_at: record.recordedAt,
    value: record.value,
    raw_value: record.rawValue ?? null,
    unit: record.unit ?? null,
    source_id: record.source.sourceId,
    source_record_id: record.source.sourceRecordId ?? null,
    source_device_id: record.source.sourceDeviceId ?? null,
    adapter_version: record.source.adapterVersion ?? null,
    epistemic_status: record.epistemicStatus,
    presence: record.presence ?? null,
    confidence: record.confidence ?? null,
    metadata: record.metadata ?? {},
    supersedes_observation_id: record.supersedesObservationId ?? null,
    is_canonical: record.isCanonical,
    schema_version: record.schemaVersion,
  };
}

function rowToObservation(row: SupabaseRow): Observation {
  return {
    ...versionedFromRow(row),
    definitionId: String(row.definition_id),
    occurredAt: optionalString(row.occurred_at),
    occurredEndAt: optionalString(row.occurred_end_at),
    localDate: String(row.local_date),
    timezone: String(row.timezone),
    timePrecision: row.time_precision as Observation["timePrecision"],
    recordedAt: String(row.recorded_at),
    value: row.value as Observation["value"],
    rawValue: nullableJson(row.raw_value),
    unit: optionalString(row.unit),
    source: {
      sourceId: String(row.source_id),
      sourceRecordId: optionalString(row.source_record_id),
      sourceDeviceId: optionalString(row.source_device_id),
      adapterVersion: optionalString(row.adapter_version),
    },
    epistemicStatus: row.epistemic_status as Observation["epistemicStatus"],
    presence: nullableValue(row.presence) as Observation["presence"],
    confidence: optionalNumber(row.confidence),
    metadata: (row.metadata ?? {}) as Observation["metadata"],
    supersedesObservationId: optionalString(row.supersedes_observation_id),
    isCanonical: Boolean(row.is_canonical),
    schemaVersion: Number(row.schema_version),
  };
}

function eventToRow(record: CanonicalEvent, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    entity_definition_id: record.entityDefinitionId,
    local_date: record.localDate,
    occurred_at: record.occurredAt ?? null,
    occurred_end_at: record.occurredEndAt ?? null,
    timezone: record.timezone,
    time_precision: record.timePrecision,
    presence: record.presence,
    quantity: record.quantity ?? null,
    unit: record.unit ?? null,
    attributes: record.attributes ?? {},
    source_id: record.source.sourceId,
    source_record_id: record.source.sourceRecordId ?? null,
    source_device_id: record.source.sourceDeviceId ?? null,
    adapter_version: record.source.adapterVersion ?? null,
    epistemic_status: record.epistemicStatus,
    confidence: record.confidence ?? null,
    converted_from_planned_event_id: record.convertedFromPlannedEventId ?? null,
    schema_version: record.schemaVersion,
  };
}

function rowToEvent(row: SupabaseRow): CanonicalEvent {
  return {
    ...versionedFromRow(row),
    entityDefinitionId: String(row.entity_definition_id),
    localDate: String(row.local_date),
    occurredAt: optionalString(row.occurred_at),
    occurredEndAt: optionalString(row.occurred_end_at),
    timezone: String(row.timezone),
    timePrecision: row.time_precision as CanonicalEvent["timePrecision"],
    presence: row.presence as CanonicalEvent["presence"],
    quantity: optionalNumber(row.quantity),
    unit: optionalString(row.unit),
    attributes: (row.attributes ?? {}) as CanonicalEvent["attributes"],
    source: sourceFromRow(row),
    epistemicStatus: row.epistemic_status as CanonicalEvent["epistemicStatus"],
    confidence: optionalNumber(row.confidence),
    convertedFromPlannedEventId: optionalString(row.converted_from_planned_event_id),
    schemaVersion: Number(row.schema_version),
  };
}

function symptomToRow(record: SymptomEpisode, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    entity_definition_id: record.entityDefinitionId,
    local_date: record.localDate,
    occurred_at: record.occurredAt ?? null,
    occurred_end_at: record.occurredEndAt ?? null,
    timezone: record.timezone,
    time_precision: record.timePrecision,
    presence: record.presence,
    intensity: record.intensity ?? null,
    location: record.location ?? null,
    character: record.character ?? null,
    duration_minutes: record.durationMinutes ?? null,
    attributes: record.attributes ?? {},
    source_id: record.source.sourceId,
    source_record_id: record.source.sourceRecordId ?? null,
    source_device_id: record.source.sourceDeviceId ?? null,
    adapter_version: record.source.adapterVersion ?? null,
    epistemic_status: record.epistemicStatus,
    confidence: record.confidence ?? null,
    provenance_context: record.provenanceContext ?? null,
    schema_version: record.schemaVersion,
  };
}

function rowToSymptom(row: SupabaseRow): SymptomEpisode {
  return {
    ...versionedFromRow(row),
    entityDefinitionId: String(row.entity_definition_id),
    localDate: String(row.local_date),
    occurredAt: optionalString(row.occurred_at),
    occurredEndAt: optionalString(row.occurred_end_at),
    timezone: String(row.timezone),
    timePrecision: row.time_precision as SymptomEpisode["timePrecision"],
    presence: row.presence as SymptomEpisode["presence"],
    intensity: optionalNumber(row.intensity),
    location: optionalString(row.location),
    character: optionalString(row.character),
    durationMinutes: optionalNumber(row.duration_minutes),
    attributes: (row.attributes ?? {}) as SymptomEpisode["attributes"],
    source: sourceFromRow(row),
    epistemicStatus: row.epistemic_status as SymptomEpisode["epistemicStatus"],
    confidence: optionalNumber(row.confidence),
    provenanceContext: optionalString(row.provenance_context),
    schemaVersion: Number(row.schema_version),
  };
}

function plannedEventToRow(record: PlannedEvent, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    entity_definition_id: record.entityDefinitionId,
    planned_start_at: record.plannedStartAt,
    planned_end_at: record.plannedEndAt ?? null,
    local_date: record.localDate,
    timezone: record.timezone,
    status: record.status,
    importance: record.importance ?? null,
    attributes: record.attributes ?? {},
    source_id: record.source.sourceId,
    schema_version: record.schemaVersion,
  };
}

function rowToPlannedEvent(row: SupabaseRow): PlannedEvent {
  return {
    ...versionedFromRow(row),
    entityDefinitionId: String(row.entity_definition_id),
    plannedStartAt: String(row.planned_start_at),
    plannedEndAt: optionalString(row.planned_end_at),
    localDate: String(row.local_date),
    timezone: String(row.timezone),
    status: row.status as PlannedEvent["status"],
    importance: optionalNumber(row.importance),
    attributes: (row.attributes ?? {}) as PlannedEvent["attributes"],
    source: { sourceId: String(row.source_id) },
    schemaVersion: Number(row.schema_version),
  };
}

function contextToRow(record: ContextPeriod, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    entity_definition_id: record.entityDefinitionId,
    started_at: record.startedAt,
    ended_at: record.endedAt ?? null,
    timezone: record.timezone,
    value: record.value ?? null,
    source_id: record.source.sourceId,
    epistemic_status: record.epistemicStatus,
    confidence: record.confidence ?? null,
    schema_version: record.schemaVersion,
  };
}

function rowToContext(row: SupabaseRow): ContextPeriod {
  return {
    ...versionedFromRow(row),
    entityDefinitionId: String(row.entity_definition_id),
    startedAt: String(row.started_at),
    endedAt: optionalString(row.ended_at),
    timezone: String(row.timezone),
    value: nullableJson(row.value),
    source: { sourceId: String(row.source_id) },
    epistemicStatus: row.epistemic_status as ContextPeriod["epistemicStatus"],
    confidence: optionalNumber(row.confidence),
    schemaVersion: Number(row.schema_version),
  };
}

function versionedFromRow(row: SupabaseRow, id = String(row.id)): VersionedRecord {
  return {
    id,
    userId: optionalString(row.user_id),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: optionalString(row.deleted_at),
    origin: "cloud",
  };
}

function sourceFromRow(row: SupabaseRow) {
  return {
    sourceId: String(row.source_id),
    sourceRecordId: optionalString(row.source_record_id),
    sourceDeviceId: optionalString(row.source_device_id),
    adapterVersion: optionalString(row.adapter_version),
  };
}

function cleanRow(row: SupabaseRow) {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  );
}

function rowsEquivalent(existing: SupabaseRow, desired: SupabaseRow) {
  return Object.entries(desired).every(([key, value]) =>
    JSON.stringify(existing[key] ?? null) === JSON.stringify(value ?? null),
  );
}

function optionalString(value: unknown) {
  return value == null ? undefined : String(value);
}

function optionalNumber(value: unknown) {
  return value == null ? undefined : Number(value);
}

function nullableValue(value: unknown) {
  return value == null ? undefined : value;
}

function nullableJson(value: unknown) {
  return value == null ? undefined : value as Observation["rawValue"];
}
