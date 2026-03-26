import "server-only";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import { getServerEnv } from "@/lib/env";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/integrations/supabase";
import {
  buildResumeContext,
  buildResearchBriefFromPayload,
  computeMissingFields,
  computeReadyForMarket,
  createEmptyResearchBrief,
  inputModeSchema,
  normalizeResearchBriefHeadcount,
  assertResearchSessionIsMutable,
  researchBriefSchema,
  researchConversationEventSchema,
  researchSessionSnapshotSchema,
  type InputMode,
  type PartialResearchBrief,
  type ResearchConversationEvent,
  type ResearchEventRecord,
  type ResearchMessageRecord,
  type ResearchSessionSnapshot,
  type ResearchSessionRecord,
  type SaveResearchBriefRoutePayload,
} from "@/lib/research/schemas";
import {
  buildResearchBriefRecoveryPayload,
  extractRecoveredConversationMessages,
} from "@/lib/research/recovery";
import {
  readResearchConversationStartAttempt,
  shouldIgnoreStaleResearchConversationEvent,
} from "@/lib/research/conversation-guards";
import {
  extractResearchConversationId,
  extractResearchMessageText,
  inferResearchMessageModality,
  inferResearchMessageRole,
} from "@/lib/research/elevenlabs-client";

type DatabaseClient = Awaited<ReturnType<typeof createSupabaseClient>>;
type TrustedDatabaseClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
type ResearchDatabaseClient = DatabaseClient | TrustedDatabaseClient;
type ResearchBriefPersistSource =
  | "post_call_recovery"
  | "tool_handoff"
  | "live_tool_error_recovery";
type ResearchTranscriptSyncSource =
  | "post_call_recovery"
  | "tool_handoff"
  | "terminal_reconcile"
  | "live_transcript_sync";
type ResearchSessionReconcileMode = "default" | "transcript_sync";
type ReconcileResearchSessionResult = {
  snapshot: ResearchSessionSnapshot | null;
  recovered: boolean;
  reason: string | null;
  source: ResearchBriefPersistSource | ResearchTranscriptSyncSource | null;
  missingFields: string[];
  lastToolFailureKind: string | null;
  lastToolFailureReason: string | null;
};

function getNextSeq(records: Array<{ seq: number }>) {
  return (records.at(-1)?.seq ?? 0) + 1;
}

function readResearchMessageEventId(payload: Record<string, unknown> | null | undefined) {
  if (!payload) {
    return null;
  }

  const eventId =
    payload.event_id ??
    payload.eventId ??
    payload.recovered_event_id ??
    payload.recoveredEventId ??
    payload.tool_call_id ??
    payload.toolCallId;

  return typeof eventId === "string" && eventId.trim() ? eventId.trim() : null;
}

function getResearchMessageIdentity(payload: Record<string, unknown> | null | undefined) {
  const eventId = readResearchMessageEventId(payload);

  if (!eventId) {
    return null;
  }

  return `${extractResearchConversationId(payload) ?? ""}\u0000${eventId}`;
}

function getResearchMessageFallbackIdentity(args: {
  role: string;
  modality: string;
  content: string;
  payload: Record<string, unknown> | null | undefined;
}) {
  return [
    extractResearchConversationId(args.payload) ?? "",
    args.role,
    args.modality,
    args.content,
    JSON.stringify(args.payload ?? {}),
  ].join("\u0000");
}

function normalizeComparableResearchMessageContent(content: string) {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

function getResearchMessageConversationFallbackMatchKey(args: {
  role: string;
  content: string;
  payload: Record<string, unknown> | null | undefined;
}) {
  return [
    extractResearchConversationId(args.payload) ?? "",
    args.role,
    normalizeComparableResearchMessageContent(args.content),
  ].join("\u0000");
}

function getTrustedSupabase() {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    throw new Error("Supabase admin client is not configured.");
  }

  return supabase;
}

