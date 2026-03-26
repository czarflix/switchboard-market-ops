import type {
  CallCampaignRecord,
  CallOutcomeRecord,
  CallRecord,
  CallTurnRecord,
  MarketCandidateEvidenceRecord,
  MarketCandidateRecord,
  MarketRunRecord,
  NotificationRequestRecord,
  WinnerArtifactRecord,
} from "./schemas.ts";
import {
  callCampaignSchema,
  callOutcomeSchema,
  callPlanSchema,
  callSchema,
  callTurnRecordSchema,
  callTransportSchema,
  callingPolicySchema,
  candidateEligibilitySchema,
  marketCandidateEvidenceSchema,
  marketCandidateFactSchema,
  marketCandidateSchema,
  marketRunSchema,
  marketRunSummarySchema,
  notificationRequestSchema,
  sellerScenarioSchema,
  simulatedCallArtifactSchema,
  transcriptLanguageSchema,
  winnerArtifactSchema,
  type CallCampaign,
  type CallOutcome,
  type Call,
  type MarketCandidateEvidence,
  type MarketCandidate,
  type MarketRun,
  type NotificationRequest,
  type WinnerArtifact,
} from "./schemas.ts";
import { researchBriefSchema } from "../research/schemas.ts";

export type MarketRunSnapshot = {
  run: MarketRun;
  candidates: MarketCandidate[];
  evidence: Record<string, MarketCandidateEvidence[]>;
  notifications: NotificationRequest[];
};

export type CallSnapshot = Call & {
  turns: Array<{
    id: string;
    seq: number;
    speaker: "buyer" | "seller" | "system";
    sourceText: string;
    englishText: string;
    offsetMs: number;
    createdAt: string;
  }>;
  outcome: CallOutcome | null;
};

export type CallCampaignSnapshot = {
  campaign: CallCampaign;
  calls: CallSnapshot[];
  winner: WinnerArtifact | null;
  notifications: NotificationRequest[];
};

function toMarketRun(record: MarketRunRecord): MarketRun {
  return marketRunSchema.parse({
    id: record.id,
    userId: record.user_id,
    researchSessionId: record.research_session_id,
    parentRunId: record.parent_run_id,
    supersedesRunId: record.supersedes_run_id,
    status: record.status,
    currentStage: record.current_stage,
    briefSnapshot: researchBriefSchema.parse(record.brief_snapshot_json),
    refinements: Array.isArray(record.refinements_json)
      ? record.refinements_json
      : [],
    summary: marketRunSummarySchema.parse(record.summary_json ?? {}),
    error: record.error_text,
    updatedAt: record.updated_at,
    completedAt: record.completed_at,
  });
}

function toMarketCandidate(record: MarketCandidateRecord): MarketCandidate {
  return marketCandidateSchema.parse({
    id: record.id,
    marketRunId: record.market_run_id,
    researchSessionId: record.research_session_id,
    rank: record.rank,
    displayName: record.display_name,
    canonicalUrl: record.canonical_url ?? "",
    websiteUrl: record.website_url ?? "",
    phone: record.phone ?? "",
    whatsappNumber: record.whatsapp_number ?? "",
    locality: record.locality ?? "",
    city: record.city ?? "",
    address: record.address ?? "",
    summary: record.summary ?? "",
    eligibility: candidateEligibilitySchema.parse(record.eligibility_status),
    selectedForCalls: record.selected_for_calls,
    score: record.score,
    evidenceCount: record.evidence_count,
    scoreBreakdown: record.score_breakdown_json ?? {
      requirementFit: 0,
      evidenceConfidence: 0,
      contactability: 0,
      freshness: 0,
      total: record.score,
    },
    fitNotes: record.fit_notes_json ?? [],
    sourceLanguage: record.source_language ?? "English",
    payload: record.payload_json,
  });
}

function toMarketEvidence(record: MarketCandidateEvidenceRecord): MarketCandidateEvidence {
  return marketCandidateEvidenceSchema.parse({
    id: record.id,
    candidateId: record.candidate_id,
    sourceUrl: record.source_url,
    sourceDomain: record.source_domain ?? "",
    sourceKind: record.source_kind,
    isFirstParty: record.is_first_party,
    confidence: record.confidence,
    sourceLanguage: record.source_language ?? "English",
    excerpt: record.excerpt ?? "",
    facts: marketCandidateFactSchema.parse(record.fact_json ?? {}),
  });
}

function toCallCampaign(record: CallCampaignRecord): CallCampaign {
  return callCampaignSchema.parse({
    id: record.id,
    userId: record.user_id,
    researchSessionId: record.research_session_id,
    marketRunId: record.market_run_id,
    transport: callTransportSchema.parse(record.transport),
    status: record.status,
    displayLanguage: transcriptLanguageSchema.parse(record.display_language),
    sourceLanguage: record.source_language ?? "English",
    seed: record.seed,
    callingPolicy: callingPolicySchema.parse(record.calling_policy_json),
    selectionFingerprint:
      record.selection_fingerprint ??
      (typeof (record.calling_policy_json as Record<string, unknown> | null)?.selectionFingerprint === "string"
        ? ((record.calling_policy_json as Record<string, unknown>).selectionFingerprint as string)
        : ""),
    providerState: record.provider_state_json ?? {},
    playbackStartedAt: record.playback_started_at,
    playbackEndsAt: record.playback_ends_at,
    updatedAt: record.updated_at,
    completedAt: record.completed_at,
    error: record.error_text,
  });
}

