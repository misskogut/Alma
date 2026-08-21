import type {
  JsonValue,
  PatternLifecycle,
  PatternStage,
  VersionedRecord,
} from "../data-model/types";

export type NarrativeInsightType =
  | "first_coincidence"
  | "possible_relationship"
  | "repeated_pattern"
  | "established_personal_pattern"
  | "counterexample"
  | "weakening_pattern"
  | "disappeared_pattern"
  | "refined_pattern"
  | "lagged_relationship"
  | "cumulative_relationship"
  | "inverse_relationship"
  | "interaction"
  | "compensation"
  | "exception"
  | "new_hypothesis"
  | "competing_hypotheses"
  | "experiment_proposal"
  | "experiment_result"
  | "forecast"
  | "forecast_miss"
  | "recommendation"
  | "baseline_change"
  | "life_context_change"
  | "insufficient_evidence";

export interface StructuredInsight {
  id: string;
  type: NarrativeInsightType;
  createdAt: string;
  relevantPeriod?: { start?: string; end?: string };
  targetDefinitionId?: string;
  factorDefinitionIds?: string[];
  modifierDefinitionIds?: string[];
  compensatorDefinitionIds?: string[];
  direction?: "up_up" | "up_down" | "down_up" | "down_down";
  factorChange?: "increase" | "decrease";
  targetChange?: "increase" | "decrease";
  lagMinutes?: number;
  lagRangeMinutes?: [number, number];
  cumulativeWindowDays?: number;
  support?: number;
  opportunities?: number;
  counterexamples?: number;
  evidenceScore?: number;
  stage?: PatternStage;
  lifecycle?: PatternLifecycle;
  probability?: number;
  uncertainty?: number;
  previousInsightId?: string;
  relatedPatternId?: string;
  relatedQuestId?: string;
  hypothesisLabels?: string[];
  actionDefinitionId?: string;
  experimentResult?: "helped" | "did_not_help" | "inconclusive";
  metadata?: Record<string, JsonValue>;
}

export interface NarrativeCopy {
  title: string;
  body: string;
  shortBody: string;
  uncertaintyNote?: string;
}

export interface OutputFeedRecord extends VersionedRecord {
  insightType: NarrativeInsightType;
  structuredPayload: StructuredInsight;
  title: string;
  body: string;
  relevantPeriodStart?: string;
  relevantPeriodEnd?: string;
  priority: number;
  readAt?: string;
  archivedAt?: string;
  carryForward: boolean;
  relatedPatternId?: string;
  relatedQuestId?: string;
  supersedesInsightId?: string;
  sourceDataDeletedAt?: string;
  algorithmVersion: string;
  narrativeVersion: string;
}

export type InputFreshness = "subjective_today" | "recent_fact" | "timeless_context";

export interface InputRequestCandidate {
  id: string;
  targetDefinitionId: string;
  reasonCode: string;
  explanation: string;
  informationValue: number;
  urgency: number;
  researchRelevance: number;
  uncertaintyReduction: number;
  estimatedEffort: number;
  createdAt: string;
  expiresAt?: string;
  recurring?: boolean;
  retrospectiveAllowed?: boolean;
  freshness: InputFreshness;
  relatedQuestIds?: string[];
  relatedHypothesisIds?: string[];
}

export interface RankedInputRequest extends InputRequestCandidate {
  score: number;
  sharedWithQuestIds: string[];
}

export interface ContactCandidate {
  id: string;
  kind: "input_request" | "insight" | "forecast" | "research" | "experiment";
  createdAt: string;
  expiresAt?: string;
  informationValue: number;
  urgency: number;
  novelty: number;
  relevance: number;
  researchRelevance: number;
  estimatedEffort: number;
  preferredDayParts?: Array<"morning" | "day" | "evening">;
}

export interface ContactHistoryItem {
  kind: ContactCandidate["kind"];
  contactedAt: string;
  respondedAt?: string;
  ignored: boolean;
}

export interface ContactProfile {
  comfortableContactsPerDay: number;
  preferredDayParts: Array<"morning" | "day" | "evening">;
  responseRateByKind: Partial<Record<ContactCandidate["kind"], number>>;
}
