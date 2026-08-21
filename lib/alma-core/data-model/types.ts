export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type EpistemicStatus =
  | "measured"
  | "user_confirmed"
  | "inferred"
  | "predicted"
  | "planned";

export type Presence = "present" | "confirmed_absent" | "unknown";

export type TimePrecision =
  | "date_only"
  | "day_part"
  | "approximate_time"
  | "exact_time";

export type DataForm =
  | "continuous_metric"
  | "binary_marker"
  | "count"
  | "category"
  | "point_event"
  | "interval_event"
  | "state_rating"
  | "symptom_episode"
  | "context_period"
  | "planned_event"
  | "derived_metric"
  | "forecast";

export type DomainKey =
  | "internal"
  | "activity"
  | "social"
  | "nutrition"
  | "cycle"
  | "physiology"
  | "natural_environment"
  | "digital_environment"
  | "life_context";

export type EntityKind =
  | "metric"
  | "state"
  | "symptom"
  | "activity"
  | "social_event"
  | "intake"
  | "cycle_event"
  | "physiology_signal"
  | "natural_signal"
  | "digital_signal"
  | "context"
  | "derived_metric";

export type RecordOrigin = "local" | "cloud" | "migration";

export interface VersionedRecord {
  id: string;
  userId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  origin?: RecordOrigin;
}

export interface ObservationSource {
  sourceId: string;
  sourceRecordId?: string;
  sourceDeviceId?: string;
  adapterVersion?: string;
}

/**
 * The single canonical envelope used by every ingestion path.
 * Source and epistemic status are deliberately independent.
 */
export interface Observation<TValue extends JsonValue = JsonValue>
  extends VersionedRecord {
  definitionId: string;
  occurredAt?: string;
  occurredEndAt?: string;
  localDate: string;
  timezone: string;
  timePrecision: TimePrecision;
  recordedAt: string;
  value: TValue;
  rawValue?: JsonValue;
  unit?: string;
  source: ObservationSource;
  epistemicStatus: EpistemicStatus;
  presence?: Presence;
  confidence?: number;
  metadata?: Record<string, JsonValue>;
  supersedesObservationId?: string;
  isCanonical: boolean;
  schemaVersion: number;
}

export type LoadKind = "cognitive" | "emotional" | "physical" | "social";

/** Presentation aggregate; each populated axis remains its own Observation. */
export interface LoadAssessment {
  kind: LoadKind;
  loadIntensity: number | null;
  subjectiveResponse: number | null;
  intensityPresence: Presence;
  responsePresence: Presence;
  intensityObservationId?: string;
  responseObservationId?: string;
}

export interface OverallWellbeingAnchor {
  value: number;
  dailyMin?: number;
  dailyMax?: number;
  volatility?: number;
}

export interface CanonicalEntity extends VersionedRecord {
  canonicalKey: string;
  canonicalLabel: string;
  userLabel?: string;
  kind: EntityKind;
  domain: DomainKey;
  custom: boolean;
  registryVersion: string;
}

export interface EntityAlias extends VersionedRecord {
  canonicalEntityId?: string;
  normalizedAlias: string;
  displayAlias: string;
  status: "proposed" | "confirmed" | "rejected";
  confirmationRequired: boolean;
}

export interface SymptomEpisode extends VersionedRecord {
  entityDefinitionId: string;
  localDate: string;
  occurredAt?: string;
  occurredEndAt?: string;
  timezone: string;
  timePrecision: TimePrecision;
  presence: Presence;
  intensity?: number;
  location?: string;
  character?: string;
  durationMinutes?: number;
  attributes?: Record<string, JsonValue>;
  source: ObservationSource;
  epistemicStatus: Extract<EpistemicStatus, "measured" | "user_confirmed" | "inferred">;
  confidence?: number;
  provenanceContext?: string;
  schemaVersion: number;
}

export interface CanonicalEvent extends VersionedRecord {
  entityDefinitionId: string;
  localDate: string;
  occurredAt?: string;
  occurredEndAt?: string;
  timezone: string;
  timePrecision: TimePrecision;
  presence: Presence;
  quantity?: number;
  unit?: string;
  attributes?: Record<string, JsonValue>;
  source: ObservationSource;
  epistemicStatus: Extract<
    EpistemicStatus,
    "measured" | "user_confirmed" | "inferred"
  >;
  confidence?: number;
  convertedFromPlannedEventId?: string;
  schemaVersion: number;
}

export interface ContextPeriod extends VersionedRecord {
  entityDefinitionId: string;
  startedAt: string;
  endedAt?: string;
  timezone: string;
  value?: JsonValue;
  source: ObservationSource;
  epistemicStatus: Extract<EpistemicStatus, "measured" | "user_confirmed" | "inferred">;
  confidence?: number;
  schemaVersion: number;
}

export interface PlannedEvent extends VersionedRecord {
  entityDefinitionId: string;
  plannedStartAt: string;
  plannedEndAt?: string;
  timezone: string;
  localDate: string;
  status: "planned" | "confirmed_happened" | "confirmed_cancelled" | "expired_unknown";
  importance?: number;
  attributes?: Record<string, JsonValue>;
  source: ObservationSource;
  schemaVersion: number;
}

export interface BaselineRecord extends VersionedRecord {
  definitionId: string;
  kind: "population_reference" | "habitual" | "user_declared" | "comfortable";
  value: number;
  unit?: string;
  validFrom: string;
  validTo?: string;
  evidenceCount: number;
  confidence: number;
  algorithmVersion: string;
  userConfirmed: boolean;
}

