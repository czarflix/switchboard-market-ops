import {
  marketRefinementAlreadyUsedErrorMessage,
  marketRefinementSchema,
  type MarketRefinement,
} from "./schemas.ts";

export {
  buildMarketRunBriefSnapshot,
  callCampaignSchema,
  callResultSchema,
  callSpeakerSchema,
  callStatusSchema,
  callTransportSchema,
  callingPolicySchema,
  createCallCampaignRequestSchema,
  createMarketRunRequestSchema,
  createNotificationRequestSchema,
  marketCandidateEvidenceSchema,
  marketCandidateFactSchema,
  marketCandidateSchema,
  marketRefinementSchema,
  marketRunSchema,
  marketRunStatusSchema,
  notificationChannelSchema,
  notificationRequestSchema,
  notificationStatusSchema,
  normalizeBriefRefinement,
  normalizeCallingPolicy,
  sanitizeBriefForMarketSeed,
  sellerScenarioSchema,
  simulatedCallArtifactSchema,
  transcriptLanguageSchema,
  winnerArtifactSchema,
  type CallCampaign,
  type CallOutcome,
  type CallPlan,
  type Call,
  type CallingPolicy,
  type CategoryCapability,
  type CreateCallCampaignRequest,
  type CreateMarketRunRequest,
  type CreateNotificationRequest,
  type MarketCandidateEvidence,
  type MarketCandidateFact,
  type MarketCandidate,
  type MarketProviderJob,
  type MarketRefinement,
  type MarketRun,
  type MarketRunStatus,
  type NotificationDelivery,
  type NotificationRequest,
  type SellerScenario,
  type SimulatedCallArtifact,
  type SimulatedCallTurn,
  type WinnerArtifact,
} from "./schemas.ts";

export const marketRunChronologyColumn = "started_at" as const;

export function getMarketErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return fallback;
}

export function getMarketRouteStatus(
  message: string,
  options?: {
    notFoundMessages?: string[];
    conflictMessages?: string[];
    fallbackStatus?: number;
  },
) {
  if (message === "Unauthorized") {
    return 401;
  }

  if ((options?.notFoundMessages ?? []).includes(message)) {
    return 404;
  }

  if ((options?.conflictMessages ?? [marketRefinementAlreadyUsedErrorMessage]).includes(message)) {
    return 409;
  }

  return options?.fallbackStatus ?? 400;
}

function coerceRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return undefined;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries.length > 0 ? entries : undefined;
}

export function normalizeStructuredMarketRefinement(value: unknown, fallbackNotes?: string): MarketRefinement | null {
  const record = coerceRecord(value);
  if (!record) {
    return null;
  }

  const notes =
    typeof record.notes === "string" && record.notes.trim().length > 0
      ? record.notes.trim()
      : fallbackNotes?.trim() || "";

  const label =
    typeof record.label === "string" && record.label.trim().length > 0
      ? record.label.trim()
      : "Updated preferences";

  const rawNotes =
    typeof record.rawNotes === "string" && record.rawNotes.trim().length > 0
      ? record.rawNotes.trim()
      : notes;

  const budgetStretchPercent = readInteger(record.budgetStretchPercent);
  const budgetDeltaAbsolute = readInteger(record.budgetDeltaAbsolute);
  const budgetTargetMax = readInteger(record.budgetTargetMax);
  const localities = readStringArray(record.localities);
  const mustHaves = readStringArray(record.mustHaves);
  const niceToHaves = readStringArray(record.niceToHaves);
  const dealBreakers = readStringArray(record.dealBreakers);
  const hasStructuredSignal = [
    budgetStretchPercent,
    budgetDeltaAbsolute,
    budgetTargetMax,
    localities,
    mustHaves,
    niceToHaves,
    dealBreakers,
  ].some((entry) => entry !== undefined);

  if (!hasStructuredSignal) {
    return null;
  }

  return marketRefinementSchema.parse({
    label,
    notes: notes || rawNotes,
    rawNotes: rawNotes || notes,
    budgetStretchPercent,
    budgetDeltaAbsolute,
    budgetTargetMax,
    localities,
    mustHaves,
    niceToHaves,
    dealBreakers,
  });
}

export type {
  CallCampaignSnapshot,
  CallSnapshot,
  MarketRunSnapshot,
} from "./presenter.ts";

export {
  flattenCallCampaignSnapshot,
  flattenMarketRunSnapshot,
} from "./presenter.ts";
