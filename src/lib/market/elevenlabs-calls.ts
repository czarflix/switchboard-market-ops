import "server-only";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import { getServerEnv } from "@/lib/env";
import type {
  CallCampaignRecord,
  CallRecord,
  MarketCandidateRecord,
  MarketRunRecord,
} from "./schemas.ts";

export const LIVE_CALL_TRANSPORT = "elevenlabs_twilio" as const;

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function normalizePhoneNumber(rawValue: string, defaultCountryCode = "91") {
  const sanitized = rawValue.replace(/[^\d+]/g, "");

  if (!sanitized) {
    throw new Error("Missing destination phone number.");
  }

  if (sanitized.startsWith("+")) {
    if (!/^\+\d{8,15}$/.test(sanitized)) {
      throw new Error(`Unsupported destination phone number: ${rawValue}`);
    }

    return sanitized;
  }

  if (/^00\d{8,15}$/.test(sanitized)) {
    return `+${sanitized.slice(2)}`;
  }

  if (/^0\d{10}$/.test(sanitized)) {
    return `+${defaultCountryCode}${sanitized.slice(1)}`;
  }

  if (/^\d{10}$/.test(sanitized)) {
    return `+${defaultCountryCode}${sanitized}`;
  }

  if (/^91\d{10}$/.test(sanitized)) {
    return `+${sanitized}`;
  }

  throw new Error(`Unsupported destination phone number: ${rawValue}`);
}

function createElevenLabsClient() {
  const env = getServerEnv();

  if (!env.elevenLabsApiKey) {
    throw new Error("Live calling is not configured: missing ELEVENLABS_API_KEY.");
  }

  return new ElevenLabsClient({
    apiKey: env.elevenLabsApiKey,
  });
}

export function assertLiveCallingReady() {
  const env = getServerEnv();

  if (!env.liveCallsEnabled) {
    throw new Error("Live calling is disabled. Set LIVE_CALLS_ENABLED=true to start outreach.");
  }

  const missing: string[] = [];

  if (!env.elevenLabsApiKey) {
    missing.push("ELEVENLABS_API_KEY");
  }

  if (!env.elevenLabsCallAgentId) {
    missing.push("ELEVENLABS_CALL_AGENT_ID");
  }

  if (!env.elevenLabsPhoneNumberId) {
    missing.push("ELEVENLABS_AGENT_PHONE_NUMBER_ID");
  }

  if (!env.appBaseUrl) {
    missing.push("APP_BASE_URL");
  }

  if (missing.length > 0) {
    throw new Error(`Live calling is not configured: missing ${missing.join(", ")}.`);
  }

  return {
    elevenLabsCallAgentId: env.elevenLabsCallAgentId,
    elevenLabsPhoneNumberId: env.elevenLabsPhoneNumberId,
    appBaseUrl: env.appBaseUrl,
    testCallNumber: env.testCallNumber,
  };
}

