import { ALMA_SCHEMA_VERSION } from "../data-model/versions";
import type { SyncMetadata, VersionedRecord } from "../data-model/types";

export interface KeyValueStorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface LocalOutboxEntry {
  id: string;
  recordType: string;
  recordId: string;
  operation: "upsert" | "delete";
  localVersion: number;
  baseServerVersion?: number;
  enqueuedAt: string;
  attempts: number;
}

export interface DirtyDateRange {
  from: string;
  to: string;
  reason: "insert" | "update" | "delete" | "canonical_source_change" | "algorithm_upgrade";
  recordIds: string[];
}

interface LocalDatabaseState {
  schemaVersion: number;
  records: Record<string, Record<string, VersionedRecord>>;
  sync: Record<string, SyncMetadata>;
  outbox: LocalOutboxEntry[];
  dirtyRanges: DirtyDateRange[];
  serverCursor?: string;
  updatedAt: string;
}

const EMPTY_STATE = (): LocalDatabaseState => ({
  schemaVersion: ALMA_SCHEMA_VERSION,
  records: {},
  sync: {},
  outbox: [],
  dirtyRanges: [],
  updatedAt: new Date(0).toISOString(),
});

export class MemoryStorageAdapter implements KeyValueStorageAdapter {
  private values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
  }

  async remove(key: string) {
    this.values.delete(key);
  }
}

export class BrowserLocalStorageAdapter implements KeyValueStorageAdapter {
  async get(key: string) {
    return window.localStorage.getItem(key);
  }

  async set(key: string, value: string) {
    window.localStorage.setItem(key, value);
  }

  async remove(key: string) {
    window.localStorage.removeItem(key);
  }
}

/**
 * Small local-first record database. Storage is pluggable so IndexedDB can replace
 * localStorage without changing repositories or sync semantics.
 */
