import { z } from "zod";

import {
  computeMissingFields,
  computeReadyForMarket,
  researchBriefSchema,
  researchCategorySchema,
  researchBudgetSchema,
  scopeStatusSchema,
  type ResearchBrief,
} from "../research/schemas.ts";

export const marketRunStatusValues = [
  "queued",
  "discovering",
  "scraping",
  "fallback_discovering",
  "scoring",
  "ready",
  "needs_input",
  "failed",
  "cancelled",
  "superseded",
] as const;

export const marketStageValues = [
  "idle",
  "discovering",
  "mapping",
  "scraping",
  "fallback_discovering",
  "scoring",
  "ready",
  "needs_input",
  "failed",
] as const;

export const candidateEligibilityValues = [
  "eligible",
  "needs_review",
  "ineligible",
] as const;

export const callTransportValues = [
  "synthetic_openai",
  "elevenlabs_twilio",
  "twilio_batch",
  "whatsapp",
] as const;

export const callCampaignStatusValues = [
  "queued",
  "preparing",
  "active",
  "completed",
  "failed",
  "cancelled",
] as const;

export const callStatusValues = [
  "queued",
  "dialing",
  "connected",
  "negotiating",
  "completed",
  "no_answer",
  "failed",
] as const;

export const callResultValues = [
  "accepted",
  "countered",
  "refused",
  "no_answer",
] as const;

export const callSpeakerValues = ["buyer", "seller", "system"] as const;

export const notificationChannelValues = ["email", "whatsapp"] as const;
export const notificationStatusValues = ["pending", "sent", "failed", "cancelled"] as const;
export const transcriptLanguageValues = ["source", "english"] as const;
export const marketSpeedProfileValues = ["demo_fast", "balanced"] as const;
export const guideStageValues = ["research", "market", "calls", "winner"] as const;
export const guideModeValues = ["live", "narrated"] as const;
export const guideAudioStateValues = ["pending", "playing", "blocked", "muted", "failed"] as const;
export const callPlaybackStatusValues = [
  "preparing",
  "queued",
  "ringing",
  "connected",
  "negotiating",
  "wrap_up",
  "completed",
  "no_answer",
  "failed",
] as const;
export const callPlaybackResolutionKindValues = [
  "accepted",
  "countered",
  "refused",
  "no_answer",
  "failed",
] as const;

export const marketRunStatusSchema = z.enum(marketRunStatusValues);
export const marketStageSchema = z.enum(marketStageValues);
export const candidateEligibilitySchema = z.enum(candidateEligibilityValues);
export const callTransportSchema = z.enum(callTransportValues);
export const callCampaignStatusSchema = z.enum(callCampaignStatusValues);
export const callStatusSchema = z.enum(callStatusValues);
export const callResultSchema = z.enum(callResultValues);
export const callSpeakerSchema = z.enum(callSpeakerValues);
export const notificationChannelSchema = z.enum(notificationChannelValues);
export const notificationStatusSchema = z.enum(notificationStatusValues);
export const transcriptLanguageSchema = z.enum(transcriptLanguageValues);
export const marketSpeedProfileSchema = z.enum(marketSpeedProfileValues);
export const guideStageSchema = z.enum(guideStageValues);
export const guideModeSchema = z.enum(guideModeValues);
export const guideAudioStateSchema = z.enum(guideAudioStateValues);
export const callPlaybackStatusSchema = z.enum(callPlaybackStatusValues);
export const callPlaybackResolutionKindSchema = z.enum(callPlaybackResolutionKindValues);

const recordSchema = z.record(z.string(), z.unknown());
const stringArraySchema = z.array(z.string()).default([]);

export const guideEnvelopeSchema = z.object({
  personaId: z.string().trim().min(1).default("switchboard"),
  stage: guideStageSchema,
  mode: guideModeSchema.default("narrated"),
  headline: z.string().trim().min(1),
  body: z.string().trim().min(1),
  accent: z.string().trim().min(1).default("Switchboard"),
  speakableText: z.string().trim().min(1),
  speechKey: z.string().trim().min(1),
  speechToken: z.string().trim().default(""),
  nextActionLabel: z.string().trim().min(1).default("Stand by"),
  nextActionHref: z.string().trim().default(""),
  blockingState: z.boolean().default(false),
  audioState: guideAudioStateSchema.default("muted"),
});

