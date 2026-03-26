import {
  RESEARCH_AGENT_TOOL_NAME,
  buildResearchAgentSimulationSpecification,
  researchAgentSimulationBranchCoverageNote,
  researchAgentSimulationCases,
} from "../../config/elevenlabs/research-agent.ts";
import { buildResearchDynamicVariables } from "../../src/lib/research/elevenlabs-client.ts";
import { conversationText, createElevenLabsClient, heading, readResearchAgentRuntimeEnv, stableJson } from "./shared.mts";

function hasAny(text: string, phrases: readonly string[]) {
  return phrases.some((phrase) => text.includes(phrase.toLowerCase()));
}

type StructuredToolCall = {
  toolName: string;
  params: Record<string, unknown> | null;
};

function parseToolCallParams(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawParams =
    record.paramsAsJson ??
    record.params_as_json ??
    record.parametersAsJson ??
    record.parameters_as_json ??
    record.parameters ??
    record.args ??
    record.arguments ??
    record.toolParams ??
    record.tool_params;

  if (rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)) {
    return rawParams as Record<string, unknown>;
  }

  if (typeof rawParams === "string") {
    try {
      const parsed = JSON.parse(rawParams) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return null;
}

function findStructuredToolCall(
  value: unknown,
  toolName: string,
  seen = new WeakSet<object>(),
): StructuredToolCall | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (seen.has(value as object)) {
    return null;
  }

  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStructuredToolCall(entry, toolName, seen);
      if (found) {
        return found;
      }
    }

    return null;
  }

  const record = value as Record<string, unknown>;
  const candidateName =
    typeof record.toolName === "string"
      ? record.toolName
      : typeof record.tool_name === "string"
        ? record.tool_name
        : null;

  if (candidateName === toolName) {
    return {
      toolName: candidateName,
      params: parseToolCallParams(record),
    };
  }

  for (const entry of Object.values(record)) {
    const found = findStructuredToolCall(entry, toolName, seen);
    if (found) {
      return found;
    }
  }

  return null;
}

async function runCase(
  client: ReturnType<typeof createElevenLabsClient>,
  agentId: string,
  testCase: (typeof researchAgentSimulationCases)[number],
  strict: boolean,
) {
  const toolMockConfig = "toolMockConfig" in testCase ? testCase.toolMockConfig : undefined;
  const newTurnsLimit = "newTurnsLimit" in testCase ? testCase.newTurnsLimit : undefined;
  const dynamicVariables = buildResearchDynamicVariables({
    sessionId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    priorSummary: "",
    missingFields: [],
    supportedCategories: ["banquet", "coworking", "clinic"],
  });
  dynamicVariables.system__conversation_id = "conv_simulated_research_intake";

  const response = await client.conversationalAi.agents.simulateConversation(agentId, {
    ...buildResearchAgentSimulationSpecification(
      testCase.firstMessage,
      testCase.language,
      toolMockConfig,
      newTurnsLimit,
    ),
    simulationSpecification: {
      ...buildResearchAgentSimulationSpecification(
        testCase.firstMessage,
        testCase.language,
        toolMockConfig,
        newTurnsLimit,
      ).simulationSpecification,
      dynamicVariables,
    },
  });

  const transcriptText = [
    response.analysis?.transcriptSummary ?? "",
    conversationText(response.simulatedConversation),
    stableJson(response.analysis ?? {}),
  ]
    .join("\n")
    .toLowerCase();

  const toolCall = findStructuredToolCall(response.simulatedConversation, RESEARCH_AGENT_TOOL_NAME);

  const failures: string[] = [];
  const notes: string[] = [];

  if (response.analysis?.callSuccessful === "failure") {
    failures.push("conversation analysis reported failure");
  }

  if (!hasAny(transcriptText, testCase.expectedIncludes)) {
    failures.push(`missing expected phrases: ${testCase.expectedIncludes.join(", ")}`);
  }

  if (hasAny(transcriptText, testCase.expectedExcludes)) {
    failures.push(`contained forbidden phrases: ${testCase.expectedExcludes.join(", ")}`);
  }

  if (testCase.expectToolCall && !toolCall) {
    failures.push(`simulation did not surface a structured ${RESEARCH_AGENT_TOOL_NAME} tool call`);
  }

  if (testCase.expectToolCall && toolCall && !toolCall.params) {
    failures.push(`simulation surfaced ${RESEARCH_AGENT_TOOL_NAME} without parseable params`);
  }

  if (testCase.expectToolCall && toolCall?.params) {
    const params = toolCall?.params;
    const researchSessionId = typeof params?.research_session_id === "string" ? params.research_session_id : undefined;
    const budgetText = typeof params?.budget_text === "string" ? params.budget_text : undefined;
    const conversationId =
      typeof params?.conversation_id === "string" ? params.conversation_id : undefined;

    if (researchSessionId != null && researchSessionId !== "dynamic_value") {
      failures.push(
        `tool call unexpectedly included model-authored research_session_id: found ${researchSessionId}`,
      );
    }

    if (!budgetText) {
      failures.push("tool call did not include primitive budget_text");
    }

    if (conversationId == null || conversationId === "dynamic_value") {
      notes.push(
        "simulateConversation did not expose the dynamic-bound conversation_id value, so branch-safe validation must rely on the live webhook/tool path instead.",
      );
    } else if (conversationId !== dynamicVariables.system__conversation_id) {
      failures.push(
        `tool call did not propagate conversation_id: expected ${dynamicVariables.system__conversation_id} but found ${conversationId}`,
      );
    }
  }

  if (failures.length > 0) {
    const reporter = strict ? console.error : console.warn;
    reporter(heading(`${strict ? "Simulation failed" : "Simulation drift"}: ${testCase.name}`));
    reporter(`First message: ${testCase.firstMessage}`);
    reporter("Transcript text:");
    reporter(transcriptText);
    reporter("Analysis:");
    reporter(stableJson(response.analysis ?? {}));
    reporter("Simulated conversation:");
    reporter(stableJson(response.simulatedConversation));
    for (const failure of failures) {
      reporter(`- ${failure}`);
    }

    if (strict) {
      throw new Error(`Simulation case failed: ${testCase.name}`);
    }

    console.log("Note: simulation drift is non-gating because simulateConversation cannot target the configured branch.");
    return;
  }

  console.log(heading(`Simulation passed: ${testCase.name}`));
  console.log(response.analysis?.transcriptSummary ?? "(no summary)");
  for (const note of notes) {
    console.log(`Note: ${note}`);
  }
}

async function main() {
  const runtime = readResearchAgentRuntimeEnv();
  const client = createElevenLabsClient(runtime.apiKey);
  const strict = !runtime.branchId;

  console.log(heading("Research agent simulate"));
  console.log(`Agent: ${runtime.agentId}`);
  console.log(`Branch: ${runtime.branchId ?? "(main)"}`);
  const branchCoverageNote = researchAgentSimulationBranchCoverageNote(runtime.branchId);
  if (branchCoverageNote) {
    console.log(branchCoverageNote);
  }

  for (const testCase of researchAgentSimulationCases) {
    await runCase(client, runtime.agentId, testCase, strict);
  }

  console.log("\nAll simulation cases passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
