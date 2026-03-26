import {
  resolveResearchAgentBaseUrl,
  resolveServerResearchAgentEnv,
} from "../../src/lib/research/runtime-env.ts";
import {
  heading,
  maskSecret,
  readResearchAgentRuntimeEnv,
  readVercelEnvironment,
} from "./shared.mts";

type ProductionRuntimeSnapshot = {
  apiKey: string;
  firecrawlApiKey: string;
  openAiApiKey: string;
  resendApiKey: string;
  resendFromEmail: string;
  researchAgentId: string;
  researchAgentBranchId?: string;
  genericAgentId?: string;
  genericAgentBranchId?: string;
};

type ServedRuntimeSnapshot = {
  researchAgentId: string;
  researchAgentBranchId?: string | null;
  appBaseUrl?: string | null;
  genericAgentId?: string | null;
};

function isServedRuntimeSnapshot(
  payload: ServedRuntimeSnapshot | { error?: string } | null,
): payload is ServedRuntimeSnapshot {
  return Boolean(
    payload &&
      typeof (payload as { researchAgentId?: unknown }).researchAgentId === "string",
  );
}

function getProductionRuntimeSnapshot(env: Record<string, string>) {
  const resolved = resolveServerResearchAgentEnv(env);

  return {
    apiKey: env.ELEVENLABS_API_KEY?.trim() ?? "",
    firecrawlApiKey: env.FIRECRAWL_API_KEY?.trim() ?? "",
    openAiApiKey: env.OPENAI_API_KEY?.trim() ?? "",
    resendApiKey: env.RESEND_API_KEY?.trim() ?? "",
    resendFromEmail: env.RESEND_FROM_EMAIL?.trim() ?? "",
    researchAgentId: resolved.researchAgentId,
    researchAgentBranchId: resolved.researchAgentBranchId,
    genericAgentId: resolved.genericAgentId,
    genericAgentBranchId: resolved.genericAgentBranchId,
  } satisfies ProductionRuntimeSnapshot;
}

function compareRuntimeValues(local: ReturnType<typeof readResearchAgentRuntimeEnv>, production: ProductionRuntimeSnapshot) {
  const failures: string[] = [];

  if (!production.apiKey) {
    failures.push("production ELEVENLABS_API_KEY is missing");
  } else if (production.apiKey !== local.apiKey) {
    failures.push(
      `production ELEVENLABS_API_KEY drifted: local ${maskSecret(local.apiKey)} vs production ${maskSecret(production.apiKey)}`,
    );
  }

  if (!production.firecrawlApiKey) {
    failures.push("production FIRECRAWL_API_KEY is missing");
  } else if (!local.firecrawlApiKey) {
    failures.push("local FIRECRAWL_API_KEY is missing");
  } else if (local.firecrawlApiKey && production.firecrawlApiKey !== local.firecrawlApiKey) {
    failures.push(
      `production FIRECRAWL_API_KEY drifted: local ${maskSecret(local.firecrawlApiKey)} vs production ${maskSecret(production.firecrawlApiKey)}`,
    );
  }

  if (!production.openAiApiKey) {
    failures.push("production OPENAI_API_KEY is missing");
  } else if (!local.openAiApiKey) {
    failures.push("local OPENAI_API_KEY is missing");
  } else if (local.openAiApiKey && production.openAiApiKey !== local.openAiApiKey) {
    failures.push(
      `production OPENAI_API_KEY drifted: local ${maskSecret(local.openAiApiKey)} vs production ${maskSecret(production.openAiApiKey)}`,
    );
  }

  if (!production.resendApiKey) {
    failures.push("production RESEND_API_KEY is missing");
  } else if (!local.resendApiKey) {
    failures.push("local RESEND_API_KEY is missing");
  } else if (local.resendApiKey && production.resendApiKey !== local.resendApiKey) {
    failures.push(
      `production RESEND_API_KEY drifted: local ${maskSecret(local.resendApiKey)} vs production ${maskSecret(production.resendApiKey)}`,
    );
  }

  if (!production.resendFromEmail) {
    failures.push("production RESEND_FROM_EMAIL is missing");
  } else if (!local.resendFromEmail) {
    failures.push("local RESEND_FROM_EMAIL is missing");
  } else if (production.resendFromEmail.endsWith("@resend.dev")) {
    failures.push(`production RESEND_FROM_EMAIL must use a verified sender domain, not ${production.resendFromEmail}`);
  } else if (local.resendFromEmail.endsWith("@resend.dev")) {
    failures.push(`local RESEND_FROM_EMAIL must use a verified sender domain, not ${local.resendFromEmail}`);
  } else if (local.resendFromEmail !== production.resendFromEmail) {
    failures.push(
      `production RESEND_FROM_EMAIL drifted: expected ${local.resendFromEmail} but found ${production.resendFromEmail}`,
    );
  }

  if (!production.researchAgentId) {
    failures.push("production ELEVENLABS_RESEARCH_AGENT_ID is missing");
  } else if (production.researchAgentId !== local.agentId) {
    failures.push(
      `production research agent drifted: expected ${local.agentId} but found ${production.researchAgentId}`,
    );
  }

  if ((production.researchAgentBranchId ?? "") !== (local.branchId ?? "")) {
    failures.push(
      `production research branch drifted: expected ${local.branchId ?? "(main)"} but found ${production.researchAgentBranchId ?? "(main)"}`,
    );
  }

  if ((production.genericAgentId ?? "") !== (local.genericAgentId ?? "")) {
    failures.push(
      `production generic fallback agent drifted: expected ${local.genericAgentId ?? "(unset)"} but found ${production.genericAgentId ?? "(unset)"}`,
    );
  }

  if ((production.genericAgentBranchId ?? "") !== (local.genericBranchId ?? "")) {
    failures.push(
      `production generic fallback branch drifted: expected ${local.genericBranchId ?? "(unset)"} but found ${production.genericAgentBranchId ?? "(unset)"}`,
    );
  }

  return failures;
}

