import {
  assertUniqueSaveResearchBriefTool,
  RESEARCH_AGENT_TOOL_NAME,
  buildResearchAgentUpdateRequest,
  buildResearchBriefToolConfig,
  buildResearchPostCallWebhookUrl,
  RESEARCH_AGENT_POST_CALL_WEBHOOK_EVENTS,
  RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME,
} from "../../config/elevenlabs/research-agent.ts";
import { createElevenLabsClient, diffValues, heading, readResearchAgentRuntimeEnv, stableJson } from "./shared.mts";

type ToolConfigLike = {
  type?: string;
  name?: string;
  description?: string;
  responseTimeoutSecs?: number;
  disableInterruptions?: boolean;
  executionMode?: string;
  toolErrorHandlingMode?: string;
  apiSchema?: Record<string, unknown>;
};

type ToolResponseLike = {
  id: string;
  toolConfig?: {
    name?: string | null;
    description?: string | null;
    responseTimeoutSecs?: number | null;
    disableInterruptions?: boolean | null;
    executionMode?: string | null;
    toolErrorHandlingMode?: string | null;
    apiSchema?: Record<string, unknown> | null;
    type?: string | null;
    [key: string]: unknown;
  } | null;
};

type AgentResponseLike = {
  name: string;
  tags?: string[];
  branchId?: string | null;
  conversationConfig?: {
    turn?: {
      turnTimeout?: number;
      silenceEndCallTimeout?: number;
      speculativeTurn?: boolean;
      softTimeoutConfig?: {
        timeoutSeconds?: number;
        message?: string;
        useLlmGeneratedMessage?: boolean;
      };
    };
    tts?: {
      modelId?: string;
      voiceId?: string;
    };
    agent?: {
      firstMessage?: string;
      language?: string;
      hinglishMode?: boolean;
      disableFirstMessageInterruptions?: boolean;
      prompt?: {
        prompt?: string;
        llm?: string;
        toolIds?: string[];
        ignoreDefaultPersonality?: boolean;
        temperature?: number;
        timezone?: string;
      };
    };
  };
  platformSettings?: {
    auth?: {
      enableAuth?: boolean;
      requireOriginHeader?: boolean;
    };
    summaryLanguage?: string;
    dataCollection?: Record<string, unknown>;
    workspaceOverrides?: Record<string, unknown>;
    guardrails?: Record<string, unknown>;
  };
};

function readRequestBodySchema(toolConfig: ToolConfigLike) {
  const apiSchema =
    toolConfig.apiSchema && typeof toolConfig.apiSchema === "object"
      ? (toolConfig.apiSchema as Record<string, unknown>)
      : null;
  const requestBodySchema =
    apiSchema?.requestBodySchema && typeof apiSchema.requestBodySchema === "object"
      ? (apiSchema.requestBodySchema as Record<string, unknown>)
      : null;

  return requestBodySchema;
}

function readRequestHeaders(toolConfig: ToolConfigLike) {
  const apiSchema =
    toolConfig.apiSchema && typeof toolConfig.apiSchema === "object"
      ? (toolConfig.apiSchema as Record<string, unknown>)
      : null;
  return apiSchema?.requestHeaders && typeof apiSchema.requestHeaders === "object"
    ? (apiSchema.requestHeaders as Record<string, unknown>)
    : null;
}

function findRequiredObjectTypedFields(requestBodySchema: Record<string, unknown> | null) {
  const required = Array.isArray(requestBodySchema?.required)
    ? requestBodySchema.required.filter((value): value is string => typeof value === "string")
    : [];
  const properties =
    requestBodySchema?.properties && typeof requestBodySchema.properties === "object"
      ? (requestBodySchema.properties as Record<string, unknown>)
      : {};

  return required.filter((fieldName) => {
    const property =
      properties[fieldName] && typeof properties[fieldName] === "object"
        ? (properties[fieldName] as Record<string, unknown>)
        : null;
    return property?.type === "object";
  });
}

