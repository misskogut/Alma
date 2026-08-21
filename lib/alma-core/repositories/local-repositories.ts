import type {
  CanonicalEvent,
  Observation,
  SymptomEpisode,
  VersionedRecord,
} from "../data-model/types";
import type {
  EventRepository,
  ObservationRepository,
  RepositoryQuery,
  SymptomRepository,
  VersionedRepository,
} from "./contracts";
import { LocalDatabase, type DirtyDateRange } from "../sync/local-database";

export class LocalVersionedRepository<TRecord extends VersionedRecord>
  implements VersionedRepository<TRecord>
{
  constructor(
    protected readonly database: LocalDatabase,
    protected readonly recordType: string,
    private readonly dateField?: keyof TRecord,
  ) {}

  getById(id: string) {
    return this.database.get<TRecord>(this.recordType, id);
  }

  async list(query: RepositoryQuery = {}) {
    const records = await this.database.list<TRecord>(
      this.recordType,
      query.includeDeleted,
    );
    const filtered = records.filter((record) => {
      if (query.userId && record.userId !== query.userId) return false;
      if (!query.range || !this.dateField) return true;
      const value = record[this.dateField];
      return (
        typeof value === "string" &&
        value >= query.range.from &&
        value <= query.range.to
      );
    });
    return typeof query.limit === "number" ? filtered.slice(0, query.limit) : filtered;
  }

  async upsert(record: TRecord) {
    const sync = await this.database.syncMetadata(this.recordType, record.id);
    return this.database.put(this.recordType, record, {
      baseServerVersion: sync?.serverVersion,
      dirtyRange: this.dirtyRange(record, record.deletedAt ? "delete" : "update"),
    });
  }

  async upsertMany(records: TRecord[]) {
    const result: TRecord[] = [];
    for (const record of records) result.push(await this.upsert(record));
    return result;
  }

  async markDeleted(id: string, deletedAt: string) {
    const record = await this.getById(id);
    if (!record) return;
    await this.database.softDelete(
      this.recordType,
      id,
      deletedAt,
      this.dirtyRange(record, "delete"),
    );
  }

  protected dirtyRange(
    record: TRecord,
    reason: DirtyDateRange["reason"],
  ): DirtyDateRange | undefined {
    if (!this.dateField) return undefined;
    const value = record[this.dateField];
    if (typeof value !== "string") return undefined;
    const localDate = value.slice(0, 10);
    return affectedDateRange(localDate, record.id, reason);
  }
}

export class LocalObservationRepository
  extends LocalVersionedRepository<Observation>
  implements ObservationRepository
{
  constructor(database: LocalDatabase) {
    super(database, "observations", "localDate");
  }

  async listByDefinition(definitionId: string, query?: RepositoryQuery) {
    return (await this.list(query)).filter(
      (record) => record.definitionId === definitionId,
    );
  }

  async listCanonical(query?: RepositoryQuery) {
    return (await this.list(query)).filter((record) => record.isCanonical);
  }

  async replaceCanonical(definitionId: string, localDate: string, observationId: string) {
    const records = (await this.list({ includeDeleted: false })).filter(
      (record) =>
        record.definitionId === definitionId && record.localDate === localDate,
    );
    const now = new Date().toISOString();
    for (const record of records) {
      const shouldBeCanonical = record.id === observationId;
      if (record.isCanonical === shouldBeCanonical) continue;
      await this.upsert({
        ...record,
        version: record.version + 1,
        updatedAt: now,
        isCanonical: shouldBeCanonical,
      });
    }
  }
}

export class LocalEventRepository
  extends LocalVersionedRepository<CanonicalEvent>
  implements EventRepository
{
  constructor(database: LocalDatabase) {
    super(database, "events", "localDate");
  }

  async listByEntity(entityDefinitionId: string, query?: RepositoryQuery) {
    return (await this.list(query)).filter(
      (record) => record.entityDefinitionId === entityDefinitionId,
    );
  }
}

export class LocalSymptomRepository
  extends LocalVersionedRepository<SymptomEpisode>
  implements SymptomRepository
{
  constructor(database: LocalDatabase) {
    super(database, "symptoms", "localDate");
  }

  async listByEntity(entityDefinitionId: string, query?: RepositoryQuery) {
    return (await this.list(query)).filter(
      (record) => record.entityDefinitionId === entityDefinitionId,
    );
  }
}

export function affectedDateRange(
  localDate: string,
  recordId: string,
  reason: DirtyDateRange["reason"],
  maximumLagDays = 30,
): DirtyDateRange {
  const end = new Date(`${localDate}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + maximumLagDays);
  return {
    from: localDate,
    to: end.toISOString().slice(0, 10),
    reason,
    recordIds: [recordId],
  };
}