export interface DynamicFeature extends VersionedRecord {
  definitionId: string;
  localDate: string;
  featureType:
    | "normalized_value"
    | "deviation_from_baseline"
    | "delta"
    | "slope"
    | "direction"
    | "velocity"
    | "volatility"
    | "duration"
    | "cumulative_change"
    | "streak"
    | "threshold_crossing";
  value: number;
  windowStart: string;
  windowEnd: string;
  basedOnObservationIds: string[];
  algorithmVersion: string;
}

export type EvidenceRelation = "supports" | "contradicts" | "unknown";

export interface PatternEvidenceItem {
  id: string;
  relation: EvidenceRelation;
  opportunityAt: string;
  factorObservationIds: string[];
  outcomeObservationIds: string[];
  quality: number;
  lagMinutes?: number;
  metadata?: Record<string, JsonValue>;
}

export type PatternStage =
  | "observation"
  | "possible_link"
  | "repeating_pattern"
  | "established_personal_pattern";

export type PatternLifecycle =
  | "emerged"
  | "stable"
  | "strengthening"
  | "weakening"
  | "changed"
  | "no_longer_observed"
  | "refined";

export interface PersonalPattern extends VersionedRecord {
  targetDefinitionId: string;
  factorDefinitionIds: string[];
  modifierDefinitionIds: string[];
  relationshipType:
    | "association"
    | "inverse"
    | "lagged"
    | "cumulative"
    | "threshold"
    | "interaction"
    | "compensation"
    | "mediated";
  direction?: "up_up" | "up_down" | "down_up" | "down_down";
  typicalLagMinutes?: number;
  lagRangeMinutes?: [number, number];
  cumulativeWindowDays?: number;
  threshold?: number;
  evidenceScore: number;
  stage: PatternStage;
  lifecycle: PatternLifecycle;
  evidence: PatternEvidenceItem[];
  parentPatternId?: string;
  validFrom: string;
  validTo?: string;
  algorithmVersion: string;
}

export interface ForecastRecord extends VersionedRecord {
  targetDefinitionId: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  probability: number;
  predictedValue?: number;
  uncertainty?: number;
  positiveContributorIds: string[];
  negativeContributorIds: string[];
  compensatorIds: string[];
  relatedPatternIds: string[];
  outcome:
    | "pending"
    | "confirmed_occurred"
    | "confirmed_absent"
    | "unknown";
  resolvedAt?: string;
  brierScore?: number;
  algorithmVersion: string;
}

export type RecommendationStatus =
  | "generated"
  | "shown"
  | "opened"
  | "accepted"
  | "performed"
  | "not_performed"
  | "helped"
  | "did_not_help";

/**
 * A non-medical, evidence-bound action suggestion. A recommendation is never
 * promoted from population or synthetic data and remains separate from facts.
 */
export interface RecommendationRecord extends VersionedRecord {
  targetDefinitionId: string;
  actionDefinitionId: string;
  relatedPatternIds: string[];
  expectedBenefit?: number;
  controllability?: number;
  effort?: number;
  risk?: number;
  status: RecommendationStatus;
  shownAt?: string;
  performedEventId?: string;
  nonMedical: true;
  algorithmVersion: string;
}

export interface PersonalToolRecord extends VersionedRecord {
  targetDefinitionId: string;
  actionDefinitionId: string;
  contextFilter: Record<string, JsonValue>;
  testCount: number;
  consistency: number;
  status: "candidate" | "active" | "weakening" | "retired";
  relatedPatternIds: string[];
  algorithmVersion: string;
}

export interface PersonalExperimentRecord extends VersionedRecord {
  hypothesis: Record<string, JsonValue>;
  intervention: Record<string, JsonValue>;
  targetDefinitionId: string;
  periodStart: string;
  periodEnd: string;
  baselineWindow: [string, string];
  observationWindow: [string, string];
  status: "proposed" | "active" | "completed" | "cancelled";
  result?: Record<string, JsonValue>;
  evidence: PatternEvidenceItem[];
  algorithmVersion: string;
}

export interface UserProfileRecord extends VersionedRecord {
  displayName: string;
  timezone: string;
  preferences: Record<string, JsonValue>;
  locationPrivacy: "off" | "approximate" | "precise";
  populationOptIn: boolean;
  schemaVersion: number;
}

/**
 * Safe holding area for legacy values whose semantics cannot be recovered.
 * These records never participate in evidence until the person classifies them.
 */
export interface LegacyUnclassifiedRecord extends VersionedRecord {
  legacySource: string;
  legacyTable?: string;
  legacyRecordKey?: string;
  localDate?: string;
  rawPayload: JsonValue;
  reason: string;
  classificationStatus: "pending" | "classified" | "discarded";
  classifiedEntityDefinitionId?: string;
  classifiedRecordId?: string;
  classifiedAt?: string;
  schemaVersion: number;
}

export interface SyncMetadata {
  recordId: string;
  recordType: string;
  localVersion: number;
  serverVersion?: number;
  syncState: "local_only" | "pending" | "synced" | "conflict" | "deleted_pending";
  updatedAt: string;
  lastSyncedAt?: string;
  conflictReason?: string;
}

export function isHistoricalEvidenceStatus(status: EpistemicStatus) {
  return status === "measured" || status === "user_confirmed";
}

export function isKnownPresence(presence: Presence | undefined) {
  return presence === "present" || presence === "confirmed_absent";
}

export function assertUnitInterval(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must be between 0 and 1`);
  }
  return value;
}

export function assertSignedUnit(value: number, field: string): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new RangeError(`${field} must be between -1 and 1`);
  }
  return value;
}
