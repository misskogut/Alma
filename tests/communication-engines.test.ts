import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveInsight,
  createOutputFeedItem,
  immediateInputFeedback,
  isMaterialModelUpdate,
  learnContactProfile,
  markInsightRead,
  prioritizeContacts,
  progressiveInputBatch,
  rankInputRequests,
  rankOutputFeed,
  renderNarrative,
  returnAfterAbsence,
  supersedeInsight,
  unavailablePopulationKnowledge,
  unavailableSafetyKnowledge,
  unavailableScientificKnowledge,
} from "../lib/alma-core";
import type {
  InputRequestCandidate,
  StructuredInsight,
} from "../lib/alma-core";

test("narrative uses observational Russian rather than causal claims", () => {
  const copy = renderNarrative(insight("possible_relationship", {
    targetDefinitionId: "headache",
    factorDefinitionIds: ["pressure"],
    factorChange: "decrease",
    support: 5,
    opportunities: 7,
    counterexamples: 2,
    stage: "possible_link",
  }));
  assert.match(copy.body, /ваших|наблюдени/i);
  assert.match(copy.body, /возможн/i);
  assert.doesNotMatch(copy.body, /вызывает|приводит к/i);
});

test("narrative supports lag, cumulative, inverse and interaction families", () => {
  const lag = renderNarrative(insight("lagged_relationship", {
    targetDefinitionId: "headache",
    factorDefinitionIds: ["pressure"],
    factorChange: "decrease",
    lagRangeMinutes: [720, 1800],
    support: 5,
  }));
  const cumulative = renderNarrative(insight("cumulative_relationship", {
    targetDefinitionId: "fatigue",
    factorDefinitionIds: ["sleep_duration"],
    factorChange: "decrease",
    cumulativeWindowDays: 3,
  }));
  const inverse = renderNarrative(insight("inverse_relationship", {
    targetDefinitionId: "clarity",
    factorDefinitionIds: ["cognitive_load_intensity"],
  }));
  const interaction = renderNarrative(insight("interaction", {
    targetDefinitionId: "overall_wellbeing",
    factorDefinitionIds: ["sleep_duration", "cognitive_load_intensity"],
  }));
  assert.match(lag.body, /следующ/);
  assert.match(cumulative.title, /Накопительный/);
  assert.match(inverse.title, /Противоположное/);
  assert.match(interaction.title, /комбинац/i);
});

test("input engine deduplicates shared research metric and asks one item first", () => {
  const ranked = rankInputRequests([
    request("coffee-one", "coffee", { relatedQuestIds: ["q1"] }),
    request("coffee-two", "coffee", { relatedQuestIds: ["q2"], informationValue: 0.9 }),
    request("sleep", "sleep_duration", { estimatedEffort: 0.7 }),
  ]);
  assert.equal(ranked.length, 2);
  assert.deepEqual(ranked[0].sharedWithQuestIds.sort(), ["q1", "q2"]);
  assert.equal(progressiveInputBatch(ranked).length, 1);
  assert.equal(progressiveInputBatch(ranked, 2).length, 2);
});

test("stale subjective prompts expire instead of becoming data-entry debt", () => {
  const now = new Date("2026-08-21T20:00:00.000Z");
  const ranked = rankInputRequests([
    request("old-state", "overall_wellbeing", {
      createdAt: "2026-08-19T06:00:00.000Z",
      freshness: "subjective_today",
    }),
    request("remembered-fact", "coffee", {
      createdAt: "2026-08-19T06:00:00.000Z",
      freshness: "recent_fact",
      retrospectiveAllowed: true,
    }),
  ], now);
  assert.deepEqual(ranked.map((item) => item.id), ["remembered-fact"]);
});