function buildDynamicVariables(input: {
  call: CallRecord;
  candidate: MarketCandidateRecord;
  campaign: CallCampaignRecord;
  marketRun: MarketRunRecord;
}) {
  const callPlan = asRecord(input.call.call_plan_json) ?? {};
  const sellerScenario = asRecord(input.call.seller_scenario_json) ?? {};
  const brief = asRecord(input.marketRun.brief_snapshot_json) ?? {};
  const summary = asRecord(input.marketRun.summary_json) ?? {};

  return {
    call_id: input.call.id,
    call_campaign_id: input.campaign.id,
    market_run_id: input.marketRun.id,
    research_session_id: input.marketRun.research_session_id,
    candidate_id: input.candidate.id,
    business_name: input.candidate.display_name,
    candidate_phone: input.candidate.phone ?? "",
    candidate_whatsapp: input.candidate.whatsapp_number ?? "",
    website_url: input.candidate.website_url ?? "",
    locality: input.candidate.locality ?? "",
    city: input.candidate.city ?? "",
    call_order_index: input.call.order_index,
    target_language: firstString(
      sellerScenario.targetLanguage,
      input.campaign.source_language,
      input.candidate.source_language,
      "English",
    ) ?? "English",
    category: firstString(brief.category) ?? "",
    headcount: typeof brief.headcount === "number" ? brief.headcount : 0,
    budget_currency: firstString(asRecord(brief.budget)?.currency) ?? "INR",
    budget_min: typeof asRecord(brief.budget)?.min === "number" ? (asRecord(brief.budget)?.min as number) : 0,
    budget_max: typeof asRecord(brief.budget)?.max === "number" ? (asRecord(brief.budget)?.max as number) : 0,
    why_call: firstString(callPlan.whyCall) ?? "",
    known_facts: JSON.stringify(callPlan.knownFacts ?? []),
    unknown_facts: JSON.stringify(callPlan.unknownFacts ?? []),
    ask_sequence: JSON.stringify(callPlan.askSequence ?? []),
    success_criteria: JSON.stringify(callPlan.successCriteria ?? []),
    disqualifiers: JSON.stringify(callPlan.disqualifiers ?? []),
    call_plan_json: JSON.stringify(callPlan),
    seller_scenario_json: JSON.stringify(sellerScenario),
    brief_json: JSON.stringify(brief),
    market_summary_json: JSON.stringify(summary),
    selection_fingerprint: input.campaign.selection_fingerprint ?? "",
  } satisfies Record<string, string | number | boolean>;
}

export async function startElevenLabsOutboundCall(input: {
  call: CallRecord;
  candidate: MarketCandidateRecord;
  campaign: CallCampaignRecord;
  marketRun: MarketRunRecord;
}) {
  const env = assertLiveCallingReady();
  const client = createElevenLabsClient();
  const rawDestination =
    env.testCallNumber ||
    input.candidate.phone ||
    input.candidate.whatsapp_number ||
    "";
  const toNumber = normalizePhoneNumber(rawDestination);

  return client.conversationalAi.twilio.outboundCall({
    agentId: env.elevenLabsCallAgentId!,
    agentPhoneNumberId: env.elevenLabsPhoneNumberId!,
    toNumber,
    callRecordingEnabled: false,
    telephonyCallConfig: {
      ringingTimeoutSecs: 28,
    },
    conversationInitiationClientData: {
      userId: input.campaign.user_id,
      dynamicVariables: buildDynamicVariables(input),
    },
  });
}

export async function fetchElevenLabsConversation(conversationId: string) {
  const client = createElevenLabsClient();
  return client.conversationalAi.conversations.get(conversationId);
}

export function extractWebhookDynamicVariables(payload: Record<string, unknown>) {
  const metadata = asRecord(payload.metadata);

  return (
    asRecord(payload.dynamic_variables) ??
    asRecord(asRecord(payload.conversation_initiation_client_data)?.dynamic_variables) ??
    asRecord(asRecord(payload.conversationInitiationClientData)?.dynamicVariables) ??
    asRecord(metadata?.dynamic_variables) ??
    {}
  );
}

export function extractWebhookEventType(payload: Record<string, unknown>) {
  const metadata = asRecord(payload.metadata);

  return (
    firstString(
      payload.event_type,
      payload.eventType,
      payload.type,
      metadata?.event_type,
      metadata?.eventType,
    ) ?? "post_call_webhook"
  );
}

export function extractWebhookEventId(payload: Record<string, unknown>) {
  const metadata = asRecord(payload.metadata);

  return firstString(
    payload.event_id,
    payload.eventId,
    payload.id,
    metadata?.event_id,
    metadata?.eventId,
  );
}

export function extractWebhookConversationId(payload: Record<string, unknown>) {
  const metadata = asRecord(payload.metadata);

  return firstString(
    payload.conversation_id,
    payload.conversationId,
    metadata?.conversation_id,
    metadata?.conversationId,
  );
}

export function extractWebhookProviderCallId(payload: Record<string, unknown>) {
  const metadata = asRecord(payload.metadata);
  const phoneCall = asRecord(metadata?.phone_call) ?? asRecord(payload.phone_call);

  return firstString(
    payload.call_sid,
    payload.callSid,
    phoneCall?.call_sid,
    phoneCall?.callSid,
  );
}
