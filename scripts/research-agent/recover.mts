import { buildResearchAgentUpdateRequest, buildResearchBriefToolConfig, buildResearchPostCallWebhookUrl, RESEARCH_AGENT_NAME, RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME, RESEARCH_AGENT_VERSION_DESCRIPTION, RESEARCH_AGENT_TOOL_NAME } from "../../config/elevenlabs/research-agent.ts";
import { isSaveResearchBriefTool } from "../../src/lib/research/elevenlabs-client.ts";
import { createElevenLabsClient, diffValues, heading, readResearchAgentBootstrapEnv, stableJson } from "./shared.mts";
import { UpdateAgentRequest as UpdateAgentRequestSerializer } from "../../node_modules/@elevenlabs/elevenlabs-js/serialization/resources/conversationalAi/resources/agents/client/requests/UpdateAgentRequest.js";

const apply = process.argv.includes("--apply");
const dryRun = !apply || process.argv.includes("--dry-run");
const allowLocalhost = process.argv.includes("--allow-localhost");

type Runtime = ReturnType<typeof readResearchAgentBootstrapEnv>;
type ElevenLabsClientInstance = ReturnType<typeof createElevenLabsClient>;
type ToolCreateRequest = Parameters<ElevenLabsClientInstance["conversationalAi"]["tools"]["create"]>[0];
type WebhookCreateRequest = Parameters<ElevenLabsClientInstance["webhooks"]["create"]>[0];
type AgentCreateRequest = Parameters<ElevenLabsClientInstance["conversationalAi"]["agents"]["create"]>[0];
type AgentUpdateRequest = NonNullable<
  Parameters<ElevenLabsClientInstance["conversationalAi"]["agents"]["update"]>[1]
>;
type AgentUpdateRequestWithGuardrails = AgentUpdateRequest & {
  platformSettings?: NonNullable<AgentUpdateRequest["platformSettings"]> & {
    guardrails?: Record<string, unknown>;
  };
};
type AgentSnapshot = {
  name?: string;
  tags?: string[];
  branchId?: string;
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
  platformSettings?: AgentUpdateRequestWithGuardrails["platformSettings"];
};

function pickAgentSnapshot(agent: AgentSnapshot) {
  const agentConfig = agent.conversationConfig?.agent ?? {};
  const turn = agent.conversationConfig?.turn ?? {};
  const tts = agent.conversationConfig?.tts ?? {};
  const prompt = agentConfig.prompt ?? {};

  return {
    name: agent.name,
    tags: [...(agent.tags ?? [])].sort(),
    branchId: agent.branchId,
    conversationConfig: {
      turn: {
        turnTimeout: turn.turnTimeout ?? undefined,
        silenceEndCallTimeout: turn.silenceEndCallTimeout ?? undefined,
        speculativeTurn: turn.speculativeTurn ?? false,
        softTimeoutConfig: turn.softTimeoutConfig ?? undefined,
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
    platformSettings: agent.platformSettings,
  };
}

function buildCreateRequest(toolId: string, postCallWebhookId: string): AgentCreateRequest {
  const updateRequest = buildResearchAgentUpdateRequest(toolId, postCallWebhookId);

  return {
    enableVersioning: true,
    name: updateRequest.name,
    tags: updateRequest.tags,
    conversationConfig: updateRequest.conversationConfig,
    platformSettings: updateRequest.platformSettings,
  } as unknown as AgentCreateRequest;
}

function withSerializedGuardrails(request: AgentUpdateRequestWithGuardrails) {
  const body = {
    ...(request as AgentUpdateRequestWithGuardrails & {
      platformSettings?: AgentSnapshot["platformSettings"];
    }),
  };

  delete body.branchId;
  delete body.enableVersioningIfNotEnabled;

  const serialized = UpdateAgentRequestSerializer.jsonOrThrow(body, {
    unrecognizedObjectKeys: "strip",
  }) as Record<string, unknown>;
  const desiredGuardrails = request.platformSettings?.guardrails;

  if (desiredGuardrails !== undefined) {
    const platformSettings =
      serialized.platform_settings &&
      typeof serialized.platform_settings === "object" &&
      !Array.isArray(serialized.platform_settings)
        ? (serialized.platform_settings as Record<string, unknown>)
        : {};

    serialized.platform_settings = {
      ...platformSettings,
      guardrails: desiredGuardrails,
    };
  }

  return serialized;
}

async function patchAgentConfig(
  runtime: Runtime,
  request: AgentUpdateRequestWithGuardrails,
  agentId: string,
) {
  const url = new URL(`v1/convai/agents/${agentId}`, "https://api.elevenlabs.io/");

  if (request.enableVersioningIfNotEnabled != null) {
    url.searchParams.set(
      "enable_versioning_if_not_enabled",
      String(request.enableVersioningIfNotEnabled),
    );
  }

  if (request.branchId) {
    url.searchParams.set("branch_id", request.branchId);
  }

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": runtime.apiKey,
    },
    body: JSON.stringify(withSerializedGuardrails(request)),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Agent recover sync failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
    );
  }

  return (await response.json()) as {
    agentId?: string;
    branchId?: string | null;
  };
}