function validateDesiredToolContract(toolConfig: ToolConfigLike) {
  const failures: string[] = [];
  const requestBodySchema = readRequestBodySchema(toolConfig);
  const requestHeaders = readRequestHeaders(toolConfig);
  const required = Array.isArray(requestBodySchema?.required)
    ? requestBodySchema.required.filter((value): value is string => typeof value === "string")
    : [];
  const properties =
    requestBodySchema?.properties && typeof requestBodySchema.properties === "object"
      ? (requestBodySchema.properties as Record<string, unknown>)
      : {};
  const budgetTextProperty =
    properties.budget_text && typeof properties.budget_text === "object"
      ? (properties.budget_text as Record<string, unknown>)
      : null;
  const handoffHeader =
    requestHeaders?.["x-research-handoff-token"] &&
    typeof requestHeaders["x-research-handoff-token"] === "object"
      ? (requestHeaders["x-research-handoff-token"] as Record<string, unknown>)
      : null;

  if ("research_session_id" in properties || required.includes("research_session_id")) {
    failures.push("tool schema must not expose model-authored research_session_id");
  }

  if ("missing_fields" in properties || "ready_for_market" in properties) {
    failures.push("tool schema must not expose derived control-plane fields");
  }

  if (!required.includes("budget_text") || budgetTextProperty?.type !== "string") {
    failures.push("tool schema must require primitive budget_text");
  }

  const requiredObjectTypedFields = findRequiredObjectTypedFields(requestBodySchema);
  if (requiredObjectTypedFields.length > 0) {
    failures.push(
      `tool schema must not require object-typed fields: ${requiredObjectTypedFields.join(", ")}`,
    );
  }

  if (handoffHeader?.variableName !== "secret__handoff_token") {
    failures.push("tool schema must bind x-research-handoff-token to secret__handoff_token");
  }

  return failures;
}

function normalizeToolSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeToolSchema(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const entries = Object.entries(source).flatMap(([key, entry]) => {
    if (
      (key === "constantValue" || key === "dynamicVariable" || key === "constant_value" || key === "dynamic_variable") &&
      (entry === "" || entry == null)
    ) {
      return [];
    }

    if ((key === "isSystemProvided" || key === "is_system_provided") && entry === false) {
      return [];
    }

    if (key === "enum" && entry == null) {
      return [];
    }

    if (key === "description" && entry === "") {
      return [];
    }

    if ((key === "required" || key === "pathParamsSchema") && Array.isArray(entry) && entry.length === 0) {
      return [];
    }

    if (
      key === "pathParamsSchema" &&
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      Object.keys(entry as Record<string, unknown>).length === 0
    ) {
      return [];
    }

    return [[key, normalizeToolSchema(entry)] as const];
  });

  return Object.fromEntries(entries);
}

function pickLiveAgentSnapshot(agent: AgentResponseLike) {
  const agentConfig = agent.conversationConfig?.agent ?? {};
  const turn = agent.conversationConfig?.turn ?? {};
  const tts = agent.conversationConfig?.tts ?? {};
  const prompt = agentConfig.prompt ?? {};
  const platformSettings = agent.platformSettings ?? {};

  return {
    name: agent.name,
    tags: [...(agent.tags ?? [])].sort(),
    branchId: agent.branchId ?? undefined,
    conversationConfig: {
      turn: {
        turnTimeout: turn.turnTimeout ?? undefined,
        silenceEndCallTimeout: turn.silenceEndCallTimeout ?? undefined,
        speculativeTurn: turn.speculativeTurn ?? false,
        softTimeoutConfig: normalizeToolSchema(turn.softTimeoutConfig ?? {}) as Record<string, unknown>,
      },
      tts: {
        modelId: tts.modelId ?? "",
        voiceId: tts.voiceId ?? "",
      },
      agent: {
        firstMessage: agentConfig.firstMessage ?? "",
        language: agentConfig.language ?? "",
        hinglishMode: agentConfig.hinglishMode ?? false,
        disableFirstMessageInterruptions: agentConfig.disableFirstMessageInterruptions ?? false,
        prompt: {
          prompt: prompt.prompt ?? "",
          llm: prompt.llm ?? "",
          toolIds: [...(prompt.toolIds ?? [])].sort(),
          ignoreDefaultPersonality: prompt.ignoreDefaultPersonality ?? false,
          temperature: prompt.temperature ?? undefined,
          timezone: prompt.timezone ?? "",
        },
      },
    },
    platformSettings: {
      auth: {
        enableAuth: platformSettings.auth?.enableAuth ?? false,
        requireOriginHeader: platformSettings.auth?.requireOriginHeader ?? false,
      },
      summaryLanguage: platformSettings.summaryLanguage ?? "",
      dataCollection: normalizeToolSchema(platformSettings.dataCollection ?? {}) as Record<string, unknown>,
      workspaceOverrides: normalizeToolSchema(platformSettings.workspaceOverrides ?? {}) as Record<string, unknown>,
      guardrails: normalizeToolSchema(platformSettings.guardrails ?? {}) as Record<string, unknown>,
    },
  };
}

