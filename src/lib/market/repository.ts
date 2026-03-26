import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/integrations/supabase";
import { getServerEnv } from "@/lib/env";
import {
  marketRunChronologyColumn,
} from "@/lib/market/contracts";
import {
  buildMarketSearchQueries,
  buildCallSelectionFingerprint,
  buildCallingPlan,
  buildSellerScenario,
  buildWinnerRanking,
  chooseEligibility,
  resolveMarketRunShortlistStatus,
  scoreMarketCandidate,
  shouldMapSearchResult,
  summarizeCandidateFit,
} from "@/lib/market/logic";
import {
  sendCallsReadyEmail,
  sendMarketReadyEmail,
  sendWinnerReadyEmail,
} from "@/lib/market/notifications";
import {
  flattenCallCampaignSnapshot,
  flattenMarketRunSnapshot,
} from "@/lib/market/presenter";
import {
  buildMarketRunBriefSnapshot,
  callOutcomeRecordSchema,
  callCampaignRecordSchema,
  callRecordSchema,
  callTurnRecordSchema,
  createCallCampaignRequestSchema,
  createMarketRunRequestSchema,
  createNotificationRequestSchema,
  selectMarketCandidatesSchema,
  confirmWinnerSelectionSchema,
  marketCandidateEvidenceRecordSchema,
  marketCandidateFactSchema,
  marketCandidateRecordSchema,
  marketRefinementAlreadyUsedErrorMessage,
  marketProviderJobRecordSchema,
  marketRefinementSchema,
  marketRunRecordSchema,
  marketSpeedProfileSchema,
  normalizeCallingPolicy,
  notificationRequestRecordSchema,
  simulatedCallArtifactSchema,
  workspaceFlowSchema,
  winnerArtifactRecordSchema,
  type CallCampaignRecord,
  type CallRecord,
  type CallPlan,
  type CallingPolicy,
  type CreateCallCampaignRequest,
  type CreateMarketRunRequest,
  type CreateNotificationRequest,
  type ConfirmWinnerSelectionRequest,
  type MarketCandidateEvidenceRecord,
  type MarketCandidateRecord,
  type MarketProviderJobRecord,
  type MarketRunRecord,
  type MarketSpeedProfile,
  type SellerScenario,
  type WinnerArtifactRecord,
} from "@/lib/market/schemas";
import { researchSessionRecordSchema, type ResearchBrief } from "@/lib/research/schemas";
import { getResearchSnapshotForUser } from "@/lib/research/repository";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { startFallbackAgentDiscovery, startCandidateBatchScrape, runFirecrawlSearches, mapDomainUrls, getBatchScrapeStatus } from "@/lib/market/firecrawl-client";
import {
  LIVE_CALL_TRANSPORT,
  assertLiveCallingReady,
  extractWebhookConversationId,
  extractWebhookDynamicVariables,
  extractWebhookEventId,
  extractWebhookEventType,
  extractWebhookProviderCallId,
  fetchElevenLabsConversation,
  startElevenLabsOutboundCall,
} from "@/lib/market/elevenlabs-calls";
import {
  generateSimulatedCallArtifact,
  summarizeLiveCallOutcomeFromTranscript,
} from "@/lib/market/openai-client";

type DatabaseClient = Awaited<ReturnType<typeof createSupabaseClient>>;
type TrustedDatabaseClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
type MarketDatabaseClient = DatabaseClient | TrustedDatabaseClient;

function getTrustedSupabase() {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    throw new Error("Supabase admin client is not configured.");
  }

  return supabase;
}

function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function buildCandidateKey(input: {
  businessName?: string;
  websiteUrl?: string;
  sourceUrl?: string;
}) {
  let domain = "";

  try {
    const base = input.websiteUrl || input.sourceUrl || "";
    if (base) {
      domain = new URL(base).hostname.replace(/^www\./, "");
    }
  } catch {
    domain = "";
  }

  return `${domain}\u0000${normalized(input.businessName)}`;
}

