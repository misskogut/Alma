import type { VersionedRecord } from "../data-model/types";
import { LocalDatabase, type LocalOutboxEntry } from "./local-database";

export interface RemoteChange {
  recordType: string;
  record: VersionedRecord;
}

export interface SyncPushResult {
  status: "accepted" | "duplicate" | "conflict";
  record?: VersionedRecord;
  serverVersion?: number;
  reason?: string;
}

export interface SyncPullResult {
  changes: RemoteChange[];
  cursor: string;
}

export interface SyncTransport {
  push(input: {
    entry: LocalOutboxEntry;
    record: VersionedRecord;
  }): Promise<SyncPushResult>;
  pull(cursor?: string): Promise<SyncPullResult>;
}

export interface SyncRunResult {
  pushed: number;
  duplicates: number;
  pulled: number;
  conflicts: number;
}

export async function synchronize(
  database: LocalDatabase,
  transport: SyncTransport,
): Promise<SyncRunResult> {
  const result: SyncRunResult = { pushed: 0, duplicates: 0, pulled: 0, conflicts: 0 };
  for (const entry of await database.outbox()) {
    const record = await database.get(entry.recordType, entry.recordId);
    if (!record) continue;
    const pushed = await transport.push({ entry, record });
    if (pushed.status === "conflict") {
      await database.markConflict(
        entry.recordType,
        entry.recordId,
        pushed.reason ?? "concurrent_edit",
        pushed.serverVersion,
      );
      result.conflicts += 1;
      continue;
    }
    await database.acknowledge(
      entry.recordType,
      entry.recordId,
      pushed.serverVersion ?? pushed.record?.version ?? record.version,
      new Date().toISOString(),
    );
    if (pushed.record) await database.applyRemote(entry.recordType, pushed.record);
    if (pushed.status === "duplicate") result.duplicates += 1;
    else result.pushed += 1;
  }

  const pulled = await transport.pull(await database.serverCursor());
  for (const change of pulled.changes) {
    const local = await database.get(change.recordType, change.record.id);
    const metadata = await database.syncMetadata(change.recordType, change.record.id);
    if (metadata?.syncState === "pending" || metadata?.syncState === "deleted_pending") {
      const resolution = resolveConcurrentRecord(local, change.record);
      if (resolution.status === "conflict") {
        await database.markConflict(
          change.recordType,
          change.record.id,
          resolution.reason,
          change.record.version,
        );
        result.conflicts += 1;
        continue;
      }
      if (resolution.record === local) continue;
    }
    if (!local || change.record.version >= local.version) {
      await database.applyRemote(change.recordType, change.record);
      result.pulled += 1;
    }
  }
  await database.setServerCursor(pulled.cursor);
  return result;
}

export function resolveConcurrentRecord(
  local: VersionedRecord | null,
  remote: VersionedRecord,
):
  | { status: "resolved"; record: VersionedRecord }
  | { status: "conflict"; reason: string } {
  if (!local) return { status: "resolved", record: remote };
  if (recordsEqual(local, remote)) return { status: "resolved", record: remote };
  if (local.version > remote.version) return { status: "resolved", record: local };
  // A pending local edit and a different equal/newer server copy are both
  // retained for explicit resolution. Last-write-wins would silently erase a
  // correction made offline.
  return {
    status: "conflict",
    reason: "Одна и та же запись была изменена локально и в облаке. Обе версии сохранены для выбора.",
  };
}

export function deduplicateByStableIdentity<TRecord extends VersionedRecord>(
  records: TRecord[],
): TRecord[] {
  const byId = new Map<string, TRecord>();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing || record.version > existing.version || (record.version === existing.version && record.updatedAt > existing.updatedAt)) {
      byId.set(record.id, record);
    }
  }
  return [...byId.values()];
}

function recordsEqual(left: VersionedRecord, right: VersionedRecord) {
  return JSON.stringify(left) === JSON.stringify(right);
}