function pickDesiredAgentSnapshot(toolId: string, postCallWebhookId: string, branchId?: string) {
  const desired = buildResearchAgentUpdateRequest(toolId, postCallWebhookId) as {
    name?: string;
    tags?: string[];
    conversationConfig?: AgentResponseLike["conversationConfig"];
    platformSettings?: AgentResponseLike["platformSettings"];
  };

  return pickLiveAgentSnapshot({
    name: desired.name ?? "",
    tags: desired.tags,
    branchId,
    conversationConfig: desired.conversationConfig,
    platformSettings: desired.platformSettings,
  });
}

async function resolveResearchPostCallWebhook(
  client: ReturnType<typeof createElevenLabsClient>,
  baseUrl: string,
  intakeSecret: string,
  webhookSecret?: string,
) {
  const desiredWebhookUrl = buildResearchPostCallWebhookUrl(baseUrl, intakeSecret, webhookSecret);
  const listResponse = await client.webhooks.list();
  const webhooks = listResponse.webhooks ?? [];
  const exactUrlMatch = webhooks.find((entry) => entry.webhookUrl === desiredWebhookUrl);

  if (!exactUrlMatch) {
    throw new Error(
      `Missing ${RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME} post-call webhook for ${desiredWebhookUrl}. Run agent:research:sync first.`,
    );
  }

  if (exactUrlMatch.name !== RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME) {
    throw new Error(
      `Post-call webhook name drifted: expected ${RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME} but found ${exactUrlMatch.name}.`,
    );
  }

  if (exactUrlMatch.isDisabled) {
    throw new Error(`Post-call webhook ${exactUrlMatch.webhookId} is disabled.`);
  }

  return exactUrlMatch.webhookId;
}

function pickLiveToolSnapshot(tool: ToolResponseLike) {
  const toolConfig = tool.toolConfig ?? {};
  return {
    name: toolConfig.name,
    description: toolConfig.description,
    responseTimeoutSecs: toolConfig.responseTimeoutSecs,
    disableInterruptions: toolConfig.disableInterruptions ?? false,
    executionMode: toolConfig.executionMode ?? undefined,
    toolErrorHandlingMode: toolConfig.toolErrorHandlingMode ?? undefined,
    apiSchema: normalizeToolSchema(toolConfig.apiSchema),
  };
}

function pickDesiredToolSnapshot(toolConfig: ToolConfigLike) {
  return {
    name: toolConfig.name,
    description: toolConfig.description,
    responseTimeoutSecs: toolConfig.responseTimeoutSecs,
    disableInterruptions: toolConfig.disableInterruptions ?? false,
    executionMode: toolConfig.executionMode ?? undefined,
    toolErrorHandlingMode: toolConfig.toolErrorHandlingMode ?? undefined,
    apiSchema: normalizeToolSchema(toolConfig.apiSchema),
  };
}