function seededHex(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function seededUuid(input: string) {
  const chars = seededHex(input).slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = ["8", "9", "a", "b"][Number.parseInt(chars[16] ?? "0", 16) % 4] ?? "8";

  return [
    chars.slice(0, 8).join(""),
    chars.slice(8, 12).join(""),
    chars.slice(12, 16).join(""),
    chars.slice(16, 20).join(""),
    chars.slice(20, 32).join(""),
  ].join("-");
}

function compareStrings(left: string | null | undefined, right: string | null | undefined) {
  return normalized(left) === normalized(right);
}

function coerceRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function isTerminalCallStatus(status: string | null | undefined) {
  return status === "completed" || status === "no_answer" || status === "failed";
}

function isTerminalCampaignStatus(status: string | null | undefined) {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "superseded";
}

function buildLiveCallPhaseSchedule(targetDurationMs: number) {
  const ringingUntilMs = Math.min(Math.max(Math.round(targetDurationMs * 0.18), 3_500), 7_500);
  const negotiatingAtMs = Math.min(Math.max(Math.round(targetDurationMs * 0.62), 12_000), 24_000);

  return {
    ringingUntilMs,
    negotiatingAtMs,
  };
}

function mergeProviderState(currentValue: unknown, updates: Record<string, unknown>) {
  return {
    ...coerceRecord(currentValue),
    ...updates,
  };
}

function readMarketSpeedProfile(value: unknown): MarketSpeedProfile {
  const parsed = marketSpeedProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : "demo_fast";
}

function readWorkspaceFlow(value: unknown, researchSessionId: string) {
  const record = coerceRecord(value);
  const parsed = workspaceFlowSchema.safeParse(record.workspaceFlow);

  if (!parsed.success) {
    return workspaceFlowSchema.parse({
      researchSessionId,
      marketRunId: null,
      callCampaignId: null,
      winnerArtifactId: null,
      activeStage: "research",
      revision: 0,
      updatedAt: "",
    });
  }

  return parsed.data;
}

async function getResearchSessionForUser(
  supabase: DatabaseClient,
  userId: string,
  researchSessionId: string,
) {
  const { data, error } = await supabase
    .from("research_sessions")
    .select("*")
    .eq("id", researchSessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? researchSessionRecordSchema.parse(data) : null;
}

async function getResearchSessionForService(researchSessionId: string) {
  const supabase = getTrustedSupabase();
  const { data, error } = await supabase
    .from("research_sessions")
    .select("*")
    .eq("id", researchSessionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? researchSessionRecordSchema.parse(data) : null;
}

async function updateWorkspaceFlowForResearchSession(
  researchSessionId: string,
  patch: Partial<{
    marketRunId: string | null;
    callCampaignId: string | null;
    winnerArtifactId: string | null;
    activeStage: "research" | "market" | "calls" | "winner";
  }>,
) {
  const supabase = getTrustedSupabase();
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const session = await getResearchSessionForService(researchSessionId);

    if (!session) {
      return null;
    }

    const resumeContext = coerceRecord(session.resume_context);
    const current = readWorkspaceFlow(resumeContext, researchSessionId);
    const updatedAt = new Date().toISOString();
    const nextFlow = workspaceFlowSchema.parse({
      ...current,
      ...patch,
      researchSessionId,
      revision: current.revision + 1,
      updatedAt,
    });
    const { data, error } = await supabase
      .from("research_sessions")
      .update({
        updated_at: updatedAt,
        resume_context: {
          ...resumeContext,
          workspaceFlow: nextFlow,
        },
      })
      .eq("id", researchSessionId)
      .eq("updated_at", session.updated_at)
      .select("id")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      return nextFlow;
    }
  }

  throw new Error("Workspace flow update conflicted. Retry the action.");
}

export async function getWorkspaceFlowForUser(userId: string, researchSessionId: string) {
  const supabase = await createSupabaseClient();
  const session = await getResearchSessionForUser(supabase, userId, researchSessionId);

  if (!session) {
    return null;
  }

  return readWorkspaceFlow(session.resume_context, researchSessionId);
}

function getWebhookBaseUrl() {
  return getServerEnv().appBaseUrl.replace(/\/$/, "");
}

function getFirecrawlWebhookUrl(runId: string) {
  return `${getWebhookBaseUrl()}/api/market/firecrawl/webhook?marketRunId=${encodeURIComponent(runId)}`;
}

function isBatchScrapeOperation(operation: string) {
  return operation === "batch_scrape" || operation === "batch_scrape_fallback";
}

function isTerminalBatchScrapeStatus(status: string) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function getLatestBatchScrapeProviderJob(jobs: MarketProviderJobRecord[]) {
  return [...jobs]
    .reverse()
    .find((entry) => isBatchScrapeOperation(entry.operation) && entry.external_job_id);
}

function getFirecrawlStatusFailureMessage(payload: unknown) {
  const record = coerceRecord(payload);
  const details = Array.isArray(record.details)
    ? record.details.flatMap((entry) => {
        const detail = coerceRecord(entry);
        const message = typeof detail.message === "string" ? detail.message : null;
        if (message) {
          return [message];
        }

        if (Array.isArray(detail.keys)) {
          return detail.keys
            .filter((key) => typeof key === "string" && key.trim().length > 0)
            .map((key) => `Unrecognized key: "${key}"`);
        }

        return [];
      })
    : [];
  const messages = [
    typeof record.message === "string" ? record.message : null,
    typeof record.error === "string" ? record.error : null,
    ...details,
  ].filter((entry, index, array): entry is string => Boolean(entry) && array.indexOf(entry) === index);

  return messages.length > 0
    ? `Firecrawl batch scrape failed: ${messages.join("; ")}`
    : "Firecrawl batch scrape failed.";
}

async function getOwnedMarketRun(
  supabase: DatabaseClient,
  userId: string,
  runId: string,
) {
  const { data, error } = await supabase
    .from("market_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? marketRunRecordSchema.parse(data) : null;
}

async function getMarketRunForService(runId: string) {
  const supabase = getTrustedSupabase();
  const { data, error } = await supabase
    .from("market_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? marketRunRecordSchema.parse(data) : null;
}

async function getMarketCandidates(
  supabase: MarketDatabaseClient,
  marketRunId: string,
) {
  const { data, error } = await supabase
    .from("market_candidates")
    .select("*")
    .eq("market_run_id", marketRunId)
    .order("rank", { ascending: true })
    .order("score", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []).map((entry) => marketCandidateRecordSchema.parse(entry));
}

async function getMarketEvidence(
  supabase: MarketDatabaseClient,
  marketRunId: string,
) {
  const { data, error } = await supabase
    .from("market_candidate_evidence")
    .select("*")
    .eq("market_run_id", marketRunId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((entry) => marketCandidateEvidenceRecordSchema.parse(entry));
}

async function getMarketNotifications(
  supabase: MarketDatabaseClient,
  marketRunId: string,
) {
  const { data, error } = await supabase
    .from("notification_requests")
    .select("*")
    .eq("market_run_id", marketRunId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((entry) => notificationRequestRecordSchema.parse(entry));
}

async function getMarketProviderJobs(
  supabase: MarketDatabaseClient,
  marketRunId: string,
) {
  const { data, error } = await supabase
    .from("market_provider_jobs")
    .select("*")
    .eq("market_run_id", marketRunId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((entry) => marketProviderJobRecordSchema.parse(entry));
}

async function getCallCampaignForUser(
  supabase: DatabaseClient,
  userId: string,
  campaignId: string,
) {
  const { data, error } = await supabase
    .from("call_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? (data as CallCampaignRecord) : null;
}

async function getCallCampaignForService(campaignId: string) {
  const supabase = getTrustedSupabase();
  const { data, error } = await supabase
    .from("call_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? (data as CallCampaignRecord) : null;
}

async function getCallsForCampaign(
  supabase: MarketDatabaseClient,
  campaignId: string,
) {
  const { data, error } = await supabase
    .from("calls")
    .select("*")
    .eq("call_campaign_id", campaignId)
    .order("order_index", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((entry) => callRecordSchema.parse(entry));
}

async function getCallForService(callId: string) {
  const supabase = getTrustedSupabase();
  const { data, error } = await supabase
    .from("calls")
    .select("*")
    .eq("id", callId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? callRecordSchema.parse(data) : null;
}

async function getCallByProviderIdentifiersForService(input: {
  providerCallId?: string;
  providerConversationId?: string;
  campaignId?: string;
}) {
  const supabase = getTrustedSupabase();

  if (!input.providerCallId && !input.providerConversationId) {
    return null;
  }

  let query = supabase.from("calls").select("*").limit(1);

  if (input.providerCallId) {
    query = query.eq("provider_call_id", input.providerCallId);
  } else if (input.providerConversationId) {
    query = query.eq("provider_conversation_id", input.providerConversationId);
  }

  if (input.campaignId) {
    query = query.eq("call_campaign_id", input.campaignId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data ? callRecordSchema.parse(data) : null;
}

async function getCallTurns(
  supabase: MarketDatabaseClient,
  campaignId: string,
) {
  const { data, error } = await supabase
    .from("call_turns")
    .select("*, calls!inner(call_campaign_id)")
    .eq("calls.call_campaign_id", campaignId)
    .order("seq", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((entry) => callTurnRecordSchema.parse(entry));
}

async function getCallOutcomes(
  supabase: MarketDatabaseClient,
  campaignId: string,
) {
  const { data, error } = await supabase
    .from("call_outcomes")
    .select("*, calls!inner(call_campaign_id)")
    .eq("calls.call_campaign_id", campaignId);

  if (error) {
    throw error;
  }

  return (data ?? []).map((entry) => callOutcomeRecordSchema.parse(entry));
}

async function replaceCallTurnsForService(
  callId: string,
  userId: string,
  turns: Array<{
    seq: number;
    speaker: "buyer" | "seller" | "system";
    sourceText: string;
    englishText: string;
    offsetMs: number;
  }>,
) {
  const supabase = getTrustedSupabase();
  await supabase.from("call_turns").delete().eq("call_id", callId);

  if (turns.length === 0) {
    return;
  }

  const { error } = await supabase.from("call_turns").insert(
    turns.map((turn) => ({
      user_id: userId,
      call_id: callId,
      seq: turn.seq,
      speaker: turn.speaker,
      source_text: turn.sourceText,
      english_text: turn.englishText,
      offset_ms: turn.offsetMs,
    })),
  );

  if (error) {
    throw error;
  }
}

async function replaceCallOutcomeForService(
  callId: string,
  userId: string,
  outcome:
    | {
        result: "accepted" | "countered" | "refused" | "no_answer";
        availabilityStatus: string;
        quotedPrice?: number;
        discountOffered?: number;
        depositRequired: boolean;
        holdPossible: boolean;
        websiteUrl: string;
        whatsappNumber: string;
        contactName: string;
        contactChannel: string;
        confidence: number;
        summarySourceText: string;
        summaryEnglishText: string;
        structuredDetails: Record<string, unknown>;
      }
    | null,
) {
  const supabase = getTrustedSupabase();
  await supabase.from("call_outcomes").delete().eq("call_id", callId);

  if (!outcome) {
    return;
  }

  const { error } = await supabase
    .from("call_outcomes")
    .insert({
      user_id: userId,
      call_id: callId,
      result: outcome.result,
      availability_status: outcome.availabilityStatus,
      quoted_price: outcome.quotedPrice ?? null,
      discount_offered: outcome.discountOffered ?? null,
      deposit_required: outcome.depositRequired,
      hold_possible: outcome.holdPossible,
      website_url: outcome.websiteUrl || null,
      whatsapp_number: outcome.whatsappNumber || null,
      contact_name: outcome.contactName || null,
      contact_channel: outcome.contactChannel || null,
      confidence: outcome.confidence,
      summary_source_text: outcome.summarySourceText,
      summary_english_text: outcome.summaryEnglishText,
      payload_json: outcome.structuredDetails,
    });

  if (error) {
    throw error;
  }
}

async function getWinnerArtifactByCampaign(
  supabase: MarketDatabaseClient,
  campaignId: string,
) {
  const { data, error } = await supabase
    .from("winner_artifacts")
    .select("*")
    .eq("call_campaign_id", campaignId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? winnerArtifactRecordSchema.parse(data) : null;
}

async function getWinnerArtifactForService(artifactId: string) {
  const supabase = getTrustedSupabase();
  const { data, error } = await supabase
    .from("winner_artifacts")
    .select("*")
    .eq("id", artifactId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? winnerArtifactRecordSchema.parse(data) : null;
}

async function getNotificationRequestsByCampaign(
  supabase: MarketDatabaseClient,
  campaignId: string,
) {
  const { data, error } = await supabase
    .from("notification_requests")
    .select("*")
    .eq("call_campaign_id", campaignId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((entry) => notificationRequestRecordSchema.parse(entry));
}

async function getNotificationRequestsByWinnerArtifact(
  supabase: MarketDatabaseClient,
  winnerArtifactId: string,
) {
  const { data, error } = await supabase
    .from("notification_requests")
    .select("*")
    .eq("winner_artifact_id", winnerArtifactId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((entry) => notificationRequestRecordSchema.parse(entry));
}

async function getNotificationRequestById(
  supabase: MarketDatabaseClient,
  requestId: string,
) {
  const { data, error } = await supabase
    .from("notification_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? notificationRequestRecordSchema.parse(data) : null;
}

async function createNotificationDeliveryRecord(
  supabase: TrustedDatabaseClient,
  input: {
    requestId: string;
    userId: string;
    provider: string;
    status: "sent" | "failed";
    channel: "email";
    externalId?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  await supabase.from("notification_deliveries").insert({
    user_id: input.userId,
    request_id: input.requestId,
    channel: input.channel,
    provider: input.provider,
    status: input.status,
    external_id: input.externalId ?? null,
    payload_json: input.payload ?? {},
  });
}

async function dispatchNotificationRequestNow(
  supabase: TrustedDatabaseClient,
  request: ReturnType<typeof notificationRequestRecordSchema.parse>,
) {
  if (request.status !== "pending" || request.channel !== "email") {
    return request;
  }

  if (request.winner_artifact_id) {
    const artifact = await getWinnerArtifactForService(request.winner_artifact_id);

    if (!artifact) {
      return request;
    }

    try {
      const deliveryId = await sendWinnerReadyEmail({
        to: request.destination,
        artifact: flattenWinnerArtifactRecord(artifact),
      });

      await supabase.from("notification_requests").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        last_error: null,
      }).eq("id", request.id);

      await createNotificationDeliveryRecord(supabase, {
        requestId: request.id,
        userId: request.user_id,
        provider: "resend",
        status: "sent",
        channel: "email",
        externalId: deliveryId,
        payload: { winnerArtifactId: artifact.id },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send email.";
      await supabase.from("notification_requests").update({
        status: "failed",
        last_error: message,
      }).eq("id", request.id);
      await createNotificationDeliveryRecord(supabase, {
        requestId: request.id,
        userId: request.user_id,
        provider: "resend",
        status: "failed",
        channel: "email",
        payload: { winnerArtifactId: request.winner_artifact_id, error: message },
      });
    }

    return getNotificationRequestById(supabase, request.id);
  }

  if (request.call_campaign_id) {
    const campaign = await getCallCampaignForService(request.call_campaign_id);
    if (!campaign || campaign.status !== "completed") {
      return request;
    }

    try {
      const deliveryId = await sendCallsReadyEmail({
        to: request.destination,
        callCampaignId: campaign.id,
        marketRunId: campaign.market_run_id,
      });

      await supabase.from("notification_requests").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        last_error: null,
      }).eq("id", request.id);

      await createNotificationDeliveryRecord(supabase, {
        requestId: request.id,
        userId: request.user_id,
        provider: "resend",
        status: "sent",
        channel: "email",
        externalId: deliveryId,
        payload: { callCampaignId: campaign.id },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send email.";
      await supabase.from("notification_requests").update({
        status: "failed",
        last_error: message,
      }).eq("id", request.id);
      await createNotificationDeliveryRecord(supabase, {
        requestId: request.id,
        userId: request.user_id,
        provider: "resend",
        status: "failed",
        channel: "email",
        payload: { callCampaignId: request.call_campaign_id, error: message },
      });
    }

    return getNotificationRequestById(supabase, request.id);
  }

  if (request.market_run_id) {
    const run = await getMarketRunForService(request.market_run_id);
    if (!run || !["ready", "needs_input"].includes(run.status)) {
      return request;
    }

    try {
      const deliveryId = await sendMarketReadyEmail({
        to: request.destination,
        marketRunId: run.id,
        researchSessionId: run.research_session_id,
      });

      await supabase.from("notification_requests").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        last_error: null,
      }).eq("id", request.id);

      await createNotificationDeliveryRecord(supabase, {
        requestId: request.id,
        userId: request.user_id,
        provider: "resend",
        status: "sent",
        channel: "email",
        externalId: deliveryId,
        payload: { marketRunId: run.id },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send email.";
      await supabase.from("notification_requests").update({
        status: "failed",
        last_error: message,
      }).eq("id", request.id);
      await createNotificationDeliveryRecord(supabase, {
        requestId: request.id,
        userId: request.user_id,
        provider: "resend",
        status: "failed",
        channel: "email",
        payload: { marketRunId: request.market_run_id, error: message },
      });
    }

    return getNotificationRequestById(supabase, request.id);
  }

  return request;
}

async function dispatchMarketNotifications(marketRunId: string) {
  const supabase = getTrustedSupabase();
  const requests = await getMarketNotifications(supabase, marketRunId);

  for (const request of requests.filter((entry) => entry.status === "pending" && entry.channel === "email")) {
    await dispatchNotificationRequestNow(supabase, request);
  }
}

async function dispatchCallCampaignNotifications(campaignId: string) {
  const supabase = getTrustedSupabase();
  const requests = await getNotificationRequestsByCampaign(supabase, campaignId);

  for (const request of requests.filter((entry) => entry.status === "pending" && entry.channel === "email")) {
    await dispatchNotificationRequestNow(supabase, request);
  }
}

async function dispatchWinnerArtifactNotifications(winnerArtifactId: string) {
  const supabase = getTrustedSupabase();
  const requests = await getNotificationRequestsByWinnerArtifact(supabase, winnerArtifactId);

  for (const request of requests.filter((entry) => entry.status === "pending" && entry.channel === "email")) {
    await dispatchNotificationRequestNow(supabase, request);
  }
}

function flattenWinnerArtifactRecord(artifact: WinnerArtifactRecord | null) {
  if (!artifact) {
    throw new Error("Winner artifact not found.");
  }

  return {
    id: artifact.id,
    userId: artifact.user_id,
    researchSessionId: artifact.research_session_id,
    marketRunId: artifact.market_run_id,
    callCampaignId: artifact.call_campaign_id,
    selectedCandidateId: artifact.selected_candidate_id,
    reportSourceText: artifact.report_source_text ?? "",
    reportEnglishText: artifact.report_english_text ?? "",
    ranking: Array.isArray(artifact.ranking_json)
      ? artifact.ranking_json.map((entry) => ({
          candidateId: typeof entry.candidateId === "string" ? entry.candidateId : "",
          rank: typeof entry.rank === "number" ? entry.rank : 1,
          score: typeof entry.score === "number" ? entry.score : 0,
          reason: typeof entry.reason === "string" ? entry.reason : "",
        }))
      : [],
    payload: artifact.payload_json ?? {},
    createdAt: artifact.created_at,
  };
}

export async function maybeDispatchNotificationRequest(requestId: string) {
  const supabase = getTrustedSupabase();
  const request = await getNotificationRequestById(supabase, requestId);

  if (!request) {
    return null;
  }

  return dispatchNotificationRequestNow(supabase, request);
}

function buildRunSummaryFromSnapshot(
  run: MarketRunRecord,
  candidates: MarketCandidateRecord[],
  evidence: MarketCandidateEvidenceRecord[],
  queries: string[],
) {
  const speedProfile = getMarketRunSpeedProfile(run);
  const eligibleCandidates = candidates.filter((candidate) => candidate.eligibility_status === "eligible");
  const highlights = candidates
    .slice(0, 3)
    .map((candidate) => `${candidate.display_name}: ${candidate.summary ?? "Evidence-backed shortlist lead."}`);

  return {
    searchQueries: queries,
    totalCandidates: candidates.length,
    eligibleCandidates: eligibleCandidates.length,
    selectedCandidates: candidates.filter((candidate) => candidate.selected_for_calls).length,
    highlights,
    speedProfile,
  };
}

function getMarketRunSpeedProfile(run: MarketRunRecord) {
  return readMarketSpeedProfile(coerceRecord(run.summary_json).speedProfile);
}

async function getWritableMarketRunForService(marketRunId: string) {
  const run = await getMarketRunForService(marketRunId);
  if (!run || run.status === "superseded") {
    return null;
  }
  return run;
}

function extractFactRecord(page: Record<string, unknown>) {
  const rawJson = page.json;
  const facts = marketCandidateFactSchema.safeParse(rawJson ?? {});

  if (facts.success) {
    return facts.data;
  }

  return null;
}

function extractSourceUrl(page: Record<string, unknown>) {
  const metadata = coerceRecord(page.metadata);
  const sourceUrl = metadata.sourceURL ?? metadata.url ?? page.url;
  return typeof sourceUrl === "string" ? sourceUrl : "";
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function updateMarketRunStatus(
  supabase: TrustedDatabaseClient,
  marketRunId: string,
  input: Partial<{
    status: MarketRunRecord["status"];
    current_stage: MarketRunRecord["current_stage"];
    summary_json: Record<string, unknown>;
    error_text: string | null;
    completed_at: string | null;
  }>,
) {
  const { error } = await supabase
    .from("market_runs")
    .update(input)
    .eq("id", marketRunId);

  if (error) {
    throw error;
  }
}

async function failMarketRun(marketRunId: string, error: unknown) {
  const marketRun = await getWritableMarketRunForService(marketRunId);
  if (!marketRun) {
    return;
  }
  const supabase = getTrustedSupabase();
  const message = error instanceof Error ? error.message : "Market run failed.";

  await updateMarketRunStatus(supabase, marketRun.id, {
    status: "failed",
    current_stage: "failed",
    error_text: message,
    completed_at: new Date().toISOString(),
  });
}

async function advanceMarketRunAfterBatchScrapeCompletion(marketRun: MarketRunRecord) {
  const currentRun = await getWritableMarketRunForService(marketRun.id);
  if (!currentRun) {
    return;
  }
  const supabase = getTrustedSupabase();

  await updateMarketRunStatus(supabase, currentRun.id, {
    status: "scoring",
    current_stage: "scoring",
    error_text: null,
  });
  await scoreMarketRun(currentRun.id);
  const refreshedRun = await getWritableMarketRunForService(currentRun.id);
  if (refreshedRun && refreshedRun.status === "needs_input") {
    await maybeStartFallbackDiscovery(refreshedRun);
  }
}

async function reconcileScrapingMarketRun(marketRun: MarketRunRecord) {
  if (marketRun.status !== "scraping") {
    return;
  }

  const currentRun = await getWritableMarketRunForService(marketRun.id);
  if (!currentRun || currentRun.status !== "scraping") {
    return;
  }

  const supabase = getTrustedSupabase();
  const providerJobs = await getMarketProviderJobs(supabase, currentRun.id);
  const providerJob = getLatestBatchScrapeProviderJob(providerJobs);

  if (!providerJob?.external_job_id) {
    return;
  }

  let status;
  try {
    status = await getBatchScrapeStatus(providerJob.external_job_id);
  } catch (error) {
    console.error("Unable to reconcile Firecrawl batch scrape status.", {
      marketRunId: marketRun.id,
      providerJobId: providerJob.id,
      error,
    });
    return;
  }

  if (Array.isArray(status.data) && status.data.length > 0) {
    await upsertMarketCandidatesFromPages(
      supabase,
      currentRun,
      status.data.map((entry) => coerceRecord(entry)),
    );
  }

  await supabase
    .from("market_provider_jobs")
    .update({
      status: status.status,
      response_json: coerceRecord(status),
      last_event_type: isTerminalBatchScrapeStatus(status.status)
        ? "batch_scrape.reconciled.completed"
        : "batch_scrape.reconciled",
      completed_at: isTerminalBatchScrapeStatus(status.status)
        ? new Date().toISOString()
        : providerJob.completed_at,
    })
    .eq("id", providerJob.id);

  if (status.status === "completed") {
    await advanceMarketRunAfterBatchScrapeCompletion(currentRun);
    return;
  }

  if (status.status === "failed" || status.status === "cancelled") {
    await failMarketRun(currentRun.id, new Error(getFirecrawlStatusFailureMessage(status)));
  }
}

async function upsertMarketCandidatesFromPages(
  supabase: TrustedDatabaseClient,
  marketRun: MarketRunRecord,
  pages: Array<Record<string, unknown>>,
) {
  const existingCandidates = await getMarketCandidates(supabase, marketRun.id);
  const existingEvidence = await getMarketEvidence(supabase, marketRun.id);
  const candidateByKey = new Map(
    existingCandidates.map((candidate) => [
      buildCandidateKey({
        businessName: candidate.display_name,
        websiteUrl: candidate.website_url ?? undefined,
      }),
      candidate,
    ]),
  );
  const evidenceKeys = new Set(
    existingEvidence.map((entry) => `${entry.candidate_id}\u0000${normalized(entry.source_url)}`),
  );

  for (const page of pages) {
    const facts = extractFactRecord(page);
    const sourceUrl = extractSourceUrl(page);

    if (!facts || !sourceUrl) {
      continue;
    }

    const candidateKey = buildCandidateKey({
      businessName: facts.businessName,
      websiteUrl: facts.websiteUrl,
      sourceUrl,
    });
    const existingCandidate = candidateByKey.get(candidateKey);
    let candidateId = existingCandidate?.id;

    if (!candidateId) {
      const { data, error } = await supabase
        .from("market_candidates")
        .insert({
          user_id: marketRun.user_id,
          market_run_id: marketRun.id,
          research_session_id: marketRun.research_session_id,
          rank: 999,
          eligibility_status: "needs_review",
          selected_for_calls: false,
          display_name: facts.businessName,
          canonical_url: facts.websiteUrl || sourceUrl,
          website_url: facts.websiteUrl || sourceUrl,
          phone: facts.phone ?? null,
          whatsapp_number: facts.whatsappNumber ?? null,
          locality: facts.locality ?? null,
          city: facts.city ?? marketRun.brief_snapshot_json.city ?? null,
          address: facts.address ?? null,
          summary: facts.summary,
          score: 0,
          evidence_count: 0,
          score_breakdown_json: null,
          fit_notes_json: [],
          source_language: facts.sourceLanguage,
          payload_json: {},
        })
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      const parsed = marketCandidateRecordSchema.parse(data);
      candidateByKey.set(candidateKey, parsed);
      candidateId = parsed.id;
    } else {
      const { error } = await supabase
        .from("market_candidates")
        .update({
          phone: facts.phone || existingCandidate?.phone || null,
          whatsapp_number: facts.whatsappNumber || existingCandidate?.whatsapp_number || null,
          locality: facts.locality || existingCandidate?.locality || null,
          city: facts.city || existingCandidate?.city || null,
          address: facts.address || existingCandidate?.address || null,
          summary: facts.summary || existingCandidate?.summary || null,
          source_language: facts.sourceLanguage || existingCandidate?.source_language || null,
          website_url: facts.websiteUrl || existingCandidate?.website_url || sourceUrl,
        })
        .eq("id", candidateId);

      if (error) {
        throw error;
      }
    }

    if (!candidateId) {
      continue;
    }

    const evidenceKey = `${candidateId}\u0000${normalized(sourceUrl)}`;
    if (evidenceKeys.has(evidenceKey)) {
      continue;
    }

    const { error: evidenceError } = await supabase
      .from("market_candidate_evidence")
      .insert({
        user_id: marketRun.user_id,
        market_run_id: marketRun.id,
        candidate_id: candidateId,
        source_url: sourceUrl,
        source_domain: extractDomain(sourceUrl),
        source_kind: "web_page",
        is_first_party:
          Boolean(facts.websiteUrl) &&
          compareStrings(extractDomain(facts.websiteUrl ?? ""), extractDomain(sourceUrl)),
        confidence: 0.6,
        source_language: facts.sourceLanguage,
        excerpt: typeof page.markdown === "string" ? page.markdown.slice(0, 800) : "",
        fact_json: facts,
      });

    if (evidenceError) {
      throw evidenceError;
    }

    evidenceKeys.add(evidenceKey);
  }
}

async function scoreMarketRun(marketRunId: string) {
  const supabase = getTrustedSupabase();
  const marketRun = await getWritableMarketRunForService(marketRunId);

  if (!marketRun) {
    throw new Error("Market run not found.");
  }

  const brief = marketRun.brief_snapshot_json as unknown as ResearchBrief;
  const candidates = await getMarketCandidates(supabase, marketRunId);
  const evidence = await getMarketEvidence(supabase, marketRunId);

  const evidenceByCandidate = evidence.reduce<Record<string, MarketCandidateEvidenceRecord[]>>(
    (accumulator, entry) => {
      const bucket = accumulator[entry.candidate_id] ?? [];
      bucket.push(entry);
      accumulator[entry.candidate_id] = bucket;
      return accumulator;
    },
    {},
  );

  const ranked = candidates
    .map((candidate) => {
      const candidateEvidence = (evidenceByCandidate[candidate.id] ?? []).map((entry) => ({
        id: entry.id,
        candidateId: entry.candidate_id,
        sourceUrl: entry.source_url,
        sourceDomain: entry.source_domain ?? "",
        sourceKind: entry.source_kind,
        isFirstParty: entry.is_first_party,
        confidence: entry.confidence,
        sourceLanguage: entry.source_language ?? "English",
        excerpt: entry.excerpt ?? "",
        facts: marketCandidateFactSchema.parse(entry.fact_json ?? {}),
      }));
      const presentable = flattenMarketRunSnapshot({
        run: marketRun,
        candidates: [candidate],
        evidence: evidence.filter((entry) => entry.candidate_id === candidate.id),
        notifications: [],
      }).candidates[0];
      const score = scoreMarketCandidate(brief, presentable, candidateEvidence);
      const fitNotes = summarizeCandidateFit(brief, presentable, candidateEvidence);
      return {
        candidate,
        score,
        fitNotes,
        candidateEvidence,
      };
    })
    .sort((left, right) => right.score.total - left.score.total || left.candidate.rank - right.candidate.rank)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
      eligibility: chooseEligibility(
        {
          ...flattenMarketRunSnapshot({
            run: marketRun,
            candidates: [entry.candidate],
            evidence: evidence.filter((item) => item.candidate_id === entry.candidate.id),
            notifications: [],
          }).candidates[0],
          score: entry.score.total,
        },
        entry.candidateEvidence,
      ),
    }));

  const shortlistOutcome = resolveMarketRunShortlistStatus(
    ranked.map((entry) => entry.eligibility),
  );
  const autoSelectedIds = new Set(
    shortlistOutcome.status === "failed"
      ? []
      : ranked
          .filter((entry) => entry.eligibility !== "ineligible")
          .slice(0, 4)
          .map((entry) => entry.candidate.id),
  );

  for (const entry of ranked) {
    const { error } = await supabase
      .from("market_candidates")
      .update({
        rank: entry.rank,
        eligibility_status: entry.eligibility,
        summary: entry.fitNotes.join(". "),
        score: entry.score.total,
        evidence_count: entry.candidateEvidence.length,
        score_breakdown_json: entry.score,
        fit_notes_json: entry.fitNotes,
        selected_for_calls: autoSelectedIds.has(entry.candidate.id),
      })
      .eq("id", entry.candidate.id);

    if (error) {
      throw error;
    }
  }

  const refreshedCandidates = await getMarketCandidates(supabase, marketRunId);
  const summary = buildRunSummaryFromSnapshot(
    marketRun,
    refreshedCandidates,
    evidence,
    buildMarketSearchQueries(brief, getMarketRunSpeedProfile(marketRun)),
  );
  const nextStatus = shortlistOutcome.status;

  await updateMarketRunStatus(supabase, marketRunId, {
    status: nextStatus,
    current_stage: nextStatus,
    summary_json: summary,
    completed_at: new Date().toISOString(),
    error_text: shortlistOutcome.errorText,
  });

  if (nextStatus !== "failed") {
    await dispatchMarketNotifications(marketRunId);
  }
}

async function maybeStartFallbackDiscovery(marketRun: MarketRunRecord) {
  if (marketRun.status === "superseded" || getMarketRunSpeedProfile(marketRun) === "demo_fast") {
    return;
  }

  const supabase = getTrustedSupabase();
  const existingJobs = await getMarketProviderJobs(supabase, marketRun.id);

  if (existingJobs.some((entry) => entry.operation === "agent_fallback")) {
    return;
  }

  const candidates = await getMarketCandidates(supabase, marketRun.id);
  if (candidates.filter((entry) => entry.eligibility_status === "eligible").length >= 2) {
    return;
  }

  const seedUrls = candidates
    .map((entry) => entry.website_url || entry.canonical_url || "")
    .filter(Boolean)
    .slice(0, 6);

  if (seedUrls.length === 0) {
    return;
  }

  const result = await startFallbackAgentDiscovery(
    marketRun.brief_snapshot_json as unknown as ResearchBrief,
    seedUrls,
    getFirecrawlWebhookUrl(marketRun.id),
  );

  if (!result.id) {
    return;
  }

  await supabase.from("market_provider_jobs").insert({
    user_id: marketRun.user_id,
    market_run_id: marketRun.id,
    provider: "firecrawl",
    operation: "agent_fallback",
    stage: "fallback_discovering",
    external_job_id: result.id,
    status: "queued",
    request_json: { seedUrls },
    response_json: result,
    last_event_type: null,
  });

    await updateMarketRunStatus(supabase, marketRun.id, {
      status: "fallback_discovering",
      current_stage: "fallback_discovering",
    });
}

function collectUrlsDeep(value: unknown, accumulator = new Set<string>()) {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    accumulator.add(value);
    return accumulator;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectUrlsDeep(entry, accumulator);
    }
    return accumulator;
  }

  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      collectUrlsDeep(entry, accumulator);
    }
  }

  return accumulator;
}

async function buildWinnerDecisionData(campaignId: string) {
  const supabase = getTrustedSupabase();
  const campaign = await getCallCampaignForService(campaignId);

  if (!campaign) {
    throw new Error("Call campaign not found.");
  }

  const marketRun = await getMarketRunForService(campaign.market_run_id);
  if (!marketRun) {
    throw new Error("Market run not found.");
  }

  const [calls, outcomes, marketCandidates, marketEvidence] = await Promise.all([
    getCallsForCampaign(supabase, campaignId),
    getCallOutcomes(supabase, campaignId),
    getMarketCandidates(supabase, campaign.market_run_id),
    getMarketEvidence(supabase, campaign.market_run_id),
  ]);

  const candidateSnapshot = flattenMarketRunSnapshot({
    run: marketRun,
    candidates: marketCandidates,
    evidence: marketEvidence,
    notifications: [],
  }).candidates;
  const callSnapshot = flattenCallCampaignSnapshot({
    campaign,
    calls,
    turns: [],
    outcomes,
    winner: null,
    notifications: [],
  }).calls;
  const rankedOutcomes = callSnapshot.flatMap((call) =>
    call.outcome
      ? [
          {
            candidateId: call.candidateId,
            outcome: call.outcome,
          },
        ]
      : [],
  );

  return {
    campaign,
    calls,
    outcomes,
    candidates: candidateSnapshot,
    ranking: buildWinnerRanking(candidateSnapshot, rankedOutcomes),
  };
}

async function ensureWinnerArtifactForSelection(
  campaignId: string,
  selectedCandidateId?: string,
) {
  const supabase = getTrustedSupabase();
  const existing = await getWinnerArtifactByCampaign(supabase, campaignId);
  const decision = await buildWinnerDecisionData(campaignId);
  const selected =
    (selectedCandidateId
      ? decision.ranking.find((entry) => entry.candidateId === selectedCandidateId)
      : undefined) ?? decision.ranking[0];

  if (!selected) {
    throw new Error("Unable to create winner artifact without ranked candidates.");
  }

  const selectedCall = decision.calls.find((call) => call.candidate_id === selected.candidateId);
  const selectedOutcome = decision.outcomes.find((outcome) => outcome.call_id === selectedCall?.id);
  const selectedCandidate = decision.candidates.find((candidate) => candidate.id === selected.candidateId);
  const reportSourceText =
    selectedOutcome?.summary_source_text ??
    `${selectedCandidate?.displayName ?? "The selected candidate"} is the strongest live match from outreach.`;
  const reportEnglishText = selectedOutcome?.summary_english_text ?? reportSourceText;
  const payload = {
    selected,
    ranking: decision.ranking,
  };

  if (existing) {
    const { data, error } = await supabase
      .from("winner_artifacts")
      .update({
        selected_candidate_id: selected.candidateId,
        report_source_text: reportSourceText,
        report_english_text: reportEnglishText,
        ranking_json: decision.ranking,
        payload_json: payload,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return winnerArtifactRecordSchema.parse(data);
  }

  const { data, error } = await supabase
    .from("winner_artifacts")
    .insert({
      user_id: decision.campaign.user_id,
      research_session_id: decision.campaign.research_session_id,
      market_run_id: decision.campaign.market_run_id,
      call_campaign_id: decision.campaign.id,
      selected_candidate_id: selected.candidateId,
      report_source_text: reportSourceText,
      report_english_text: reportEnglishText,
      ranking_json: decision.ranking,
      payload_json: payload,
    })
    .select("*")
    .single();

  if (error) {
    if ("code" in error && error.code === "23505") {
      const duplicate = await getWinnerArtifactByCampaign(supabase, campaignId);
      if (duplicate) {
        return duplicate;
      }
    }
    throw error;
  }

  return winnerArtifactRecordSchema.parse(data);
}

export async function getLatestMarketRunForUser(
  userId: string,
  researchSessionId?: string,
) {
  const supabase = await createSupabaseClient();
  let query = supabase
    .from("market_runs")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "superseded")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (researchSessionId) {
    query = query.eq("research_session_id", researchSessionId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data ? marketRunRecordSchema.parse(data) : null;
}

export async function getCurrentMarketRunForUser(
  userId: string,
  researchSessionId: string,
) {
  const flow = await getWorkspaceFlowForUser(userId, researchSessionId);

  if (flow?.marketRunId) {
    const supabase = await createSupabaseClient();
    const run = await getOwnedMarketRun(supabase, userId, flow.marketRunId);
    if (run && run.status !== "superseded") {
      return run;
    }
  }

  return getLatestMarketRunForUser(userId, researchSessionId);
}

async function getMarketRunsForResearchSession(
  supabase: DatabaseClient,
  userId: string,
  researchSessionId: string,
) {
  const { data, error } = await supabase
    .from("market_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("research_session_id", researchSessionId)
    .order(marketRunChronologyColumn, { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((entry) => marketRunRecordSchema.parse(entry));
}

export async function getMarketRunSnapshotForUser(
  userId: string,
  runId: string,
) {
  const supabase = await createSupabaseClient();
  const initialRun = await getOwnedMarketRun(supabase, userId, runId);

  if (!initialRun) {
    return null;
  }

  if (initialRun.status === "scraping") {
    await reconcileScrapingMarketRun(initialRun);
  }

  const run = (await getOwnedMarketRun(supabase, userId, runId)) ?? initialRun;

  const [candidates, evidence, notifications] = await Promise.all([
    getMarketCandidates(supabase, run.id),
    getMarketEvidence(supabase, run.id),
    getMarketNotifications(supabase, run.id),
  ]);

  return flattenMarketRunSnapshot({
    run,
    candidates,
    evidence,
    notifications,
  });
}

export async function getMarketRunSnapshotForRecording(runId: string) {
  const supabase = getTrustedSupabase();
  const initialRun = await getMarketRunForService(runId);

  if (!initialRun) {
    return null;
  }

  if (initialRun.status === "scraping") {
    await reconcileScrapingMarketRun(initialRun);
  }

  const run = (await getMarketRunForService(runId)) ?? initialRun;
  const [candidates, evidence, notifications] = await Promise.all([
    getMarketCandidates(supabase, run.id),
    getMarketEvidence(supabase, run.id),
    getMarketNotifications(supabase, run.id),
  ]);

  return flattenMarketRunSnapshot({
    run,
    candidates,
    evidence,
    notifications,
  });
}

export async function getCurrentMarketRunSnapshotForUser(
  userId: string,
  researchSessionId: string,
) {
  const run = await getCurrentMarketRunForUser(userId, researchSessionId);
  if (!run) {
    return null;
  }

  return getMarketRunSnapshotForUser(userId, run.id);
}

export async function createOrReuseMarketRunForUser(
  userId: string,
  input: CreateMarketRunRequest,
) {
  const supabase = await createSupabaseClient();
  const parsed = createMarketRunRequestSchema.parse(input);
  const researchSnapshot = await getResearchSnapshotForUser(userId, parsed.researchSessionId);

  if (!researchSnapshot) {
    throw new Error("Research session not found.");
  }

  if (researchSnapshot.session.status !== "confirmed") {
    throw new Error("Research brief must be confirmed before market research starts.");
  }

  const priorRuns = await getMarketRunsForResearchSession(supabase, userId, parsed.researchSessionId);
  const refinementAlreadyUsed = priorRuns.some(
    (entry) => Array.isArray(entry.refinements_json) && entry.refinements_json.length > 0,
  );
  const active = await getCurrentMarketRunForUser(userId, parsed.researchSessionId);
  const sourceRun = parsed.sourceRunId
    ? await getOwnedMarketRun(supabase, userId, parsed.sourceRunId)
    : null;
  const speedProfileSource =
    sourceRun ??
    active ??
    [...priorRuns].reverse().find((entry) => entry.status !== "superseded") ??
    null;
  const speedProfile =
    parsed.speedProfile ?? (speedProfileSource ? getMarketRunSpeedProfile(speedProfileSource) : "demo_fast");

  if (parsed.sourceRunId && !sourceRun) {
    throw new Error("Market run not found.");
  }

  if (
    active &&
    !parsed.refinement &&
    !parsed.forceFresh &&
    ["queued", "discovering", "scraping", "fallback_discovering", "scoring", "ready", "needs_input"].includes(active.status)
  ) {
    const snapshot = await getMarketRunSnapshotForUser(userId, active.id);
    if (!snapshot) {
      throw new Error("Market run not found.");
    }
    await updateWorkspaceFlowForResearchSession(parsed.researchSessionId, {
      marketRunId: active.id,
      activeStage: "market",
    });
    return snapshot;
  }

  if (parsed.refinement && refinementAlreadyUsed) {
    throw new Error(marketRefinementAlreadyUsedErrorMessage);
  }

  const retrySourceRun = parsed.forceFresh ? sourceRun ?? active : null;
  const refinementSourceRun = parsed.refinement ? sourceRun ?? active : null;
  const supersededRunIds = [...new Set([retrySourceRun?.id, refinementSourceRun?.id, active?.id].filter(Boolean))];
  if (supersededRunIds.length > 0 && (parsed.refinement || parsed.forceFresh)) {
    await supabase
      .from("market_runs")
      .update({
        status: "superseded",
        superseded_at: new Date().toISOString(),
      })
      .in("id", supersededRunIds)
      .eq("user_id", userId);
  }

  const refinementBaseBrief =
    refinementSourceRun?.brief_snapshot_json as unknown as ResearchBrief | undefined;
  const briefSnapshot = retrySourceRun
    ? (retrySourceRun.brief_snapshot_json as unknown as ResearchBrief)
    : parsed.refinement
      ? buildMarketRunBriefSnapshot(refinementBaseBrief ?? researchSnapshot.brief, parsed.refinement)
      : buildMarketRunBriefSnapshot(researchSnapshot.brief, parsed.refinement);
  const refinements = retrySourceRun
    ? Array.isArray(retrySourceRun.refinements_json)
      ? retrySourceRun.refinements_json
      : []
    : parsed.refinement
      ? [marketRefinementSchema.parse(parsed.refinement)]
      : [];
  const refinementSeedRun = sourceRun ?? active;
  const refinementRunId = parsed.refinement
    ? seededUuid(`market-refinement:${userId}:${parsed.researchSessionId}:${refinementSeedRun?.id ?? "root"}`)
    : null;
  const lineageRun = retrySourceRun ?? refinementSourceRun ?? active;
  const supersededLineageRun = active ?? retrySourceRun ?? refinementSourceRun ?? null;
  const { data, error } = await supabase
    .from("market_runs")
    .insert({
      ...(refinementRunId ? { id: refinementRunId } : {}),
      user_id: userId,
      research_session_id: parsed.researchSessionId,
      parent_run_id: lineageRun?.id ?? null,
      supersedes_run_id: supersededLineageRun?.id ?? null,
      status: "queued",
      current_stage: "idle",
      brief_snapshot_json: briefSnapshot,
      refinements_json: refinements,
      summary_json: {
        searchQueries: [],
        totalCandidates: 0,
        eligibleCandidates: 0,
        selectedCandidates: 0,
        highlights: [],
        speedProfile,
      },
      error_text: null,
    })
    .select("*")
    .single();

  if (error) {
    if ("code" in error && error.code === "23505" && refinementRunId) {
      const duplicate = await getOwnedMarketRun(supabase, userId, refinementRunId);
      if (duplicate) {
        const [candidates, evidence, notifications] = await Promise.all([
          getMarketCandidates(supabase, duplicate.id),
          getMarketEvidence(supabase, duplicate.id),
          getMarketNotifications(supabase, duplicate.id),
        ]);

        return flattenMarketRunSnapshot({
          run: duplicate,
          candidates,
          evidence,
          notifications,
        });
      }
    }
    throw error;
  }

  const run = marketRunRecordSchema.parse(data);
  await updateWorkspaceFlowForResearchSession(parsed.researchSessionId, {
    marketRunId: run.id,
    callCampaignId: null,
    winnerArtifactId: null,
    activeStage: "market",
  });
  return flattenMarketRunSnapshot({
    run,
    candidates: [],
    evidence: [],
    notifications: [],
  });
}

export async function kickoffMarketRun(marketRunId: string) {
  try {
    const supabase = getTrustedSupabase();
    const marketRun = await getWritableMarketRunForService(marketRunId);

    if (!marketRun) {
      return;
    }

    if (marketRun.status !== "queued") {
      return;
    }

    const brief = marketRun.brief_snapshot_json as unknown as ResearchBrief;
    const speedProfile = getMarketRunSpeedProfile(marketRun);
    await updateMarketRunStatus(supabase, marketRunId, {
      status: "discovering",
      current_stage: "discovering",
      error_text: null,
      completed_at: null,
    });

    const searchPayload = await runFirecrawlSearches(brief, speedProfile);
    const searchQueries = searchPayload.queries;
    const searchResults = searchPayload.results.flatMap((entry) => entry.results);
    const dedupedSearchUrls = Array.from(
      new Set(searchResults.map((entry) => entry.url).filter(Boolean)),
    );
    const contactableSearchUrls = dedupedSearchUrls.filter((url) => !shouldMapSearchResult(url));
    const shouldMap =
      speedProfile === "balanced" || contactableSearchUrls.length < 4;
    const mappedUrls = shouldMap
      ? (
          await Promise.all(
            searchPayload.results
              .flatMap((entry) => entry.results)
              .filter((entry, index, array) => array.findIndex((candidate) => candidate.url === entry.url) === index)
              .filter((entry) => entry.url)
              .filter((entry) => shouldMapSearchResult(entry.url))
              .slice(0, speedProfile === "demo_fast" ? 2 : 4)
              .map(async (entry) =>
                mapDomainUrls(brief, entry.url, `${brief.category} contact pricing phone whatsapp`, speedProfile),
              ),
          )
        )
          .flat()
          .map((entry) => entry.url)
          .filter(Boolean)
      : [];
    const scrapeUrls = Array.from(
      new Set([
        ...searchResults.map((entry) => entry.url),
        ...mappedUrls,
      ]),
    ).slice(0, speedProfile === "demo_fast" ? 6 : 12);

    await supabase.from("market_provider_jobs").insert({
      user_id: marketRun.user_id,
      market_run_id: marketRun.id,
      provider: "firecrawl",
      operation: "search_map",
      stage: "discovering",
      external_job_id: null,
      status: "completed",
      request_json: { queries: searchQueries },
      response_json: { searchResultsCount: searchResults.length, scrapeUrls },
      last_event_type: "discovering.completed",
    });

    if (scrapeUrls.length === 0) {
      await updateMarketRunStatus(supabase, marketRunId, {
        status: "failed",
        current_stage: "failed",
        error_text: "No candidate URLs were discovered for this market run.",
        completed_at: new Date().toISOString(),
      });
      return;
    }

    await updateMarketRunStatus(supabase, marketRunId, {
      status: "scraping",
      current_stage: "scraping",
      summary_json: {
        searchQueries,
        totalCandidates: 0,
        eligibleCandidates: 0,
        selectedCandidates: 0,
        highlights: [],
        speedProfile,
      },
    });

    const batchJob = await startCandidateBatchScrape(
      brief,
      scrapeUrls,
      getFirecrawlWebhookUrl(marketRun.id),
      speedProfile,
    );

    await supabase.from("market_provider_jobs").insert({
      user_id: marketRun.user_id,
      market_run_id: marketRun.id,
      provider: "firecrawl",
      operation: "batch_scrape",
      stage: "scraping",
      external_job_id: batchJob.id,
      status: "queued",
      request_json: { urls: scrapeUrls, queries: searchQueries },
      response_json: batchJob,
      last_event_type: "batch_scrape.queued",
    });
  } catch (error) {
    await failMarketRun(marketRunId, error);
  }
}

function verifyFirecrawlSignature(rawBody: string, signatureHeader: string | null) {
  const secret = process.env.FIRECRAWL_WEBHOOK_SECRET;

  if (!secret || !signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function handleBatchScrapeWebhook(
  marketRun: MarketRunRecord,
  providerJob: MarketProviderJobRecord | null,
  payload: Record<string, unknown>,
) {
  const supabase = getTrustedSupabase();
  const type = typeof payload.type === "string" ? payload.type : "batch_scrape.unknown";
  const pages =
    Array.isArray(payload.data) ? (payload.data as Array<Record<string, unknown>>) : [];

  if (providerJob) {
    await supabase
      .from("market_provider_jobs")
      .update({
        status: typeof payload.status === "string" ? payload.status : "processing",
        response_json: payload,
        last_event_type: type,
        completed_at:
          type.includes("completed") || payload.status === "completed"
            ? new Date().toISOString()
            : null,
      })
      .eq("id", providerJob.id);
  }

  const currentRun = await getWritableMarketRunForService(marketRun.id);
  if (!currentRun) {
    return;
  }

  if (pages.length > 0) {
    await upsertMarketCandidatesFromPages(supabase, currentRun, pages);
  }

  if (type.includes("completed") || payload.status === "completed") {
    const externalJobId = providerJob?.external_job_id;
    if (externalJobId) {
      const status = await getBatchScrapeStatus(externalJobId);
      if (Array.isArray(status.data) && status.data.length > 0) {
        await upsertMarketCandidatesFromPages(
          supabase,
          currentRun,
          status.data.map((entry) => coerceRecord(entry)),
        );
      }
    }

    await advanceMarketRunAfterBatchScrapeCompletion(currentRun);
  }
}

async function handleAgentFallbackWebhook(
  marketRun: MarketRunRecord,
  providerJob: MarketProviderJobRecord | null,
  payload: Record<string, unknown>,
) {
  const supabase = getTrustedSupabase();
  const type = typeof payload.type === "string" ? payload.type : "agent.unknown";

  if (providerJob) {
    await supabase
      .from("market_provider_jobs")
      .update({
        status: typeof payload.status === "string" ? payload.status : "processing",
        response_json: payload,
        last_event_type: type,
        completed_at:
          type.includes("completed") || payload.status === "completed"
            ? new Date().toISOString()
            : null,
      })
      .eq("id", providerJob.id);
  }

  if (!(type.includes("completed") || payload.status === "completed")) {
    return;
  }

  const currentRun = await getWritableMarketRunForService(marketRun.id);
  if (!currentRun) {
    return;
  }

  const urls = Array.from(collectUrlsDeep(payload)).slice(0, 8);
  if (urls.length === 0) {
    await updateMarketRunStatus(supabase, currentRun.id, {
      status: "needs_input",
      current_stage: "needs_input",
      completed_at: new Date().toISOString(),
    });
    return;
  }

  const batchJob = await startCandidateBatchScrape(
    currentRun.brief_snapshot_json as unknown as ResearchBrief,
    urls,
    getFirecrawlWebhookUrl(currentRun.id),
    getMarketRunSpeedProfile(currentRun),
  );

  await supabase.from("market_provider_jobs").insert({
    user_id: currentRun.user_id,
    market_run_id: currentRun.id,
    provider: "firecrawl",
    operation: "batch_scrape_fallback",
    stage: "scraping",
    external_job_id: batchJob.id,
    status: "queued",
    request_json: { urls },
    response_json: batchJob,
    last_event_type: "batch_scrape_fallback.queued",
  });

  await updateMarketRunStatus(supabase, currentRun.id, {
    status: "scraping",
    current_stage: "scraping",
  });
}

export async function processFirecrawlWebhook(input: {
  rawBody: string;
  signatureHeader: string | null;
  marketRunId?: string | null;
}) {
  if (!verifyFirecrawlSignature(input.rawBody, input.signatureHeader)) {
    throw new Error("Invalid Firecrawl signature.");
  }

  const payload = JSON.parse(input.rawBody) as Record<string, unknown>;
  const eventType = typeof payload.type === "string" ? payload.type : "";
  const externalJobId =
    typeof payload.id === "string"
      ? payload.id
      : typeof payload.jobId === "string"
        ? payload.jobId
        : typeof payload.job_id === "string"
          ? payload.job_id
          : null;
  const supabase = getTrustedSupabase();
  const marketRun = input.marketRunId ? await getMarketRunForService(input.marketRunId) : null;
  let providerJob: MarketProviderJobRecord | null = null;

  if (externalJobId) {
    const { data, error } = await supabase
      .from("market_provider_jobs")
      .select("*")
      .eq("external_job_id", externalJobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    providerJob = data ? marketProviderJobRecordSchema.parse(data) : null;
  }

  const effectiveRun = marketRun ?? (providerJob ? await getMarketRunForService(providerJob.market_run_id) : null);
  if (!effectiveRun) {
    throw new Error("Market run not found.");
  }

  if (eventType.includes("agent")) {
    await handleAgentFallbackWebhook(effectiveRun, providerJob, payload);
  } else {
    await handleBatchScrapeWebhook(effectiveRun, providerJob, payload);
  }

  return { ok: true };
}

export async function saveSelectedCallCandidatesForUser(
  userId: string,
  marketRunId: string,
  input: { candidateIds: string[] },
) {
  const supabase = await createSupabaseClient();
  const parsed = selectMarketCandidatesSchema.parse(input);
  const run = await getOwnedMarketRun(supabase, userId, marketRunId);

  if (!run) {
    throw new Error("Market run not found.");
  }

  if (!["ready", "needs_input"].includes(run.status)) {
    throw new Error("Market run is not ready for candidate selection.");
  }

  const uniqueCandidateIds = Array.from(new Set(parsed.candidateIds));
  if (uniqueCandidateIds.length === 0) {
    throw new Error("Select at least one establishment for outreach.");
  }

  const candidates = await getMarketCandidates(supabase, marketRunId);
  const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  for (const candidateId of uniqueCandidateIds) {
    const candidate = candidateMap.get(candidateId);
    if (!candidate) {
      throw new Error("One or more selected candidates do not belong to this market run.");
    }

    if (candidate.eligibility_status === "ineligible") {
      throw new Error("Ineligible candidates cannot be selected for outreach.");
    }
  }

  await supabase
    .from("market_candidates")
    .update({ selected_for_calls: false })
    .eq("market_run_id", marketRunId);

  const { error } = await supabase
    .from("market_candidates")
    .update({ selected_for_calls: true })
    .in("id", uniqueCandidateIds);

  if (error) {
    throw error;
  }

  const refreshedCandidates = await getMarketCandidates(supabase, marketRunId);
  const summary = {
    ...(coerceRecord(run.summary_json) as Record<string, unknown>),
    selectedCandidates: refreshedCandidates.filter((entry) => entry.selected_for_calls).length,
  };

  await updateMarketRunStatus(getTrustedSupabase(), marketRunId, {
    summary_json: summary,
  });

  const snapshot = await getMarketRunSnapshotForUser(userId, marketRunId);
  if (!snapshot) {
    throw new Error("Market run not found.");
  }

  return snapshot;
}

async function buildPreparedCallEntries(
  supabase: MarketDatabaseClient,
  marketRun: MarketRunRecord,
  campaign: CallCampaignRecord,
) {
  const [marketCandidates, marketEvidence] = await Promise.all([
    getMarketCandidates(supabase, marketRun.id),
    getMarketEvidence(supabase, marketRun.id),
  ]);
  const snapshot = flattenMarketRunSnapshot({
    run: marketRun,
    candidates: marketCandidates,
    evidence: marketEvidence,
    notifications: [],
  });
  const selectedCandidates = snapshot.candidates
    .filter((candidate) => candidate.selectedForCalls && candidate.eligibility !== "ineligible")
    .sort((left, right) => left.rank - right.rank || right.score - left.score)
    .slice(0, 4);

  if (selectedCandidates.length === 0) {
    throw new Error("Select at least one establishment before starting calls.");
  }

  const brief = marketRun.brief_snapshot_json as unknown as ResearchBrief;
  const callingPolicy = normalizeCallingPolicy(
    brief,
    coerceRecord(campaign.calling_policy_json) as Partial<CallingPolicy>,
  );

  return selectedCandidates.map((candidate, index) => {
    const evidence = snapshot.evidence[candidate.id] ?? [];
    const callPlan = buildCallingPlan(brief, candidate, evidence, callingPolicy);
    const sellerScenario = buildSellerScenario(brief, candidate, evidence, campaign.id, callingPolicy);

    return {
      candidate,
      callPlan,
      sellerScenario,
      orderIndex: index,
      callingPolicy,
    };
  });
}

async function ensurePreparedCallsForCampaign(
  supabase: TrustedDatabaseClient,
  campaign: CallCampaignRecord,
  marketRun: MarketRunRecord,
) {
  const existingCalls = await getCallsForCampaign(supabase, campaign.id);
  if (existingCalls.length > 0) {
    return existingCalls;
  }

  const entries = await buildPreparedCallEntries(supabase, marketRun, campaign);

  const { data, error } = await supabase
    .from("calls")
    .insert(
      entries.map((entry) => ({
        user_id: campaign.user_id,
        call_campaign_id: campaign.id,
        market_run_id: campaign.market_run_id,
        candidate_id: entry.candidate.id,
        order_index: entry.orderIndex,
        status: "queued",
        target_duration_ms: entry.sellerScenario.seededDurationMs,
        actual_duration_ms: null,
        result: null,
        provider_call_id: null,
        provider_conversation_id: null,
        provider_state_json: {},
        call_plan_json: entry.callPlan,
        seller_scenario_json: entry.sellerScenario,
        artifact_json: null,
        completed_at: null,
      })),
    )
    .select("*");

  if (error) {
    throw error;
  }

  return (data ?? []).map((entry) => callRecordSchema.parse(entry));
}

export async function getLatestCallCampaignForUser(
  userId: string,
  marketRunId?: string,
) {
  const supabase = await createSupabaseClient();
  let query = supabase
    .from("call_campaigns")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (marketRunId) {
    query = query.eq("market_run_id", marketRunId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data ? (data as CallCampaignRecord) : null;
}

export async function getCurrentCallCampaignForUser(
  userId: string,
  marketRunId: string,
) {
  const supabase = await createSupabaseClient();
  const marketRun = await getOwnedMarketRun(supabase, userId, marketRunId);

  if (!marketRun) {
    return null;
  }

  const flow = await getWorkspaceFlowForUser(userId, marketRun.research_session_id);

  if (flow?.callCampaignId) {
    const campaign = await getCallCampaignForUser(supabase, userId, flow.callCampaignId);
    if (campaign && campaign.market_run_id === marketRunId) {
      return campaign;
    }
  }

  return getLatestCallCampaignForUser(userId, marketRunId);
}

export async function getCallCampaignSnapshotForUser(
  userId: string,
  campaignId: string,
) {
  const supabase = await createSupabaseClient();
  let campaign = await getCallCampaignForUser(supabase, userId, campaignId);

  if (!campaign) {
    return null;
  }

  await finalizeCallCampaignIfReady(campaign.id);
  let calls = await getCallsForCampaign(supabase, campaign.id);

  if (calls.length === 0 && ["queued", "preparing", "active"].includes(campaign.status)) {
    const trustedSupabase = getTrustedSupabase();
    const serviceRun = await getMarketRunForService(campaign.market_run_id);
    const serviceCampaign = await getCallCampaignForService(campaign.id);

    if (serviceRun && serviceCampaign) {
      await ensurePreparedCallsForCampaign(trustedSupabase, serviceCampaign, serviceRun);
      calls = await getCallsForCampaign(supabase, campaign.id);
      campaign = (await getCallCampaignForUser(supabase, userId, campaignId)) ?? campaign;
    }
  }

  const [turns, outcomes, winner, notifications] = await Promise.all([
    getCallTurns(supabase, campaign.id),
    getCallOutcomes(supabase, campaign.id),
    getWinnerArtifactByCampaign(supabase, campaign.id),
    getNotificationRequestsByCampaign(supabase, campaign.id),
  ]);

  return flattenCallCampaignSnapshot({
    campaign,
    calls,
    turns,
    outcomes,
    winner,
    notifications,
  });
}

export async function getCallCampaignSnapshotForRecording(
  campaignId: string,
) {
  const supabase = getTrustedSupabase();
  let campaign = await getCallCampaignForService(campaignId);

  if (!campaign) {
    return null;
  }

  await finalizeCallCampaignIfReady(campaign.id);
  let calls = await getCallsForCampaign(supabase, campaign.id);

  if (calls.length === 0 && ["queued", "preparing", "active"].includes(campaign.status)) {
    const serviceRun = await getMarketRunForService(campaign.market_run_id);

    if (serviceRun) {
      await ensurePreparedCallsForCampaign(supabase, campaign, serviceRun);
      calls = await getCallsForCampaign(supabase, campaign.id);
      campaign = (await getCallCampaignForService(campaignId)) ?? campaign;
    }
  }

  const [turns, outcomes, winner, notifications] = await Promise.all([
    getCallTurns(supabase, campaign.id),
    getCallOutcomes(supabase, campaign.id),
    getWinnerArtifactByCampaign(supabase, campaign.id),
    getNotificationRequestsByCampaign(supabase, campaign.id),
  ]);

  return flattenCallCampaignSnapshot({
    campaign,
    calls,
    turns,
    outcomes,
    winner,
    notifications,
  });
}

export async function getCurrentCallCampaignSnapshotForRecording(
  marketRunId: string,
) {
  const supabase = getTrustedSupabase();
  const { data, error } = await supabase
    .from("call_campaigns")
    .select("*")
    .eq("market_run_id", marketRunId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const campaign = data ? callCampaignRecordSchema.parse(data) : null;

  if (!campaign) {
    return null;
  }

  return getCallCampaignSnapshotForRecording(campaign.id);
}

export async function createOrReuseCallCampaignForUser(
  userId: string,
  input: CreateCallCampaignRequest,
) {
  assertLiveCallingReady();
  const supabase = await createSupabaseClient();
  const parsed = createCallCampaignRequestSchema.parse(input);
  const marketRun = await getOwnedMarketRun(supabase, userId, parsed.marketRunId);

  if (!marketRun) {
    throw new Error("Market run not found.");
  }

  if (marketRun.status !== "ready" && marketRun.status !== "needs_input") {
    throw new Error("Market run is not ready for calls.");
  }

  const selectedCandidates = (await getMarketCandidates(supabase, marketRun.id)).filter(
    (candidate) => candidate.selected_for_calls && candidate.eligibility_status !== "ineligible",
  );

  if (selectedCandidates.length === 0) {
    throw new Error("Select at least one establishment before starting calls.");
  }

  if (selectedCandidates.length > 4) {
    throw new Error("Select no more than four establishments for outreach.");
  }

  const sourceCampaign = parsed.sourceCampaignId
    ? await getCallCampaignForUser(supabase, userId, parsed.sourceCampaignId)
    : null;

  if (parsed.sourceCampaignId && !sourceCampaign) {
    throw new Error("Call campaign not found.");
  }

  if (sourceCampaign && sourceCampaign.market_run_id !== marketRun.id) {
    throw new Error("Call campaign does not belong to this market run.");
  }

  const brief = marketRun.brief_snapshot_json as unknown as ResearchBrief;
  const callingPolicy = normalizeCallingPolicy(
    brief,
    parsed.callingPolicy ??
      (sourceCampaign ? (coerceRecord(sourceCampaign.calling_policy_json) as Partial<CallingPolicy>) : undefined),
  );
  const selectionFingerprint = buildCallSelectionFingerprint({
    selectedCandidateIds: selectedCandidates.map((candidate) => candidate.id),
    transport: LIVE_CALL_TRANSPORT,
    callingPolicy,
  });
  const normalizedCallingPolicy = normalizeCallingPolicy(brief, {
    ...callingPolicy,
    selectionFingerprint,
  });
  const existing = await getCurrentCallCampaignForUser(userId, parsed.marketRunId);
  const existingFingerprint = existing
    ? normalizeCallingPolicy(
        brief,
        coerceRecord(existing.calling_policy_json) as Partial<CallingPolicy>,
      ).selectionFingerprint
    : "";

  if (
    existing &&
    !parsed.forceFresh &&
    existingFingerprint === selectionFingerprint &&
    ["queued", "preparing", "active", "completed"].includes(existing.status)
  ) {
    const snapshot = await getCallCampaignSnapshotForUser(userId, existing.id);
    if (!snapshot) {
      throw new Error("Call campaign not found.");
    }
    await updateWorkspaceFlowForResearchSession(marketRun.research_session_id, {
      marketRunId: marketRun.id,
      callCampaignId: existing.id,
      winnerArtifactId: null,
      activeStage: "calls",
    });
    return snapshot;
  }

  const supersededCampaign = parsed.forceFresh ? sourceCampaign ?? existing : null;
  if (supersededCampaign && ["queued", "preparing", "active"].includes(supersededCampaign.status)) {
    await supabase
      .from("call_campaigns")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error_text: "Superseded by a newer outreach attempt.",
      })
      .eq("id", supersededCampaign.id)
      .eq("user_id", userId);
  }

  const seed = seededHex(`${marketRun.id}:${selectionFingerprint}`).slice(0, 24);
  const { data, error } = await supabase
    .from("call_campaigns")
    .insert({
      user_id: userId,
      research_session_id: marketRun.research_session_id,
      market_run_id: marketRun.id,
      transport: LIVE_CALL_TRANSPORT,
      status: "queued",
      display_language: "english",
      source_language: normalizedCallingPolicy.preferredLanguage,
      seed,
      calling_policy_json: normalizedCallingPolicy,
      selection_fingerprint: selectionFingerprint,
      provider_state_json: {
        provider: LIVE_CALL_TRANSPORT,
        initiated_calls: 0,
      },
      error_text: null,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const campaign = callCampaignRecordSchema.parse(data);
  const trustedSupabase = getTrustedSupabase();
  const ownedRun = await getMarketRunForService(marketRun.id);

  if (!ownedRun) {
    throw new Error("Market run not found.");
  }

  const calls = await ensurePreparedCallsForCampaign(trustedSupabase, campaign, ownedRun);
  const notifications = await getNotificationRequestsByCampaign(supabase, campaign.id);
  await updateWorkspaceFlowForResearchSession(marketRun.research_session_id, {
    marketRunId: marketRun.id,
    callCampaignId: campaign.id,
    winnerArtifactId: null,
    activeStage: "calls",
  });

  return flattenCallCampaignSnapshot({
    campaign,
    calls,
    turns: [],
    outcomes: [],
    winner: null,
    notifications,
  });
}

async function kickoffSyntheticCallCampaign(
  supabase: TrustedDatabaseClient,
  campaign: CallCampaignRecord,
  marketRun: MarketRunRecord,
) {
  const [marketCandidates, marketEvidence] = await Promise.all([
    getMarketCandidates(supabase, marketRun.id),
    getMarketEvidence(supabase, marketRun.id),
  ]);
  const marketSnapshot = flattenMarketRunSnapshot({
    run: marketRun,
    candidates: marketCandidates,
    evidence: marketEvidence,
    notifications: [],
  });
  const evidenceByCandidate = marketSnapshot.evidence;
  const brief = marketRun.brief_snapshot_json as unknown as ResearchBrief;
  const callingPolicy = normalizeCallingPolicy(
    brief,
    coerceRecord(campaign.calling_policy_json) as Partial<CallingPolicy>,
  );
  const preparedCalls = await ensurePreparedCallsForCampaign(supabase, campaign, marketRun);

  await supabase
    .from("call_campaigns")
    .update({
      status: "preparing",
      error_text: null,
      completed_at: null,
    })
    .eq("id", campaign.id);

  const generationResults = await Promise.allSettled(
    preparedCalls.map(async (call) => {
      const candidate = marketSnapshot.candidates.find((entry) => entry.id === call.candidate_id);
      if (!candidate) {
        throw new Error("Selected candidate not found for call generation.");
      }

      const evidence = evidenceByCandidate[candidate.id] ?? [];
      const generated = await generateSimulatedCallArtifact({
        brief,
        candidate,
        evidence,
        callCampaignId: campaign.id,
        callingPolicy,
        orderIndex: call.order_index,
      });

      await replaceCallTurnsForService(call.id, campaign.user_id, generated.artifact.turns);
      await replaceCallOutcomeForService(call.id, campaign.user_id, generated.artifact.outcome);

      const callStatus = generated.artifact.outcome.result === "no_answer" ? "no_answer" : "completed";
      const completedAt = new Date().toISOString();
      const { error: callUpdateError } = await supabase
        .from("calls")
        .update({
          status: callStatus,
          target_duration_ms: generated.artifact.targetDurationMs,
          actual_duration_ms: generated.artifact.targetDurationMs,
          result: generated.artifact.outcome.result,
          call_plan_json: generated.callPlan,
          seller_scenario_json: generated.sellerScenario,
          artifact_json: generated.artifact,
          completed_at: completedAt,
        })
        .eq("id", call.id);

      if (callUpdateError) {
        throw callUpdateError;
      }

      return {
        callId: call.id,
        targetDurationMs: generated.artifact.targetDurationMs,
        playbackEndMs: generated.artifact.playback?.summaryRevealMs ?? generated.artifact.targetDurationMs,
      };
    }),
  );

  const successfulCalls = generationResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failedCalls = generationResults.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            callId: preparedCalls[index]?.id,
            message: result.reason instanceof Error ? result.reason.message : "Unable to generate call artifact.",
          },
        ]
      : [],
  );

  for (const failedCall of failedCalls) {
    if (!failedCall.callId) {
      continue;
    }

    await supabase
      .from("calls")
      .update({
        status: "failed",
        result: null,
        completed_at: new Date().toISOString(),
        artifact_json: null,
      })
      .eq("id", failedCall.callId);
  }

  if (successfulCalls.length === 0) {
    const failureMessage =
      failedCalls[0]?.message ?? "Unable to generate synthetic outreach artifacts.";

    await supabase
      .from("call_campaigns")
      .update({
        status: "failed",
        error_text: failureMessage,
        completed_at: new Date().toISOString(),
      })
      .eq("id", campaign.id);
    return;
  }

  const playbackStartedAt = new Date();
  const playbackEndsAt = new Date(
    playbackStartedAt.getTime() + Math.max(...successfulCalls.map((entry) => entry.playbackEndMs)),
  );

  await supabase
    .from("call_campaigns")
    .update({
      status: "active",
      playback_started_at: playbackStartedAt.toISOString(),
      playback_ends_at: playbackEndsAt.toISOString(),
      completed_at: null,
      error_text:
        failedCalls.length > 0
          ? `${failedCalls.length} call${failedCalls.length === 1 ? "" : "s"} could not be prepared.`
          : null,
    })
    .eq("id", campaign.id);
  await updateWorkspaceFlowForResearchSession(campaign.research_session_id, {
    marketRunId: campaign.market_run_id,
    callCampaignId: campaign.id,
    winnerArtifactId: null,
    activeStage: "calls",
  });
}

function buildNoAnswerOutcome(call: CallRecord) {
  const scenario = coerceRecord(call.seller_scenario_json);
  const businessName = firstString(coerceRecord(call.call_plan_json).businessName, scenario.businessName, "Candidate")!;
  const summary = `${businessName} did not answer the outreach attempt.`;

  return {
    result: "no_answer" as const,
    availabilityStatus: "unknown",
    depositRequired: false,
    holdPossible: false,
    websiteUrl: firstString(scenario.websiteUrl) ?? "",
    whatsappNumber: firstString(scenario.whatsappNumber) ?? "",
    contactName: firstString(scenario.contactName, "Front desk") ?? "Front desk",
    contactChannel: firstString(scenario.contactChannel, "phone") ?? "phone",
    confidence: 0.5,
    summarySourceText: summary,
    summaryEnglishText: summary,
    structuredDetails: {
      failureKind: "no_answer",
    },
  };
}

function normalizeConversationTurns(
  transcript: Array<{
    role?: string;
    message?: string;
    originalMessage?: string;
    timeInCallSecs?: number;
  }> | undefined,
) {
  return (transcript ?? [])
    .map((entry, index) => {
      const sourceText = firstString(entry.originalMessage, entry.message) ?? "";
      const englishText = firstString(entry.message, entry.originalMessage) ?? sourceText;

      if (!sourceText && !englishText) {
        return null;
      }

      return {
        seq: index + 1,
        speaker: entry.role === "agent" ? "buyer" : "seller",
        sourceText,
        englishText,
        offsetMs: Math.max(Math.round((entry.timeInCallSecs ?? 0) * 1000), 0),
      } as const;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => left.offsetMs - right.offsetMs || left.seq - right.seq);
}

async function persistInitiationFailureForService(input: {
  campaign: CallCampaignRecord;
  call: CallRecord;
  eventType: string;
  eventId?: string;
  message: string;
  providerCallId?: string;
  providerConversationId?: string;
  payload: Record<string, unknown>;
}) {
  const supabase = getTrustedSupabase();
  const completedAt = new Date().toISOString();
  const failureIsNoAnswer = /(no answer|no pickup|not answer|timeout|unavailable recipient)/i.test(
    input.message,
  );
  const status = failureIsNoAnswer ? "no_answer" : "failed";
  const outcome = failureIsNoAnswer ? buildNoAnswerOutcome(input.call) : null;
  const artifact =
    outcome != null
      ? simulatedCallArtifactSchema.parse({
          targetDurationMs: input.call.target_duration_ms,
          sourceLanguage:
            firstString(coerceRecord(input.call.seller_scenario_json).targetLanguage, input.campaign.source_language, "English") ??
            "English",
          englishLanguage: "English",
          callStatusPattern: [],
          turns: [],
          outcome,
        })
      : null;

  await replaceCallTurnsForService(input.call.id, input.campaign.user_id, []);
  await replaceCallOutcomeForService(input.call.id, input.campaign.user_id, outcome);

  const { error } = await supabase
    .from("calls")
    .update({
      status,
      result: outcome?.result ?? null,
      actual_duration_ms: 0,
      provider_call_id: input.providerCallId ?? input.call.provider_call_id ?? null,
      provider_conversation_id:
        input.providerConversationId ?? input.call.provider_conversation_id ?? null,
      provider_state_json: mergeProviderState(input.call.provider_state_json, {
        provider: LIVE_CALL_TRANSPORT,
        lastEventType: input.eventType,
        lastEventId: input.eventId ?? null,
        lastWebhookAt: completedAt,
        lastError: input.message,
      }),
      artifact_json: artifact,
      completed_at: completedAt,
    })
    .eq("id", input.call.id);

  if (error) {
    throw error;
  }

  await maybeCompleteLiveCallCampaign(input.campaign.id);
}

async function persistConversationForCall(input: {
  campaign: CallCampaignRecord;
  call: CallRecord;
  marketRun: MarketRunRecord;
  conversation: Awaited<ReturnType<typeof fetchElevenLabsConversation>>;
  eventType: string;
  eventId?: string;
  payload: Record<string, unknown>;
}) {
  const supabase = getTrustedSupabase();
  const callPlan = coerceRecord(input.call.call_plan_json);
  const sellerScenario = coerceRecord(input.call.seller_scenario_json);
  const transcriptTurns = normalizeConversationTurns(input.conversation.transcript);
  const sourceLanguage =
    firstString(
      input.conversation.metadata?.mainLanguage,
      sellerScenario.targetLanguage,
      input.campaign.source_language,
      "English",
    ) ?? "English";
  const actualDurationMs = Math.max(
    Math.round((input.conversation.metadata?.callDurationSecs ?? 0) * 1000),
    transcriptTurns.at(-1)?.offsetMs ?? 0,
    input.call.target_duration_ms,
  );
  const hasTechnicalFailure =
    input.conversation.status === "failed" && transcriptTurns.length === 0;
  const outcome = hasTechnicalFailure
    ? null
      : await summarizeLiveCallOutcomeFromTranscript({
        candidateName: firstString(callPlan.businessName, sellerScenario.businessName, "Candidate") ?? "Candidate",
        sourceLanguage,
        transcript: transcriptTurns,
        analysisSummary: input.conversation.analysis?.transcriptSummary ?? "",
        conversationStatus: input.conversation.status,
        callPlan: callPlan as CallPlan,
        sellerScenario: sellerScenario as SellerScenario,
      });
  const callStatus = hasTechnicalFailure
    ? "failed"
    : outcome?.result === "no_answer"
      ? "no_answer"
      : "completed";
  const completedAt = new Date().toISOString();
  const artifact =
    outcome != null
      ? simulatedCallArtifactSchema.parse({
          targetDurationMs: actualDurationMs,
          sourceLanguage,
          englishLanguage: "English",
          callStatusPattern: [],
          turns: transcriptTurns,
          outcome,
        })
      : null;

  await replaceCallTurnsForService(input.call.id, input.campaign.user_id, transcriptTurns);
  await replaceCallOutcomeForService(input.call.id, input.campaign.user_id, outcome);

  const { error } = await supabase
    .from("calls")
    .update({
      status: callStatus,
      result: outcome?.result ?? null,
      target_duration_ms: Math.max(input.call.target_duration_ms, actualDurationMs),
      actual_duration_ms: actualDurationMs,
      provider_call_id:
        firstString(
          input.conversation.metadata?.phoneCall && "callSid" in input.conversation.metadata.phoneCall
            ? input.conversation.metadata.phoneCall.callSid
            : undefined,
          input.call.provider_call_id,
        ) ?? null,
      provider_conversation_id: input.conversation.conversationId,
      provider_state_json: mergeProviderState(input.call.provider_state_json, {
        provider: LIVE_CALL_TRANSPORT,
        lastEventType: input.eventType,
        lastEventId: input.eventId ?? null,
        lastWebhookAt: completedAt,
        conversationStatus: input.conversation.status,
        terminationReason: input.conversation.metadata?.terminationReason ?? null,
        callDurationSecs: input.conversation.metadata?.callDurationSecs ?? null,
        analysisSummary: input.conversation.analysis?.transcriptSummary ?? null,
      }),
      artifact_json: artifact,
      completed_at: completedAt,
    })
    .eq("id", input.call.id);

  if (error) {
    throw error;
  }

  await maybeCompleteLiveCallCampaign(input.campaign.id);
}

async function kickoffLiveCallCampaign(
  supabase: TrustedDatabaseClient,
  campaign: CallCampaignRecord,
  marketRun: MarketRunRecord,
) {
  assertLiveCallingReady();

  const kickoffStartedAt = new Date().toISOString();
  const [preparedCalls, marketCandidates] = await Promise.all([
    ensurePreparedCallsForCampaign(supabase, campaign, marketRun),
    getMarketCandidates(supabase, marketRun.id),
  ]);
  const candidateById = new Map(marketCandidates.map((candidate) => [candidate.id, candidate] as const));

  await supabase
    .from("call_campaigns")
    .update({
      status: "preparing",
      error_text: null,
      completed_at: null,
      playback_started_at: kickoffStartedAt,
      playback_ends_at: null,
      provider_state_json: mergeProviderState(campaign.provider_state_json, {
        provider: LIVE_CALL_TRANSPORT,
        kickoffStartedAt,
      }),
    })
    .eq("id", campaign.id);

  const initiationResults = await Promise.allSettled(
    preparedCalls.map(async (call) => {
      const candidate = candidateById.get(call.candidate_id);

      if (!candidate) {
        throw new Error("Selected candidate not found for outbound calling.");
      }

      const initiatedAt = new Date().toISOString();
      const response = await startElevenLabsOutboundCall({
        call,
        candidate,
        campaign,
        marketRun,
      });

      if (!response.success) {
        throw new Error(response.message || "Outbound call was rejected by ElevenLabs.");
      }

      const { error } = await supabase
        .from("calls")
        .update({
          status: "dialing",
          provider_call_id: response.callSid ?? null,
          provider_conversation_id: response.conversationId ?? null,
          provider_state_json: mergeProviderState(call.provider_state_json, {
            provider: LIVE_CALL_TRANSPORT,
            initiatedAt,
            phase: "dialing",
            phaseSchedule: buildLiveCallPhaseSchedule(call.target_duration_ms),
          }),
          artifact_json: null,
          completed_at: null,
        })
        .eq("id", call.id);

      if (error) {
        throw error;
      }

      return {
        callId: call.id,
      };
    }),
  );

  const successfulCalls = initiationResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failedCalls = initiationResults.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            call: preparedCalls[index] ?? null,
            message:
              result.reason instanceof Error
                ? result.reason.message
                : "Unable to start outbound call.",
          },
        ]
      : [],
  );

  for (const failedCall of failedCalls) {
    if (!failedCall.call) {
      continue;
    }

    await persistInitiationFailureForService({
      campaign,
      call: failedCall.call,
      eventType: "call_initiation_failure",
      message: failedCall.message,
      payload: { message: failedCall.message },
    });
  }

  const kickoffCompletedAt = new Date().toISOString();
  await supabase
    .from("call_campaigns")
    .update({
      status: "active",
      error_text:
        failedCalls.length > 0
          ? `${failedCalls.length} call${failedCalls.length === 1 ? "" : "s"} could not be started.`
          : null,
      completed_at: null,
      provider_state_json: mergeProviderState(campaign.provider_state_json, {
        provider: LIVE_CALL_TRANSPORT,
        kickoffStartedAt,
        kickoffCompletedAt,
        initiated_calls: successfulCalls.length,
        failed_initiations: failedCalls.length,
      }),
    })
    .eq("id", campaign.id);

  await updateWorkspaceFlowForResearchSession(campaign.research_session_id, {
    marketRunId: campaign.market_run_id,
    callCampaignId: campaign.id,
    winnerArtifactId: null,
    activeStage: "calls",
  });

  await maybeCompleteLiveCallCampaign(campaign.id);
}

async function maybeCompleteLiveCallCampaign(campaignId: string) {
  const supabase = getTrustedSupabase();
  const campaign = await getCallCampaignForService(campaignId);

  if (!campaign || isTerminalCampaignStatus(campaign.status)) {
    return campaign;
  }

  const calls = await getCallsForCampaign(supabase, campaignId);

  if (calls.length === 0 || !calls.every((call) => isTerminalCallStatus(call.status))) {
    return campaign;
  }

  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("call_campaigns")
    .update({
      status: "completed",
      completed_at: completedAt,
      playback_ends_at: completedAt,
      provider_state_json: mergeProviderState(campaign.provider_state_json, {
        provider: LIVE_CALL_TRANSPORT,
        completedAt,
        terminalCalls: calls.length,
      }),
    })
    .eq("id", campaignId)
    .in("status", ["queued", "preparing", "active"])
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  const updated = data ? callCampaignRecordSchema.parse(data) : await getCallCampaignForService(campaignId);

  if (updated?.status === "completed") {
    await updateWorkspaceFlowForResearchSession(updated.research_session_id, {
      marketRunId: updated.market_run_id,
      callCampaignId: updated.id,
      activeStage: "winner",
    });
    await dispatchCallCampaignNotifications(campaignId);
  }

  return updated;
}

async function finalizeSyntheticCallCampaignIfReady(campaignId: string) {
  const supabase = getTrustedSupabase();
  const completionTime = new Date().toISOString();
  const { data, error } = await supabase
    .from("call_campaigns")
    .update({
      status: "completed",
      completed_at: completionTime,
    })
    .eq("id", campaignId)
    .eq("status", "active")
    .lte("playback_ends_at", completionTime)
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return getCallCampaignForService(campaignId);
  }

  await updateWorkspaceFlowForResearchSession(data.research_session_id, {
    marketRunId: data.market_run_id,
    callCampaignId: data.id,
    activeStage: "winner",
  });
  await dispatchCallCampaignNotifications(campaignId);
  return getCallCampaignForService(campaignId);
}

export async function kickoffCallCampaign(campaignId: string) {
  const supabase = getTrustedSupabase();

  try {
    const campaign = await getCallCampaignForService(campaignId);

    if (!campaign) {
      throw new Error("Call campaign not found.");
    }

    const marketRun = await getMarketRunForService(campaign.market_run_id);

    if (!marketRun) {
      throw new Error("Market run not found.");
    }

    if (campaign.transport === LIVE_CALL_TRANSPORT || campaign.transport === "twilio_batch") {
      await kickoffLiveCallCampaign(supabase, campaign, marketRun);
      return;
    }

    if (campaign.transport === "synthetic_openai") {
      await kickoffSyntheticCallCampaign(supabase, campaign, marketRun);
      return;
    }

    throw new Error(`Unsupported call transport: ${campaign.transport}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start outreach campaign.";
    await supabase
      .from("call_campaigns")
      .update({
        status: "failed",
        error_text: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", campaignId);
  }
}

export async function finalizeCallCampaignIfReady(campaignId: string) {
  const campaign = await getCallCampaignForService(campaignId);

  if (!campaign) {
    return null;
  }

  if (campaign.transport === LIVE_CALL_TRANSPORT || campaign.transport === "twilio_batch") {
    return maybeCompleteLiveCallCampaign(campaignId);
  }

  return finalizeSyntheticCallCampaignIfReady(campaignId);
}

export async function ingestElevenLabsPostCallWebhook(payload: Record<string, unknown>) {
  const eventType = extractWebhookEventType(payload);
  const eventId = extractWebhookEventId(payload);
  const dynamicVariables = extractWebhookDynamicVariables(payload);
  const conversationId =
    extractWebhookConversationId(payload) ??
    firstString(dynamicVariables.conversation_id, dynamicVariables.conversationId);
  let providerCallId =
    extractWebhookProviderCallId(payload) ??
    firstString(dynamicVariables.call_sid, dynamicVariables.callSid);
  let callId = firstString(
    payload.call_id,
    payload.callId,
    dynamicVariables.call_id,
    dynamicVariables.callId,
  );
  let campaignId = firstString(
    payload.call_campaign_id,
    payload.callCampaignId,
    dynamicVariables.call_campaign_id,
    dynamicVariables.callCampaignId,
  );

  let call =
    (callId ? await getCallForService(callId) : null) ??
    (await getCallByProviderIdentifiersForService({
      providerCallId,
      providerConversationId: conversationId,
      campaignId,
    }));

  if (eventType === "call_initiation_failure") {
    if (!call) {
      return {
        ok: false,
        handled: false,
        reason: "call_not_found",
        eventType,
      };
    }

    const campaign = await getCallCampaignForService(call.call_campaign_id);

    if (!campaign) {
      return {
        ok: false,
        handled: false,
        reason: "campaign_not_found",
        eventType,
      };
    }

    await persistInitiationFailureForService({
      campaign,
      call,
      eventType,
      eventId,
      message:
        firstString(
          payload.message,
          payload.error,
          payload.reason,
          coerceRecord(payload.error_details).message,
        ) ?? "Outbound call initiation failed.",
      providerCallId,
      providerConversationId: conversationId,
      payload,
    });

    return {
      ok: true,
      handled: true,
      eventType,
      callId: call.id,
      campaignId: campaign.id,
    };
  }

  if (!conversationId) {
    throw new Error("Missing conversation id in post-call webhook payload.");
  }

  const conversation = await fetchElevenLabsConversation(conversationId);
  const conversationDynamicVariables = coerceRecord(
    conversation.conversationInitiationClientData?.dynamicVariables,
  );

  callId =
    callId ??
    firstString(conversationDynamicVariables.call_id, conversationDynamicVariables.callId);
  campaignId =
    campaignId ??
    firstString(
      conversationDynamicVariables.call_campaign_id,
      conversationDynamicVariables.callCampaignId,
    );
  providerCallId =
    providerCallId ??
    firstString(
      conversation.metadata?.phoneCall && "callSid" in conversation.metadata.phoneCall
        ? conversation.metadata.phoneCall.callSid
        : undefined,
    );

  call =
    (callId ? await getCallForService(callId) : null) ??
    (await getCallByProviderIdentifiersForService({
      providerCallId,
      providerConversationId: conversationId,
      campaignId,
    }));

  if (!call) {
    return {
      ok: false,
      handled: false,
      reason: "call_not_found",
      eventType,
      conversationId,
    };
  }

  const [campaign, marketRun] = await Promise.all([
    getCallCampaignForService(call.call_campaign_id),
    getMarketRunForService(call.market_run_id),
  ]);

  if (!campaign) {
    return {
      ok: false,
      handled: false,
      reason: "campaign_not_found",
      eventType,
      callId: call.id,
      conversationId,
    };
  }

  if (!marketRun) {
    return {
      ok: false,
      handled: false,
      reason: "market_run_not_found",
      eventType,
      callId: call.id,
      campaignId: campaign.id,
      conversationId,
    };
  }

  await persistConversationForCall({
    campaign,
    call,
    marketRun,
    conversation,
    eventType,
    eventId,
    payload,
  });

  return {
    ok: true,
    handled: true,
    eventType,
    callId: call.id,
    campaignId: campaign.id,
    conversationId,
  };
}

export async function getLatestWinnerArtifactForUser(
  userId: string,
  params?: {
    winnerArtifactId?: string;
    callCampaignId?: string;
    marketRunId?: string;
  },
) {
  const supabase = await createSupabaseClient();
  let query = supabase
    .from("winner_artifacts")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (params?.winnerArtifactId) {
    query = query.eq("id", params.winnerArtifactId);
  } else if (params?.callCampaignId) {
    query = query.eq("call_campaign_id", params.callCampaignId);
  } else if (params?.marketRunId) {
    const supabase = await createSupabaseClient();
    const marketRun = await getOwnedMarketRun(supabase, userId, params.marketRunId);
    const flow =
      marketRun ? await getWorkspaceFlowForUser(userId, marketRun.research_session_id) : null;
    if (flow?.winnerArtifactId) {
      query = query.eq("id", flow.winnerArtifactId);
    } else {
      query = query.eq("market_run_id", params.marketRunId);
    }
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data ? winnerArtifactRecordSchema.parse(data) : null;
}

export async function getLatestWinnerArtifactForRecording(
  params?: {
    winnerArtifactId?: string;
    callCampaignId?: string;
    marketRunId?: string;
  },
) {
  const supabase = getTrustedSupabase();
  let query = supabase
    .from("winner_artifacts")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (params?.winnerArtifactId) {
    query = query.eq("id", params.winnerArtifactId);
  } else if (params?.callCampaignId) {
    query = query.eq("call_campaign_id", params.callCampaignId);
  } else if (params?.marketRunId) {
    query = query.eq("market_run_id", params.marketRunId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data ? winnerArtifactRecordSchema.parse(data) : null;
}

export async function getWinnerDecisionSnapshotForUser(
  userId: string,
  params?: {
    winnerArtifactId?: string;
    callCampaignId?: string;
    marketRunId?: string;
  },
) {
  const supabase = await createSupabaseClient();
  let campaign: CallCampaignRecord | null = null;
  let artifact: ReturnType<typeof winnerArtifactRecordSchema.parse> | null = null;

  if (params?.winnerArtifactId) {
    artifact = await getLatestWinnerArtifactForUser(userId, { winnerArtifactId: params.winnerArtifactId });
    if (!artifact) {
      return null;
    }

    campaign = await getCallCampaignForUser(supabase, userId, artifact.call_campaign_id);
  } else if (params?.callCampaignId) {
    campaign = await getCallCampaignForUser(supabase, userId, params.callCampaignId);
    artifact = campaign ? await getWinnerArtifactByCampaign(supabase, campaign.id) : null;
  } else if (params?.marketRunId) {
    campaign = await getCurrentCallCampaignForUser(userId, params.marketRunId);
    artifact = campaign ? await getWinnerArtifactByCampaign(supabase, campaign.id) : null;
  }

  if (!campaign) {
    return null;
  }

  const decision = await buildWinnerDecisionData(campaign.id);
  const selectedCandidateId = artifact?.selected_candidate_id ?? decision.ranking[0]?.candidateId ?? null;
  const selectedCall = decision.calls.find((call) => call.candidate_id === selectedCandidateId);
  const selectedOutcome = decision.outcomes.find((entry) => entry.call_id === selectedCall?.id) ?? null;

  return {
    campaignId: campaign.id,
    marketRunId: campaign.market_run_id,
    researchSessionId: campaign.research_session_id,
    status: campaign.status,
    confirmed: Boolean(artifact),
    recommendedCandidateId: decision.ranking[0]?.candidateId ?? null,
    selectedCandidateId,
    reportSourceText:
      artifact?.report_source_text ??
      selectedOutcome?.summary_source_text ??
      "Switchboard recommends the strongest live-fit establishment from the completed outreach.",
    reportEnglishText:
      artifact?.report_english_text ??
      selectedOutcome?.summary_english_text ??
      "Switchboard recommends the strongest live-fit establishment from the completed outreach.",
    ranking: decision.ranking.map((entry) => {
      const candidate = decision.candidates.find((item) => item.id === entry.candidateId);
      const call = decision.calls.find((item) => item.candidate_id === entry.candidateId);
      const outcome = decision.outcomes.find((item) => item.call_id === call?.id) ?? null;

      return {
        candidateId: entry.candidateId,
        displayName: candidate?.displayName ?? "Candidate",
        locality: candidate?.locality ?? "",
        websiteUrl: candidate?.websiteUrl ?? "",
        whatsappNumber: candidate?.whatsappNumber ?? "",
        phone: candidate?.phone ?? "",
        rank: entry.rank,
        score: entry.score,
        reason: entry.reason,
        result: outcome?.result ?? null,
        quotedPrice: outcome?.quoted_price ?? null,
        confidence: outcome?.confidence ?? null,
        summarySourceText: outcome?.summary_source_text ?? "",
        summaryEnglishText: outcome?.summary_english_text ?? "",
      };
    }),
  };
}

export async function getWinnerDecisionSnapshotForRecording(
  params?: {
    winnerArtifactId?: string;
    callCampaignId?: string;
    marketRunId?: string;
  },
) {
  const supabase = getTrustedSupabase();
  let campaign: CallCampaignRecord | null = null;
  let artifact: ReturnType<typeof winnerArtifactRecordSchema.parse> | null = null;

  if (params?.winnerArtifactId) {
    artifact = await getLatestWinnerArtifactForRecording({ winnerArtifactId: params.winnerArtifactId });
    if (!artifact) {
      return null;
    }

    campaign = await getCallCampaignForService(artifact.call_campaign_id);
  } else if (params?.callCampaignId) {
    campaign = await getCallCampaignForService(params.callCampaignId);
    artifact = campaign ? await getWinnerArtifactByCampaign(supabase, campaign.id) : null;
  } else if (params?.marketRunId) {
    const { data, error } = await supabase
      .from("call_campaigns")
      .select("*")
      .eq("market_run_id", params.marketRunId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    campaign = data ? callCampaignRecordSchema.parse(data) : null;
    artifact = campaign ? await getWinnerArtifactByCampaign(supabase, campaign.id) : null;
  }

  if (!campaign) {
    return null;
  }

  const decision = await buildWinnerDecisionData(campaign.id);
  const selectedCandidateId = artifact?.selected_candidate_id ?? decision.ranking[0]?.candidateId ?? null;
  const selectedCall = decision.calls.find((call) => call.candidate_id === selectedCandidateId);
  const selectedOutcome = decision.outcomes.find((entry) => entry.call_id === selectedCall?.id) ?? null;

  return {
    campaignId: campaign.id,
    marketRunId: campaign.market_run_id,
    researchSessionId: campaign.research_session_id,
    status: campaign.status,
    confirmed: Boolean(artifact),
    recommendedCandidateId: decision.ranking[0]?.candidateId ?? null,
    selectedCandidateId,
    reportSourceText:
      artifact?.report_source_text ??
      selectedOutcome?.summary_source_text ??
      "Switchboard recommends the strongest live-fit establishment from the completed outreach.",
    reportEnglishText:
      artifact?.report_english_text ??
      selectedOutcome?.summary_english_text ??
      "Switchboard recommends the strongest live-fit establishment from the completed outreach.",
    ranking: decision.ranking.map((entry) => {
      const candidate = decision.candidates.find((item) => item.id === entry.candidateId);
      const call = decision.calls.find((item) => item.candidate_id === entry.candidateId);
      const outcome = decision.outcomes.find((item) => item.call_id === call?.id) ?? null;

      return {
        candidateId: entry.candidateId,
        displayName: candidate?.displayName ?? "Candidate",
        locality: candidate?.locality ?? "",
        websiteUrl: candidate?.websiteUrl ?? "",
        whatsappNumber: candidate?.whatsappNumber ?? "",
        phone: candidate?.phone ?? "",
        rank: entry.rank,
        score: entry.score,
        reason: entry.reason,
        result: outcome?.result ?? null,
        quotedPrice: outcome?.quoted_price ?? null,
        confidence: outcome?.confidence ?? null,
        summarySourceText: outcome?.summary_source_text ?? "",
        summaryEnglishText: outcome?.summary_english_text ?? "",
      };
    }),
  };
}

export async function saveWinnerSelectionForUser(
  userId: string,
  input: ConfirmWinnerSelectionRequest,
) {
  const supabase = await createSupabaseClient();
  const parsed = confirmWinnerSelectionSchema.parse(input);
  const campaign = await getCallCampaignForUser(supabase, userId, parsed.callCampaignId);

  if (!campaign) {
    throw new Error("Call campaign not found.");
  }

  if (campaign.status !== "completed") {
    throw new Error("Calls must finish before choosing a winner.");
  }

  const decision = await buildWinnerDecisionData(campaign.id);
  if (!decision.ranking.some((entry) => entry.candidateId === parsed.candidateId)) {
    throw new Error("Selected candidate is not available in the completed outreach ranking.");
  }

  const artifact = await ensureWinnerArtifactForSelection(parsed.callCampaignId, parsed.candidateId);
  await updateWorkspaceFlowForResearchSession(campaign.research_session_id, {
    marketRunId: campaign.market_run_id,
    callCampaignId: campaign.id,
    winnerArtifactId: artifact.id,
    activeStage: "winner",
  });
  await dispatchWinnerArtifactNotifications(artifact.id);
  return artifact;
}

export async function createNotificationRequestForUser(
  userId: string,
  email: string,
  input: CreateNotificationRequest,
) {
  const supabase = await createSupabaseClient();
  const parsed = createNotificationRequestSchema.parse(input);
  let existingQuery = supabase
    .from("notification_requests")
    .select("*")
    .eq("user_id", userId)
    .eq("channel", parsed.channel)
    .eq("destination", email)
    .limit(1);

  existingQuery = parsed.marketRunId
    ? existingQuery.eq("market_run_id", parsed.marketRunId)
    : existingQuery.is("market_run_id", null);
  existingQuery = parsed.callCampaignId
    ? existingQuery.eq("call_campaign_id", parsed.callCampaignId)
    : existingQuery.is("call_campaign_id", null);
  existingQuery = parsed.winnerArtifactId
    ? existingQuery.eq("winner_artifact_id", parsed.winnerArtifactId)
    : existingQuery.is("winner_artifact_id", null);

  const existingResult = await existingQuery.maybeSingle();

  if (existingResult.error) {
    throw new Error(
      "message" in existingResult.error && typeof existingResult.error.message === "string"
        ? existingResult.error.message
        : "Unable to create notification request.",
    );
  }

  if (existingResult.data) {
    return notificationRequestRecordSchema.parse(existingResult.data);
  }

  const { data, error } = await supabase
    .from("notification_requests")
    .insert({
      user_id: userId,
      channel: parsed.channel,
      status: "pending",
      research_session_id: null,
      market_run_id: parsed.marketRunId ?? null,
      call_campaign_id: parsed.callCampaignId ?? null,
      winner_artifact_id: parsed.winnerArtifactId ?? null,
      destination: email,
      last_error: null,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const created = notificationRequestRecordSchema.parse(data);
  const dispatched = await maybeDispatchNotificationRequest(created.id);

  return dispatched ?? created;
}
