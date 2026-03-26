export type ResearchInputMode = "voice" | "text" | "mixed";

export type ResearchTimelineRole = "assistant" | "system" | "user";

export type ResearchTransportState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type ResearchConversationEventKind =
  | "client-contextual-update"
  | "client-text"
  | "sdk-connect"
  | "sdk-disconnect"
  | "sdk-error"
  | "sdk-message"
  | "sdk-mode"
  | "sdk-status"
  | "sdk-tool-request"
  | "sdk-tool-response";

export interface ResearchTimelineEntry {
  id: string;
  role: ResearchTimelineRole;
  text: string;
  messageType: string;
  createdAt: string;
  final: boolean;
  optimistic?: boolean;
  raw?: unknown;
}

export interface ResearchConversationEvent {
  kind: ResearchConversationEventKind;
  sessionId: string;
  conversationId?: string;
  seq?: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ResearchSignedUrlRequest {
  sessionId: string;
  userId: string;
  inputMode: ResearchInputMode;
  priorSummary?: string;
  missingFields?: string[];
  supportedCategories?: string[];
  dynamicVariables?: ResearchDynamicVariables;
}

export interface ResearchSignedUrlResponse {
  signedUrl: string;
  conversationId?: string;
}

export interface SaveResearchBriefToolSignal {
  toolName?: string;
  toolCallId?: string;
  payload: unknown;
}

export type ResearchDynamicVariableValue = string | number | boolean;
export type ResearchDynamicVariables = Record<string, ResearchDynamicVariableValue>;
export type PersistableResearchMessageRole = "assistant" | "system" | "tool" | "user";
export type PersistableResearchMessageModality = "mixed" | "text" | "voice";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function readCharacterArray(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];

  if (!Array.isArray(value)) {
    return undefined;
  }

  const characters = value
    .map((entry) => (typeof entry === "string" ? entry : typeof entry === "number" ? String(entry) : ""))
    .filter((entry) => entry.length > 0);

  return characters.length > 0 ? characters : undefined;
}

export function buildResearchDynamicVariables({
  sessionId,
  userId,
  priorSummary,
  missingFields = [],
  supportedCategories = [],
}: {
  sessionId: string;
  userId: string;
  priorSummary?: string;
  missingFields?: string[];
  supportedCategories?: string[];
}) {
  return normalizeResearchDynamicVariables({
    research_session_id: sessionId,
    user_id: userId,
    country_code: "IN",
    supported_categories: supportedCategories,
    prior_summary: priorSummary ?? "",
    missing_fields: missingFields,
  });
}

export function normalizeResearchDynamicVariables(
  input: Record<string, unknown> | ResearchDynamicVariables | undefined,
): ResearchDynamicVariables {
  const normalized: ResearchDynamicVariables = {};

  for (const [key, value] of Object.entries(input ?? {})) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      normalized[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      normalized[key] = value
        .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry)))
        .filter(Boolean)
        .join(", ");
      continue;
    }

    if (value && typeof value === "object") {
      normalized[key] = JSON.stringify(value);
    }
  }

  return normalized;
}

export function inferResearchRole(messageType?: string): ResearchTimelineRole | undefined {
  switch (messageType) {
    case "user_message":
    case "user_transcript":
    case "tentative_user_transcript":
      return "user";
    case "agent_chat_response_part":
    case "agent_response":
    case "agent_response_correction":
      return "assistant";
    case "agent_tool_request":
    case "agent_tool_response":
      return "system";
    default:
      return undefined;
  }
}

function inferResearchRoleFromSource(source?: string): PersistableResearchMessageRole | undefined {
  switch (source) {
    case "agent":
    case "ai":
    case "assistant":
      return "assistant";
    case "tool":
      return "tool";
    case "system":
      return "system";
    case "user":
      return "user";
    default:
      return undefined;
  }
}

export function inferResearchMessageRole(payload: unknown): PersistableResearchMessageRole | undefined {
  const record = asRecord(payload);

  if (!record) {
    return undefined;
  }

  const explicitRole = inferResearchRoleFromSource(
    readString(record, "role") ?? readString(record, "source"),
  );

  if (explicitRole) {
    return explicitRole;
  }

  const inferredRole = inferResearchRole(readString(record, "type"));

  if (inferredRole === "assistant") {
    return "assistant";
  }

  return inferredRole;
}

export function inferResearchMessageType(payload: unknown) {
  const record = asRecord(payload);

  if (!record) {
    return undefined;
  }

  const rawType = readString(record, "type");

  if (rawType) {
    return rawType;
  }

  const role = inferResearchMessageRole(payload);

  switch (role) {
    case "assistant":
      return "agent_response";
    case "user":
      return "user_transcript";
    case "tool":
      return "agent_tool_response";
    case "system":
      return "sdk-message";
    default:
      return undefined;
  }
}

export function inferResearchMessageModality(
  payload: unknown,
): PersistableResearchMessageModality {
  const record = asRecord(payload);
  const rawType = readString(record ?? {}, "type");

  if (rawType === "user_message") {
    return "text";
  }

  if (
    rawType === "user_transcript" ||
    rawType === "agent_response" ||
    rawType === "agent_response_correction" ||
    rawType === "tentative_user_transcript"
  ) {
    return "voice";
  }

  if (rawType === "agent_tool_request" || rawType === "agent_tool_response") {
    return "mixed";
  }

  const role = inferResearchMessageRole(payload);

  if (role === "assistant" || role === "user") {
    return "voice";
  }

  return "mixed";
}

