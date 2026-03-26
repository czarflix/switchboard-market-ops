import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { buildResumeContext, createEmptyResearchBrief } from "../../src/lib/research/schemas.ts";
import { createResearchHandoffToken } from "../../src/lib/research/handoff-token.ts";
import { resolveResearchAgentBaseUrl } from "../../src/lib/research/runtime-env.ts";
import { heading, loadEnvFiles, readResearchAgentRuntimeEnv, readVercelEnvironment } from "./shared.mts";

function getSmokeBaseUrl() {
  const raw = resolveResearchAgentBaseUrl(readVercelEnvironment("production"));

  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

async function createTempResearchSession() {
  const productionEnv = readVercelEnvironment("production");
  const productionSupabaseUrl = productionEnv.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const productionServiceRoleKey = productionEnv.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!productionSupabaseUrl || !productionServiceRoleKey) {
    throw new Error("Production Supabase credentials are required for research smoke.");
  }

  const supabase = createClient(
    productionSupabaseUrl,
    productionServiceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
  const { data: seedSession, error: seedError } = await supabase
    .from("research_sessions")
    .select("user_id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (seedError) {
    throw seedError;
  }

  if (!seedSession?.user_id) {
    throw new Error("Unable to find a seed user for research smoke.");
  }

  const sessionId = randomUUID();
  const brief = createEmptyResearchBrief(sessionId, "voice");
  const { error: insertError } = await supabase.from("research_sessions").insert({
    id: sessionId,
    user_id: seedSession.user_id,
    status: "collecting",
    input_mode: "voice",
    category: "unclear",
    scope_status: "unclear",
    brief_json: brief,
    resume_context: buildResumeContext(brief),
    last_event_seq: 0,
  });

  if (insertError) {
    throw insertError;
  }

  return {
    supabase,
    sessionId,
  };
}

async function main() {
  loadEnvFiles();
  const runtime = readResearchAgentRuntimeEnv();
  const baseUrl = getSmokeBaseUrl();

  console.log(heading("Research live smoke"));
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Agent: ${runtime.agentId}`);
  console.log(`Branch: ${runtime.branchId ?? "(main)"}`);

  const { supabase, sessionId } = await createTempResearchSession();

  try {
    const runtimeResponse = await fetch(`${baseUrl}/api/research/elevenlabs/runtime`, {
      headers: {
        Authorization: `Bearer ${runtime.intakeSecret}`,
      },
    });
    const runtimePayload = (await runtimeResponse.json().catch(() => null)) as
      | {
          researchAgentId?: string;
          researchAgentBranchId?: string | null;
          appBaseUrl?: string | null;
          error?: string;
        }
      | null;

    if (!runtimeResponse.ok) {
      throw new Error(runtimePayload?.error ?? `Runtime probe failed with ${runtimeResponse.status}.`);
    }

    if (runtimePayload?.researchAgentId !== runtime.agentId) {
      throw new Error("Production runtime is serving the wrong research agent id.");
    }

    if ((runtimePayload?.researchAgentBranchId ?? "") !== (runtime.branchId ?? "")) {
      throw new Error("Production runtime is serving the wrong research branch.");
    }

    const handoffToken = createResearchHandoffToken(sessionId, runtime.intakeSecret);
    const response = await fetch(`${baseUrl}/api/research/elevenlabs/tool/save-brief`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.intakeSecret}`,
        "x-research-handoff-token": handoffToken,
      },
      body: JSON.stringify({
        input_mode: "voice",
        category: "coworking",
        scope_status: "supported",
        city: "Noida",
        headcount: "one",
        budget_text: "Rs 20,000",
        timeline_text: "tomorrow",
        summary: "Need a coworking shortlist in Noida for one person tomorrow.",
        market_query_preview: "Research coworking spaces in Noida for one person tomorrow.",
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          brief?: {
            readyForMarket?: boolean;
            budget?: { max?: number; notes?: string };
          };
          error?: string;
        }
      | null;

    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.error ?? `Smoke route failed with ${response.status}.`);
    }

    if (payload?.brief?.readyForMarket !== true) {
      throw new Error("Smoke handoff did not produce a market-ready brief.");
    }

    if (payload?.brief?.budget?.max !== 20000) {
      throw new Error("Smoke handoff did not normalize budget_text into the expected budget.");
    }

    console.log("Production save-brief v2 smoke passed.");
  } finally {
    await supabase.from("research_sessions").delete().eq("id", sessionId);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