async function resolveSaveResearchBriefTool(
  client: ElevenLabsClientInstance,
  baseUrl: string,
  intakeSecret: string,
) {
  const listResponse = await client.conversationalAi.tools.list({
    search: RESEARCH_AGENT_TOOL_NAME,
    pageSize: 100,
    showOnlyOwnedDocuments: true,
    sortBy: "name",
    sortDirection: "asc",
  });

  const matches = listResponse.tools.filter((tool) => {
    const toolName =
      tool.toolConfig?.type === "webhook" &&
      tool.toolConfig &&
      "name" in tool.toolConfig
        ? tool.toolConfig.name
        : undefined;
    return isSaveResearchBriefTool(toolName);
  });
  const exactMatches = matches.filter((tool) => {
    return (
      tool.toolConfig?.type === "webhook" &&
      tool.toolConfig &&
      "name" in tool.toolConfig &&
      tool.toolConfig.name === RESEARCH_AGENT_TOOL_NAME
    );
  });

  const desiredToolRequest = buildResearchBriefToolConfig(
    baseUrl,
    intakeSecret,
  ) as unknown as ToolCreateRequest;

  if (exactMatches.length > 1) {
    throw new Error(
      `Expected exactly one ${RESEARCH_AGENT_TOOL_NAME} tool, found ${exactMatches.length}. Remove duplicate tools before recovering.`,
    );
  }

  if (matches.length === 0) {
    if (dryRun) {
      console.log(`Would create tool ${RESEARCH_AGENT_TOOL_NAME}`);
      return { toolId: "(dry-run)", toolConfig: desiredToolRequest.toolConfig };
    }

    const created = await client.conversationalAi.tools.create(desiredToolRequest);
    return { toolId: created.id, toolConfig: created.toolConfig };
  }

  const liveTool =
    exactMatches[0] ??
    (() => {
      if (matches.length !== 1) {
        throw new Error(
          `Expected exactly one compatible research handoff tool to recover, found ${matches.length}. Remove duplicates before recovering.`,
        );
      }

      return matches[0];
    })();

  if (dryRun) {
    const diffs = diffValues(desiredToolRequest.toolConfig, liveTool.toolConfig);
    if (diffs.length === 0) {
      console.log(`Tool ${liveTool.id} already matches desired config.`);
    } else {
      console.log(`Would update tool ${liveTool.id}`);
      for (const diff of diffs) {
        console.log(`- ${diff}`);
      }
    }
    return { toolId: liveTool.id, toolConfig: liveTool.toolConfig };
  }

  const updated = await client.conversationalAi.tools.update(
    liveTool.id,
    desiredToolRequest,
  );
  return { toolId: updated.id, toolConfig: updated.toolConfig };
}

async function resolveResearchPostCallWebhook(
  client: ElevenLabsClientInstance,
  baseUrl: string,
  intakeSecret: string,
  webhookSecret?: string,
) {
  const desiredWebhookUrl = buildResearchPostCallWebhookUrl(
    baseUrl,
    intakeSecret,
    webhookSecret,
  );
  const desiredWebhookRequest = {
    settings: {
      authType: "hmac",
      name: RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME,
      webhookUrl: desiredWebhookUrl,
    },
  } satisfies WebhookCreateRequest;
  const listResponse = await client.webhooks.list();
  const webhooks = listResponse.webhooks ?? [];
  const exactNameMatches = webhooks.filter(
    (entry) => entry.name === RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME,
  );
  const exactUrlMatch =
    exactNameMatches.find((entry) => entry.webhookUrl === desiredWebhookUrl) ??
    webhooks.find((entry) => entry.webhookUrl === desiredWebhookUrl);

  if (exactNameMatches.length > 1 && !exactUrlMatch) {
    throw new Error(
      `Expected at most one ${RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME} webhook, found ${exactNameMatches.length}. Remove duplicates before recovering.`,
    );
  }

  if (exactUrlMatch) {
    if (dryRun) {
      if (
        exactUrlMatch.isDisabled ||
        exactUrlMatch.name !== RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME
      ) {
        console.log(`Would enable/update webhook ${exactUrlMatch.webhookId}`);
      }
      return exactUrlMatch.webhookId;
    }

    if (
      exactUrlMatch.isDisabled ||
      exactUrlMatch.name !== RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME
    ) {
      await client.webhooks.update(exactUrlMatch.webhookId, {
        isDisabled: false,
        name: RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME,
        retryEnabled: true,
      });
    }

    return exactUrlMatch.webhookId;
  }

  if (exactNameMatches.length === 1) {
    if (dryRun) {
      console.log(
        `Would replace webhook ${exactNameMatches[0].webhookId} because the URL drifted to ${exactNameMatches[0].webhookUrl}`,
      );
      return "(dry-run)";
    }

    await client.webhooks.delete(exactNameMatches[0].webhookId);
  }

  if (dryRun) {
    console.log(`Would create webhook ${RESEARCH_AGENT_POST_CALL_WEBHOOK_NAME}`);
    return "(dry-run)";
  }

  const created = await client.webhooks.create(desiredWebhookRequest);
  return created.webhookId;
}

