import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BaselineRecord,
  CanonicalEntity,
  CanonicalEvent,
  ContextPeriod,
  DynamicFeature,
  ForecastRecord,
  Observation,
  PersonalExperimentRecord,
  PersonalPattern,
  PersonalToolRecord,
  PlannedEvent,
  RecommendationRecord,
  SymptomEpisode,
  UserProfileRecord,
  VersionedRecord,
} from "../data-model/types";
import type { InputRequestRecord, ResearchQuestRecord } from "../engines/types";
import type { OutputFeedRecord } from "../communication/types";
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
  planned_events: {
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
  baselines: {
    table: "alma_v2_baselines",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: baselineToRow as RecordMapping["toRow"],
    fromRow: rowToBaseline,
  },
  dynamic_features: {
    table: "alma_v2_dynamic_features",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: dynamicFeatureToRow as RecordMapping["toRow"],
    fromRow: rowToDynamicFeature,
  },
  patterns: {
    table: "alma_v2_patterns",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: patternToRow as RecordMapping["toRow"],
    fromRow: rowToPattern,
  },
  forecasts: {
    table: "alma_v2_forecasts",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: forecastToRow as RecordMapping["toRow"],
    fromRow: rowToForecast,
  },
  recommendations: {
    table: "alma_v2_recommendations",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: recommendationToRow as RecordMapping["toRow"],
    fromRow: rowToRecommendation,
  },
  personal_tools: {
    table: "alma_v2_personal_tools",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: personalToolToRow as RecordMapping["toRow"],
    fromRow: rowToPersonalTool,
  },
  experiments: {
    table: "alma_v2_experiments",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: experimentToRow as RecordMapping["toRow"],
    fromRow: rowToExperiment,
  },
  research_quests: {
    table: "alma_v2_research_quests",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: researchQuestToRow as RecordMapping["toRow"],
    fromRow: rowToResearchQuest,
  },
  input_requests: {
    table: "alma_v2_input_requests",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: inputRequestToRow as RecordMapping["toRow"],
    fromRow: rowToInputRequest,
  },
  output_feed: {
    table: "alma_v2_output_feed",
    identityColumn: "id",
    conflictColumn: "id",
    toRow: outputFeedToRow as RecordMapping["toRow"],
    fromRow: rowToOutputFeed,
  },
};

const recordTypeAliases: Record<string, keyof typeof mappings> = {
  plannedEvents: "planned_events",
  dynamicFeatures: "dynamic_features",
  personalTools: "personal_tools",
};

function mappingFor(recordType: string) {
  return mappings[recordType] ?? mappings[recordTypeAliases[recordType]];
}

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
      const mapping = mappingFor(entry.recordType);
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
  const mapping = mappingFor(recordType);
  if (!mapping) throw new Error(`Unsupported record type: ${recordType}`);
  return cleanRow(mapping.toRow(record, userId));
}

export function supabaseRowToCanonicalRecord(recordType: string, row: SupabaseRow) {
  const mapping = mappingFor(recordType);
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

function baselineToRow(record: BaselineRecord, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    definition_id: record.definitionId,
    kind: record.kind,
    value: record.value,
    unit: record.unit ?? null,
    valid_from: record.validFrom,
    valid_to: record.validTo ?? null,
    evidence_count: record.evidenceCount,
    confidence: record.confidence,
    algorithm_version: record.algorithmVersion,
    user_confirmed: record.userConfirmed,
  };
}

function rowToBaseline(row: SupabaseRow): BaselineRecord {
  return {
    ...versionedFromRow(row),
    definitionId: String(row.definition_id),
    kind: row.kind as BaselineRecord["kind"],
    value: Number(row.value),
    unit: optionalString(row.unit),
    validFrom: String(row.valid_from),
    validTo: optionalString(row.valid_to),
    evidenceCount: Number(row.evidence_count),
    confidence: Number(row.confidence),
    algorithmVersion: String(row.algorithm_version),
    userConfirmed: Boolean(row.user_confirmed),
  };
}

function dynamicFeatureToRow(record: DynamicFeature, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    definition_id: record.definitionId,
    local_date: record.localDate,
    feature_type: record.featureType,
    value: record.value,
    window_start: record.windowStart,
    window_end: record.windowEnd,
    based_on_observation_ids: record.basedOnObservationIds,
    algorithm_version: record.algorithmVersion,
  };
}

function rowToDynamicFeature(row: SupabaseRow): DynamicFeature {
  return {
    ...versionedFromRow(row),
    definitionId: String(row.definition_id),
    localDate: String(row.local_date),
    featureType: row.feature_type as DynamicFeature["featureType"],
    value: Number(row.value),
    windowStart: String(row.window_start),
    windowEnd: String(row.window_end),
    basedOnObservationIds: stringArray(row.based_on_observation_ids),
    algorithmVersion: String(row.algorithm_version),
  };
}

