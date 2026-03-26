export type ResearchAgentEnvSource = Record<string, string | undefined>;

function trimEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export type ResolvedResearchAgentEnv = {
  researchAgentId: string;
  researchAgentBranchId?: string;
  genericAgentId?: string;
  genericAgentBranchId?: string;
};

export function resolveResearchAgentEnv(
  source: ResearchAgentEnvSource,
): ResolvedResearchAgentEnv {
  return {
    researchAgentId:
      trimEnv(source.ELEVENLABS_RESEARCH_AGENT_ID) ??
      trimEnv(source.NEXT_PUBLIC_ELEVENLABS_RESEARCH_AGENT_ID) ??
      "",
    researchAgentBranchId:
      trimEnv(source.ELEVENLABS_RESEARCH_AGENT_BRANCH_ID) ??
      trimEnv(source.ELEVENLABS_AGENT_BRANCH_ID),
    genericAgentId:
      trimEnv(source.ELEVENLABS_AGENT_ID) ??
      trimEnv(source.NEXT_PUBLIC_ELEVENLABS_AGENT_ID),
    genericAgentBranchId: trimEnv(source.ELEVENLABS_AGENT_BRANCH_ID),
  };
}

export function resolveServerResearchAgentEnv(
  source: ResearchAgentEnvSource,
): ResolvedResearchAgentEnv {
  return {
    researchAgentId: trimEnv(source.ELEVENLABS_RESEARCH_AGENT_ID) ?? "",
    researchAgentBranchId: trimEnv(source.ELEVENLABS_RESEARCH_AGENT_BRANCH_ID),
    genericAgentId:
      trimEnv(source.ELEVENLABS_AGENT_ID) ??
      trimEnv(source.NEXT_PUBLIC_ELEVENLABS_AGENT_ID),
    genericAgentBranchId: trimEnv(source.ELEVENLABS_AGENT_BRANCH_ID),
  };
}

function normalizeBaseUrl(baseUrl: string | undefined) {
  return baseUrl
    ? baseUrl.endsWith("/")
      ? baseUrl
      : `${baseUrl}/`
    : "http://localhost:3000/";
}

export function resolveAppBaseUrl(source: ResearchAgentEnvSource) {
  const explicitBaseUrl =
    trimEnv(source.APP_BASE_URL) ??
    trimEnv(source.NEXT_PUBLIC_SITE_URL) ??
    trimEnv(source.NEXT_PUBLIC_APP_URL);
  const vercelUrl = trimEnv(source.VERCEL_URL);
  const baseUrl =
    explicitBaseUrl ??
    (vercelUrl ? `https://${vercelUrl.replace(/^https?:\/\//, "")}` : undefined);

  return normalizeBaseUrl(baseUrl);
}

export function resolveResearchAgentBaseUrl(source: ResearchAgentEnvSource) {
  const explicitBaseUrl =
    trimEnv(source.RESEARCH_AGENT_WEBHOOK_BASE_URL) ??
    trimEnv(source.APP_BASE_URL) ??
    trimEnv(source.NEXT_PUBLIC_SITE_URL) ??
    trimEnv(source.NEXT_PUBLIC_APP_URL);
  const vercelUrl = trimEnv(source.VERCEL_URL);
  const baseUrl =
    explicitBaseUrl ??
    (vercelUrl ? `https://${vercelUrl.replace(/^https?:\/\//, "")}` : undefined);

  return normalizeBaseUrl(baseUrl);
}