test("feed keeps delivered content immutable and links refinements", () => {
  const original = createOutputFeedItem(insight("possible_relationship", {
    targetDefinitionId: "headache",
    factorDefinitionIds: ["pressure"],
  }));
  const read = markInsightRead(original, "2026-08-21T10:00:00.000Z");
  const archived = archiveInsight(read, "2026-08-22T10:00:00.000Z");
  const refined = supersedeInsight(original, insight("refined_pattern", {
    targetDefinitionId: "headache",
    factorDefinitionIds: ["pressure"],
    modifierDefinitionIds: ["sleep_duration"],
  }));
  assert.equal(read.body, original.body);
  assert.equal(archived.body, original.body);
  assert.equal(refined.supersedesInsightId, original.id);
  assert.notEqual(refined.id, original.id);
});

test("unread useful insights survive absence and rank before read items", () => {
  const unread = createOutputFeedItem(insight("established_personal_pattern", {
    targetDefinitionId: "clarity",
    factorDefinitionIds: ["sleep_duration"],
  }), { priority: 0.8 });
  const read = markInsightRead(
    createOutputFeedItem(insight("first_coincidence", {
      targetDefinitionId: "fatigue",
      factorDefinitionIds: ["coffee"],
    }), { priority: 0.95 }),
    "2026-08-21T12:00:00.000Z",
  );
  assert.equal(rankOutputFeed([read, unread])[0].id, unread.id);
  const summary = returnAfterAbsence([read, unread]);
  assert.equal(summary.count, 1);
  assert.equal(summary.items[0].id, unread.id);
});

test("small feedback stays separate from material feed update", () => {
  assert.match(immediateInputFeedback("useful_control_day").body, /сравнения/);
  assert.equal(isMaterialModelUpdate({ previousStage: "observation", nextStage: "possible_link" }), true);
  assert.equal(isMaterialModelUpdate({ previousEvidenceScore: 0.4, nextEvidenceScore: 0.46 }), false);
});

test("contact engine honors attention budget and chooses highest value", () => {
  const profile = learnContactProfile([
    { kind: "input_request", contactedAt: "2026-08-20T18:00:00.000Z", respondedAt: "2026-08-20T18:02:00.000Z", ignored: false },
  ]);
  const chosen = prioritizeContacts({
    profile,
    alreadyContactedToday: 0,
    now: new Date("2026-08-21T18:00:00.000Z"),
    candidates: [
      { id: "low", kind: "input_request", createdAt: "2026-08-21", informationValue: 0.2, urgency: 0.1, novelty: 0.1, relevance: 0.3, researchRelevance: 0.1, estimatedEffort: 0.8 },
      { id: "high", kind: "insight", createdAt: "2026-08-21", informationValue: 0.9, urgency: 0.8, novelty: 0.8, relevance: 0.9, researchRelevance: 0.6, estimatedEffort: 0.1 },
    ],
  });
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].candidate.id, "high");
});

test("unavailable knowledge adapters return no invented evidence or rules", async () => {
  assert.equal((await unavailableScientificKnowledge.findStartingHypotheses({ targetDefinitionId: "headache", availableDefinitionIds: [] })).length, 0);
  assert.equal((await unavailablePopulationKnowledge.findStartingHypotheses({ explicitOptIn: true, targetDefinitionId: "headache" })).length, 0);
  const safety = await unavailableSafetyKnowledge.evaluate({ definitionIds: ["headache"], observations: [] });
  assert.equal(safety.status, "unavailable");
  assert.deepEqual(safety.matchedRuleIds, []);
});

function insight(type: StructuredInsight["type"], overrides: Partial<StructuredInsight> = {}): StructuredInsight {
  return {
    id: `insight-${type}`,
    type,
    createdAt: "2026-08-21T09:00:00.000Z",
    ...overrides,
  };
}

function request(
  id: string,
  targetDefinitionId: string,
  overrides: Partial<InputRequestCandidate> = {},
): InputRequestCandidate {
  return {
    id,
    targetDefinitionId,
    reasonCode: "test",
    explanation: "Проверяем возможную персональную связь.",
    informationValue: 0.7,
    urgency: 0.4,
    researchRelevance: 0.7,
    uncertaintyReduction: 0.8,
    estimatedEffort: 0.2,
    createdAt: "2026-08-21T08:00:00.000Z",
    freshness: "subjective_today",
    ...overrides,
  };
}
