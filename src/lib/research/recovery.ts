import {
  buildResearchBriefFromPayload,
  computeMissingFields,
  normalizeSaveResearchBriefToolPayload,
  type InputMode,
  type PartialResearchBrief,
  type SaveResearchBriefRoutePayload,
} from "./schemas.ts";
import {
  extractResearchMessageText,
  inferResearchMessageModality,
  inferResearchMessageRole,
  type PersistableResearchMessageModality,
  type PersistableResearchMessageRole,
  isSaveResearchBriefTool,
} from "./elevenlabs-client.ts";

type RecoverySource = "data_collection" | "tool_call";

export type RecoveredConversationMessage = {
  role: PersistableResearchMessageRole;
  modality: PersistableResearchMessageModality;
  content: string;
  payload: Record<string, unknown>;
};

export type ResearchToolFailure = {
  kind: string | null;
  reason: string | null;
  toolWasCalled: boolean | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
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

function firstDefined<T>(...values: Array<T | undefined>) {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return undefined;
}

function parseJsonRecord(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return asRecord(parsed);
    } catch {
      return null;
    }
  }

  return asRecord(value);
}

function collectDataCollectionValues(analysis: Record<string, unknown> | null) {
  const values: Record<string, unknown> = {};
  const results = asRecord(analysis?.dataCollectionResults);

  for (const [key, entry] of Object.entries(results ?? {})) {
    const entryRecord = asRecord(entry);

    if (entryRecord && "value" in entryRecord) {
      values[key] = entryRecord.value;
    }
  }

  const list = Array.isArray(analysis?.dataCollectionResultsList)
    ? analysis.dataCollectionResultsList
    : [];

  for (const entry of list) {
    const entryRecord = asRecord(entry);
    const key = firstString(
      entryRecord?.dataCollectionId,
      entryRecord?.data_collection_id,
      entryRecord?.name,
    );

    if (!key || !(entryRecord && "value" in entryRecord) || key in values) {
      continue;
    }

    values[key] = entryRecord.value;
  }

  return values;
}

function collectConversationTurnCandidates(conversation: Record<string, unknown>) {
  const candidates: unknown[] = [];

  for (const key of ["transcript", "messages", "turns"] as const) {
    const value = conversation[key];

    if (Array.isArray(value)) {
      candidates.push(...value);
    }
  }

  return candidates;
}

function readRecoveredMessageEventId(payload: Record<string, unknown> | null) {
  return firstString(
    payload?.event_id,
    payload?.eventId,
    payload?.recovered_event_id,
    payload?.recoveredEventId,
    payload?.tool_call_id,
    payload?.toolCallId,
  );
}