function patternToRow(record: PersonalPattern, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    target_definition_id: record.targetDefinitionId,
    factor_definition_ids: record.factorDefinitionIds,
    modifier_definition_ids: record.modifierDefinitionIds,
    relationship_type: record.relationshipType,
    direction: record.direction ?? null,
    typical_lag_minutes: record.typicalLagMinutes ?? null,
    lag_range_minutes: record.lagRangeMinutes
      ? `[${record.lagRangeMinutes[0]},${record.lagRangeMinutes[1]}]`
      : null,
    cumulative_window_days: record.cumulativeWindowDays ?? null,
    threshold: record.threshold ?? null,
    evidence_score: record.evidenceScore,
    stage: record.stage,
    lifecycle: record.lifecycle,
    evidence: record.evidence,
    parent_pattern_id: record.parentPatternId ?? null,
    valid_from: record.validFrom,
    valid_to: record.validTo ?? null,
    algorithm_version: record.algorithmVersion,
  };
}

function rowToPattern(row: SupabaseRow): PersonalPattern {
  return {
    ...versionedFromRow(row),
    targetDefinitionId: String(row.target_definition_id),
    factorDefinitionIds: stringArray(row.factor_definition_ids),
    modifierDefinitionIds: stringArray(row.modifier_definition_ids),
    relationshipType: row.relationship_type as PersonalPattern["relationshipType"],
    direction: nullableValue(row.direction) as PersonalPattern["direction"],
    typicalLagMinutes: optionalNumber(row.typical_lag_minutes),
    lagRangeMinutes: optionalNumberRange(row.lag_range_minutes),
    cumulativeWindowDays: optionalNumber(row.cumulative_window_days),
    threshold: optionalNumber(row.threshold),
    evidenceScore: Number(row.evidence_score),
    stage: row.stage as PersonalPattern["stage"],
    lifecycle: row.lifecycle as PersonalPattern["lifecycle"],
    evidence: (row.evidence ?? []) as PersonalPattern["evidence"],
    parentPatternId: optionalString(row.parent_pattern_id),
    validFrom: String(row.valid_from),
    validTo: optionalString(row.valid_to),
    algorithmVersion: String(row.algorithm_version),
  };
}

function forecastToRow(record: ForecastRecord, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    target_definition_id: record.targetDefinitionId,
    generated_at: record.generatedAt,
    window_start: record.windowStart,
    window_end: record.windowEnd,
    probability: record.probability,
    predicted_value: record.predictedValue ?? null,
    uncertainty: record.uncertainty ?? null,
    positive_contributor_ids: record.positiveContributorIds,
    negative_contributor_ids: record.negativeContributorIds,
    compensator_ids: record.compensatorIds,
    related_pattern_ids: record.relatedPatternIds,
    outcome: record.outcome,
    resolved_at: record.resolvedAt ?? null,
    brier_score: record.brierScore ?? null,
    algorithm_version: record.algorithmVersion,
  };
}

function rowToForecast(row: SupabaseRow): ForecastRecord {
  return {
    ...versionedFromRow(row),
    targetDefinitionId: String(row.target_definition_id),
    generatedAt: String(row.generated_at),
    windowStart: String(row.window_start),
    windowEnd: String(row.window_end),
    probability: Number(row.probability),
    predictedValue: optionalNumber(row.predicted_value),
    uncertainty: optionalNumber(row.uncertainty),
    positiveContributorIds: stringArray(row.positive_contributor_ids),
    negativeContributorIds: stringArray(row.negative_contributor_ids),
    compensatorIds: stringArray(row.compensator_ids),
    relatedPatternIds: stringArray(row.related_pattern_ids),
    outcome: row.outcome as ForecastRecord["outcome"],
    resolvedAt: optionalString(row.resolved_at),
    brierScore: optionalNumber(row.brier_score),
    algorithmVersion: String(row.algorithm_version),
  };
}

function recommendationToRow(record: RecommendationRecord, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    target_definition_id: record.targetDefinitionId,
    action_definition_id: record.actionDefinitionId,
    related_pattern_ids: record.relatedPatternIds,
    expected_benefit: record.expectedBenefit ?? null,
    controllability: record.controllability ?? null,
    effort: record.effort ?? null,
    risk: record.risk ?? null,
    status: record.status,
    shown_at: record.shownAt ?? null,
    performed_event_id: record.performedEventId ?? null,
    non_medical: record.nonMedical,
    algorithm_version: record.algorithmVersion,
  };
}

