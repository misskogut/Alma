import type { VersionedRecord } from "../data-model/types";
import type { OutputFeedRecord } from "../communication/types";
import type { DirtyDateRange } from "../sync/local-database";

export interface DeletionInvalidationResult<TRecord extends VersionedRecord> {
  activeRecords: TRecord[];
  affectedInsightRecords: OutputFeedRecord[];
  dirtyRanges: DirtyDateRange[];
}

/**
 * Current analytics exclude soft-deleted facts, while already delivered
 * insights remain immutable and receive only a source-data marker.
 */
export function invalidateAfterDeletion<TRecord extends VersionedRecord>(input: {
  records: TRecord[];
  feed: OutputFeedRecord[];
  deletedRecordIds: string[];
  affectedInsightIds: string[];
  deletedAt: string;
  dirtyRanges?: DirtyDateRange[];
}): DeletionInvalidationResult<TRecord> {
  const deleted = new Set(input.deletedRecordIds);
  const affectedInsights = new Set(input.affectedInsightIds);
  return {
    activeRecords: input.records.filter(
      (record) => !record.deletedAt && !deleted.has(record.id),
    ),
    affectedInsightRecords: input.feed.map((insight) =>
      affectedInsights.has(insight.id) && !insight.sourceDataDeletedAt
        ? {
            ...insight,
            sourceDataDeletedAt: input.deletedAt,
            version: insight.version + 1,
            updatedAt: input.deletedAt,
          }
        : insight,
    ),
    dirtyRanges: input.dirtyRanges ?? [],
  };
}
