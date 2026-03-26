import "server-only";

import {
  resolveAppBaseUrl,
  resolveServerResearchAgentEnv,
} from "@/lib/research/runtime-env";
import {
  readJudgeAccessConfig,
  readJudgeAccessPresentationConfig,
} from "@/lib/auth/judge-access";

function readBooleanEnv(value: string | undefined, fallback = false) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function getServerEnv() {
  const researchAgentEnv = resolveServerResearchAgentEnv(process.env);
  const judgeAccess = readJudgeAccessConfig(process.env);
  const judgeAccessPresentation = readJudgeAccessPresentationConfig(process.env);

  return {
    firecrawlApiKey: process.env.FIRECRAWL_API_KEY,
    firecrawlWebhookSecret: process.env.FIRECRAWL_WEBHOOK_SECRET,
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY?.trim(),
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiIntakeModel: process.env.OPENAI_INTAKE_MODEL,
    openAiCallsModel: process.env.OPENAI_CALLS_MODEL,
    appBaseUrl: resolveAppBaseUrl(process.env),
    researchIntakeSessionSecret: process.env.RESEARCH_INTAKE_SESSION_SECRET,
    elevenLabsWebhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET,
    elevenLabsAgentId: researchAgentEnv.genericAgentId,
    elevenLabsResearchAgentId: researchAgentEnv.researchAgentId,
    elevenLabsResearchAgentBranchId: researchAgentEnv.researchAgentBranchId,
    elevenLabsCallAgentId: process.env.ELEVENLABS_CALL_AGENT_ID?.trim(),
    elevenLabsPhoneNumberId: process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID,
    exotelApiKey: process.env.EXOTEL_API_KEY,
    exotelApiToken: process.env.EXOTEL_API_TOKEN,
    exotelSid: process.env.EXOTEL_SID,
    exotelCallerId: process.env.EXOTEL_CALLER_ID,
    databaseUrl: process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER,
    liveCallsEnabled: readBooleanEnv(process.env.LIVE_CALLS_ENABLED, false),
    testCallNumber: process.env.TEST_CALL_NUMBER?.trim(),
    resendApiKey: process.env.RESEND_API_KEY,
    resendFromEmail: process.env.RESEND_FROM_EMAIL,
    judgeAccessCode: judgeAccess.judgeAccessCode,
    judgeSignupEnabled: judgeAccess.judgeSignupEnabled,
    judgeAccessRepoUrl: judgeAccessPresentation.judgeAccessRepoUrl,
    judgeAccessPublishAt: judgeAccessPresentation.judgeAccessPublishAt,
    judgeAccessPublished: judgeAccessPresentation.judgeAccessPublished,
    judgeAccessRepoMessage: judgeAccessPresentation.judgeAccessRepoMessage,
  };
}

export function getPublicEnv() {
  return {
    elevenLabsAgentId: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "",
    elevenLabsResearchAgentId: process.env.NEXT_PUBLIC_ELEVENLABS_RESEARCH_AGENT_ID ?? "",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabasePublishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "",
  };
}