function rowToRecommendation(row: SupabaseRow): RecommendationRecord {
  return {
    ...versionedFromRow(row),
    targetDefinitionId: String(row.target_definition_id),
    actionDefinitionId: String(row.action_definition_id),
    relatedPatternIds: stringArray(row.related_pattern_ids),
    expectedBenefit: optionalNumber(row.expected_benefit),
    controllability: optionalNumber(row.controllability),
    effort: optionalNumber(row.effort),
    risk: optionalNumber(row.risk),
    status: row.status as RecommendationRecord["status"],
    shownAt: optionalString(row.shown_at),
    performedEventId: optionalString(row.performed_event_id),
    nonMedical: true,
    algorithmVersion: String(row.algorithm_version),
  };
}

function personalToolToRow(record: PersonalToolRecord, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    target_definition_id: record.targetDefinitionId,
    action_definition_id: record.actionDefinitionId,
    context_filter: record.contextFilter,
    test_count: record.testCount,
    consistency: record.consistency,
    status: record.status,
    related_pattern_ids: record.relatedPatternIds,
    algorithm_version: record.algorithmVersion,
  };
}

function rowToPersonalTool(row: SupabaseRow): PersonalToolRecord {
  return {
    ...versionedFromRow(row),
    targetDefinitionId: String(row.target_definition_id),
    actionDefinitionId: String(row.action_definition_id),
    contextFilter: (row.context_filter ?? {}) as PersonalToolRecord["contextFilter"],
    testCount: Number(row.test_count),
    consistency: Number(row.consistency),
    status: row.status as PersonalToolRecord["status"],
    relatedPatternIds: stringArray(row.related_pattern_ids),
    algorithmVersion: String(row.algorithm_version),
  };
}

function experimentToRow(record: PersonalExperimentRecord, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    hypothesis: record.hypothesis,
    intervention: record.intervention,
    target_definition_id: record.targetDefinitionId,
    period_start: record.periodStart,
    period_end: record.periodEnd,
    baseline_window: dateRangeLiteral(record.baselineWindow),
    observation_window: dateRangeLiteral(record.observationWindow),
    status: record.status,
    result: record.result ?? null,
    evidence: record.evidence,
    algorithm_version: record.algorithmVersion,
  };
}

function rowToExperiment(row: SupabaseRow): PersonalExperimentRecord {
  return {
    ...versionedFromRow(row),
    hypothesis: (row.hypothesis ?? {}) as PersonalExperimentRecord["hypothesis"],
    intervention: (row.intervention ?? {}) as PersonalExperimentRecord["intervention"],
    targetDefinitionId: String(row.target_definition_id),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    baselineWindow: requiredDateRange(row.baseline_window),
    observationWindow: requiredDateRange(row.observation_window),
    status: row.status as PersonalExperimentRecord["status"],
    result: row.result == null
      ? undefined
      : row.result as PersonalExperimentRecord["result"],
    evidence: (row.evidence ?? []) as PersonalExperimentRecord["evidence"],
    algorithmVersion: String(row.algorithm_version),
  };
}

function researchQuestToRow(record: ResearchQuestRecord, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    title: record.title,
    target_definition_id: record.targetDefinitionId,
    status: record.status,
    hypotheses: record.hypotheses,
    required_metric_ids: record.requiredMetricIds,
    optional_metric_ids: record.optionalMetricIds,
    progress: record.progress,
    dossier: record.dossier,
    algorithm_version: record.algorithmVersion,
  };
}

function rowToResearchQuest(row: SupabaseRow): ResearchQuestRecord {
  return {
    ...versionedFromRow(row),
    title: String(row.title),
    targetDefinitionId: String(row.target_definition_id),
    status: row.status as ResearchQuestRecord["status"],
    hypotheses: (row.hypotheses ?? []) as ResearchQuestRecord["hypotheses"],
    requiredMetricIds: stringArray(row.required_metric_ids),
    optionalMetricIds: stringArray(row.optional_metric_ids),
    progress: (row.progress ?? {}) as ResearchQuestRecord["progress"],
    dossier: (row.dossier ?? {}) as ResearchQuestRecord["dossier"],
    algorithmVersion: String(row.algorithm_version),
  };
}

