import {
  NARRATIVE_TEMPLATE_VERSION,
  PATTERN_ALGORITHM_VERSION,
} from "../data-model/versions";
import { clamp, stableId } from "../engines/math";
import { renderNarrative } from "./narrative-engine";
import type {
  OutputFeedRecord,
  StructuredInsight,
} from "./types";

export function createOutputFeedItem(
  insight: StructuredInsight,
  options: {
    priority?: number;
    carryForward?: boolean;
    now?: string;
  } = {},
): OutputFeedRecord {
  const createdAt = options.now ?? insight.createdAt;
  const narrative = renderNarrative(insight);
  return {
    id: stableId("feed", insight.id, createdAt),
    version: 1,
    createdAt,
    updatedAt: createdAt,
    insightType: insight.type,
    structuredPayload: insight,
    title: narrative.title,
    body: narrative.body,
    relevantPeriodStart: insight.relevantPeriod?.start,
    relevantPeriodEnd: insight.relevantPeriod?.end,
    priority: clamp(options.priority ?? insightPriority(insight), 0, 1),
    carryForward: options.carryForward ?? true,
    relatedPatternId: insight.relatedPatternId,
    relatedQuestId: insight.relatedQuestId,
    supersedesInsightId: insight.previousInsightId,
    algorithmVersion: PATTERN_ALGORITHM_VERSION,
    narrativeVersion: NARRATIVE_TEMPLATE_VERSION,
  };
}

/** Content is immutable; only delivery metadata may change. */
export function markInsightRead(item: OutputFeedRecord, readAt: string): OutputFeedRecord {
  if (item.readAt) return item;
  return {
    ...item,
    version: item.version + 1,
    updatedAt: readAt,
    readAt,
  };
}

export function archiveInsight(item: OutputFeedRecord, archivedAt: string): OutputFeedRecord {
  if (item.archivedAt) return item;
  return {
    ...item,
    version: item.version + 1,
    updatedAt: archivedAt,
    archivedAt,
  };
}

/** A refinement is a new item linked to the original; old text remains unchanged. */
export function supersedeInsight(
  previous: OutputFeedRecord,
  refinement: StructuredInsight,
): OutputFeedRecord {
  return createOutputFeedItem(
    {
      ...refinement,
      previousInsightId: previous.id,
    },
    { priority: Math.max(previous.priority, insightPriority(refinement)) },
  );
}

export function rankOutputFeed(items: OutputFeedRecord[]) {
  return [...items]
    .filter((item) => !item.archivedAt && !item.deletedAt)
    .sort((left, right) => {
      const unreadDifference = Number(!right.readAt) - Number(!left.readAt);
      if (unreadDifference) return unreadDifference;
      const priorityDifference = right.priority - left.priority;
      if (priorityDifference) return priorityDifference;
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    });
}

export function returnAfterAbsence(items: OutputFeedRecord[], maximum = 5) {
  const unread = rankOutputFeed(items).filter((item) => !item.readAt && item.carryForward);
  return {
    count: unread.length,
    title:
      unread.length === 0
        ? "Новых наблюдений пока нет"
        : `Пока вас не было, ALMA заметила ${formatCount(unread.length)}`,
    items: unread.slice(0, Math.max(1, maximum)),
  };
}

export type MicroResultKind =
  | "useful_control_day"
  | "unchanged"
  | "slightly_strengthened"
  | "slightly_weakened";

export function immediateInputFeedback(kind: MicroResultKind) {
  const messages: Record<MicroResultKind, string> = {
    useful_control_day: "Данные учтены. Это полезный день для сравнения.",
    unchanged: "Данные учтены. Текущие версии пока не изменились.",
    slightly_strengthened: "Данные учтены. Одна из версий стала немного сильнее.",
    slightly_weakened: "Данные учтены. В одной из версий появилось полезное исключение.",
  };
  return { title: "Готово", body: messages[kind], archived: false };
}

export function isMaterialModelUpdate(input: {
  previousStage?: StructuredInsight["stage"];
  nextStage?: StructuredInsight["stage"];
  previousEvidenceScore?: number;
  nextEvidenceScore?: number;
  lifecycleChanged?: boolean;
}) {
  if (input.previousStage !== input.nextStage) return true;
  if (input.lifecycleChanged) return true;
  return Math.abs((input.nextEvidenceScore ?? 0) - (input.previousEvidenceScore ?? 0)) >= 0.15;
}

function insightPriority(insight: StructuredInsight) {
  const base: Record<StructuredInsight["type"], number> = {
    first_coincidence: 0.25,
    possible_relationship: 0.45,
    repeated_pattern: 0.6,
    established_personal_pattern: 0.82,
    counterexample: 0.55,
    weakening_pattern: 0.68,
    disappeared_pattern: 0.72,
    refined_pattern: 0.78,
    lagged_relationship: 0.64,
    cumulative_relationship: 0.68,
    inverse_relationship: 0.62,
    interaction: 0.75,
    compensation: 0.76,
    exception: 0.5,
    new_hypothesis: 0.42,
    competing_hypotheses: 0.48,
    experiment_proposal: 0.62,
    experiment_result: 0.83,
    forecast: 0.7,
    forecast_miss: 0.74,
    recommendation: 0.68,
    baseline_change: 0.78,
    life_context_change: 0.72,
    insufficient_evidence: 0.22,
  };
  return clamp(base[insight.type] + (insight.evidenceScore ?? 0) * 0.08, 0, 1);
}

function formatCount(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} важную вещь`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} важные вещи`;
  }
  return `${count} важных вещей`;
}
