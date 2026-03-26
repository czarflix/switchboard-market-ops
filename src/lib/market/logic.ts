import { type ResearchBrief } from "../research/schemas.ts";
import {
  type CallPlaybackEnvelope,
  type CallOutcome,
  type CallPlan,
  type CallingPolicy,
  type CategoryCapability,
  type MarketCandidateEvidence,
  type MarketCandidate,
  type MarketSpeedProfile,
  type MarketScoreBreakdown,
  type SellerScenario,
  type SimulatedCallTurn,
} from "./schemas.ts";

type MarketRunShortlistStatus = "ready" | "needs_input" | "failed";

const DEFAULT_LANGUAGE = "English";

const LANGUAGE_CODE_MAP: Record<string, string> = {
  english: "en-US",
  hindi: "hi-IN",
  marathi: "mr-IN",
  spanish: "es-ES",
};

export const CATEGORY_CAPABILITY_REGISTRY: Record<
  ResearchBrief["category"],
  CategoryCapability
> = {
  banquet: {
    category: "banquet",
    allowedScopeStatus: ["supported"],
    searchQueryTemplates: [
      (brief) =>
        `${brief.city} banquet hall wedding ${brief.headcount} guests ${brief.localities.join(" ")}`.trim(),
      (brief) =>
        `${brief.city} wedding venue contact pricing parking ${brief.localities.join(" ")}`.trim(),
      (brief) =>
        `${brief.marketQueryPreview} venue phone whatsapp`.trim(),
      (brief) =>
        `${brief.city} banquet banquet hall vegetarian catering ${brief.headcount}`.trim(),
    ],
  },
  coworking: {
    category: "coworking",
    allowedScopeStatus: ["supported"],
    searchQueryTemplates: [
      (brief) =>
        `${brief.city} coworking private cabin ${brief.headcount} ${brief.localities.join(" ")}`.trim(),
      (brief) =>
        `${brief.marketQueryPreview} phone whatsapp pricing`.trim(),
      (brief) =>
        `${brief.city} coworking meeting room amenities ${brief.localities.join(" ")}`.trim(),
      (brief) =>
        `${brief.city} coworking day pass office space budget ${brief.budget.max ?? ""}`.trim(),
    ],
  },
  clinic: {
    category: "clinic",
    allowedScopeStatus: ["supported"],
    searchQueryTemplates: [
      (brief) =>
        `${brief.city} clinic ${brief.headcount} ${brief.localities.join(" ")} specialty`.trim(),
      (brief) =>
        `${brief.marketQueryPreview} consultation contact phone whatsapp`.trim(),
      (brief) =>
        `${brief.city} clinic appointment visit contact ${brief.localities.join(" ")}`.trim(),
      (brief) =>
        `${brief.city} doctor clinic budget ${brief.budget.max ?? ""}`.trim(),
    ],
  },
  adjacent: {
    category: "adjacent",
    allowedScopeStatus: ["adjacent", "supported"],
    searchQueryTemplates: [(brief) => brief.marketQueryPreview || brief.summary],
  },
  unclear: {
    category: "unclear",
    allowedScopeStatus: ["unclear", "supported"],
    searchQueryTemplates: [(brief) => brief.marketQueryPreview || brief.summary],
  },
};

function normalizedText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFromSeed(seed: string, offset = 0) {
  const hash = hashSeed(`${seed}:${offset}`);
  return (hash % 10000) / 10000;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function seededInt(seed: string, offset: number, minimum: number, maximum: number) {
  const span = Math.max(maximum - minimum, 0);
  return minimum + Math.round(randomFromSeed(seed, offset) * span);
}

function intersectionScore(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right.map(normalizedText));
  let hits = 0;

  for (const entry of left) {
    if (rightSet.has(normalizedText(entry))) {
      hits += 1;
    }
  }

  return hits / Math.max(left.length, 1);
}