async function readServedRuntime(baseUrl: string, intakeSecret: string) {
  const response = await fetch(`${baseUrl}api/research/elevenlabs/runtime`, {
    headers: {
      Authorization: `Bearer ${intakeSecret}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | ServedRuntimeSnapshot
    | { error?: string }
    | null;

  if (!response.ok || !isServedRuntimeSnapshot(payload)) {
    throw new Error(
      (payload && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Unable to read served runtime (${response.status}).`),
    );
  }

  return payload;
}

async function main() {
  const runtime = readResearchAgentRuntimeEnv();
  const productionEnv = readVercelEnvironment("production");
  const productionRuntime = getProductionRuntimeSnapshot(productionEnv);
  const productionBaseUrl = resolveResearchAgentBaseUrl(productionEnv);
  const servedRuntime = await readServedRuntime(productionBaseUrl, runtime.intakeSecret);

  console.log(heading("Research runtime audit"));
  console.log(`Local research agent: ${runtime.agentId}`);
  console.log(`Local research branch: ${runtime.branchId ?? "(main)"}`);
  console.log(`Local webhook base: ${runtime.baseUrl}`);
  console.log(`Production webhook base: ${productionBaseUrl}`);

  const failures = [
    ...compareRuntimeValues(runtime, productionRuntime),
    ...(productionBaseUrl !== runtime.baseUrl
      ? [
          `production app base URL drifted: expected ${runtime.baseUrl} but found ${productionBaseUrl}`,
        ]
      : []),
    ...(servedRuntime.researchAgentId !== runtime.agentId
      ? [
          `served research agent drifted: expected ${runtime.agentId} but found ${servedRuntime.researchAgentId}`,
        ]
      : []),
    ...((servedRuntime.researchAgentBranchId ?? "") !== (runtime.branchId ?? "")
      ? [
          `served research branch drifted: expected ${runtime.branchId ?? "(main)"} but found ${servedRuntime.researchAgentBranchId ?? "(main)"}`,
        ]
      : []),
    ...((servedRuntime.appBaseUrl ?? "") !== runtime.baseUrl
      ? [
          `served app base URL drifted: expected ${runtime.baseUrl} but found ${servedRuntime.appBaseUrl ?? "(unset)"}`,
        ]
      : []),
  ];

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Production env and live ElevenLabs runtime match the local research runtime.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