function toCall(record: CallRecord): Call {
  return callSchema.parse({
    id: record.id,
    campaignId: record.call_campaign_id,
    marketRunId: record.market_run_id,
    candidateId: record.candidate_id,
    orderIndex: record.order_index,
    status: record.status,
    targetDurationMs: record.target_duration_ms,
    actualDurationMs: record.actual_duration_ms,
    result: record.result,
    providerCallId: record.provider_call_id ?? null,
    providerConversationId: record.provider_conversation_id ?? null,
    providerState: record.provider_state_json ?? {},
    plan: callPlanSchema.parse(record.call_plan_json),
    scenario: sellerScenarioSchema.parse(record.seller_scenario_json),
    payload: record.artifact_json
      ? simulatedCallArtifactSchema.parse(record.artifact_json)
      : null,
  });
}

function toCallTurn(record: CallTurnRecord) {
  const parsed = callTurnRecordSchema.parse(record);

  return {
    id: parsed.id,
    seq: parsed.seq,
    speaker: parsed.speaker,
    sourceText: parsed.source_text,
    englishText: parsed.english_text,
    offsetMs: parsed.offset_ms,
    createdAt: parsed.created_at,
  };
}

function toCallOutcome(record: CallOutcomeRecord): CallOutcome {
  return callOutcomeSchema.parse({
    result: record.result,
    availabilityStatus: record.availability_status,
    quotedPrice: record.quoted_price ?? undefined,
    discountOffered: record.discount_offered ?? undefined,
    depositRequired: record.deposit_required,
    holdPossible: record.hold_possible,
    websiteUrl: record.website_url ?? "",
    whatsappNumber: record.whatsapp_number ?? "",
    contactName: record.contact_name ?? "",
    contactChannel: record.contact_channel ?? "",
    confidence: record.confidence,
    summarySourceText: record.summary_source_text ?? "",
    summaryEnglishText: record.summary_english_text ?? "",
    structuredDetails: record.payload_json ?? {},
  });
}

function toWinnerArtifact(record: WinnerArtifactRecord): WinnerArtifact {
  return winnerArtifactSchema.parse({
    id: record.id,
    userId: record.user_id,
    researchSessionId: record.research_session_id,
    marketRunId: record.market_run_id,
    callCampaignId: record.call_campaign_id,
    selectedCandidateId: record.selected_candidate_id,
    reportSourceText: record.report_source_text ?? "",
    reportEnglishText: record.report_english_text ?? "",
    ranking: Array.isArray(record.ranking_json)
      ? record.ranking_json.map((entry) => ({
          candidateId: typeof entry.candidateId === "string" ? entry.candidateId : "",
          rank: typeof entry.rank === "number" ? entry.rank : 1,
          score: typeof entry.score === "number" ? entry.score : 0,
          reason: typeof entry.reason === "string" ? entry.reason : "",
        }))
      : [],
    payload: record.payload_json ?? {},
    createdAt: record.created_at,
  });
}

function toNotificationRequest(record: NotificationRequestRecord): NotificationRequest {
  return notificationRequestSchema.parse({
    id: record.id,
    userId: record.user_id,
    channel: record.channel,
    status: record.status,
    researchSessionId: record.research_session_id,
    marketRunId: record.market_run_id,
    callCampaignId: record.call_campaign_id,
    winnerArtifactId: record.winner_artifact_id,
    destination: record.destination,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    sentAt: record.sent_at,
    lastError: record.last_error,
  });
}

export function flattenMarketRunSnapshot(input: {
  run: MarketRunRecord;
  candidates: MarketCandidateRecord[];
  evidence: MarketCandidateEvidenceRecord[];
  notifications?: NotificationRequestRecord[];
}): MarketRunSnapshot {
  const evidenceByCandidate = input.evidence.reduce<Record<string, MarketCandidateEvidence[]>>(
    (accumulator, record) => {
      const bucket = accumulator[record.candidate_id] ?? [];
      bucket.push(toMarketEvidence(record));
      accumulator[record.candidate_id] = bucket;
      return accumulator;
    },
    {},
  );

  return {
    run: toMarketRun(input.run),
    candidates: input.candidates.map(toMarketCandidate),
    evidence: evidenceByCandidate,
    notifications: (input.notifications ?? []).map(toNotificationRequest),
  };
}

export function flattenCallCampaignSnapshot(input: {
  campaign: CallCampaignRecord;
  calls: CallRecord[];
  turns: CallTurnRecord[];
  outcomes: CallOutcomeRecord[];
  winner: WinnerArtifactRecord | null;
  notifications?: NotificationRequestRecord[];
}): CallCampaignSnapshot {
  const turnsByCall = input.turns.reduce<Record<string, ReturnType<typeof toCallTurn>[]>>(
    (accumulator, record) => {
      const bucket = accumulator[record.call_id] ?? [];
      bucket.push(toCallTurn(record));
      accumulator[record.call_id] = bucket;
      return accumulator;
    },
    {},
  );
  const outcomesByCall = new Map(input.outcomes.map((record) => [record.call_id, toCallOutcome(record)]));

  return {
    campaign: toCallCampaign(input.campaign),
    calls: input.calls.map((record) => {
      const call = toCall(record);
      return {
        ...call,
        turns: turnsByCall[record.id] ?? [],
        outcome: outcomesByCall.get(record.id) ?? null,
      };
    }),
    winner: input.winner ? toWinnerArtifact(input.winner) : null,
    notifications: (input.notifications ?? []).map(toNotificationRequest),
  };
}