function extractBudgetHint(candidate: MarketCandidate, evidence: MarketCandidateEvidence[]) {
  const values = evidence.flatMap((entry) => [
    entry.facts.priceHintMin,
    entry.facts.priceHintMax,
  ]);
  const numericValues = values.filter((entry): entry is number => typeof entry === "number");

  if (numericValues.length === 0) {
    return undefined;
  }

  return Math.max(...numericValues);
}

function extractCapacityHint(candidate: MarketCandidate, evidence: MarketCandidateEvidence[]) {
  const values = evidence.flatMap((entry) => [
    entry.facts.capacityMin,
    entry.facts.capacityMax,
  ]);
  const numericValues = values.filter((entry): entry is number => typeof entry === "number");

  if (numericValues.length === 0) {
    return undefined;
  }

  return Math.max(...numericValues);
}

function collectAmenities(candidate: MarketCandidate, evidence: MarketCandidateEvidence[]) {
  return Array.from(
    new Set(
      evidence.flatMap((entry) => [...entry.facts.amenities, ...entry.facts.tags]).filter(Boolean),
    ),
  );
}

export function toFirecrawlLanguageCodes(languages: string[]) {
  const mapped = languages
    .map((entry) => LANGUAGE_CODE_MAP[normalizedText(entry)])
    .filter(Boolean);

  return mapped.length > 0 ? mapped : ["en-US"];
}

export function selectPrimaryConversationLanguage(brief: ResearchBrief) {
  return brief.preferredLanguages[0]?.trim() || DEFAULT_LANGUAGE;
}

export function buildMarketSearchQueries(
  brief: ResearchBrief,
  speedProfile: MarketSpeedProfile = "demo_fast",
) {
  const capability = CATEGORY_CAPABILITY_REGISTRY[brief.category];
  return capability.searchQueryTemplates
    .map((builder) => builder(brief).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, speedProfile === "demo_fast" ? 2 : 4);
}

export function shouldMapSearchResult(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/" || parsed.pathname === "") {
      return true;
    }

    return /(list|directory|locations|spaces|venues|services)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function scoreMarketCandidate(
  brief: ResearchBrief,
  candidate: MarketCandidate,
  evidence: MarketCandidateEvidence[],
): MarketScoreBreakdown {
  const localityMatch =
    brief.localities.length === 0
      ? 1
      : brief.localities.some((entry) => normalizedText(candidate.locality).includes(normalizedText(entry)))
        ? 1
        : 0;
  const normalizedCandidateCity = normalizedText(candidate.city);
  const normalizedBriefCity = normalizedText(brief.city);
  const cityMatch =
    !normalizedCandidateCity
      ? 0.4
      : normalizedCandidateCity === normalizedBriefCity
      ? 1
      : 0;
  const mustHaveScore = intersectionScore(brief.mustHaves, collectAmenities(candidate, evidence));
  const budgetHint = extractBudgetHint(candidate, evidence);
  const budgetMax = brief.budget.max ?? brief.budget.min;
  const budgetFit =
    typeof budgetHint === "number" && typeof budgetMax === "number"
      ? budgetHint <= budgetMax
        ? 1
        : budgetHint <= budgetMax * 1.2
          ? 0.55
          : 0.15
      : 0.55;
  const capacityHint = extractCapacityHint(candidate, evidence);
  const headcountFit =
    typeof capacityHint === "number"
      ? capacityHint >= brief.headcount
        ? 1
        : capacityHint >= Math.max(1, Math.round(brief.headcount * 0.8))
          ? 0.6
          : 0.2
      : 0.55;
  const requirementFit = clamp(
    cityMatch * 8 + localityMatch * 8 + budgetFit * 10 + mustHaveScore * 9 + headcountFit * 10,
    0,
    45,
  );

  const firstPartyCount = evidence.filter((entry) => entry.isFirstParty).length;
  const evidenceConfidence = clamp(evidence.length * 4 + firstPartyCount * 5, 0, 25);

  const contactability = clamp(
    (candidate.phone ? 8 : 0) +
      (candidate.whatsappNumber ? 6 : 0) +
      (candidate.websiteUrl ? 6 : 0),
    0,
    20,
  );

  const freshness = clamp(firstPartyCount > 0 ? 8 : evidence.length > 2 ? 6 : 4, 0, 10);
  const total = clamp(requirementFit + evidenceConfidence + contactability + freshness, 0, 100);

  return {
    requirementFit: Number(requirementFit.toFixed(2)),
    evidenceConfidence: Number(evidenceConfidence.toFixed(2)),
    contactability: Number(contactability.toFixed(2)),
    freshness: Number(freshness.toFixed(2)),
    total: Number(total.toFixed(2)),
  };
}