export const workspaceFlowSchema = z.object({
  researchSessionId: z.string().uuid(),
  marketRunId: z.string().uuid().nullable().optional(),
  callCampaignId: z.string().uuid().nullable().optional(),
  winnerArtifactId: z.string().uuid().nullable().optional(),
  activeStage: guideStageSchema.default("research"),
  revision: z.number().int().nonnegative().default(0),
  updatedAt: z.string().trim().default(""),
});

export const marketRefinementSchema = z.object({
  label: z.string().trim().min(1).max(120).default("Updated preferences"),
  notes: z.string().trim().min(1).max(1200),
  rawNotes: z.string().trim().min(1).max(1200).optional(),
  budgetStretchPercent: z.number().int().min(0).max(100).optional(),
  budgetDeltaAbsolute: z.number().int().nonnegative().optional(),
  budgetTargetMax: z.number().int().nonnegative().optional(),
  localities: stringArraySchema.optional(),
  mustHaves: stringArraySchema.optional(),
  niceToHaves: stringArraySchema.optional(),
  dealBreakers: stringArraySchema.optional(),
});

export const marketScoreBreakdownSchema = z.object({
  requirementFit: z.number().min(0).max(45),
  evidenceConfidence: z.number().min(0).max(25),
  contactability: z.number().min(0).max(20),
  freshness: z.number().min(0).max(10),
  total: z.number().min(0).max(100),
});

export const marketCandidateFactSchema = z.object({
  businessName: z.string().trim().min(1).default("Unknown business"),
  locality: z.string().trim().optional(),
  city: z.string().trim().optional(),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  whatsappNumber: z.string().trim().optional(),
  websiteUrl: z.string().trim().optional(),
  sourceLanguage: z.string().trim().default("English"),
  priceHintMin: z.number().int().nonnegative().optional(),
  priceHintMax: z.number().int().nonnegative().optional(),
  capacityMin: z.number().int().nonnegative().optional(),
  capacityMax: z.number().int().nonnegative().optional(),
  amenities: stringArraySchema,
  tags: stringArraySchema,
  summary: z.string().trim().default(""),
  contactable: z.boolean().default(false),
});

export const marketCandidateEvidenceSchema = z.object({
  id: z.string().uuid().optional(),
  candidateId: z.string().uuid().optional(),
  sourceUrl: z.string().trim().min(1),
  sourceDomain: z.string().trim().min(1).default(""),
  sourceKind: z.string().trim().min(1).default("web_page"),
  isFirstParty: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.5),
  sourceLanguage: z.string().trim().default("English"),
  excerpt: z.string().trim().default(""),
  facts: marketCandidateFactSchema,
});

export const marketCandidateSchema = z.object({
  id: z.string().uuid(),
  marketRunId: z.string().uuid(),
  researchSessionId: z.string().uuid(),
  rank: z.number().int().positive().default(1),
  displayName: z.string().trim().min(1),
  canonicalUrl: z.string().trim().default(""),
  websiteUrl: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  whatsappNumber: z.string().trim().default(""),
  locality: z.string().trim().default(""),
  city: z.string().trim().default(""),
  address: z.string().trim().default(""),
  summary: z.string().trim().default(""),
  eligibility: candidateEligibilitySchema.default("needs_review"),
  selectedForCalls: z.boolean().default(false),
  score: z.number().min(0).max(100).default(0),
  evidenceCount: z.number().int().nonnegative().default(0),
  scoreBreakdown: marketScoreBreakdownSchema,
  fitNotes: stringArraySchema,
  sourceLanguage: z.string().trim().default("English"),
  payload: recordSchema.optional().nullable(),
});