export class LocalDatabase {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly adapter: KeyValueStorageAdapter,
    private readonly key = "alma-canonical-v2",
  ) {}

  async get<TRecord extends VersionedRecord>(recordType: string, id: string) {
    const state = await this.read();
    return (state.records[recordType]?.[id] as TRecord | undefined) ?? null;
  }

  async list<TRecord extends VersionedRecord>(recordType: string, includeDeleted = false) {
    const state = await this.read();
    return Object.values(state.records[recordType] ?? {})
      .filter((record) => includeDeleted || !record.deletedAt)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)) as TRecord[];
  }

  async put<TRecord extends VersionedRecord>(
    recordType: string,
    record: TRecord,
    options: {
      enqueue?: boolean;
      baseServerVersion?: number;
      dirtyRange?: DirtyDateRange;
    } = {},
  ): Promise<TRecord> {
    return this.mutate((state) => {
      const table = state.records[recordType] ?? {};
      const existing = table[record.id] as TRecord | undefined;
      const contentChanged = existing
        ? JSON.stringify(existing) !== JSON.stringify(record)
        : false;
      const next: TRecord = {
        ...record,
        version: existing && contentChanged
          ? Math.max(record.version, existing.version + 1)
          : Math.max(record.version, existing?.version ?? 1),
      };
      state.records[recordType] = { ...table, [record.id]: next };
      if (options.enqueue !== false) {
        enqueueChange(state, recordType, next.id, next.deletedAt ? "delete" : "upsert", next.version, options.baseServerVersion);
        state.sync[syncKey(recordType, next.id)] = {
          recordId: next.id,
          recordType,
          localVersion: next.version,
          serverVersion: options.baseServerVersion,
          syncState: next.deletedAt ? "deleted_pending" : "pending",
          updatedAt: next.updatedAt,
        };
      }
      if (options.dirtyRange) state.dirtyRanges = mergeDirtyRanges([...state.dirtyRanges, options.dirtyRange]);
      return next;
    });
  }

  async softDelete(
    recordType: string,
    id: string,
    deletedAt: string,
    dirtyRange?: DirtyDateRange,
  ) {
    const existing = await this.get(recordType, id);
    if (!existing) return;
    await this.put(recordType, {
      ...existing,
      version: existing.version + 1,
      updatedAt: deletedAt,
      deletedAt,
    }, { dirtyRange });
  }

  async applyRemote<TRecord extends VersionedRecord>(recordType: string, record: TRecord) {
    return this.mutate((state) => {
      const table = state.records[recordType] ?? {};
      state.records[recordType] = { ...table, [record.id]: record };
      state.sync[syncKey(recordType, record.id)] = {
        recordId: record.id,
        recordType,
        localVersion: record.version,
        serverVersion: record.version,
        syncState: "synced",
        updatedAt: record.updatedAt,
        lastSyncedAt: new Date().toISOString(),
      };
      return record;
    });
  }

  async hasPendingChange(recordType: string, recordId: string) {
    const state = await this.read();
    return state.outbox.some(
      (entry) => entry.recordType === recordType && entry.recordId === recordId,
    );
  }

  async outbox(limit = 100) {
    const state = await this.read();
    return state.outbox.slice(0, limit);
  }

  async acknowledge(recordType: string, recordId: string, serverVersion: number, syncedAt: string) {
    await this.mutate((state) => {
      state.outbox = state.outbox.filter((entry) => !(entry.recordType === recordType && entry.recordId === recordId));
      const record = state.records[recordType]?.[recordId];
      state.sync[syncKey(recordType, recordId)] = {
        recordId,
        recordType,
        localVersion: record?.version ?? serverVersion,
        serverVersion,
        syncState: "synced",
        updatedAt: record?.updatedAt ?? syncedAt,
        lastSyncedAt: syncedAt,
      };
    });
  }

  async markConflict(recordType: string, recordId: string, reason: string, serverVersion?: number) {
    await this.mutate((state) => {
      const record = state.records[recordType]?.[recordId];
      state.sync[syncKey(recordType, recordId)] = {
        recordId,
        recordType,
        localVersion: record?.version ?? 1,
        serverVersion,
        syncState: "conflict",
        conflictReason: reason,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  async syncMetadata(recordType: string, recordId: string) {
    const state = await this.read();
    return state.sync[syncKey(recordType, recordId)] ?? null;
  }

  async allSyncMetadata() {
    const state = await this.read();
    return Object.values(state.sync);
  }

  async consumeDirtyRanges() {
    return this.mutate((state) => {
      const ranges = state.dirtyRanges;
      state.dirtyRanges = [];
      return ranges;
    });
  }

  async setServerCursor(cursor: string) {
    await this.mutate((state) => {
      state.serverCursor = cursor;
    });
  }

  async serverCursor() {
    return (await this.read()).serverCursor;
  }

  private async read(): Promise<LocalDatabaseState> {
    const raw = await this.adapter.get(this.key);
    if (!raw) return EMPTY_STATE();
    try {
      const parsed = JSON.parse(raw) as LocalDatabaseState;
      if (parsed.schemaVersion !== ALMA_SCHEMA_VERSION) return EMPTY_STATE();
      return parsed;
    } catch {
      return EMPTY_STATE();
    }
  }

  private async mutate<TResult>(operation: (state: LocalDatabaseState) => TResult | Promise<TResult>): Promise<TResult> {
    const run = this.queue.then(async () => {
      const state = await this.read();
      const result = await operation(state);
      state.updatedAt = new Date().toISOString();
      await this.adapter.set(this.key, JSON.stringify(state));
      return result;
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

function enqueueChange(
  state: LocalDatabaseState,
  recordType: string,
  recordId: string,
  operation: LocalOutboxEntry["operation"],
  localVersion: number,
  baseServerVersion?: number,
) {
  const id = `${recordType}:${recordId}`;
  const previous = state.outbox.find((entry) => entry.id === id);
  const next: LocalOutboxEntry = {
    id,
    recordType,
    recordId,
    operation,
    localVersion,
    baseServerVersion: baseServerVersion ?? previous?.baseServerVersion,
    enqueuedAt: previous?.enqueuedAt ?? new Date().toISOString(),
    attempts: previous?.attempts ?? 0,
  };
  state.outbox = [...state.outbox.filter((entry) => entry.id !== id), next];
}

export function mergeDirtyRanges(ranges: DirtyDateRange[]): DirtyDateRange[] {
  const sorted = [...ranges].sort((left, right) => left.from.localeCompare(right.from));
  const merged: DirtyDateRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.from > previous.to) {
      merged.push({ ...range, recordIds: [...new Set(range.recordIds)] });
      continue;
    }
    previous.to = previous.to > range.to ? previous.to : range.to;
    previous.recordIds = [...new Set([...previous.recordIds, ...range.recordIds])];
    if (previous.reason !== range.reason) previous.reason = "update";
  }
  return merged;
}

function syncKey(recordType: string, recordId: string) {
  return `${recordType}:${recordId}`;
}