export function summarizeCandidateFit(
  brief: ResearchBrief,
  candidate: MarketCandidate,
  evidence: MarketCandidateEvidence[],
) {
  const notes: string[] = [];
  if (candidate.locality) {
    notes.push(`Locality: ${candidate.locality}`);
  }
  if (candidate.phone || candidate.whatsappNumber) {
    notes.push("Direct contact available");
  }

  const budgetHint = extractBudgetHint(candidate, evidence);
  if (typeof budgetHint === "number") {
    notes.push(`Price signal around ${brief.budget.currency} ${budgetHint}`);
  }

  const amenities = collectAmenities(candidate, evidence)
    .slice(0, 3)
    .join(", ");
  if (amenities) {
    notes.push(`Amenities: ${amenities}`);
  }

  return notes;
}

export function chooseEligibility(candidate: MarketCandidate, evidence: MarketCandidateEvidence[]) {
  const observedEvidenceCount = Math.max(candidate.evidenceCount, evidence.length);
  const hasContactableSource =
    evidence.some(
      (entry) =>
        entry.isFirstParty ||
        entry.facts.contactable ||
        Boolean(entry.facts.phone || entry.facts.whatsappNumber || entry.facts.websiteUrl),
    ) ||
    Boolean(candidate.phone || candidate.whatsappNumber || candidate.websiteUrl);

  if (candidate.score >= 60 && observedEvidenceCount >= 2 && hasContactableSource) {
    return "eligible" as const;
  }

  if (candidate.score >= 45 && observedEvidenceCount >= 1) {
    return "needs_review" as const;
  }

  return "ineligible" as const;
}

export function resolveMarketRunShortlistStatus(
  eligibilities: ReadonlyArray<MarketCandidate["eligibility"]>,
): {
  status: MarketRunShortlistStatus;
  errorText: string | null;
} {
  const eligibleCount = eligibilities.filter((entry) => entry === "eligible").length;
  const reviewableCount = eligibilities.filter((entry) => entry === "needs_review").length;

  if (eligibleCount >= 2) {
    return {
      status: "ready",
      errorText: null,
    };
  }

  if (eligibleCount === 1 || reviewableCount > 0) {
    return {
      status: "needs_input",
      errorText: null,
    };
  }

  return {
    status: "failed",
    errorText: "Firecrawl completed, but no reviewable establishments survived the shortlist.",
  };
}