async function resolveOwnedResearchAgent(client: ElevenLabsClientInstance, runtime: Runtime) {
  if (runtime.researchAgentId) {
    try {
      return await client.conversationalAi.agents.get(runtime.researchAgentId);
    } catch {
      console.log(
        `Configured research agent ${runtime.researchAgentId} was not found in the current workspace.`,
      );
    }
  }

  const listResponse = await client.conversationalAi.agents.list({
    pageSize: 100,
    search: RESEARCH_AGENT_NAME,
    showOnlyOwnedAgents: true,
    sortBy: "name",
    sortDirection: "asc",
  });
  const matches = (listResponse.agents ?? []).filter(
    (agent) => agent.name === RESEARCH_AGENT_NAME && !agent.archived,
  );

  if (matches.length > 1) {
    throw new Error(
      `Expected at most one owned ${RESEARCH_AGENT_NAME} agent, found ${matches.length}.`,
    );
  }

  if (matches.length === 0) {
    return null;
  }

  return client.conversationalAi.agents.get(matches[0].agentId);
}

async function resolveOrCreateResearchAgent(
  client: ElevenLabsClientInstance,
  runtime: Runtime,
  toolId: string,
  postCallWebhookId: string,
) {
  const existing = await resolveOwnedResearchAgent(client, runtime);

  if (existing) {
    return existing;
  }

  if (dryRun) {
    console.log(`Would create agent ${RESEARCH_AGENT_NAME}`);
    return null;
  }

  const created = await client.conversationalAi.agents.create(
    buildCreateRequest(toolId, postCallWebhookId),
  );
  console.log(`Created agent: ${created.agentId}`);
  return client.conversationalAi.agents.get(created.agentId);
}

async function resolveOrCreateManagedBranch(
  client: ElevenLabsClientInstance,
  runtime: Runtime,
  agentId: string,
  mainAgent: Awaited<ReturnType<ElevenLabsClientInstance["conversationalAi"]["agents"]["get"]>>,
) {
  const branchList = await client.conversationalAi.agents.branches.list(agentId, {
    includeArchived: false,
    limit: 100,
  });
  const branchSummaries = branchList.results ?? [];

  if (runtime.researchAgentBranchId) {
    try {
      const configuredBranch = await client.conversationalAi.agents.branches.get(
        agentId,
        runtime.researchAgentBranchId,
      );
      return {
        branchId: runtime.researchAgentBranchId,
        branchName: configuredBranch.name ?? "research-sync",
        created: false,
      };
    } catch {
      console.log(
        `Configured research branch ${runtime.researchAgentBranchId} was not found in the current workspace.`,
      );
    }
  }

  const exactNameMatch = branchSummaries.find((branch) => branch.name === "research-sync");
  if (exactNameMatch) {
    return {
      branchId: exactNameMatch.id,
      branchName: exactNameMatch.name,
      created: false,
    };
  }

  if (!mainAgent.versionId) {
    throw new Error("Unable to create a managed branch because the main version id is missing.");
  }

  if (dryRun) {
    console.log("Would create branch research-sync from the current main agent version.");
    return {
      branchId: "(dry-run)",
      branchName: "research-sync",
      created: true,
    };
  }

  const created = await client.conversationalAi.agents.branches.create(agentId, {
    parentVersionId: mainAgent.versionId,
    name: "research-sync",
    description: RESEARCH_AGENT_VERSION_DESCRIPTION,
  });

  return {
    branchId: created.createdBranchId,
    branchName: "research-sync",
    created: true,
  };
}