function normalizeRecoveredMessageToken(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function buildRecoveredMessageEventId(args: {
  conversationId: string | undefined;
  turnIndex: number;
  role: PersistableResearchMessageRole;
  content: string;
}) {
  const normalizedContent = normalizeRecoveredMessageToken(args.content) || "message";

  return [
    "recovered",
    args.conversationId ?? "unknown",
    String(args.turnIndex),
    args.role,
    normalizedContent,
  ].join(":");
}

function getRecoveredMessageIdentity(args: {
  role: PersistableResearchMessageRole;
  modality: PersistableResearchMessageModality;
  content: string;
  payload: Record<string, unknown> | null;
}) {
  const eventId = readRecoveredMessageEventId(args.payload);
  const conversationId = firstString(
    args.payload?.conversation_id,
    args.payload?.conversationId,
  );

  if (eventId) {
    return [
      conversationId ?? "",
      eventId,
      args.role,
      args.modality,
    ].join("\u0000");
  }

  return [
    conversationId ?? "",
    args.role,
    args.modality,
    args.content,
    JSON.stringify(args.payload ?? {}),
  ].join("\u0000");
}

export function extractRecoveredConversationMessages(
  conversation: unknown,
): RecoveredConversationMessage[] {
  const record = asRecord(conversation);

  if (!record) {
    return [];
  }

  const messages: RecoveredConversationMessage[] = [];
  const seen = new Map<string, number>();
  const parentConversationId = firstString(
    record.conversationId,
    record.conversation_id,
  );
  for (const [turnIndex, candidate] of collectConversationTurnCandidates(record).entries()) {
    const role = inferResearchMessageRole(candidate);
    const content = extractResearchMessageText(candidate)?.trim();

    if (!role || !content) {
      continue;
    }

    const modality = inferResearchMessageModality(candidate);
    const payload = asRecord(candidate);
    const conversationId =
      firstString(
        payload?.conversation_id,
        payload?.conversationId,
      ) ?? parentConversationId;
    const nextPayload: Record<string, unknown> = {
      ...(payload ?? { content }),
      ...(conversationId ? { conversation_id: conversationId } : {}),
    };
    const recoveredEventId =
      readRecoveredMessageEventId(nextPayload) ??
      buildRecoveredMessageEventId({
        conversationId,
        turnIndex,
        role,
        content,
      });
    nextPayload.recovered_event_id = recoveredEventId;
    const key = getRecoveredMessageIdentity({
      role,
      modality,
      content,
      payload: nextPayload,
    });

    const nextMessage = {
      role,
      modality,
      content,
      payload: nextPayload,
    } satisfies RecoveredConversationMessage;
    const existingIndex = seen.get(key);

    if (typeof existingIndex === "number") {
      messages[existingIndex] = nextMessage;
      continue;
    }

    seen.set(key, messages.length);
    messages.push(nextMessage);
  }

  return messages;
}

function normalizeRecoveryPayload(
  candidate: Record<string, unknown>,
  sessionId: string,
  inputMode: InputMode,
): SaveResearchBriefRoutePayload | null {
  const parsed = normalizeSaveResearchBriefToolPayload(candidate, {
    sessionId,
    inputMode,
    countryCode: "IN",
  });

  if (!parsed) {
    return null;
  }

  const nextBrief = buildResearchBriefFromPayload(parsed);

  return computeMissingFields(nextBrief).length === 0 ? parsed : null;
}

function deriveRecoveryReason(
  candidate: Record<string, unknown>,
  sessionId: string,
  inputMode: InputMode,
  currentBrief?: PartialResearchBrief,
) {
  try {
    const nextBrief = buildResearchBriefFromPayload(
      normalizeSaveResearchBriefToolPayload(candidate, {
        sessionId,
        inputMode,
        countryCode: currentBrief?.countryCode ?? "IN",
      }) ?? {
        research_session_id: sessionId,
        input_mode: inputMode,
        country_code: currentBrief?.countryCode ?? "IN",
        category: currentBrief?.category ?? "unclear",
        scope_status: currentBrief?.scopeStatus ?? "unclear",
        city: currentBrief?.city ?? "",
        headcount: currentBrief?.headcount ?? 0,
        budget: currentBrief?.budget ?? "",
        summary: currentBrief?.summary ?? "",
        market_query_preview: currentBrief?.marketQueryPreview ?? "",
      },
      currentBrief,
    );
    const missing = computeMissingFields(nextBrief);

    if (missing.length > 0) {
      return `Missing recoverable fields: ${missing.join(", ")}.`;
    }
  } catch {
    return "Recovered conversation data did not match the market-brief schema.";
  }

  return "Recovered conversation data did not satisfy the required intake gate.";
}

function buildPayloadFromDataCollection(
  conversation: Record<string, unknown>,
  sessionId: string,
  inputMode: InputMode,
  currentBrief?: PartialResearchBrief,
) {
  const analysis = asRecord(conversation.analysis);
  const values = collectDataCollectionValues(analysis);
  const conversationId = firstString(
    conversation.conversationId,
    conversation.conversation_id,
  );

  const candidate: Record<string, unknown> = {
    research_session_id: sessionId,
    input_mode: inputMode,
    country_code: firstDefined(
      firstString(values.country_code, values.countryCode),
      currentBrief?.countryCode,
      "IN",
    ),
    category: firstDefined(
      firstString(values.category),
      currentBrief?.category,
    ),
    scope_status: firstDefined(
      firstString(values.scope_status, values.scopeStatus),
      currentBrief?.scopeStatus,
    ),
    city: firstDefined(
      firstString(values.city),
      currentBrief?.city,
    ),
    headcount: firstDefined(
      values.headcount,
      currentBrief?.headcount,
    ),
    localities: firstDefined(
      normalizeStringArray(values.localities),
      currentBrief?.localities,
    ),
    preferred_languages: firstDefined(
      normalizeStringArray(values.preferred_languages ?? values.preferredLanguages),
      currentBrief?.preferredLanguages,
    ),
    budget:
      firstString(values.budget_text, values.budgetText, values.budget) ??
      currentBrief?.budget,
    timeline: firstDefined(
      parseJsonRecord(values.timeline) ??
        (firstString(values.timeline_text, values.timelineText)
          ? { label: firstString(values.timeline_text, values.timelineText) }
          : values.timeline),
      currentBrief?.timeline,
    ),
    must_haves: firstDefined(
      normalizeStringArray(values.must_haves ?? values.mustHaves),
      currentBrief?.mustHaves,
    ),
    nice_to_haves: firstDefined(
      normalizeStringArray(values.nice_to_haves ?? values.niceToHaves),
      currentBrief?.niceToHaves,
    ),
    deal_breakers: firstDefined(
      normalizeStringArray(values.deal_breakers ?? values.dealBreakers),
      currentBrief?.dealBreakers,
    ),
    summary: firstDefined(
      firstString(values.summary, analysis?.transcriptSummary, analysis?.transcript_summary),
      currentBrief?.summary,
    ),
    market_query_preview: firstDefined(
      firstString(values.market_query_preview, values.marketQueryPreview),
      currentBrief?.marketQueryPreview,
    ),
    source_strategy_hint: firstDefined(
      firstString(values.source_strategy_hint, values.sourceStrategyHint),
      currentBrief?.sourceStrategyHint,
    ),
    category_details: firstDefined(
      parseJsonRecord(values.category_details ?? values.categoryDetails) ??
        values.category_details ??
        values.categoryDetails,
      currentBrief?.categoryDetails as Record<string, unknown> | undefined,
    ),
    conversation_id: conversationId,
  };

  return {
    payload: normalizeRecoveryPayload(candidate, sessionId, inputMode),
    reason: deriveRecoveryReason(candidate, sessionId, inputMode, currentBrief),
  };
}

function buildPayloadFromToolCall(
  conversation: Record<string, unknown>,
  sessionId: string,
  inputMode: InputMode,
) {
  const transcript = Array.isArray(conversation.transcript) ? conversation.transcript : [];
  const conversationId = firstString(
    conversation.conversationId,
    conversation.conversation_id,
  );

  for (let turnIndex = transcript.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = asRecord(transcript[turnIndex]);
    const toolCalls = Array.isArray(turn?.toolCalls) ? turn.toolCalls : [];

    for (let toolIndex = toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const toolCall = asRecord(toolCalls[toolIndex]);
      const toolName = firstString(toolCall?.toolName, toolCall?.tool_name);

      if (!isSaveResearchBriefTool(toolName)) {
        continue;
      }

      const parsedParams = parseJsonRecord(toolCall?.paramsAsJson ?? toolCall?.params_as_json);

      if (!parsedParams) {
        continue;
      }

      const payload = normalizeRecoveryPayload(
        {
          ...parsedParams,
          conversation_id:
            firstString(parsedParams.conversation_id, parsedParams.conversationId) ?? conversationId,
          tool_call_id:
            firstString(parsedParams.tool_call_id, parsedParams.toolCallId) ??
            firstString(toolCall?.requestId, toolCall?.request_id),
        },
        sessionId,
        inputMode,
      );

      if (payload) {
        return {
          payload,
          reason: null,
        };
      }
    }
  }

  return {
    payload: null,
    reason: "No recoverable research brief tool call was found in the conversation.",
  };
}

export function extractConversationTerminationReason(conversation: unknown) {
  const record = asRecord(conversation);
  const metadata = asRecord(record?.metadata);

  return firstString(
    metadata?.terminationReason,
    metadata?.termination_reason,
    metadata?.error,
  ) ?? null;
}

export function extractLastSaveResearchBriefToolFailure(
  conversation: unknown,
): ResearchToolFailure {
  const record = asRecord(conversation);
  const transcript = Array.isArray(record?.transcript) ? record.transcript : [];

  for (let turnIndex = transcript.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = asRecord(transcript[turnIndex]);
    const toolResults = Array.isArray(turn?.toolResults) ? turn.toolResults : [];

    for (let toolIndex = toolResults.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const toolResult = asRecord(toolResults[toolIndex]);
      const toolName = firstString(toolResult?.toolName, toolResult?.tool_name);

      if (!isSaveResearchBriefTool(toolName)) {
        continue;
      }

      const isError = toolResult?.isError === true || toolResult?.is_error === true;

      if (!isError) {
        continue;
      }

      return {
        kind:
          firstString(toolResult?.errorType, toolResult?.error_type) ?? "tool_execution_error",
        reason:
          firstString(
            toolResult?.rawErrorMessage,
            toolResult?.raw_error_message,
            toolResult?.resultValue,
            toolResult?.result_value,
          ) ?? null,
        toolWasCalled:
          typeof toolResult?.toolHasBeenCalled === "boolean"
            ? toolResult.toolHasBeenCalled
            : typeof toolResult?.tool_has_been_called === "boolean"
              ? (toolResult.tool_has_been_called as boolean)
              : null,
      };
    }
  }

  return {
    kind: null,
    reason: null,
    toolWasCalled: null,
  };
}

export function buildResearchBriefRecoveryPayload({
  conversation,
  currentBrief,
  inputMode,
  sessionId,
}: {
  conversation: unknown;
  currentBrief?: PartialResearchBrief;
  inputMode: InputMode;
  sessionId: string;
}) {
  const record = asRecord(conversation);
  const terminationReason = extractConversationTerminationReason(record);
  const lastToolFailure = extractLastSaveResearchBriefToolFailure(record);

  if (!record) {
    return {
      payload: null,
      reason: "Recovered conversation payload was not an object.",
      source: null,
      terminationReason,
      lastToolFailureKind: lastToolFailure.kind,
      lastToolFailureReason: lastToolFailure.reason,
    };
  }

  const toolCandidate = buildPayloadFromToolCall(record, sessionId, inputMode);

  if (toolCandidate.payload) {
    return {
      payload: toolCandidate.payload,
      reason: null,
      source: "tool_call" satisfies RecoverySource,
      terminationReason,
      lastToolFailureKind: lastToolFailure.kind,
      lastToolFailureReason: lastToolFailure.reason,
    };
  }

  const dataCollectionCandidate = buildPayloadFromDataCollection(
    record,
    sessionId,
    inputMode,
    currentBrief,
  );

  if (dataCollectionCandidate.payload) {
    return {
      payload: dataCollectionCandidate.payload,
      reason: null,
      source: "data_collection" satisfies RecoverySource,
      terminationReason,
      lastToolFailureKind: lastToolFailure.kind,
      lastToolFailureReason: lastToolFailure.reason,
    };
  }

  return {
    payload: null,
    reason: dataCollectionCandidate.reason ?? toolCandidate.reason,
    source: null,
    terminationReason,
    lastToolFailureKind: lastToolFailure.kind,
    lastToolFailureReason: lastToolFailure.reason,
  };
}