export function buildCallingPlan(
  brief: ResearchBrief,
  candidate: MarketCandidate,
  evidence: MarketCandidateEvidence[],
  policy: CallingPolicy,
): CallPlan {
  const knownFacts = summarizeCandidateFit(brief, candidate, evidence);
  const unknownFacts = [
    "Live availability",
    "Final quote",
    "Negotiation flexibility",
    "Deposit or hold policy",
  ];

  if (!candidate.whatsappNumber) {
    unknownFacts.push("Best handoff channel");
  }

  return {
    candidateId: candidate.id,
    businessName: candidate.displayName,
    phone: candidate.phone,
    whyCall: `Verify live fit for ${brief.city} ${brief.category} request and test quote flexibility.`,
    knownFacts,
    unknownFacts,
    askSequence: [
      "Confirm availability for the requested timeline.",
      "Confirm whether the setup matches the required headcount and must-haves.",
      "Ask for the real all-in quote.",
      policy.askForDiscount ? "Negotiate within the allowed budget stretch." : "Confirm whether quote is fixed.",
      "Ask for the best next handoff channel.",
    ],
    negotiationBounds: {
      currency: brief.budget.currency,
      budgetMax: brief.budget.max ?? null,
      stretchBudgetPercent: policy.stretchBudgetPercent,
      askForDiscount: policy.askForDiscount,
    },
    successCriteria: [
      "Candidate confirms availability or a usable workaround.",
      "Quote lands within approved budget bounds.",
      "A direct follow-up contact is shared.",
    ],
    disqualifiers: [
      "Unavailable in required time window.",
      "Fails must-have requirements.",
      "Quote exceeds approved stretch by a wide margin.",
    ],
  };
}

export function buildSellerScenario(
  brief: ResearchBrief,
  candidate: MarketCandidate,
  evidence: MarketCandidateEvidence[],
  callCampaignId: string,
  policy: CallingPolicy,
): SellerScenario {
  const seed = `${callCampaignId}:${candidate.id}`;
  const scoreFactor = candidate.score / 100;
  const contactFactor =
    (candidate.phone ? 0.4 : 0) +
    (candidate.whatsappNumber ? 0.35 : 0) +
    (candidate.websiteUrl ? 0.25 : 0);
  const pickupThreshold = 0.22 + scoreFactor * 0.5 + contactFactor * 0.2;
  const pickupOutcome = randomFromSeed(seed, 1) <= pickupThreshold ? "answer" : "no_answer";
  const sourceLanguage = candidate.sourceLanguage || selectPrimaryConversationLanguage(brief);
  const budgetBase = brief.budget.max ?? brief.budget.min ?? 0;
  const priceHint = extractBudgetHint(candidate, evidence) ?? budgetBase;
  const quoteDelta = Math.round((randomFromSeed(seed, 2) - 0.35) * Math.max(500, budgetBase * 0.18));
  const baseQuote = Math.max(0, (priceHint || budgetBase || 0) + quoteDelta);
  const stretchMultiplier = 1 + policy.stretchBudgetPercent / 100;
  const allowedQuote = budgetBase ? Math.round(budgetBase * stretchMultiplier) : baseQuote;
  const finalQuote =
    pickupOutcome === "no_answer"
      ? undefined
      : Math.max(Math.min(baseQuote, allowedQuote + Math.round(baseQuote * 0.1)), Math.round(baseQuote * 0.9));
  const availabilityRoll = randomFromSeed(seed, 3);
  const availability =
    pickupOutcome === "no_answer"
      ? "unavailable"
      : availabilityRoll > 0.88
        ? "unavailable"
        : availabilityRoll > 0.72
          ? "limited"
          : "available";
  const finalWithinBounds = typeof allowedQuote === "number" && typeof finalQuote === "number"
    ? finalQuote <= allowedQuote
    : false;
  const holdPossible = randomFromSeed(seed, 4) > 0.45;
  const depositRequired = randomFromSeed(seed, 5) > 0.62;
  const seededDurationMs =
    pickupOutcome === "no_answer"
      ? 12000 + Math.round(randomFromSeed(seed, 6) * 8000)
      : 35000 + Math.round(randomFromSeed(seed, 6) * 25000);

  return {
    candidateId: candidate.id,
    businessName: candidate.displayName,
    targetLanguage: sourceLanguage,
    pickupOutcome,
    availability,
    baseQuote: pickupOutcome === "no_answer" ? undefined : baseQuote,
    finalQuote,
    negotiationFloor:
      pickupOutcome === "no_answer" || typeof finalQuote !== "number"
        ? undefined
        : Math.max(finalQuote - Math.round(Math.max(finalQuote, 1) * 0.08), 0),
    depositRequired,
    holdPossible,
    contactName: candidate.displayName.split(" ")[0] || "Manager",
    contactChannel: candidate.whatsappNumber ? "whatsapp" : candidate.websiteUrl ? "website" : "phone",
    websiteUrl: candidate.websiteUrl,
    whatsappNumber: candidate.whatsappNumber,
    websiteVisible: Boolean(candidate.websiteUrl),
    tone:
      pickupOutcome === "no_answer"
        ? "busy"
        : finalWithinBounds
          ? "helpful"
          : candidate.score >= 70
            ? "premium"
            : "rigid",
    mustRevealConditions: [
      availability === "limited" ? "Only limited availability remains." : "",
      depositRequired ? "A deposit is required to hold the slot." : "",
      holdPossible ? "A short hold is possible after confirmation." : "",
    ].filter(Boolean),
    seededDurationMs,
  };
}