function mapPersistableRoleToMessageRole(role: ReturnType<typeof inferResearchMessageRole>) {
  switch (role) {
    case "assistant":
      return "agent";
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

async function getOwnedSession(
  supabase: DatabaseClient,
  userId: string,
  sessionId: string,
) {
  const { data, error } = await supabase
    .from("research_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as ResearchSessionRecord | null;
}

async function getSessionForService(sessionId: string) {
  const supabase = getTrustedSupabase();
  const { data, error } = await supabase
    .from("research_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as ResearchSessionRecord | null;
}

async function getMessagesForSession(
  supabase: ResearchDatabaseClient,
  sessionId: string,
) {
  const { data, error } = await supabase
    .from("research_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as ResearchMessageRecord[];
}

async function getEventsForSession(
  supabase: ResearchDatabaseClient,
  sessionId: string,
) {
  const { data, error } = await supabase
    .from("research_events")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as ResearchEventRecord[];
}

function parseBriefFromSession(session: ResearchSessionRecord) {
  const rawBrief: Partial<PartialResearchBrief> =
    session.brief_json && typeof session.brief_json === "object"
      ? (session.brief_json as PartialResearchBrief)
      : {};

  const baseBrief = normalizeResearchBriefHeadcount({
    ...createEmptyResearchBrief(session.id, session.input_mode),
    ...rawBrief,
    id: session.id,
    version: "v1",
    status: session.status,
    inputMode: session.input_mode,
    category: rawBrief.category ?? session.category ?? "unclear",
    scopeStatus: rawBrief.scopeStatus ?? session.scope_status ?? "unclear",
    countryCode: rawBrief.countryCode ?? "IN",
  });

  return researchBriefSchema.parse({
    ...baseBrief,
    missingFields:
      Array.isArray(baseBrief.missingFields) && baseBrief.missingFields.length > 0
        ? baseBrief.missingFields
        : computeMissingFields(baseBrief),
    readyForMarket:
      typeof baseBrief.readyForMarket === "boolean"
        ? baseBrief.readyForMarket
        : computeReadyForMarket(baseBrief),
  });
}

async function buildSnapshotFromSession(
  supabase: ResearchDatabaseClient,
  session: ResearchSessionRecord,
) {
  const [messages, events] = await Promise.all([
    getMessagesForSession(supabase, session.id),
    getEventsForSession(supabase, session.id),
  ]);
  const activeConversationId = session.active_conversation_id;
  const scopedMessages =
    session.status === "collecting" && activeConversationId
      ? messages.filter((message) => {
          return extractResearchConversationId(message.payload_json) === activeConversationId;
        })
      : messages;

  return researchSessionSnapshotSchema.parse({
    session,
    brief: parseBriefFromSession(session),
    messages: scopedMessages,
    events,
  });
}

async function createResearchSessionForUser(
  supabase: DatabaseClient,
  userId: string,
  inputMode: InputMode,
) {
  const { data, error } = await supabase
    .from("research_sessions")
    .insert({
      user_id: userId,
      status: "collecting",
      input_mode: inputMode,
      category: "unclear",
      scope_status: "unclear",
      brief_json: {},
      resume_context: {},
      last_event_seq: 0,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const session = data as ResearchSessionRecord;
  const brief = createEmptyResearchBrief(session.id, inputMode);

  const { error: updateError } = await supabase
    .from("research_sessions")
    .update({
      brief_json: brief,
      resume_context: buildResumeContext(brief),
    })
    .eq("id", session.id)
    .eq("user_id", userId);

  if (updateError) {
    throw updateError;
  }

  const refreshed = await getResearchSnapshotForUser(userId, session.id);

  if (!refreshed) {
    throw new Error("Unable to create research session.");
  }

  return refreshed;
}

function normalizeBriefForSave(
  brief: PartialResearchBrief,
  currentSession: ResearchSessionRecord,
) {
  const nextBrief: PartialResearchBrief = {
    ...parseBriefFromSession(currentSession),
    ...brief,
    id: currentSession.id,
    version: "v1",
    status: currentSession.status,
    inputMode: brief.inputMode ?? currentSession.input_mode,
  };

  nextBrief.missingFields = computeMissingFields(nextBrief);
  nextBrief.readyForMarket = computeReadyForMarket(nextBrief);

  return researchBriefSchema.parse(nextBrief);
}

async function insertMessageIfNeeded(
  supabase: DatabaseClient,
  session: ResearchSessionRecord,
  message: {
    role: string;
    modality: string;
    content: string;
    payload_json?: Record<string, unknown> | null;
    seq?: number;
  },
) {
  const existingMessages = await getMessagesForSession(supabase, session.id);
  const lastMessage = existingMessages.at(-1);
  const nextSeq = message.seq ?? getNextSeq(existingMessages);
  const lastConversationId = extractResearchConversationId(lastMessage?.payload_json);
  const nextConversationId = extractResearchConversationId(message.payload_json);
  const nextIdentity = getResearchMessageIdentity(message.payload_json);
  const existingByIdentity =
    nextIdentity
      ? existingMessages.find((existing) => {
          return (
            existing.role === message.role &&
            existing.modality === message.modality &&
            getResearchMessageIdentity(existing.payload_json) === nextIdentity
          );
        })
      : null;

  if (existingByIdentity) {
    const nextPayload = message.payload_json ?? {};
    const payloadChanged =
      JSON.stringify(existingByIdentity.payload_json ?? {}) !== JSON.stringify(nextPayload);

    if (existingByIdentity.content !== message.content || payloadChanged) {
      const { data, error } = await supabase
        .from("research_messages")
        .update({
          content: message.content,
          payload_json: nextPayload,
        })
        .eq("id", existingByIdentity.id)
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      return data as ResearchMessageRecord;
    }

    return existingByIdentity;
  }

  if (
    !nextIdentity &&
    lastMessage &&
    lastMessage.role === message.role &&
    lastMessage.modality === message.modality &&
    lastMessage.content === message.content &&
    lastConversationId === nextConversationId &&
    !getResearchMessageIdentity(lastMessage.payload_json)
  ) {
    return lastMessage;
  }

  const { data, error } = await supabase
    .from("research_messages")
    .insert({
      session_id: session.id,
      user_id: session.user_id,
      seq: nextSeq,
      role: message.role,
      modality: message.modality,
      content: message.content,
      payload_json: message.payload_json ?? {},
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as ResearchMessageRecord;
}

async function rewriteConversationMessageSeqs(
  supabase: ResearchDatabaseClient,
  session: ResearchSessionRecord,
  conversationId: string,
  orderedConversationMessageIds: string[],
) {
  const existingMessages = await getMessagesForSession(supabase, session.id);
  const conversationMessages = existingMessages.filter((message) => {
    return extractResearchConversationId(message.payload_json) === conversationId;
  });

  if (conversationMessages.length === 0) {
    return;
  }

  const seenIds = new Set<string>();
  const canonicalConversationIds = [
    ...orderedConversationMessageIds.filter((id) => {
      if (seenIds.has(id)) {
        return false;
      }

      seenIds.add(id);
      return true;
    }),
    ...conversationMessages
      .map((message) => message.id)
      .filter((id) => !seenIds.has(id)),
  ];
  const messagesById = new Map(existingMessages.map((message) => [message.id, message] as const));
  const reorderedMessages: ResearchMessageRecord[] = [];
  let insertedConversationBlock = false;

  for (const message of existingMessages) {
    if (extractResearchConversationId(message.payload_json) !== conversationId) {
      reorderedMessages.push(message);
      continue;
    }

    if (!insertedConversationBlock) {
      for (const id of canonicalConversationIds) {
        const candidate = messagesById.get(id);

        if (candidate) {
          reorderedMessages.push(candidate);
        }
      }

      insertedConversationBlock = true;
    }
  }

  if (!insertedConversationBlock) {
    for (const id of canonicalConversationIds) {
      const candidate = messagesById.get(id);

      if (candidate) {
        reorderedMessages.push(candidate);
      }
    }
  }

  await Promise.all(
    reorderedMessages.map(async (message, index) => {
      const nextSeq = index + 1;

      if (message.seq === nextSeq) {
        return;
      }

      const { error } = await supabase
        .from("research_messages")
        .update({ seq: nextSeq })
        .eq("id", message.id);

      if (error) {
        throw error;
      }
    }),
  );
}

async function backfillRecoveredTranscriptMessages(
  supabase: TrustedDatabaseClient,
  session: ResearchSessionRecord,
  conversation: unknown,
) {
  const recoveredMessages = extractRecoveredConversationMessages(conversation);

  if (recoveredMessages.length === 0) {
    return 0;
  }

  const existingMessages = await getMessagesForSession(supabase, session.id);
  const conversationId =
    extractResearchConversationId(recoveredMessages[0]?.payload) ??
    session.active_conversation_id;
  const existingKeys = new Set(
    existingMessages.map((message) => {
      return (
        getResearchMessageIdentity(message.payload_json) ??
        getResearchMessageFallbackIdentity({
          role: message.role,
          modality: message.modality,
          content: message.content,
          payload: message.payload_json,
        })
      );
    }),
  );
  const exactIdentityMap = new Map<string, ResearchMessageRecord>();
  const fallbackMatchBuckets = new Map<string, ResearchMessageRecord[]>();

  for (const message of existingMessages) {
    const messageConversationId = extractResearchConversationId(message.payload_json);

    if (conversationId && messageConversationId !== conversationId) {
      continue;
    }

    const identity = getResearchMessageIdentity(message.payload_json);

    if (identity) {
      exactIdentityMap.set(identity, message);
    }

    const fallbackKey = getResearchMessageConversationFallbackMatchKey({
      role: message.role,
      content: message.content,
      payload: message.payload_json,
    });
    const bucket = fallbackMatchBuckets.get(fallbackKey);

    if (bucket) {
      bucket.push(message);
    } else {
      fallbackMatchBuckets.set(fallbackKey, [message]);
    }
  }

  const claimedMessageIds = new Set<string>();
  const canonicalConversationMessageIds: string[] = [];
  let inserted = 0;

  for (const recovered of recoveredMessages) {
    const persistedRole = mapPersistableRoleToMessageRole(recovered.role);

    if (!persistedRole) {
      continue;
    }

    const key =
      getResearchMessageIdentity(recovered.payload) ??
      getResearchMessageFallbackIdentity({
        role: persistedRole,
        modality: recovered.modality,
        content: recovered.content,
        payload: recovered.payload,
      });
    const exactIdentity = getResearchMessageIdentity(recovered.payload);
    const exactMatch =
      exactIdentity && exactIdentityMap.has(exactIdentity)
        ? exactIdentityMap.get(exactIdentity) ?? null
        : null;
    const fallbackMatch =
      !exactMatch
        ? (fallbackMatchBuckets.get(
            getResearchMessageConversationFallbackMatchKey({
              role: persistedRole,
              content: recovered.content,
              payload: recovered.payload,
            }),
          ) ?? []).find((candidate) => !claimedMessageIds.has(candidate.id)) ?? null
        : null;
    const matchedMessage =
      exactMatch && !claimedMessageIds.has(exactMatch.id)
        ? exactMatch
        : fallbackMatch;

    if (matchedMessage) {
      claimedMessageIds.add(matchedMessage.id);
      canonicalConversationMessageIds.push(matchedMessage.id);

      const nextPayload = recovered.payload ?? {};
      const payloadChanged =
        JSON.stringify(matchedMessage.payload_json ?? {}) !== JSON.stringify(nextPayload);

      if (
        matchedMessage.role !== persistedRole ||
        matchedMessage.modality !== recovered.modality ||
        matchedMessage.content !== recovered.content ||
        payloadChanged
      ) {
        const { data, error } = await supabase
          .from("research_messages")
          .update({
            role: persistedRole,
            modality: recovered.modality,
            content: recovered.content,
            payload_json: nextPayload,
          })
          .eq("id", matchedMessage.id)
          .select("*")
          .single();

        if (error) {
          throw error;
        }

        const updatedMessage = data as ResearchMessageRecord;

        if (exactIdentity) {
          exactIdentityMap.set(exactIdentity, updatedMessage);
        }
      }
    } else {
      const createdMessage = await insertMessageIfNeeded(supabase, session, {
        role: persistedRole,
        modality: recovered.modality,
        content: recovered.content,
        payload_json: recovered.payload,
      });

      claimedMessageIds.add(createdMessage.id);
      canonicalConversationMessageIds.push(createdMessage.id);

      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        inserted += 1;
      }
    }
  }

  if (conversationId && canonicalConversationMessageIds.length > 0) {
    await rewriteConversationMessageSeqs(
      supabase,
      session,
      conversationId,
      canonicalConversationMessageIds,
    );
  }

  return inserted;
}

async function syncResearchTranscriptFromConversation(
  supabase: TrustedDatabaseClient,
  session: ResearchSessionRecord,
  conversation: unknown,
  conversationId: string,
  source: ResearchTranscriptSyncSource,
) {
  const recoveredMessages = extractRecoveredConversationMessages(conversation);

  await upsertTrustedEvent(
    supabase,
    session,
    "research_transcript_sync_started",
    {
      source,
      conversation_id: conversationId,
      recovered_message_count: recoveredMessages.length,
    },
    `transcript-sync-started:${source}:${conversationId}`,
  );

  try {
    const insertedCount = await backfillRecoveredTranscriptMessages(supabase, session, conversation);
    await upsertTrustedEvent(
      supabase,
      session,
      "research_transcript_sync_completed",
      {
        source,
        conversation_id: conversationId,
        recovered_message_count: recoveredMessages.length,
        inserted_count: insertedCount,
      },
      `transcript-sync-completed:${source}:${conversationId}`,
    );
  } catch (error) {
    await upsertTrustedEvent(
      supabase,
      session,
      "research_transcript_sync_failed",
      {
        source,
        conversation_id: conversationId,
        reason: error instanceof Error ? error.message : "Unable to sync research transcript.",
      },
      `transcript-sync-failed:${source}:${conversationId}`,
    );
  }
}

async function hydrateResearchTranscriptForSession(
  supabase: TrustedDatabaseClient,
  session: ResearchSessionRecord,
  conversationIdOverride?: string,
  source: ResearchTranscriptSyncSource = "terminal_reconcile",
) {
  const conversationId = session.active_conversation_id ?? conversationIdOverride;

  if (!conversationId) {
    return buildSnapshotFromSession(supabase, session);
  }

  let conversation: unknown;

  try {
    conversation = await fetchConversationForRecovery(conversationId);
  } catch (error) {
    await upsertTrustedEvent(
      supabase,
      session,
      "research_transcript_sync_failed",
      {
        source,
        conversation_id: conversationId,
        reason: error instanceof Error ? error.message : "Unable to load final conversation.",
      },
      `transcript-fetch-failed:${source}:${conversationId}`,
    );

    return buildSnapshotFromSession(supabase, session);
  }

  await syncResearchTranscriptFromConversation(
    supabase,
    session,
    conversation,
    conversationId,
    source,
  );

  return buildSnapshotFromSession(supabase, session);
}

async function syncResearchTranscriptOnlyForSession(
  supabase: TrustedDatabaseClient,
  session: ResearchSessionRecord,
  conversationIdOverride?: string,
  source: ResearchTranscriptSyncSource = "live_transcript_sync",
) {
  const conversationId = session.active_conversation_id ?? conversationIdOverride;

  if (!conversationId) {
    return {
      snapshot: await buildSnapshotFromSession(supabase, session),
      recovered: false,
      reason: "No active conversation id was recorded for this session.",
      source,
      missingFields: parseBriefFromSession(session).missingFields,
      lastToolFailureKind: null,
      lastToolFailureReason: null,
    } satisfies ReconcileResearchSessionResult;
  }

  let conversation: unknown;

  try {
    conversation = await fetchConversationForRecovery(conversationId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to load final conversation.";

    await upsertTrustedEvent(
      supabase,
      session,
      "research_transcript_sync_failed",
      {
        source,
        conversation_id: conversationId,
        reason,
      },
      `transcript-fetch-failed:${source}:${conversationId}`,
    );

    return {
      snapshot: await buildSnapshotFromSession(supabase, session),
      recovered: false,
      reason,
      source,
      missingFields: parseBriefFromSession(session).missingFields,
      lastToolFailureKind: null,
      lastToolFailureReason: null,
    } satisfies ReconcileResearchSessionResult;
  }

  await syncResearchTranscriptFromConversation(
    supabase,
    session,
    conversation,
    conversationId,
    source,
  );

  const latestSession = await getSessionForService(session.id);
  const nextSession = latestSession ?? session;
  const snapshot = await buildSnapshotFromSession(supabase, nextSession);

  return {
    snapshot,
    recovered: false,
    reason: null,
    source,
    missingFields: snapshot.brief.missingFields,
    lastToolFailureKind: null,
    lastToolFailureReason: null,
  } satisfies ReconcileResearchSessionResult;
}

function extractMessageFromConversationEvent(
  event: ResearchConversationEvent,
) {
  const payload =
    event.conversationId && typeof event.payload.conversation_id !== "string"
      ? {
          ...event.payload,
          conversation_id: event.conversationId,
        }
      : event.payload;

  if (event.kind === "client-text") {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";

    if (!text) {
      return null;
    }

    return {
      role: "user",
      modality: "text",
      content: text,
      payload_json: payload,
      seq: event.seq,
    };
  }

  if (event.kind !== "sdk-message") {
    return null;
  }

  const role = mapPersistableRoleToMessageRole(inferResearchMessageRole(payload));
  const text = extractResearchMessageText(payload)?.trim();

  if (!role || !text) {
    return null;
  }

  return {
    role,
    modality: inferResearchMessageModality(payload),
    content: text,
    payload_json: payload,
    seq: event.seq,
  };
}

async function upsertTrustedEvent(
  supabase: TrustedDatabaseClient,
  session: ResearchSessionRecord,
  kind: string,
  payload: Record<string, unknown>,
  externalEventId?: string,
  createdAt?: string,
) {
  const { data, error } = await supabase
    .from("research_events")
    .upsert(
      {
        session_id: session.id,
        user_id: session.user_id,
        external_event_id: externalEventId ?? null,
        kind,
        payload_json: payload,
        created_at: createdAt,
      },
      {
        onConflict: "session_id,kind,external_event_id",
        ignoreDuplicates: true,
      },
    )
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return data as ResearchEventRecord;
  }

  if (!externalEventId) {
    return null;
  }

  const { data: existing, error: existingError } = await supabase
    .from("research_events")
    .select("*")
    .eq("session_id", session.id)
    .eq("kind", kind)
    .eq("external_event_id", externalEventId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  return (existing as ResearchEventRecord | null) ?? null;
}

async function fetchConversationForRecovery(conversationId: string) {
  const env = getServerEnv();

  if (!env.elevenLabsApiKey) {
    throw new Error("ElevenLabs API key is not configured.");
  }

  const client = new ElevenLabsClient({
    apiKey: env.elevenLabsApiKey,
  });

  return client.conversationalAi.conversations.get(conversationId);
}

async function persistResearchBriefSnapshot(
  supabase: TrustedDatabaseClient,
  session: ResearchSessionRecord,
  payload: SaveResearchBriefRoutePayload,
  source: ResearchBriefPersistSource,
) {
  const nextBrief = buildResearchBriefFromPayload(payload, parseBriefFromSession(session));
  const now = new Date().toISOString();

  const { data: updatedSession, error } = await supabase
    .from("research_sessions")
    .update({
      status: "review",
      input_mode: nextBrief.inputMode,
      category: nextBrief.category,
      scope_status: nextBrief.scopeStatus,
      brief_json: nextBrief,
      resume_context: buildResumeContext(nextBrief),
      active_conversation_id: payload.conversation_id ?? session.active_conversation_id,
      updated_at: now,
    })
    .eq("id", session.id)
    .eq("status", "collecting")
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!updatedSession) {
    return null;
  }

  if (source === "tool_handoff") {
    await upsertTrustedEvent(
      supabase,
      session,
      "save_research_brief",
      payload,
      payload.tool_call_id ?? payload.conversation_id,
      now,
    );
  }

  await upsertTrustedEvent(
    supabase,
    session,
    "research_brief_ready",
    {
      source,
      conversation_id: payload.conversation_id ?? session.active_conversation_id,
      tool_call_id: payload.tool_call_id ?? null,
      missing_fields: nextBrief.missingFields,
      ready_for_market: nextBrief.readyForMarket,
    },
    `${source}:${payload.tool_call_id ?? payload.conversation_id ?? session.id}`,
    now,
  );

  return buildSnapshotFromSession(supabase, updatedSession);
}

async function reconcileTrustedResearchSession(
  supabase: TrustedDatabaseClient,
  session: ResearchSessionRecord,
  conversationIdOverride?: string,
  mode: ResearchSessionReconcileMode = "default",
): Promise<ReconcileResearchSessionResult> {
  const snapshot = await buildSnapshotFromSession(supabase, session);

  if (mode === "transcript_sync") {
    return syncResearchTranscriptOnlyForSession(
      supabase,
      session,
      conversationIdOverride,
      "live_transcript_sync",
    );
  }

  if (session.status !== "collecting") {
    if (
      (session.status === "review" || session.status === "confirmed") &&
      (conversationIdOverride ?? session.active_conversation_id)
    ) {
      const hydratedSnapshot = await hydrateResearchTranscriptForSession(
        supabase,
        session,
        conversationIdOverride,
        "terminal_reconcile",
      );

      return {
        snapshot: hydratedSnapshot,
        recovered: false,
        reason: null,
        source: null,
        missingFields: hydratedSnapshot.brief.missingFields,
        lastToolFailureKind: null,
        lastToolFailureReason: null,
      };
    }

    return {
      snapshot,
      recovered: false,
      reason: null,
      source: null,
      missingFields: snapshot.brief.missingFields,
      lastToolFailureKind: null,
      lastToolFailureReason: null,
    };
  }

  const conversationId = session.active_conversation_id ?? conversationIdOverride;

  if (!conversationId) {
    await upsertTrustedEvent(
      supabase,
      session,
      "research_brief_recovery_failed",
      {
        source: "post_call_recovery",
        reason: "No active conversation id was recorded for this session.",
      },
      `no-conversation:${session.id}`,
    );

    return {
      snapshot,
      recovered: false,
      reason: "No active conversation id was recorded for this session.",
      source: null,
      missingFields: snapshot.brief.missingFields,
      lastToolFailureKind: null,
      lastToolFailureReason: null,
    };
  }

  let conversation: unknown;

  try {
    conversation = await fetchConversationForRecovery(conversationId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to load final conversation.";

    await upsertTrustedEvent(
      supabase,
      session,
      "research_brief_recovery_failed",
      {
        source: "post_call_recovery",
        conversation_id: conversationId,
        reason,
      },
      `fetch-error:${conversationId}`,
    );

    return {
      snapshot,
      recovered: false,
      reason,
      source: null,
      missingFields: snapshot.brief.missingFields,
      lastToolFailureKind: null,
      lastToolFailureReason: null,
    };
  }

  const recovery = buildResearchBriefRecoveryPayload({
    conversation,
    currentBrief: snapshot.brief,
    inputMode: session.input_mode,
    sessionId: session.id,
  });

  if (!recovery.payload) {
    await upsertTrustedEvent(
      supabase,
      session,
      "research_brief_recovery_failed",
      {
        source: "post_call_recovery",
        conversation_id: conversationId,
        termination_reason: recovery.terminationReason,
        reason: recovery.reason ?? "The final conversation did not contain a recoverable brief.",
        last_tool_failure_kind: recovery.lastToolFailureKind,
        last_tool_failure_reason: recovery.lastToolFailureReason,
      },
      `failed:${conversationId}`,
    );

    return {
      snapshot,
      recovered: false,
      reason:
        recovery.reason ??
        "The final conversation did not contain a recoverable brief.",
      source: null,
      missingFields: snapshot.brief.missingFields,
      lastToolFailureKind: recovery.lastToolFailureKind,
      lastToolFailureReason: recovery.lastToolFailureReason,
    };
  }

  const recoveredSnapshot = await persistResearchBriefSnapshot(
    supabase,
    session,
    recovery.payload,
    "post_call_recovery",
  );

  if (!recoveredSnapshot) {
    const latestSession = await getSessionForService(session.id);

    return {
      snapshot: latestSession ? await buildSnapshotFromSession(supabase, latestSession) : snapshot,
      recovered: false,
      reason: "Research session is no longer collecting.",
      source: null,
      missingFields: snapshot.brief.missingFields,
      lastToolFailureKind: recovery.lastToolFailureKind,
      lastToolFailureReason: recovery.lastToolFailureReason,
    };
  }

  await syncResearchTranscriptFromConversation(
    supabase,
    session,
    conversation,
    conversationId,
    "post_call_recovery",
  );

  const latestSession = await getSessionForService(session.id);
  const syncedSnapshot =
    latestSession ? await buildSnapshotFromSession(supabase, latestSession) : recoveredSnapshot;

  return {
    snapshot: syncedSnapshot,
    recovered: true,
    reason: null,
    source: "post_call_recovery",
    missingFields: syncedSnapshot.brief.missingFields,
    lastToolFailureKind: recovery.lastToolFailureKind,
    lastToolFailureReason: recovery.lastToolFailureReason,
  };
}

export async function getLatestResearchSnapshotForUser(userId: string) {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("research_sessions")
    .select("*")
    .eq("user_id", userId)
    .is("superseded_at", null)
    .neq("status", "cancelled")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return buildSnapshotFromSession(supabase, data as ResearchSessionRecord);
}

export async function getResearchSnapshotForUser(userId: string, sessionId: string) {
  const supabase = await createSupabaseClient();
  const session = await getOwnedSession(supabase, userId, sessionId);

  if (!session) {
    return null;
  }

  return buildSnapshotFromSession(supabase, session);
}

export async function getResearchSnapshotForRecording(sessionId: string) {
  const supabase = getTrustedSupabase();
  const session = await getSessionForService(sessionId);

  if (!session) {
    return null;
  }

  return buildSnapshotFromSession(supabase, session);
}

export async function getOrCreateActiveResearchSessionForUser(
  userId: string,
  inputMode: InputMode = "voice",
) {
  const existing = await getLatestResearchSnapshotForUser(userId);

  if (existing && existing.session.status !== "superseded") {
    return existing;
  }

  const supabase = await createSupabaseClient();
  return createResearchSessionForUser(supabase, userId, inputMode);
}

export async function startNewResearchSessionForUser(
  userId: string,
  inputMode: InputMode = "voice",
) {
  const supabase = await createSupabaseClient();
  const now = new Date().toISOString();

  await supabase
    .from("research_sessions")
    .update({
      status: "superseded",
      superseded_at: now,
      updated_at: now,
    })
    .eq("user_id", userId)
    .is("superseded_at", null)
    .in("status", ["collecting", "review"]);

  return createResearchSessionForUser(supabase, userId, inputMode);
}

export async function saveResearchBriefEditsForUser(
  userId: string,
  sessionId: string,
  briefEdits: PartialResearchBrief,
) {
  const supabase = await createSupabaseClient();
  const session = await getOwnedSession(supabase, userId, sessionId);

  if (!session) {
    throw new Error("Research session not found.");
  }

  assertResearchSessionIsMutable(session);

  const nextBrief = normalizeBriefForSave(briefEdits, session);
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("research_sessions")
    .update({
      status: "review",
      input_mode: nextBrief.inputMode,
      category: nextBrief.category,
      scope_status: nextBrief.scopeStatus,
      brief_json: nextBrief,
      resume_context: buildResumeContext(nextBrief),
      updated_at: now,
    })
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return getResearchSnapshotForUser(userId, sessionId);
}

export async function confirmResearchSessionForUser(userId: string, sessionId: string) {
  const supabase = await createSupabaseClient();
  const session = await getOwnedSession(supabase, userId, sessionId);

  if (!session) {
    throw new Error("Research session not found.");
  }

  assertResearchSessionIsMutable(session);

  const draftBrief = parseBriefFromSession(session);

  if (!computeReadyForMarket(draftBrief)) {
    throw new Error("Research brief is incomplete.");
  }

  const brief = researchBriefSchema.parse({
    ...draftBrief,
    status: "confirmed",
    missingFields: [],
    readyForMarket: true,
  });

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("research_sessions")
    .update({
      status: "confirmed",
      completed_at: now,
      category: brief.category,
      scope_status: brief.scopeStatus,
      brief_json: brief,
      resume_context: buildResumeContext(brief),
      updated_at: now,
    })
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return getResearchSnapshotForUser(userId, sessionId);
}

export async function cancelResearchSessionForUser(userId: string, sessionId: string) {
  const supabase = await createSupabaseClient();
  const session = await getOwnedSession(supabase, userId, sessionId);

  if (!session) {
    throw new Error("Research session not found.");
  }

  assertResearchSessionIsMutable(session);

  const { error } = await supabase
    .from("research_sessions")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }
}

export async function appendResearchConversationEventForUser(
  userId: string,
  rawEvent: unknown,
) {
  const parsedEvent = researchConversationEventSchema.parse(rawEvent);
  const supabase = await createSupabaseClient();
  const session = await getOwnedSession(supabase, userId, parsedEvent.sessionId);

  if (!session) {
    throw new Error("Research session not found.");
  }

  const ignoreAsStaleConversation = shouldIgnoreStaleResearchConversationEvent({
    activeConversationId: session.active_conversation_id,
    activeStartAttempt: readResearchConversationStartAttempt(
      session.resume_context as Record<string, unknown> | null | undefined,
    ),
    eventConversationId: parsedEvent.conversationId,
    kind: parsedEvent.kind,
    payload: parsedEvent.payload,
  });
  const persistedPayload = ignoreAsStaleConversation
    ? {
        ...parsedEvent.payload,
        ignored_stale_conversation: true,
        ignored_active_conversation_id: session.active_conversation_id,
      }
    : parsedEvent.payload;
  const { data, error } = await supabase
    .from("research_events")
    .insert({
      session_id: session.id,
      user_id: session.user_id,
      kind: parsedEvent.kind,
      payload_json: persistedPayload,
      created_at: parsedEvent.createdAt,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const maybeMessage = ignoreAsStaleConversation
    ? null
    : extractMessageFromConversationEvent(parsedEvent);
  if (maybeMessage) {
    await insertMessageIfNeeded(supabase, session, maybeMessage);
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    last_event_seq:
      typeof parsedEvent.seq === "number"
        ? Math.max(parsedEvent.seq, session.last_event_seq)
        : session.last_event_seq,
  };

  const parsedInputMode = inputModeSchema.safeParse(parsedEvent.payload.inputMode);
  if (parsedInputMode.success) {
    updates.input_mode = parsedInputMode.data;
  }

  if (parsedEvent.conversationId && !ignoreAsStaleConversation) {
    updates.active_conversation_id = parsedEvent.conversationId;
  }

  if (
    parsedEvent.kind === "sdk-status" &&
    parsedEvent.payload.source === "client-start-session"
  ) {
    updates.resume_context = {
      ...(session.resume_context && typeof session.resume_context === "object"
        ? (session.resume_context as Record<string, unknown>)
        : {}),
      clientStartAttempt:
        readResearchConversationStartAttempt(parsedEvent.payload) ?? undefined,
    };
  }

  const { data: updatedSession, error: updateError } = await supabase
    .from("research_sessions")
    .update(updates)
    .eq("id", session.id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw updateError;
  }

  if (!updatedSession) {
    throw new Error("Research session not found.");
  }

  return data as ResearchEventRecord;
}

export async function saveResearchBriefFromToolPayload(payload: SaveResearchBriefRoutePayload) {
  const supabase = getTrustedSupabase();
  const session = await getSessionForService(payload.research_session_id);

  if (!session) {
    throw new Error("Research session not found for tool payload.");
  }

  if (session.status === "review" || session.status === "confirmed") {
    return hydrateResearchTranscriptForSession(
      supabase,
      session,
      payload.conversation_id,
      "tool_handoff",
    );
  }

  assertResearchSessionIsMutable(session);

  const snapshot = await persistResearchBriefSnapshot(supabase, session, payload, "tool_handoff");

  if (!snapshot) {
    const currentSession = await getSessionForService(payload.research_session_id);

    if (!currentSession) {
      throw new Error("Research session not found for tool payload.");
    }

    return buildSnapshotFromSession(supabase, currentSession);
  }

  const currentSession = await getSessionForService(payload.research_session_id);

  if (!currentSession) {
    return snapshot;
  }

  return hydrateResearchTranscriptForSession(
    supabase,
    currentSession,
    payload.conversation_id,
    "tool_handoff",
  );
}

export async function reconcileResearchSessionForUser(
  userId: string,
  sessionId: string,
  options?: {
    mode?: ResearchSessionReconcileMode;
  },
) {
  const supabase = await createSupabaseClient();
  const session = await getOwnedSession(supabase, userId, sessionId);

  if (!session) {
    return null;
  }

  const trustedSupabase = getTrustedSupabase();
  return reconcileTrustedResearchSession(
    trustedSupabase,
    session,
    undefined,
    options?.mode,
  );
}

export async function reconcileResearchSessionForService(
  sessionId: string,
  conversationIdOverride?: string,
  mode: ResearchSessionReconcileMode = "default",
) {
  const trustedSupabase = getTrustedSupabase();
  const session = await getSessionForService(sessionId);

  if (!session) {
    return null;
  }

  return reconcileTrustedResearchSession(
    trustedSupabase,
    session,
    conversationIdOverride,
    mode,
  );
}

export async function appendTrustedResearchEvent(
  sessionId: string,
  kind: string,
  payload: Record<string, unknown>,
  externalEventId?: string,
) {
  const supabase = getTrustedSupabase();
  const session = await getSessionForService(sessionId);

  if (!session) {
    return null;
  }

  const event = await upsertTrustedEvent(
    supabase,
    session,
    kind,
    payload,
    externalEventId,
  );

  await supabase
    .from("research_sessions")
    .update({
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);

  return event;
}