export const marketRunSummarySchema = z.object({
  searchQueries: stringArraySchema.default([]),
  totalCandidates: z.number().int().nonnegative().default(0),
  eligibleCandidates: z.number().int().nonnegative().default(0),
  selectedCandidates: z.number().int().nonnegative().default(0),
  highlights: stringArraySchema.default([]),
  speedProfile: marketSpeedProfileSchema.default("demo_fast"),
});

export const marketRunSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  researchSessionId: z.string().uuid(),
  status: marketRunStatusSchema,
  currentStage: marketStageSchema.default("idle"),
  briefSnapshot: researchBriefSchema,
  refinements: z.array(marketRefinementSchema).default([]),
  parentRunId: z.string().uuid().nullable().optional(),
  supersedesRunId: z.string().uuid().nullable().optional(),
  summary: marketRunSummarySchema,
  error: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
});

export const marketProviderJobSchema = z.object({
  id: z.string().uuid(),
  marketRunId: z.string().uuid(),
  provider: z.string().trim().min(1),
  operation: z.string().trim().min(1),
  stage: z.string().trim().min(1),
  externalJobId: z.string().trim().default(""),
  status: z.string().trim().min(1).default("queued"),
  request: recordSchema.optional().nullable(),
  response: recordSchema.optional().nullable(),
  lastEventType: z.string().trim().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
});

export const callingPolicySchema = z.object({
  mode: z.enum(["verify_only", "verify_and_negotiate"]).default("verify_and_negotiate"),
  targetBudget: researchBudgetSchema.optional(),
  stretchBudgetPercent: z.number().int().min(0).max(100).default(0),
  mentionBudgetOnCall: z.boolean().default(true),
  askForDiscount: z.boolean().default(true),
  requestHold: z.boolean().default(false),
  preferredLanguage: z.string().trim().default("English"),
  selectionFingerprint: z.string().trim().default(""),
  transportVersion: z.string().trim().default("v1"),
});

export const callPlanSchema = z.object({
  candidateId: z.string().uuid(),
  businessName: z.string().trim().min(1),
  phone: z.string().trim().default(""),
  whyCall: z.string().trim().min(1),
  knownFacts: stringArraySchema,
  unknownFacts: stringArraySchema,
  askSequence: stringArraySchema,
  negotiationBounds: recordSchema.default({}),
  successCriteria: stringArraySchema,
  disqualifiers: stringArraySchema,
});

export const sellerScenarioSchema = z.object({
  candidateId: z.string().uuid(),
  businessName: z.string().trim().min(1),
  targetLanguage: z.string().trim().default("English"),
  pickupOutcome: z.enum(["answer", "no_answer"]).default("answer"),
  availability: z.enum(["available", "limited", "unavailable"]).default("available"),
  baseQuote: z.number().int().nonnegative().optional(),
  finalQuote: z.number().int().nonnegative().optional(),
  negotiationFloor: z.number().int().nonnegative().optional(),
  depositRequired: z.boolean().default(false),
  holdPossible: z.boolean().default(false),
  contactName: z.string().trim().default("Front desk"),
  contactChannel: z.string().trim().default("phone"),
  websiteUrl: z.string().trim().default(""),
  whatsappNumber: z.string().trim().default(""),
  websiteVisible: z.boolean().default(true),
  tone: z.enum(["helpful", "premium", "rigid", "busy"]).default("helpful"),
  mustRevealConditions: stringArraySchema,
  seededDurationMs: z.number().int().min(5000).default(35000),
});

export const simulatedCallTurnSchema = z.object({
  seq: z.number().int().positive(),
  speaker: callSpeakerSchema,
  sourceText: z.string().trim().default(""),
  englishText: z.string().trim().default(""),
  offsetMs: z.number().int().nonnegative(),
});

export const callOutcomeSchema = z.object({
  result: callResultSchema,
  availabilityStatus: z.string().trim().default("unknown"),
  quotedPrice: z.number().int().nonnegative().optional(),
  discountOffered: z.number().int().nonnegative().optional(),
  depositRequired: z.boolean().default(false),
  holdPossible: z.boolean().default(false),
  websiteUrl: z.string().trim().default(""),
  whatsappNumber: z.string().trim().default(""),
  contactName: z.string().trim().default(""),
  contactChannel: z.string().trim().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
  summarySourceText: z.string().trim().default(""),
  summaryEnglishText: z.string().trim().default(""),
  structuredDetails: recordSchema.default({}),
});

