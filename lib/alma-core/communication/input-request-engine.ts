import { PATTERN_ALGORITHM_VERSION } from "../data-model/versions";
import { clamp, stableId } from "../engines/math";
import type { InputRequestRecord, ResearchQuestRecord } from "../engines/types";
import type {
  InputRequestCandidate,
  RankedInputRequest,
} from "./types";

const SUBJECTIVE_MAX_AGE_HOURS = 36;

export function rankInputRequests(
  candidates: InputRequestCandidate[],
  now = new Date(),
): RankedInputRequest[] {
  const useful = candidates.filter((candidate) => isRequestStillUseful(candidate, now));
  const byTarget = new Map<string, InputRequestCandidate[]>();
  for (const candidate of useful) {
    const existing = byTarget.get(candidate.targetDefinitionId) ?? [];
    existing.push(candidate);
    byTarget.set(candidate.targetDefinitionId, existing);
  }

  return [...byTarget.values()]
    .map((shared) => {
      const strongest = [...shared].sort(
        (left, right) => requestScore(right) - requestScore(left),
      )[0];
      const sharedQuestIds = Array.from(
        new Set(shared.flatMap((candidate) => candidate.relatedQuestIds ?? [])),
      );
      return {
        ...strongest,
        score: clamp(
          requestScore(strongest) + Math.min(0.08, (sharedQuestIds.length - 1) * 0.025),
          0,
          1,
        ),
        sharedWithQuestIds: sharedQuestIds,
      };
    })
    .sort((left, right) => right.score - left.score || left.estimatedEffort - right.estimatedEffort);
}

/** Default disclosure: one best question, then at most two more on explicit request. */
export function progressiveInputBatch(
  ranked: RankedInputRequest[],
  depth = 0,
): RankedInputRequest[] {
  const size = Math.max(1, Math.min(3, depth + 1));
  return ranked.slice(0, size);
}

export function createInputRequestRecords(
  ranked: RankedInputRequest[],
  now = new Date().toISOString(),
): InputRequestRecord[] {
  return ranked.map((request) => ({
    id: stableId("input", request.id, request.targetDefinitionId, now),
    version: 1,
    createdAt: now,
    updatedAt: now,
    targetDefinitionId: request.targetDefinitionId,
    reasonCode: request.reasonCode,
    relatedQuestId: request.sharedWithQuestIds[0],
    relatedHypothesisId: request.relatedHypothesisIds?.[0],
    priority: request.score,
    informationValue: clamp(request.informationValue, 0, 1),
    estimatedEffort: clamp(request.estimatedEffort, 0, 1),
    recurring: request.recurring ?? false,
    expiresAt: request.expiresAt,
    retrospectiveAllowed: request.retrospectiveAllowed ?? false,
    explanation: request.explanation,
    status: "open",
    algorithmVersion: PATTERN_ALGORITHM_VERSION,
  }));
}

export function expireStaleRequests(
  records: InputRequestRecord[],
  now = new Date(),
): InputRequestRecord[] {
  return records.map((record) => {
    if (record.status !== "open" || !record.expiresAt || new Date(record.expiresAt) > now) {
      return record;
    }
    const updatedAt = now.toISOString();
    return {
      ...record,
      version: record.version + 1,
      updatedAt,
      status: "expired" as const,
    };
  });
}

export function requestsFromQuests(
  quests: ResearchQuestRecord[],
  knownDefinitionIds: Set<string>,
  now = new Date(),
): InputRequestCandidate[] {
  const createdAt = now.toISOString();
  return quests
    .filter((quest) => ["active", "reactivated"].includes(quest.status))
    .flatMap((quest) =>
      quest.requiredMetricIds
        .filter((definitionId) => !knownDefinitionIds.has(definitionId))
        .map((definitionId) => ({
          id: stableId("quest-input", quest.id, definitionId),
          targetDefinitionId: definitionId,
          reasonCode: "research_missing_metric",
          explanation: `Этот ответ поможет проверить исследование «${quest.title}».`,
          informationValue: 0.85,
          urgency: 0.35,
          researchRelevance: 1,
          uncertaintyReduction: 0.85,
          estimatedEffort: 0.15,
          createdAt,
          expiresAt: endOfLocalDay(now).toISOString(),
          freshness: "subjective_today" as const,
          recurring: true,
          retrospectiveAllowed: false,
          relatedQuestIds: [quest.id],
        })),
    );
}

export function isRequestStillUseful(candidate: InputRequestCandidate, now: Date) {
  if (candidate.expiresAt && new Date(candidate.expiresAt) <= now) return false;
  if (candidate.freshness !== "subjective_today") return true;
  const ageHours = (now.getTime() - new Date(candidate.createdAt).getTime()) / 3_600_000;
  return ageHours <= SUBJECTIVE_MAX_AGE_HOURS;
}

function requestScore(request: InputRequestCandidate) {
  return clamp(
    request.informationValue * 0.31 +
      request.urgency * 0.18 +
      request.researchRelevance * 0.2 +
      request.uncertaintyReduction * 0.21 +
      (1 - request.estimatedEffort) * 0.1,
    0,
    1,
  );
}

function endOfLocalDay(date: Date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}