function inputRequestToRow(record: InputRequestRecord, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    target_definition_id: record.targetDefinitionId,
    reason_code: record.reasonCode,
    related_quest_id: record.relatedQuestId ?? null,
    related_hypothesis_id: record.relatedHypothesisId ?? null,
    priority: record.priority,
    information_value: record.informationValue,
    estimated_effort: record.estimatedEffort,
    recurring: record.recurring,
    expires_at: record.expiresAt ?? null,
    retrospective_allowed: record.retrospectiveAllowed,
    explanation: record.explanation,
    status: record.status,
    answer_observation_id: record.answerObservationId ?? null,
    algorithm_version: record.algorithmVersion,
  };
}

function rowToInputRequest(row: SupabaseRow): InputRequestRecord {
  return {
    ...versionedFromRow(row),
    targetDefinitionId: String(row.target_definition_id),
    reasonCode: String(row.reason_code),
    relatedQuestId: optionalString(row.related_quest_id),
    relatedHypothesisId: optionalString(row.related_hypothesis_id),
    priority: Number(row.priority),
    informationValue: Number(row.information_value),
    estimatedEffort: Number(row.estimated_effort),
    recurring: Boolean(row.recurring),
    expiresAt: optionalString(row.expires_at),
    retrospectiveAllowed: Boolean(row.retrospective_allowed),
    explanation: String(row.explanation),
    status: row.status as InputRequestRecord["status"],
    answerObservationId: optionalString(row.answer_observation_id),
    algorithmVersion: String(row.algorithm_version),
  };
}

function outputFeedToRow(record: OutputFeedRecord, userId: string): SupabaseRow {
  return {
    ...baseRow(record, userId),
    insight_type: record.insightType,
    structured_payload: record.structuredPayload,
    title: record.title,
    body: record.body,
    relevant_period_start: record.relevantPeriodStart ?? null,
    relevant_period_end: record.relevantPeriodEnd ?? null,
    priority: record.priority,
    read_at: record.readAt ?? null,
    archived_at: record.archivedAt ?? null,
    carry_forward: record.carryForward,
    related_pattern_id: record.relatedPatternId ?? null,
    related_quest_id: record.relatedQuestId ?? null,
    supersedes_insight_id: record.supersedesInsightId ?? null,
    source_data_deleted_at: record.sourceDataDeletedAt ?? null,
    algorithm_version: record.algorithmVersion,
    narrative_version: record.narrativeVersion,
  };
}

function rowToOutputFeed(row: SupabaseRow): OutputFeedRecord {
  return {
    ...versionedFromRow(row),
    insightType: row.insight_type as OutputFeedRecord["insightType"],
    structuredPayload: row.structured_payload as OutputFeedRecord["structuredPayload"],
    title: String(row.title),
    body: String(row.body),
    relevantPeriodStart: optionalString(row.relevant_period_start),
    relevantPeriodEnd: optionalString(row.relevant_period_end),
    priority: Number(row.priority),
    readAt: optionalString(row.read_at),
    archivedAt: optionalString(row.archived_at),
    carryForward: Boolean(row.carry_forward),
    relatedPatternId: optionalString(row.related_pattern_id),
    relatedQuestId: optionalString(row.related_quest_id),
    supersedesInsightId: optionalString(row.supersedes_insight_id),
    sourceDataDeletedAt: optionalString(row.source_data_deleted_at),
    algorithmVersion: String(row.algorithm_version),
    narrativeVersion: String(row.narrative_version),
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function optionalNumberRange(value: unknown): [number, number] | undefined {
  if (Array.isArray(value) && value.length >= 2) {
    return [Number(value[0]), Number(value[1])];
  }
  if (typeof value !== "string" || value.length < 5) return undefined;
  const opening = value[0];
  const closing = value[value.length - 1];
  if (!(opening === "[" || opening === "(") || !(closing === "]" || closing === ")")) {
    return undefined;
  }
  const [lower, upper] = value.slice(1, -1).split(",").map((part) => Number(part.trim()));
  return Number.isFinite(lower) && Number.isFinite(upper) ? [lower, upper] : undefined;
}

function dateRangeLiteral(value: [string, string]) {
  return `[${value[0]},${value[1]}]`;
}

function requiredDateRange(value: unknown): [string, string] {
  if (Array.isArray(value) && value.length >= 2) {
    return [String(value[0]), String(value[1])];
  }
  if (typeof value === "string" && value.length >= 5) {
    const opening = value[0];
    const closing = value[value.length - 1];
    if ((opening === "[" || opening === "(") && (closing === "]" || closing === ")")) {
      const [lower, upper] = value.slice(1, -1).split(",");
      if (lower && upper) {
        return [stripRangeQuotes(lower), stripRangeQuotes(upper)];
      }
    }
  }
  throw new Error("Invalid date range returned by Supabase");
}

function stripRangeQuotes(value: string) {
  return value.trim().replace(/^"|"$/g, "");
}