export const callPlaybackEnvelopeSchema = z.object({
  laneStartOffsetMs: z.number().int().nonnegative(),
  ringStartMs: z.number().int().nonnegative(),
  pickupAtMs: z.number().int().nonnegative().nullable().optional(),
  negotiationStartMs: z.number().int().nonnegative().nullable().optional(),
  callEndMs: z.number().int().nonnegative(),
  summaryRevealMs: z.number().int().nonnegative(),
  endedEarly: z.boolean().default(false),
  resolutionKind: callPlaybackResolutionKindSchema,
});

export const simulatedCallArtifactSchema = z.object({
  targetDurationMs: z.number().int().min(5000),
  sourceLanguage: z.string().trim().default("English"),
  englishLanguage: z.string().trim().default("English"),
  callStatusPattern: z.array(
    z.object({
      atMs: z.number().int().nonnegative(),
      status: callPlaybackStatusSchema,
    }),
  ).default([]),
  playback: callPlaybackEnvelopeSchema.optional(),
  turns: z.array(simulatedCallTurnSchema),
  outcome: callOutcomeSchema,
});

export const callSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  marketRunId: z.string().uuid(),
  candidateId: z.string().uuid(),
  orderIndex: z.number().int().nonnegative().default(0),
  status: callStatusSchema,
  targetDurationMs: z.number().int().nonnegative(),
  actualDurationMs: z.number().int().nonnegative().nullable().optional(),
  result: callResultSchema.nullable().optional(),
  providerCallId: z.string().trim().nullable().optional(),
  providerConversationId: z.string().trim().nullable().optional(),
  providerState: recordSchema.optional().nullable(),
  plan: callPlanSchema,
  scenario: sellerScenarioSchema,
  payload: recordSchema.optional().nullable(),
});

export const callCampaignSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  researchSessionId: z.string().uuid(),
  marketRunId: z.string().uuid(),
  transport: callTransportSchema,
  status: callCampaignStatusSchema,
  displayLanguage: transcriptLanguageSchema.default("english"),
  sourceLanguage: z.string().trim().default("English"),
  seed: z.string().trim().min(1),
  callingPolicy: callingPolicySchema,
  selectionFingerprint: z.string().trim().default(""),
  providerState: recordSchema.optional().nullable(),
  playbackStartedAt: z.string().nullable().optional(),
  playbackEndsAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const winnerArtifactSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  researchSessionId: z.string().uuid(),
  marketRunId: z.string().uuid(),
  callCampaignId: z.string().uuid(),
  selectedCandidateId: z.string().uuid(),
  reportSourceText: z.string().trim().default(""),
  reportEnglishText: z.string().trim().default(""),
  ranking: z.array(
    z.object({
      candidateId: z.string().uuid(),
      rank: z.number().int().positive(),
      score: z.number().min(0).max(100),
      reason: z.string().trim().default(""),
    }),
  ),
  payload: recordSchema.default({}),
  createdAt: z.string().nullable().optional(),
});

export const notificationRequestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  channel: notificationChannelSchema,
  status: notificationStatusSchema,
  researchSessionId: z.string().uuid().nullable().optional(),
  marketRunId: z.string().uuid().nullable().optional(),
  callCampaignId: z.string().uuid().nullable().optional(),
  winnerArtifactId: z.string().uuid().nullable().optional(),
  destination: z.string().trim().min(1),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  sentAt: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
});

export const notificationDeliverySchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  channel: notificationChannelSchema,
  provider: z.string().trim().min(1),
  status: notificationStatusSchema,
  externalId: z.string().trim().default(""),
  payload: recordSchema.default({}),
  createdAt: z.string().nullable().optional(),
});

export const createMarketRunRequestSchema = z.object({
  researchSessionId: z.string().uuid(),
  refinement: marketRefinementSchema.optional(),
  speedProfile: marketSpeedProfileSchema.optional(),
  forceFresh: z.boolean().optional(),
  sourceRunId: z.string().uuid().optional(),
});

