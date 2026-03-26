import {
  extractResearchConversationId,
  extractResearchMessageText,
  inferResearchMessageModality,
  inferResearchMessageRole,
  inferResearchMessageType,
} from "../../../lib/research/elevenlabs-client.ts";
import {
  computeMissingFields,
  type PartialResearchBrief,
} from "../../../lib/research/schemas.ts";

import type { ResearchMessage, ResearchMessageRole, ResearchSessionStatus } from "./types";

const IGNORED_MESSAGE_TYPES = new Set(["agent_chat_response_part", "tentative_user_transcript"]);

export const RESEARCH_SESSION_CLOSE_TIMEOUT_MS = 8_000;
export type ResearchRemoteSessionUpdateMode = "merge" | "replace";
export type ResearchConversationClosePhase = "idle" | "awaiting_final_line" | "line_started";
export type ResearchRepeatedFieldPrompt = "city" | "headcount" | "budget";
export type ResearchConversationPayloadAcceptanceOptions = {
  requireConversationId?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStableIdentifier(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function normalizeStableText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function coerceRole(value: unknown): ResearchMessageRole | null {
  switch (value) {
    case "agent":
    case "assistant":
      return "agent";
    case "tool":
      return "tool";
    case "system":
      return "system";
    case "user":
      return "user";
    default:
      return null;
  }
}

function coerceModality(value: unknown): ResearchMessage["modality"] | null {
  switch (value) {
    case "voice":
    case "text":
    case "mixed":
      return value;
    default:
      return null;
  }
}

function mapRoleFromPayload(payload: Record<string, unknown> | null, fallback?: unknown): ResearchMessageRole {
  const inferred = payload ? inferResearchMessageRole(payload) : undefined;

  if (inferred === "assistant") {
    return "agent";
  }

  return coerceRole(inferred ?? fallback) ?? "system";
}

function mapModalityFromPayload(
  payload: Record<string, unknown> | null,
  fallback?: unknown,
): ResearchMessage["modality"] {
  if (payload) {
    return inferResearchMessageModality(payload);
  }

  return coerceModality(fallback) ?? "mixed";
}

function readMessageContent(payload: Record<string, unknown> | null, fallback?: unknown) {
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }

  if (!payload) {
    return "";
  }

  return (
    extractResearchMessageText(payload) ??
    readString(payload, "content") ??
    readString(payload, "text") ??
    readString(payload, "message") ??
    ""
  ).trim();
}

export function deriveResearchMessageStableKey(candidate: {
  stableKey?: string | null;
  payload?: Record<string, unknown> | null;
  role?: unknown;
  content?: unknown;
}): string {
  if (typeof candidate.stableKey === "string" && candidate.stableKey.trim()) {
    return candidate.stableKey;
  }

  const payload = asRecord(candidate.payload);
  const eventId =
    readStableIdentifier(payload?.event_id) ??
    readStableIdentifier(payload?.eventId) ??
    readStableIdentifier(payload?.recovered_event_id) ??
    readStableIdentifier(payload?.recoveredEventId) ??
    readStableIdentifier(payload?.tool_call_id);
  const conversationId = payload ? extractResearchConversationId(payload) : undefined;
  const role = mapRoleFromPayload(payload, candidate.role);
  const source = payload ? readString(payload, "source") : null;
  const messageType = payload ? inferResearchMessageType(payload) : undefined;

  if (eventId) {
    return `${conversationId ? `conversation:${conversationId}:` : ""}event:${eventId}:${role}`;
  }

  const content = normalizeStableText(readMessageContent(payload, candidate.content));

  return `${conversationId ? `conversation:${conversationId}:` : ""}fallback:${role}:${source ?? messageType ?? "message"}:${content}`;
}

function sortMessages(left: ResearchMessage, right: ResearchMessage) {
  if (left.seq !== right.seq) {
    return left.seq - right.seq;
  }

  const createdComparison = (left.createdAt ?? "").localeCompare(right.createdAt ?? "");

  if (createdComparison !== 0) {
    return createdComparison;
  }

  const stableComparison = (left.stableKey ?? "").localeCompare(right.stableKey ?? "");

  if (stableComparison !== 0) {
    return stableComparison;
  }

  return left.id.localeCompare(right.id);
}

function isResearchMessage(message: ResearchMessage | null): message is ResearchMessage {
  return Boolean(message);
}

function chooseMessage(existing: ResearchMessage, incoming: ResearchMessage): ResearchMessage {
  const incomingWins =
    existing.optimistic && !incoming.optimistic
      ? true
      : !existing.optimistic && incoming.optimistic
        ? false
        : true;
  const winner = incomingWins ? incoming : existing;
  const loser = incomingWins ? existing : incoming;

  return {
    ...loser,
    ...winner,
    stableKey: winner.stableKey ?? loser.stableKey,
    payload: winner.payload ?? loser.payload,
    createdAt: winner.createdAt ?? loser.createdAt,
    optimistic: Boolean(existing.optimistic && incoming.optimistic),
  };
}

export function coerceResearchWorkspaceMessage(message: unknown): ResearchMessage | null {
  const payload = asRecord(message);

  if (!payload) {
    return null;
  }

  const rawType = inferResearchMessageType(payload) ?? readString(payload, "type") ?? "";

  if (IGNORED_MESSAGE_TYPES.has(rawType)) {
    return null;
  }

  const content = readMessageContent(payload);

  if (!content) {
    return null;
  }

  const role = mapRoleFromPayload(payload, payload.role ?? payload.source);

  return {
    id: `optimistic:${crypto.randomUUID()}`,
    seq: Number.isFinite(Number(payload.seq)) ? Number(payload.seq) : Date.now(),
    role,
    modality: mapModalityFromPayload(payload),
    content,
    payload,
    createdAt: new Date().toISOString(),
    stableKey: deriveResearchMessageStableKey({ payload, role, content }),
    optimistic: true,
  };
}

export function normalizeResearchWorkspaceMessage(candidate: unknown): ResearchMessage | null {
  const row = asRecord(candidate);

  if (!row) {
    return null;
  }

  const payload = asRecord(row.payload);
  const rawType = payload ? inferResearchMessageType(payload) ?? readString(payload, "type") ?? "" : "";

  if (IGNORED_MESSAGE_TYPES.has(rawType)) {
    return null;
  }

  const content = readMessageContent(payload, row.content);

  if (!content) {
    return null;
  }

  const role = mapRoleFromPayload(payload, row.role);
  const stableKey = deriveResearchMessageStableKey({
    stableKey: typeof row.stableKey === "string" ? row.stableKey : null,
    payload,
    role,
    content,
  });

  return {
    id:
      typeof row.id === "string" && row.id.trim()
        ? row.id
        : `message:${stableKey}`,
    seq: Number.isFinite(Number(row.seq)) ? Number(row.seq) : 0,
    role,
    modality: mapModalityFromPayload(payload, row.modality),
    content,
    payload,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : null,
    stableKey,
    optimistic: row.optimistic === true,
  };
}

export function normalizeResearchWorkspaceMessages(messages: unknown[]): ResearchMessage[] {
  const normalized = messages
    .map((message) => normalizeResearchWorkspaceMessage(message))
    .filter(isResearchMessage);

  return mergeResearchWorkspaceMessages([], normalized);
}

export function shouldApplyResearchRemoteSessionUpdate(
  currentSessionId: string | null | undefined,
  incomingSessionId: string,
  mode: ResearchRemoteSessionUpdateMode = "merge",
) {
  if (mode === "replace") {
    return true;
  }

  return !currentSessionId || currentSessionId === incomingSessionId;
}

export function shouldAcceptResearchConversationPayload(
  activeConversationId: string | null | undefined,
  payload: unknown,
  options: ResearchConversationPayloadAcceptanceOptions = {},
) {
  const payloadConversationId = extractResearchConversationId(payload);
  const requireConversationId = options.requireConversationId ?? false;

  if (!activeConversationId) {
    return !requireConversationId && !payloadConversationId;
  }

  if (!payloadConversationId) {
    return !requireConversationId;
  }

  return payloadConversationId === activeConversationId;
}

export function detectResearchRepeatedFieldPrompt(
  text: string,
): ResearchRepeatedFieldPrompt | null {
  const normalized = text.toLowerCase();

  if (
    /\bcity\b/.test(normalized) ||
    /which city/.test(normalized) ||
    /tell me the city/.test(normalized) ||
    /city for the coworking space/.test(normalized)
  ) {
    return "city";
  }

  if (
    /\bheadcount\b/.test(normalized) ||
    /\bteam size\b/.test(normalized) ||
    /\bguest count\b/.test(normalized) ||
    /how many people/.test(normalized)
  ) {
    return "headcount";
  }

  if (/\bbudget\b/.test(normalized) || /\bprice\b/.test(normalized)) {
    return "budget";
  }

  return null;
}

export function briefAlreadyContainsResearchField(
  brief: PartialResearchBrief,
  field: ResearchRepeatedFieldPrompt,
) {
  switch (field) {
    case "city":
      return Boolean(brief.city?.trim());
    case "headcount":
      return typeof brief.headcount === "number" && brief.headcount > 0;
    case "budget":
      return !computeMissingFields(brief).includes("budget");
    default:
      return false;
  }
}

export function mergeResearchWorkspaceMessages(
  current: ResearchMessage[],
  incoming: ResearchMessage[],
): ResearchMessage[] {
  const merged = new Map<string, ResearchMessage>();

  for (const message of current) {
    const normalized = normalizeResearchWorkspaceMessage(message);

    if (!normalized) {
      continue;
    }

    merged.set(normalized.stableKey ?? normalized.id, normalized);
  }

  for (const message of incoming) {
    const normalized = normalizeResearchWorkspaceMessage(message);

    if (!normalized) {
      continue;
    }

    const key = normalized.stableKey ?? normalized.id;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, normalized);
      continue;
    }

    merged.set(key, chooseMessage(existing, normalized));
  }

  return Array.from(merged.values()).sort(sortMessages);
}