function printEnvSnippet(input: {
  agentId: string;
  branchId: string;
  webhookId: string;
}) {
  console.log("\nRecommended env values:");
  console.log(`ELEVENLABS_RESEARCH_AGENT_ID=${input.agentId}`);
  console.log(`NEXT_PUBLIC_ELEVENLABS_RESEARCH_AGENT_ID=${input.agentId}`);
  console.log(`ELEVENLABS_RESEARCH_AGENT_BRANCH_ID=${input.branchId}`);
  console.log(`ELEVENLABS_AGENT_ID=${input.agentId}`);
  console.log(`NEXT_PUBLIC_ELEVENLABS_AGENT_ID=${input.agentId}`);
  console.log(`ELEVENLABS_AGENT_BRANCH_ID=${input.branchId}`);
  console.log(`# Workspace webhook id: ${input.webhookId}`);
}

async function main() {
  const runtime = readResearchAgentBootstrapEnv();
  const client = createElevenLabsClient(runtime.apiKey);

  if (runtime.baseUrl.startsWith("http://localhost") && !allowLocalhost) {
    throw new Error(
      "Set RESEARCH_AGENT_WEBHOOK_BASE_URL, APP_BASE_URL, NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SITE_URL, or VERCEL_URL before recovering. Pass --allow-localhost only for local dry runs.",
    );
  }

  console.log(heading("Research agent recover"));
  console.log(`Configured agent: ${runtime.researchAgentId ?? "(unset)"}`);
  console.log(`Configured branch: ${runtime.researchAgentBranchId ?? "(unset)"}`);
  console.log(`Base URL: ${runtime.baseUrl}`);
  console.log(`Mode: ${dryRun ? "dry-run" : "apply"}`);

  const tool = await resolveSaveResearchBriefTool(
    client,
    runtime.baseUrl,
    runtime.intakeSecret,
  );
  console.log(`Resolved tool ${RESEARCH_AGENT_TOOL_NAME}: ${tool.toolId}`);

  const postCallWebhookId = await resolveResearchPostCallWebhook(
    client,
    runtime.baseUrl,
    runtime.intakeSecret,
    runtime.webhookSecret,
  );
  console.log(`Resolved post-call webhook: ${postCallWebhookId}`);

  const agent = await resolveOrCreateResearchAgent(
    client,
    runtime,
    tool.toolId,
    postCallWebhookId,
  );

  if (!agent) {
    console.log("\nWould create agent with this request:");
    console.log(stableJson(buildCreateRequest(tool.toolId, postCallWebhookId)));
    return;
  }

  console.log(`Resolved agent: ${agent.agentId}`);
  console.log(`Main branch: ${agent.mainBranchId ?? "(unknown)"}`);
  console.log(`Main version: ${agent.versionId ?? "(unknown)"}`);

  const managedBranch = await resolveOrCreateManagedBranch(
    client,
    runtime,
    agent.agentId,
    agent,
  );
  console.log(
    `${managedBranch.created ? "Created" : "Resolved"} managed branch: ${managedBranch.branchId} (${managedBranch.branchName})`,
  );

  const desiredRequest = buildResearchAgentUpdateRequest(
    tool.toolId,
    postCallWebhookId,
  ) as AgentUpdateRequestWithGuardrails;
  const requestWithBranch: AgentUpdateRequestWithGuardrails = {
    ...desiredRequest,
    branchId: managedBranch.branchId,
  };

  if (dryRun) {
    if (managedBranch.branchId !== "(dry-run)") {
      const liveBranch = await client.conversationalAi.agents.get(agent.agentId, {
        branchId: managedBranch.branchId,
      });
      const diffs = diffValues(
        pickAgentSnapshot({
          name: requestWithBranch.name,
          conversationConfig: requestWithBranch.conversationConfig,
          platformSettings: requestWithBranch.platformSettings,
          tags: requestWithBranch.tags,
          branchId: requestWithBranch.branchId,
        }),
        pickAgentSnapshot({
          name: liveBranch.name,
          conversationConfig: liveBranch.conversationConfig,
          platformSettings: liveBranch.platformSettings,
          tags: liveBranch.tags,
          branchId: liveBranch.branchId ?? undefined,
        }),
      );

      if (diffs.length === 0) {
        console.log("Managed branch already matches desired config.");
      } else {
        console.log("Managed branch diff:");
        for (const diff of diffs) {
          console.log(`- ${diff}`);
        }
      }
    }

    console.log("\nDesired managed branch request:");
    console.log(stableJson(requestWithBranch));
    printEnvSnippet({
      agentId: agent.agentId,
      branchId: managedBranch.branchId,
      webhookId: postCallWebhookId,
    });
    return;
  }

  const updatedAgent = await patchAgentConfig(runtime, requestWithBranch, agent.agentId);
  console.log(`Updated agent: ${updatedAgent.agentId}`);
  console.log(`Pinned branch: ${updatedAgent.branchId ?? managedBranch.branchId}`);

  printEnvSnippet({
    agentId: agent.agentId,
    branchId: managedBranch.branchId,
    webhookId: postCallWebhookId,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
