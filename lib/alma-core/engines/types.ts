import type {
  EpistemicStatus,
  JsonValue,
  PatternEvidenceItem,
  PatternStage,
  Presence,
  VersionedRecord,
} from "../data-model/types";

export interface NumericEvidencePoint {
  id: string;
  definitionId: string;
  occurredAt: string;
  localDate: string;
  value?: number;
  presence?: Presence;
  epistemicStatus: EpistemicStatus;
  confidence?: number;
  sourceId?: string;
  synthetic?: boolean;
  metadata?: Record<string, JsonValue>;
}

export interface BaselineEstimate {
  definitionId: string;
  kind: "population_reference" | "habitual" | "user_declared" | "comfortable";
  center: number;
  scale: number;
  evidenceCount: number;
  confidence: number;
  validFrom: string;
  validTo?: string;
  userConfirmed: boolean;
  algorithmVersion: string;
}

export interface LagWindow {
  minMinutes: number;
  maxMinutes: number;
}

export interface PatternAnalysisDiagnostics {
  opportunities: number;
  support: number;
  counterexamples: number;
  unknown: number;
  effectSize: number;
  exposedRate?: number;
  controlRate?: number;
  dataQuality: number;
  temporalStability: number;
  lagConsistency: number;
  evidence: PatternEvidenceItem[];
}

export interface PatternCandidate {
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
  diagnostics: PatternAnalysisDiagnostics;
  algorithmVersion: string;
}

export interface ResearchHypothesis {
  id: string;
  targetDefinitionId: string;
  factorDefinitionIds: string[];
  modifierDefinitionIds: string[];
  relationshipType: PatternCandidate["relationshipType"];
  priorScore: number;
  evidenceScore: number;
  status: "candidate" | "collecting" | "supported" | "weakened" | "rejected";
  source: "personal_candidate" | "scientific_prior" | "population_prior" | "user_question";
  requiredMetricIds: string[];
  optionalMetricIds: string[];
  explanation: string;
}

export type ResearchQuestStatus =
  | "suggested"
  | "active"
  | "paused"
  | "sufficient_result"
  | "completed"
  | "background_monitoring"
  | "reactivated";

export interface ResearchQuestRecord extends VersionedRecord {
  title: string;
  targetDefinitionId: string;
  status: ResearchQuestStatus;
  hypotheses: ResearchHypothesis[];
  requiredMetricIds: string[];
  optionalMetricIds: string[];
  progress: {
    knownOpportunities: number;
    controlDays: number;
    evidenceCoverage: number;
    enoughData: boolean;
  };
  dossier: {
    supportedHypothesisIds: string[];
    weakenedHypothesisIds: string[];
    modifierDefinitionIds: string[];
    personalToolIds: string[];
    experimentIds: string[];
  };
  algorithmVersion: string;
}

export interface InputRequestRecord extends VersionedRecord {
  targetDefinitionId: string;
  reasonCode: string;
  relatedQuestId?: string;
  relatedHypothesisId?: string;
  priority: number;
  informationValue: number;
  estimatedEffort: number;
  recurring: boolean;
  expiresAt?: string;
  retrospectiveAllowed: boolean;
  explanation: string;
  status: "open" | "answered" | "expired" | "dismissed";
  answerObservationId?: string;
  algorithmVersion: string;
}

export function isEvidencePointEligible(point: NumericEvidencePoint) {
  return (
    !point.synthetic &&
    (point.epistemicStatus === "measured" ||
      point.epistemicStatus === "user_confirmed")
  );
}

export function numericPointValue(point: NumericEvidencePoint): number | null {
  if (point.presence === "confirmed_absent") return 0;
  if (point.presence === "unknown") return null;
  if (typeof point.value === "number" && Number.isFinite(point.value)) {
    return point.value;
  }
  if (point.presence === "present") return 1;
  return null;
}