export function scopeResearchWorkspaceMessagesToConversation(
  messages: ResearchMessage[],
  activeConversationId: string | null | undefined,
) {
  if (!activeConversationId) {
    return messages;
  }

  return messages.filter((message) => {
    return extractResearchConversationId(message.payload) === activeConversationId;
  });
}

export function countResearchConversationMessagesForRole(
  messages: ResearchMessage[],
  conversationId: string | null | undefined,
  role: ResearchMessageRole,
) {
  return scopeResearchWorkspaceMessagesToConversation(messages, conversationId).filter((message) => {
    return message.role === role;
  }).length;
}

export function hasResearchConversationMessagesForRole(
  messages: ResearchMessage[],
  conversationId: string | null | undefined,
  role: ResearchMessageRole,
) {
  return countResearchConversationMessagesForRole(messages, conversationId, role) > 0;
}

export function isResearchTerminalStatus(status: ResearchSessionStatus | null | undefined) {
  return status === "review" || status === "confirmed";
}

export function shouldQueueResearchConversationClose(args: {
  status: ResearchSessionStatus | null | undefined;
  transportStatus: string;
  closePhase?: ResearchConversationClosePhase;
}) {
  if (args.closePhase === "awaiting_final_line") {
    return false;
  }

  return isResearchTerminalStatus(args.status) && args.transportStatus === "connected";
}

export function shouldEndResearchConversation(args: {
  status: ResearchSessionStatus | null | undefined;
  transportStatus: string;
  isSpeaking: boolean;
  mode?: string | null;
  pendingCloseSince: number | null;
  now: number;
  timeoutMs?: number;
  closePhase?: ResearchConversationClosePhase;
}) {
  if (!shouldQueueResearchConversationClose(args)) {
    return false;
  }

  if (args.pendingCloseSince == null) {
    return false;
  }

  if (!args.isSpeaking) {
    return true;
  }

  return args.now - args.pendingCloseSince >= (args.timeoutMs ?? RESEARCH_SESSION_CLOSE_TIMEOUT_MS);
}
