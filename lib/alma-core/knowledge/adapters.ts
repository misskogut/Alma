import { SCIENTIFIC_KB_VERSION } from "../data-model/versions";
import type { JsonValue } from "../data-model/types";
import type { ResearchHypothesis } from "../engines/types";

export type KnowledgeAvailability =
  | { status: "available"; version: string }
  | { status: "unavailable"; reason: string; version: string };

export interface ScientificRelationship {
  id: string;
  targetDefinitionId: string;
  factorDefinitionId: string;
  relationshipType: ResearchHypothesis["relationshipType"];
  direction?: "up_up" | "up_down" | "down_up" | "down_down";
  possibleLagMinutes?: [number, number];
  populationDescription?: string;
  knownModifierDefinitionIds: string[];
  evidenceLevel: string;
  sourceIds: string[];
  version: string;
  reviewedAt: string;
}

export interface ScientificKnowledgeAdapter {
  availability(): Promise<KnowledgeAvailability>;
  findStartingHypotheses(input: {
    targetDefinitionId: string;
    availableDefinitionIds: string[];
    context?: Record<string, JsonValue>;
  }): Promise<ScientificRelationship[]>;
}

export interface PopulationHypothesis {
  id: string;
  targetDefinitionId: string;
  factorDefinitionIds: string[];
  relationshipType: ResearchHypothesis["relationshipType"];
  cohortDescription: string;
  evidenceScore: number;
  version: string;
}

export interface PopulationKnowledgeAdapter {
  availability(input: { explicitOptIn: boolean }): Promise<KnowledgeAvailability>;
  findStartingHypotheses(input: {
    explicitOptIn: boolean;
    targetDefinitionId: string;
    coarseContext?: Record<string, JsonValue>;
  }): Promise<PopulationHypothesis[]>;
}

export type SafetyUrgency =
  | "worth_discussing"
  | "seek_care_soon"
  | "do_not_delay";

export interface ValidatedSafetyRule {
  id: string;
  version: string;
  reviewedAt: string;
  reviewerReference: string;
  urgency: SafetyUrgency;
  evaluate(input: SafetyEvaluationInput): boolean;
  userMessageRu: string;
}

export interface SafetyEvaluationInput {
  definitionIds: string[];
  observations: Array<{
    definitionId: string;
    occurredAt?: string;
    value?: JsonValue;
  }>;
}

export interface SafetyEvaluation {
  status: "clear" | "matched" | "unavailable";
  urgency?: SafetyUrgency;
  matchedRuleIds: string[];
  userMessageRu?: string;
  reason?: string;
}

export interface SafetyKnowledgeAdapter {
  availability(): Promise<KnowledgeAvailability>;
  evaluate(input: SafetyEvaluationInput): Promise<SafetyEvaluation>;
}

/** Explicit prototype states: interfaces exist, but no evidence is invented. */
export const unavailableScientificKnowledge: ScientificKnowledgeAdapter = {
  async availability() {
    return {
      status: "unavailable",
      reason: "Проверенная научная база пока не подключена.",
      version: SCIENTIFIC_KB_VERSION,
    };
  },
  async findStartingHypotheses() {
    return [];
  },
};

export const unavailablePopulationKnowledge: PopulationKnowledgeAdapter = {
  async availability({ explicitOptIn }) {
    return {
      status: "unavailable",
      reason: explicitOptIn
        ? "Агрегированная база наблюдений пока не подключена."
        : "Для анализа агрегированных данных потребуется отдельное согласие.",
      version: "unavailable-v1",
    };
  },
  async findStartingHypotheses() {
    return [];
  },
};

export const unavailableSafetyKnowledge: SafetyKnowledgeAdapter = {
  async availability() {
    return {
      status: "unavailable",
      reason: "Клинически проверенный набор правил пока не подключён.",
      version: "unavailable-v1",
    };
  },
  async evaluate() {
    return {
      status: "unavailable",
      matchedRuleIds: [],
      reason: "ALMA не будет придумывать медицинские правила до подключения проверенной базы.",
    };
  },
};

export function createValidatedSafetyAdapter(
  rules: ValidatedSafetyRule[],
  version: string,
): SafetyKnowledgeAdapter {
  return {
    async availability() {
      return rules.length
        ? { status: "available", version }
        : {
            status: "unavailable",
            reason: "Нет проверенных правил.",
            version,
          };
    },
    async evaluate(input) {
      if (!rules.length) {
        return {
          status: "unavailable",
          matchedRuleIds: [],
          reason: "Нет проверенных правил.",
        };
      }
      const matched = rules.filter((rule) => rule.evaluate(input));
      if (!matched.length) return { status: "clear", matchedRuleIds: [] };
      const highest = [...matched].sort(
        (left, right) => urgencyRank(right.urgency) - urgencyRank(left.urgency),
      )[0];
      return {
        status: "matched",
        urgency: highest.urgency,
        matchedRuleIds: matched.map((rule) => rule.id),
        userMessageRu: highest.userMessageRu,
      };
    },
  };
}

function urgencyRank(urgency: SafetyUrgency) {
  return {
    worth_discussing: 1,
    seek_care_soon: 2,
    do_not_delay: 3,
  }[urgency];
}
