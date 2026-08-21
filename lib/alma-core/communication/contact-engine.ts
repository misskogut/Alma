import { clamp, mean } from "../engines/math";
import type {
  ContactCandidate,
  ContactHistoryItem,
  ContactProfile,
} from "./types";

export function learnContactProfile(history: ContactHistoryItem[]): ContactProfile {
  if (!history.length) {
    return {
      comfortableContactsPerDay: 1,
      preferredDayParts: ["evening"],
      responseRateByKind: {},
    };
  }
  const byDay = new Map<string, number>();
  const dayPartResponses = new Map<"morning" | "day" | "evening", number>();
  const kindTotals = new Map<ContactCandidate["kind"], number>();
  const kindResponses = new Map<ContactCandidate["kind"], number>();

  for (const contact of history) {
    const day = contact.contactedAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    kindTotals.set(contact.kind, (kindTotals.get(contact.kind) ?? 0) + 1);
    if (contact.respondedAt) {
      const part = dayPart(new Date(contact.respondedAt));
      dayPartResponses.set(part, (dayPartResponses.get(part) ?? 0) + 1);
      kindResponses.set(contact.kind, (kindResponses.get(contact.kind) ?? 0) + 1);
    }
  }
  const responseRateByKind: ContactProfile["responseRateByKind"] = {};
  for (const [kind, count] of kindTotals) {
    responseRateByKind[kind] = (kindResponses.get(kind) ?? 0) / count;
  }
  const preferredDayParts = [...dayPartResponses.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([part]) => part)
    .slice(0, 2);

  return {
    comfortableContactsPerDay: Math.max(
      1,
      Math.min(3, Math.round(mean([...byDay.values()]))),
    ),
    preferredDayParts: preferredDayParts.length ? preferredDayParts : ["evening"],
    responseRateByKind,
  };
}

export function prioritizeContacts(input: {
  candidates: ContactCandidate[];
  profile: ContactProfile;
  alreadyContactedToday: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const budget = Math.max(
    0,
    input.profile.comfortableContactsPerDay - input.alreadyContactedToday,
  );
  if (budget === 0) return [];
  const currentPart = dayPart(now);
  return input.candidates
    .filter((candidate) => !candidate.expiresAt || new Date(candidate.expiresAt) > now)
    .map((candidate) => ({
      candidate,
      score: contactScore(candidate, input.profile, currentPart),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, budget);
}

export function contactScore(
  candidate: ContactCandidate,
  profile: ContactProfile,
  currentDayPart: "morning" | "day" | "evening",
) {
  const historicalResponse = profile.responseRateByKind[candidate.kind] ?? 0.5;
  const preferredNow =
    profile.preferredDayParts.includes(currentDayPart) ||
    candidate.preferredDayParts?.includes(currentDayPart)
      ? 1
      : 0.35;
  return clamp(
    candidate.informationValue * 0.21 +
      candidate.urgency * 0.2 +
      candidate.novelty * 0.14 +
      candidate.relevance * 0.18 +
      candidate.researchRelevance * 0.12 +
      historicalResponse * 0.08 +
      preferredNow * 0.07 -
      candidate.estimatedEffort * 0.12,
    0,
    1,
  );
}

function dayPart(date: Date): "morning" | "day" | "evening" {
  const hour = date.getHours();
  if (hour < 11) return "morning";
  if (hour < 18) return "day";
  return "evening";
}