export function deriveCallResult(
  scenario: SellerScenario,
  policy: CallingPolicy,
  brief: ResearchBrief,
): CallOutcome["result"] {
  if (scenario.pickupOutcome === "no_answer") {
    return "no_answer";
  }

  if (scenario.availability === "unavailable") {
    return "refused";
  }

  const budgetMax = brief.budget.max ?? brief.budget.min;
  const allowedQuote =
    typeof budgetMax === "number"
      ? Math.round(budgetMax * (1 + policy.stretchBudgetPercent / 100))
      : undefined;

  if (typeof allowedQuote === "number" && typeof scenario.finalQuote === "number") {
    return scenario.finalQuote <= allowedQuote ? "accepted" : "countered";
  }

  return "accepted";
}

export function selectTopCallCandidates(candidates: MarketCandidate[], limit = 4) {
  return [...candidates]
    .filter((candidate) => candidate.eligibility !== "ineligible")
    .sort((left, right) => right.score - left.score || left.rank - right.rank)
    .slice(0, limit);
}

export function buildCallSelectionFingerprint(input: {
  selectedCandidateIds: string[];
  transport: string;
  callingPolicy: CallingPolicy;
}) {
  const normalizedPolicy = {
    mode: input.callingPolicy.mode,
    stretchBudgetPercent: input.callingPolicy.stretchBudgetPercent,
    mentionBudgetOnCall: input.callingPolicy.mentionBudgetOnCall,
    askForDiscount: input.callingPolicy.askForDiscount,
    requestHold: input.callingPolicy.requestHold,
    preferredLanguage: input.callingPolicy.preferredLanguage,
    transportVersion: input.callingPolicy.transportVersion,
  };

  return JSON.stringify({
    selectedCandidateIds: [...input.selectedCandidateIds].sort(),
    transport: input.transport,
    callingPolicy: normalizedPolicy,
  });
}