export const createCallCampaignRequestSchema = z.object({
  marketRunId: z.string().uuid(),
  callingPolicy: callingPolicySchema.partial().optional(),
  forceFresh: z.boolean().optional(),
  sourceCampaignId: z.string().uuid().optional(),
});

export const selectMarketCandidatesSchema = z.object({
  candidateIds: z.array(z.string().uuid()).max(4).default([]),
});

export const createNotificationRequestSchema = z
  .object({
    channel: notificationChannelSchema.default("email"),
    marketRunId: z.string().uuid().optional(),
    callCampaignId: z.string().uuid().optional(),
    winnerArtifactId: z.string().uuid().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.marketRunId) || Boolean(value.callCampaignId) || Boolean(value.winnerArtifactId),
    {
      message: "One target id is required.",
    },
  );

export const confirmWinnerSelectionSchema = z.object({
  callCampaignId: z.string().uuid(),
  candidateId: z.string().uuid(),
});

export const marketRunRecordSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  research_session_id: z.string().uuid(),
  parent_run_id: z.string().uuid().nullable(),
  supersedes_run_id: z.string().uuid().nullable(),
  status: marketRunStatusSchema,
  current_stage: marketStageSchema,
  brief_snapshot_json: recordSchema,
  refinements_json: z.array(recordSchema).nullable(),
  summary_json: recordSchema.nullable(),
  error_text: z.string().nullable(),
  started_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
  superseded_at: z.string().nullable(),
});

export const marketProviderJobRecordSchema = z.object({
  id: z.string().uuid(),
  market_run_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  provider: z.string(),
  operation: z.string(),
  stage: z.string(),
  external_job_id: z.string().nullable(),
  status: z.string(),
  request_json: recordSchema.nullable(),
  response_json: recordSchema.nullable(),
  last_event_type: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
});