async function main() {
  const runtime = readResearchAgentRuntimeEnv();
  const client = createElevenLabsClient(runtime.apiKey);
  const allowLocalhost = process.argv.includes("--allow-localhost");

  if (runtime.baseUrl.startsWith("http://localhost") && !allowLocalhost) {
    throw new Error(
      "Set RESEARCH_AGENT_WEBHOOK_BASE_URL, APP_BASE_URL, NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SITE_URL, or VERCEL_URL before verifying. Pass --allow-localhost only for local dry runs.",
    );
  }

  console.log(heading("Research agent verify"));
  console.log(`Agent: ${runtime.agentId}`);
  console.log(`Branch: ${runtime.branchId ?? "(main)"}`);
  console.log(`Base URL: ${runtime.baseUrl}`);

  const agentResponse = (await client.conversationalAi.agents.get(
    runtime.agentId,
    runtime.branchId ? { branchId: runtime.branchId } : undefined,
  )) as AgentResponseLike;
  const toolList = await client.conversationalAi.tools.list({
    search: RESEARCH_AGENT_TOOL_NAME,
    pageSize: 100,
    showOnlyOwnedDocuments: true,
    sortBy: "name",
    sortDirection: "asc",
  });

  const exactTools = (toolList.tools as unknown[]).filter((tool): tool is ToolResponseLike => {
    const record = tool as ToolResponseLike;
    return (
      record.toolConfig?.type === "webhook" &&
      record.toolConfig?.name === RESEARCH_AGENT_TOOL_NAME
    );
  });
  const tool = assertUniqueSaveResearchBriefTool(
    exactTools as unknown as Parameters<typeof assertUniqueSaveResearchBriefTool>[0],
  ) as ToolResponseLike;
  const desiredToolConfig = (buildResearchBriefToolConfig(runtime.baseUrl, runtime.intakeSecret) as {
    toolConfig: ToolConfigLike;
  }).toolConfig;
  const contractFailures = validateDesiredToolContract(desiredToolConfig);
  const desiredToolSnapshot = pickDesiredToolSnapshot(desiredToolConfig);
  const liveToolSnapshot = pickLiveToolSnapshot(tool);
  const toolDiffs = diffValues(desiredToolSnapshot, liveToolSnapshot);
  const postCallWebhookId = await resolveResearchPostCallWebhook(
    client,
    runtime.baseUrl,
    runtime.intakeSecret,
    runtime.webhookSecret,
  );

  const resolvedToolIds = agentResponse.conversationConfig?.agent?.prompt?.toolIds ?? [];

  const expectedAgentSnapshot = pickDesiredAgentSnapshot(tool.id, postCallWebhookId, runtime.branchId);
  const liveAgentSnapshot = pickLiveAgentSnapshot(agentResponse);
  const agentDiffs = diffValues(expectedAgentSnapshot, liveAgentSnapshot);
  const webhookConfig =
    agentResponse.platformSettings?.workspaceOverrides &&
    typeof agentResponse.platformSettings.workspaceOverrides === "object"
      ? (agentResponse.platformSettings.workspaceOverrides as Record<string, unknown>)
      : {};
  const liveWebhookSettings =
    webhookConfig.webhooks && typeof webhookConfig.webhooks === "object"
      ? (webhookConfig.webhooks as Record<string, unknown>)
      : {};
  const webhookDiffs = diffValues(
    {
      postCallWebhookId,
      events: [...RESEARCH_AGENT_POST_CALL_WEBHOOK_EVENTS],
    },
    {
      postCallWebhookId:
        typeof liveWebhookSettings.postCallWebhookId === "string"
          ? liveWebhookSettings.postCallWebhookId
          : undefined,
      events: Array.isArray(liveWebhookSettings.events) ? liveWebhookSettings.events : [],
    },
    "$.platformSettings.workspaceOverrides.webhooks",
  );

  const promptToolIdDiff =
    resolvedToolIds.length === 1 && resolvedToolIds[0] === tool.id
      ? []
      : [
          `$.conversationConfig.agent.prompt.toolIds: expected [${tool.id}] but found ${JSON.stringify(
            resolvedToolIds,
          )}`,
        ];

  const failures = [...contractFailures, ...toolDiffs, ...agentDiffs, ...webhookDiffs, ...promptToolIdDiff];

  if (failures.length > 0) {
    console.log("Live tool snapshot:");
    console.log(stableJson(liveToolSnapshot));
    console.log("Desired tool snapshot:");
    console.log(stableJson(desiredToolSnapshot));
    console.log("Live agent snapshot:");
    console.log(stableJson(liveAgentSnapshot));
    console.log("Desired agent snapshot:");
    console.log(stableJson(expectedAgentSnapshot));
    console.error("\nDiffs:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Tool and agent config match the repo manifest.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
