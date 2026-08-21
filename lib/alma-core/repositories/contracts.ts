import type {
  BaselineRecord,
  CanonicalEntity,
  CanonicalEvent,
  ContextPeriod,
  EntityAlias,
  ForecastRecord,
  Observation,
  PersonalPattern,
  PlannedEvent,
  SymptomEpisode,
  SyncMetadata,
  VersionedRecord,
} from "../data-model/types";

export interface DateRange {
  from: string;
  to: string;
}

export interface RepositoryQuery {
  userId?: string;
  range?: DateRange;
  includeDeleted?: boolean;
  limit?: number;
}

export interface VersionedRepository<TRecord extends VersionedRecord> {
  getById(id: string): Promise<TRecord | null>;
  list(query?: RepositoryQuery): Promise<TRecord[]>;
  upsert(record: TRecord): Promise<TRecord>;
  upsertMany(records: TRecord[]): Promise<TRecord[]>;
  markDeleted(id: string, deletedAt: string): Promise<void>;
}

export interface ObservationRepository extends VersionedRepository<Observation> {
  listByDefinition(definitionId: string, query?: RepositoryQuery): Promise<Observation[]>;
  listCanonical(query?: RepositoryQuery): Promise<Observation[]>;
  replaceCanonical(definitionId: string, localDate: string, observationId: string): Promise<void>;
}

export interface EventRepository extends VersionedRepository<CanonicalEvent> {
  listByEntity(entityDefinitionId: string, query?: RepositoryQuery): Promise<CanonicalEvent[]>;
}

export interface SymptomRepository extends VersionedRepository<SymptomEpisode> {
  listByEntity(entityDefinitionId: string, query?: RepositoryQuery): Promise<SymptomEpisode[]>;
}

export interface PlannedEventRepository extends VersionedRepository<PlannedEvent> {}
export interface ContextRepository extends VersionedRepository<ContextPeriod> {}
export interface BaselineRepository extends VersionedRepository<BaselineRecord> {}
export interface PatternRepository extends VersionedRepository<PersonalPattern> {}
export interface ForecastRepository extends VersionedRepository<ForecastRecord> {}
export interface EntityRepository extends VersionedRepository<CanonicalEntity> {
  listAliases(entityId: string): Promise<EntityAlias[]>;
  saveAlias(alias: EntityAlias): Promise<EntityAlias>;
}

export interface ResearchRepository<TQuest extends VersionedRecord> extends VersionedRepository<TQuest> {}
export interface InsightRepository<TInsight extends VersionedRecord> extends VersionedRepository<TInsight> {}
export interface ProfileRepository<TProfile extends VersionedRecord> extends VersionedRepository<TProfile> {}

export interface SyncRepository {
  get(recordId: string): Promise<SyncMetadata | null>;
  listPending(limit?: number): Promise<SyncMetadata[]>;
  save(metadata: SyncMetadata): Promise<void>;
}

export interface AlmaRepositories {
  observations: ObservationRepository;
  events: EventRepository;
  symptoms: SymptomRepository;
  plannedEvents: PlannedEventRepository;
  contexts: ContextRepository;
  baselines: BaselineRepository;
  patterns: PatternRepository;
  forecasts: ForecastRepository;
  entities: EntityRepository;
  sync: SyncRepository;
}