export const marketCandidateRecordSchema = z.object({
  id: z.string().uuid(),
  market_run_id: z.string().uuid(),
  research_session_id: z.string().uuid(),
  user_id: z.string().uuid(),
  rank: z.number().int(),
  eligibility_status: candidateEligibilitySchema,
  selected_for_calls: z.boolean(),
  display_name: z.string(),
  canonical_url: z.string().nullable(),
  website_url: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp_number: z.string().nullable(),
  locality: z.string().nullable(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  summary: z.string().nullable(),
  score: z.number(),
  evidence_count: z.number().int(),
  score_breakdown_json: recordSchema.nullable(),
  fit_notes_json: z.array(z.string()).nullable(),
  source_language: z.string().nullable(),
  payload_json: recordSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const marketCandidateEvidenceRecordSchema = z.object({
  id: z.string().uuid(),
  market_run_id: z.string().uuid(),
  candidate_id: z.string().uuid(),
  user_id: z.string().uuid(),
  source_url: z.string(),
  source_domain: z.string().nullable(),
  source_kind: z.string(),
  is_first_party: z.boolean(),
  confidence: z.number(),
  source_language: z.string().nullable(),
  excerpt: z.string().nullable(),
  fact_json: recordSchema.nullable(),
  created_at: z.string(),
});

export const callCampaignRecordSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  research_session_id: z.string().uuid(),
  market_run_id: z.string().uuid(),
  transport: callTransportSchema,
  status: callCampaignStatusSchema,
  display_language: transcriptLanguageSchema,
  source_language: z.string().nullable(),
  seed: z.string(),
  calling_policy_json: recordSchema,
  selection_fingerprint: z.string().nullable().optional(),
  provider_state_json: recordSchema.nullable().optional(),
  playback_started_at: z.string().nullable(),
  playback_ends_at: z.string().nullable(),
  error_text: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
});

export const callRecordSchema = z.object({
  id: z.string().uuid(),
  call_campaign_id: z.string().uuid(),
  market_run_id: z.string().uuid(),
  candidate_id: z.string().uuid(),
  user_id: z.string().uuid(),
  order_index: z.number().int(),
  status: callStatusSchema,
  target_duration_ms: z.number().int(),
  actual_duration_ms: z.number().int().nullable(),
  result: callResultSchema.nullable(),
  provider_call_id: z.string().nullable().optional(),
  provider_conversation_id: z.string().nullable().optional(),
  provider_state_json: recordSchema.nullable().optional(),
  call_plan_json: recordSchema,
  seller_scenario_json: recordSchema,
  artifact_json: recordSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
});

export const callTurnRecordSchema = z.object({
  id: z.string().uuid(),
  call_id: z.string().uuid(),
  user_id: z.string().uuid(),
  seq: z.number().int(),
  speaker: callSpeakerSchema,
  source_text: z.string(),
  english_text: z.string(),
  offset_ms: z.number().int(),
  created_at: z.string(),
});

export const callOutcomeRecordSchema = z.object({
  id: z.string().uuid(),
  call_id: z.string().uuid(),
  user_id: z.string().uuid(),
  result: callResultSchema,
  availability_status: z.string(),
  quoted_price: z.number().int().nullable(),
  discount_offered: z.number().int().nullable(),
  deposit_required: z.boolean(),
  hold_possible: z.boolean(),
  website_url: z.string().nullable(),
  whatsapp_number: z.string().nullable(),
  contact_name: z.string().nullable(),
  contact_channel: z.string().nullable(),
  confidence: z.number(),
  summary_source_text: z.string().nullable(),
  summary_english_text: z.string().nullable(),
  payload_json: recordSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const winnerArtifactRecordSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  research_session_id: z.string().uuid(),
  market_run_id: z.string().uuid(),
  call_campaign_id: z.string().uuid(),
  selected_candidate_id: z.string().uuid(),
  report_source_text: z.string().nullable(),
  report_english_text: z.string().nullable(),
  ranking_json: z.array(recordSchema).nullable(),
  payload_json: recordSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const notificationRequestRecordSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  channel: notificationChannelSchema,
  status: notificationStatusSchema,
  research_session_id: z.string().uuid().nullable(),
  market_run_id: z.string().uuid().nullable(),
  call_campaign_id: z.string().uuid().nullable(),
  winner_artifact_id: z.string().uuid().nullable(),
  destination: z.string(),
  last_error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  sent_at: z.string().nullable(),
});

export const notificationDeliveryRecordSchema = z.object({
  id: z.string().uuid(),
  request_id: z.string().uuid(),
  user_id: z.string().uuid(),
  channel: notificationChannelSchema,
  provider: z.string(),
  status: notificationStatusSchema,
  external_id: z.string().nullable(),
  payload_json: recordSchema.nullable(),
  created_at: z.string(),
});

export type MarketRunStatus = z.infer<typeof marketRunStatusSchema>;
export type MarketStage = z.infer<typeof marketStageSchema>;
export type MarketSpeedProfile = z.infer<typeof marketSpeedProfileSchema>;
export type MarketRefinement = z.infer<typeof marketRefinementSchema>;
export type MarketScoreBreakdown = z.infer<typeof marketScoreBreakdownSchema>;
export type MarketCandidateFact = z.infer<typeof marketCandidateFactSchema>;
export type MarketCandidateEvidence = z.infer<typeof marketCandidateEvidenceSchema>;
export type MarketCandidate = z.infer<typeof marketCandidateSchema>;
export type MarketRunSummary = z.infer<typeof marketRunSummarySchema>;
export type MarketRun = z.infer<typeof marketRunSchema>;
export type MarketProviderJob = z.infer<typeof marketProviderJobSchema>;
export type CallingPolicy = z.infer<typeof callingPolicySchema>;
export type CallPlan = z.infer<typeof callPlanSchema>;
export type SellerScenario = z.infer<typeof sellerScenarioSchema>;
export type GuideEnvelope = z.infer<typeof guideEnvelopeSchema>;
export type WorkspaceFlow = z.infer<typeof workspaceFlowSchema>;
export type CallPlaybackEnvelope = z.infer<typeof callPlaybackEnvelopeSchema>;
export type SimulatedCallTurn = z.infer<typeof simulatedCallTurnSchema>;
export type CallOutcome = z.infer<typeof callOutcomeSchema>;
export type SimulatedCallArtifact = z.infer<typeof simulatedCallArtifactSchema>;
export type CallCampaign = z.infer<typeof callCampaignSchema>;
export type Call = z.infer<typeof callSchema>;
export type WinnerArtifact = z.infer<typeof winnerArtifactSchema>;
export type NotificationRequest = z.infer<typeof notificationRequestSchema>;
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;
export type CreateMarketRunRequest = z.infer<typeof createMarketRunRequestSchema>;
export type CreateCallCampaignRequest = z.infer<typeof createCallCampaignRequestSchema>;
export type SelectMarketCandidatesRequest = z.infer<typeof selectMarketCandidatesSchema>;
export type CreateNotificationRequest = z.infer<typeof createNotificationRequestSchema>;
export type ConfirmWinnerSelectionRequest = z.infer<typeof confirmWinnerSelectionSchema>;
export type MarketRunRecord = z.infer<typeof marketRunRecordSchema>;
export type MarketProviderJobRecord = z.infer<typeof marketProviderJobRecordSchema>;
export type MarketCandidateRecord = z.infer<typeof marketCandidateRecordSchema>;
export type MarketCandidateEvidenceRecord = z.infer<typeof marketCandidateEvidenceRecordSchema>;
export type CallCampaignRecord = z.infer<typeof callCampaignRecordSchema>;
export type CallRecord = z.infer<typeof callRecordSchema>;
export type CallTurnRecord = z.infer<typeof callTurnRecordSchema>;
export type CallOutcomeRecord = z.infer<typeof callOutcomeRecordSchema>;
export type WinnerArtifactRecord = z.infer<typeof winnerArtifactRecordSchema>;
export type NotificationRequestRecord = z.infer<typeof notificationRequestRecordSchema>;
export type NotificationDeliveryRecord = z.infer<typeof notificationDeliveryRecordSchema>;

export type CategoryCapability = {
  category: z.infer<typeof researchCategorySchema>;
  allowedScopeStatus: z.infer<typeof scopeStatusSchema>[];
  searchQueryTemplates: Array<(brief: ResearchBrief) => string>;
};

export const marketRefinementAlreadyUsedErrorMessage =
  "Market refinement has already been used for this brief.";

function describeCategory(category: ResearchBrief["category"]) {
  switch (category) {
    case "banquet":
      return "banquet venue";
    case "coworking":
      return "coworking space";
    case "clinic":
      return "clinic";
    default:
      return "establishment";
  }
}

function describeTimeline(brief: ResearchBrief) {
  const timeline = brief.timeline ?? {};
  const categoryDetails =
    brief.categoryDetails && typeof brief.categoryDetails === "object"
      ? (brief.categoryDetails as Record<string, unknown>)
      : {};
  const dateWindow =
    typeof categoryDetails.dateWindow === "string" ? categoryDetails.dateWindow.trim() : "";

  return [
    typeof timeline.label === "string" ? timeline.label.trim() : "",
    typeof timeline.startDate === "string" ? timeline.startDate.trim() : "",
    typeof timeline.endDate === "string" && timeline.endDate !== timeline.startDate
      ? timeline.endDate.trim()
      : "",
    dateWindow,
  ]
    .filter(Boolean)
    .join(" ");
}

function describeBudget(brief: ResearchBrief) {
  const budget = brief.budget ?? { currency: "INR" };

  if (typeof budget.max === "number") {
    return `${budget.currency} ${budget.max}`;
  }

  if (typeof budget.min === "number") {
    return `${budget.currency} ${budget.min}`;
  }

  return "open budget";
}

function buildBriefSummary(brief: ResearchBrief) {
  const categoryLabel = describeCategory(brief.category);
  const localityText = brief.localities.length > 0 ? ` around ${brief.localities.join(", ")}` : "";
  const timelineText = describeTimeline(brief);
  const mustHaveText = brief.mustHaves.length > 0 ? ` Must-haves: ${brief.mustHaves.slice(0, 4).join(", ")}.` : "";

  return [
    `Looking for a ${categoryLabel} in ${brief.city}${localityText} for ${brief.headcount || "the requested"} people`,
    timelineText ? ` ${timelineText}` : "",
    ` within ${describeBudget(brief)}.`,
    mustHaveText,
  ]
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBriefMarketQueryPreview(brief: ResearchBrief) {
  const parts = [
    describeCategory(brief.category),
    "in",
    brief.city,
    brief.localities.length > 0 ? brief.localities.join(" ") : "",
    brief.headcount > 0 ? `for ${brief.headcount}` : "",
    typeof brief.budget.max === "number" ? `budget ${brief.budget.max}` : "",
    describeTimeline(brief),
    brief.mustHaves.slice(0, 3).join(" "),
    "phone whatsapp pricing",
  ];

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function rebuildMarketBriefNarrative(brief: ResearchBrief): ResearchBrief {
  const nextBrief = researchBriefSchema.parse({
    ...brief,
    summary: buildBriefSummary(brief),
    marketQueryPreview: buildBriefMarketQueryPreview(brief),
  });

  return researchBriefSchema.parse({
    ...nextBrief,
    missingFields: computeMissingFields(nextBrief),
    readyForMarket: computeReadyForMarket(nextBrief),
  });
}

export function normalizeCallingPolicy(
  brief: ResearchBrief,
  input?: Partial<CallingPolicy>,
): CallingPolicy {
  return callingPolicySchema.parse({
    targetBudget: brief.budget,
    preferredLanguage: brief.preferredLanguages[0] ?? "English",
    ...input,
  });
}

export function normalizeBriefRefinement(
  brief: ResearchBrief,
  refinement: MarketRefinement,
): ResearchBrief {
  const baselineBudgetMax = brief.budget.max ?? brief.budget.min;
  const nextBudget = { ...brief.budget };

  if (typeof refinement.budgetTargetMax === "number") {
    nextBudget.max = refinement.budgetTargetMax;
  } else if (typeof refinement.budgetDeltaAbsolute === "number") {
    nextBudget.max = Math.max((baselineBudgetMax ?? 0) + refinement.budgetDeltaAbsolute, 0);
  } else if (refinement.budgetStretchPercent) {
    nextBudget.max = baselineBudgetMax
      ? Math.round(baselineBudgetMax * (1 + refinement.budgetStretchPercent / 100))
      : baselineBudgetMax;
  }

  if (
    typeof nextBudget.min === "number" &&
    typeof nextBudget.max === "number" &&
    nextBudget.min > nextBudget.max
  ) {
    nextBudget.min = undefined;
  }

  return rebuildMarketBriefNarrative(
    researchBriefSchema.parse({
    ...brief,
    budget: nextBudget,
    localities: refinement.localities !== undefined ? refinement.localities : brief.localities,
    mustHaves: refinement.mustHaves !== undefined ? refinement.mustHaves : brief.mustHaves,
    niceToHaves: refinement.niceToHaves !== undefined ? refinement.niceToHaves : brief.niceToHaves,
    dealBreakers: refinement.dealBreakers !== undefined ? refinement.dealBreakers : brief.dealBreakers,
  }),
  );
}

export function buildMarketRunBriefSnapshot(
  brief: ResearchBrief,
  refinement?: MarketRefinement,
) {
  if (!refinement) {
    return rebuildMarketBriefNarrative(brief);
  }

  return normalizeBriefRefinement(brief, refinement);
}

export function sanitizeBriefForMarketSeed(brief: ResearchBrief) {
  return {
    id: brief.id,
    category: brief.category,
    city: brief.city,
    localities: brief.localities,
    headcount: brief.headcount,
    preferredLanguages: brief.preferredLanguages,
    mustHaves: brief.mustHaves,
    niceToHaves: brief.niceToHaves,
    dealBreakers: brief.dealBreakers,
    summary: brief.summary,
    marketQueryPreview: brief.marketQueryPreview,
    budget: brief.budget,
    timeline: brief.timeline,
    categoryDetails: brief.categoryDetails,
  };
}