export function extractResearchConversationId(payload: unknown) {
  const record = asRecord(payload);

  if (!record) {
    return undefined;
  }

  return firstString([
    record.conversationId,
    record.conversation_id,
  ]);
}

export function extractResearchMessageText(payload: unknown) {
  const record = asRecord(payload);

  if (!record) {
    return undefined;
  }

  const messageType = inferResearchMessageType(payload);

  if (messageType === "agent_response_correction") {
    return firstString([
      record.corrected_text,
      record.text,
      record.message,
      record.agent_response,
    ]);
  }

  return firstString([
    record.text,
    record.message,
    record.transcript,
    record.user_transcript,
    record.agent_response,
    record.corrected_text,
  ]);
}

export function extractResearchAudioAlignmentText(payload: unknown) {
  const record = asRecord(payload);

  if (!record) {
    return undefined;
  }

  const normalizedAlignment = asRecord(record.normalizedAlignment);
  const alignment = asRecord(record.alignment);
  const characters =
    readCharacterArray(normalizedAlignment, "chars") ??
    readCharacterArray(alignment, "chars") ??
    readCharacterArray(record, "chars");

  if (!characters) {
    return undefined;
  }

  return characters.join("");
}

export function mergeResearchAudioAlignmentText(current: string, incoming: string) {
  if (!current) {
    return incoming;
  }

  if (!incoming) {
    return current;
  }

  if (incoming.startsWith(current)) {
    return incoming;
  }

  if (current.endsWith(incoming)) {
    return current;
  }

  const overlapLimit = Math.min(current.length, incoming.length);

  for (let overlap = overlapLimit; overlap > 0; overlap -= 1) {
    if (current.slice(-overlap) === incoming.slice(0, overlap)) {
      return `${current}${incoming.slice(overlap)}`;
    }
  }

  return `${current}${incoming}`;
}

export function buildResearchAudioAlignedAssistantPayload(args: {
  conversationId?: string | null;
  eventId: string;
  text: string;
  alignmentPayload?: unknown;
}) {
  const payload: Record<string, unknown> = {
    type: "agent_response",
    role: "agent",
    source: "assistant",
    event_id: args.eventId,
    message: args.text,
    text: args.text,
    transcript_source: "audio_alignment",
  };

  if (args.conversationId) {
    payload.conversation_id = args.conversationId;
  }

  const alignment = asRecord(args.alignmentPayload);

  if (alignment) {
    if (alignment.normalizedAlignment) {
      payload.normalizedAlignment = alignment.normalizedAlignment;
    }

    if (alignment.alignment) {
      payload.alignment = alignment.alignment;
    }
  }

  return payload;
}

export function normalizeResearchTimelineEntry(payload: unknown): ResearchTimelineEntry | null {
  const record = asRecord(payload);

  if (!record) {
    return null;
  }

  const messageType = inferResearchMessageType(payload) ?? "sdk-message";
  const normalizedRole = inferResearchMessageRole(payload);
  const role =
    normalizedRole === "assistant"
      ? "assistant"
      : normalizedRole === "user"
        ? "user"
        : normalizedRole === "tool" || normalizedRole === "system"
          ? "system"
          : undefined;
  const text = extractResearchMessageText(payload);

  if (!role || !text) {
    return null;
  }

  const entryId =
    readString(record, "event_id") ??
    readString(record, "tool_call_id") ??
    `${messageType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: entryId,
    role,
    text,
    messageType,
    createdAt: new Date().toISOString(),
    final: messageType !== "tentative_user_transcript",
    raw: payload,
  };
}

export function mergeResearchTimelineEntry(
  current: ResearchTimelineEntry[],
  incoming: ResearchTimelineEntry,
) {
  const last = current.at(-1);

  if (
    last &&
    last.role === incoming.role &&
    last.text === incoming.text &&
    last.messageType === incoming.messageType
  ) {
    return current;
  }

  if (
    incoming.messageType === "tentative_user_transcript" &&
    last?.messageType === "tentative_user_transcript" &&
    last.role === "user"
  ) {
    return [...current.slice(0, -1), incoming];
  }

  if (
    incoming.messageType === "agent_response_correction" &&
    last?.role === "assistant"
  ) {
    return [...current.slice(0, -1), incoming];
  }

  return [...current, incoming];
}

export function extractToolSignal(payload: unknown): SaveResearchBriefToolSignal | null {
  const record = asRecord(payload);

  if (!record) {
    return null;
  }

  const toolName = firstString([
    record.tool_name,
    record.toolName,
    record.name,
  ]);

  const toolCallId = firstString([
    record.tool_call_id,
    record.toolCallId,
    record.id,
  ]);

  return {
    toolName,
    toolCallId,
    payload,
  };
}

export function isSaveResearchBriefTool(toolName?: string) {
  return toolName === "save_research_brief" || toolName === "save_research_brief_v2";
}