export function buildCallPlaybackEnvelope(input: {
  campaignSeed: string;
  candidateId: string;
  orderIndex: number;
  scenario: SellerScenario;
  result: CallOutcome["result"];
}): CallPlaybackEnvelope {
  const seed = `${input.campaignSeed}:${input.candidateId}:${input.orderIndex}:${input.result}`;
  const baseOffset = clamp(input.orderIndex * 2200, 0, 9000);
  const laneStartOffsetMs = clamp(
    baseOffset + seededInt(seed, 1, 0, 4200),
    0,
    12000,
  );
  const ringLeadMs = seededInt(seed, 2, 1500, 8000);
  const ringStartMs = laneStartOffsetMs;

  if (input.result === "no_answer" || input.scenario.pickupOutcome === "no_answer") {
    const callLength = seededInt(seed, 3, 8000, 22000);
    const callEndMs = laneStartOffsetMs + callLength;
    return {
      laneStartOffsetMs,
      ringStartMs,
      pickupAtMs: null,
      negotiationStartMs: null,
      callEndMs,
      summaryRevealMs: callEndMs + seededInt(seed, 4, 750, 2000),
      endedEarly: true,
      resolutionKind: "no_answer",
    };
  }

  const pickupAtMs = laneStartOffsetMs + ringLeadMs;
  const resolutionKind =
    input.result === "countered"
      ? "countered"
      : input.result === "refused"
        ? "refused"
        : "accepted";

  const totalDurationMs =
    resolutionKind === "accepted"
      ? seededInt(seed, 3, 28000, 65000)
      : resolutionKind === "countered"
        ? seededInt(seed, 3, 20000, 55000)
        : seededInt(seed, 3, 12000, 30000);
  const callEndMs = laneStartOffsetMs + totalDurationMs;
  const negotiationStartMs =
    resolutionKind === "refused"
      ? pickupAtMs + seededInt(seed, 5, 1800, 4200)
      : pickupAtMs + seededInt(seed, 5, 3000, 9000);

  return {
    laneStartOffsetMs,
    ringStartMs,
    pickupAtMs,
    negotiationStartMs: Math.min(negotiationStartMs, Math.max(callEndMs - 1500, pickupAtMs)),
    callEndMs,
    summaryRevealMs: callEndMs + seededInt(seed, 6, 750, 2000),
    endedEarly: resolutionKind === "refused",
    resolutionKind,
  };
}

export function alignSimulatedTurnsToPlayback(
  turns: SimulatedCallTurn[],
  playback: CallPlaybackEnvelope,
): SimulatedCallTurn[] {
  if (turns.length === 0) {
    return [];
  }

  const lastOffset = Math.max(...turns.map((turn) => turn.offsetMs), 1);
  const startAt =
    playback.pickupAtMs !== null && playback.pickupAtMs !== undefined
      ? playback.pickupAtMs - playback.laneStartOffsetMs + 600
      : playback.callEndMs - playback.laneStartOffsetMs;
  const endAt = Math.max(playback.callEndMs - playback.laneStartOffsetMs - 900, startAt);
  const availableWindow = Math.max(endAt - startAt, 0);

  return turns.map((turn, index) => {
    const ratio = lastOffset > 0 ? turn.offsetMs / lastOffset : index / Math.max(turns.length - 1, 1);
    return {
      ...turn,
      offsetMs:
        index === turns.length - 1
          ? endAt
          : Math.round(startAt + ratio * availableWindow),
    };
  });
}

export function buildWinnerRanking(
  candidates: MarketCandidate[],
  outcomes: Array<{ candidateId: string; outcome: CallOutcome }>,
) {
  const outcomeByCandidate = new Map(outcomes.map((entry) => [entry.candidateId, entry.outcome]));
  const hasLiveOutcomes = outcomes.length > 0;

  return [...candidates]
    .filter((candidate) => candidate.eligibility !== "ineligible")
    .map((candidate) => {
      const outcome = outcomeByCandidate.get(candidate.id);
      const delta =
        !outcome
          ? hasLiveOutcomes
            ? -35
            : 0
          : outcome.result === "accepted"
            ? 12
            : outcome.result === "countered"
              ? 4
              : outcome.result === "refused"
                ? -18
                : -25;

      return {
        candidateId: candidate.id,
        score: clamp(candidate.score + delta, 0, 100),
        reason:
          outcome?.result === "accepted"
            ? "Live outreach confirmed fit."
            : outcome?.result === "countered"
              ? "Promising, but above target budget."
              : outcome?.result === "refused"
                ? "Did not satisfy live call requirements."
                : outcome?.result === "no_answer"
                  ? "No response during outreach."
                  : hasLiveOutcomes
                    ? "No completed outreach for this lead."
                    : "Ranked from market evidence only.",
      };
    })
    .sort((left, right) => right.score - left.score)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
}
