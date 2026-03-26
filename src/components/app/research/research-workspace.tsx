"use client";

import { useConversation } from "@elevenlabs/react";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useWorkspaceGuide } from "@/components/app/workspace/workspace-guide-shell";
import {
  useResearchRecordingReplay,
  type ResearchRecordingReplayConfig,
} from "@/components/app/research/research-recording-replay";
import { ResearchSummaryPane } from "@/components/app/research/research-summary-pane";
import { ResearchVoiceCard } from "@/components/app/research/research-voice-card";
import type { GuideEnvelope } from "@/lib/market/schemas";
import {
  buildResearchAudioAlignedAssistantPayload,
  extractResearchAudioAlignmentText,
  extractResearchConversationId,
  extractResearchMessageText,
  inferResearchMessageType,
  inferResearchMessageRole,
  mergeResearchAudioAlignmentText,
} from "@/lib/research/elevenlabs-client";
import {
  buildResearchBriefFromPayload,
  computeMissingFields,
  computeReadyForMarket,
  createEmptyResearchBrief,
  inputModeValues,
  scopeStatusValues,
} from "@/lib/research/schemas";
import {
  resolveResearchDisconnectBinding,
  shouldBindResearchConversationMetadata,
} from "@/lib/research/conversation-guards";

import type {
  InputMode,
  ResearchBrief,
  ResearchMessage,
  ResearchSessionSnapshot,
  ResearchSessionStatus,
  ScopeStatus,
} from "./types";
import {
  hasResearchConversationMessagesForRole,
  briefAlreadyContainsResearchField,
  coerceResearchWorkspaceMessage,
  detectResearchRepeatedFieldPrompt,
  mergeResearchWorkspaceMessages,
  normalizeResearchWorkspaceMessages,
  RESEARCH_SESSION_CLOSE_TIMEOUT_MS,
  scopeResearchWorkspaceMessagesToConversation,
  type ResearchConversationClosePhase,
  type ResearchRepeatedFieldPrompt,
  shouldAcceptResearchConversationPayload,
  shouldApplyResearchRemoteSessionUpdate,
  shouldEndResearchConversation,
  isResearchTerminalStatus,
  shouldQueueResearchConversationClose,
  type ResearchRemoteSessionUpdateMode,
} from "./research-workspace-state";

type ResearchWorkspaceProps = {
  initialSession: ResearchSessionSnapshot | null;
  resumeCandidate?: ResearchSessionSnapshot | null;
  recordingReplay?: ResearchRecordingReplayConfig | null;
};

type RemoteResponse = {
  session?: ResearchSessionSnapshot | null;
  redirectUrl?: string | null;
  dynamicVariables?: Record<string, string | number | boolean> | null;
  recovered?: boolean;
  reason?: string | null;
  source?: string | null;
  missingFields?: string[] | null;
  lastToolFailureKind?: string | null;
  lastToolFailureReason?: string | null;
  error?: string | null;
  [key: string]: unknown;
};

type TransportState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "disconnected"
  | "error";
type ConversationAttemptToken = number;
type LiveConversationBinding = {
  sessionId: string;
  conversationId: string | null;
  attemptToken: ConversationAttemptToken;
};
type ActiveAudioAlignedAssistantTurn = {
  conversationId: string;
  attemptToken: ConversationAttemptToken;
  eventId: string;
  stableKey: string;
  id: string;
  seq: number;
  createdAt: string;
  content: string;
};
type ResearchSessionReconcileTarget = {
  id: string;
  status: ResearchSessionStatus;
  activeConversationId: string | null;
};
type ResearchSessionReconcileOptions = {
  mode?: "transcript_sync";
  onFailureNotice?: string;
  transcriptSyncRetriesRemaining?: number;
};

const EMPTY_SESSION_ID = "00000000-0000-0000-0000-000000000000";
const RESEARCH_TRANSCRIPT_SYNC_RETRY_MS = 1_200;
const RESEARCH_TRANSCRIPT_SYNC_RETRY_LIMIT = 5;
const VALID_CATEGORIES = new Set<ResearchBrief["category"]>([
  "banquet",
  "coworking",
  "clinic",
  "adjacent",
  "unclear",
]);
const VALID_SCOPE_STATUSES = new Set<ScopeStatus>(scopeStatusValues);
const VALID_INPUT_MODES = new Set<InputMode>(inputModeValues);

function createWorkspaceBrief(sessionId = EMPTY_SESSION_ID, inputMode: InputMode = "voice") {
  return {
    ...createEmptyResearchBrief(sessionId, inputMode),
    preferredLanguages: ["English", "Hindi"],
  } satisfies ResearchBrief;
}

function asPayloadRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { value };
}

function parseInputMode(value: unknown): InputMode {
  return typeof value === "string" && VALID_INPUT_MODES.has(value as InputMode)
    ? (value as InputMode)
    : "voice";
}

function parseScopeStatus(value: unknown): ScopeStatus | null {
  return typeof value === "string" && VALID_SCOPE_STATUSES.has(value as ScopeStatus)
    ? (value as ScopeStatus)
    : null;
}

function normalizeSession(candidate: unknown): ResearchSessionSnapshot | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const source = candidate as Record<string, unknown>;

  if (typeof source.id !== "string" || typeof source.status !== "string") {
    return null;
  }

  const messages = Array.isArray(source.messages)
    ? normalizeResearchWorkspaceMessages(source.messages)
    : [];

  return {
    id: source.id,
    status: source.status as ResearchSessionStatus,
    inputMode: parseInputMode(source.inputMode),
    category:
      typeof source.category === "string" && VALID_CATEGORIES.has(source.category as ResearchBrief["category"])
        ? (source.category as ResearchBrief["category"])
        : typeof source.category === "string"
          ? "unclear"
          : null,
    scopeStatus: parseScopeStatus(source.scopeStatus),
    brief: (source.brief ?? null) as ResearchBrief | null,
    resumeContext:
      source.resumeContext && typeof source.resumeContext === "object"
        ? (source.resumeContext as ResearchSessionSnapshot["resumeContext"])
        : null,
    activeConversationId:
      typeof source.activeConversationId === "string" ? source.activeConversationId : null,
    lastEventSeq: typeof source.lastEventSeq === "number" ? source.lastEventSeq : null,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
    completedAt: typeof source.completedAt === "string" ? source.completedAt : null,
    messages,
  };
}

async function apiRequest<T>(path: string, init?: RequestInit) {
  try {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    const json = response.status === 204 ? null : ((await response.json().catch(() => null)) as T | null);
    const error =
      json &&
      typeof json === "object" &&
      "error" in json &&
      typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : null;

    return {
      ok: response.ok,
      status: response.status,
      data: json,
      error,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      data: null as T | null,
      error: "Network request failed.",
    };
  }
}

function mergeBrief(base: ResearchBrief | null, patch: Partial<ResearchBrief>) {
  const nextBrief = {
    ...(base ?? createWorkspaceBrief()),
    ...patch,
  } satisfies ResearchBrief;

  return {
    ...nextBrief,
    missingFields: computeMissingFields(nextBrief),
    readyForMarket: computeReadyForMarket(nextBrief),
  } satisfies ResearchBrief;
}

function formatResearchSync(value: string | null | undefined) {
  if (!value) {
    return "No sync yet";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No sync yet";
  }

  return `Last synced ${new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(date)}`;
}

function statusRank(status: ResearchSessionStatus) {
  switch (status) {
    case "cancelled":
      return 5;
    case "superseded":
      return 4;
    case "confirmed":
      return 3;
    case "review":
      return 2;
    default:
      return 1;
  }
}

function mergeSessionStatus(
  current: ResearchSessionStatus | null | undefined,
  incoming: ResearchSessionStatus,
) {
  if (!current) {
    return incoming;
  }

  if (incoming === "cancelled" || incoming === "superseded") {
    return incoming;
  }

  return statusRank(current) > statusRank(incoming) ? current : incoming;
}

function normalizeTransportState(status: string): TransportState {
  switch (status) {
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "disconnecting":
      return "disconnecting";
    case "disconnected":
      return "disconnected";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

export function ResearchWorkspace({
  initialSession,
  resumeCandidate = null,
  recordingReplay = null,
}: ResearchWorkspaceProps) {
  const router = useRouter();
  const { setGuide } = useWorkspaceGuide();
  const [session, setSession] = useState<ResearchSessionSnapshot | null>(initialSession);
  const [messages, setMessages] = useState<ResearchMessage[]>(
    normalizeResearchWorkspaceMessages(initialSession?.messages ?? []),
  );
  const [summary, setSummary] = useState<ResearchBrief>(
    initialSession?.brief ?? createWorkspaceBrief(initialSession?.id),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    initialSession?.status === "review"
      ? "Brief ready for market review."
      : initialSession?.status === "confirmed"
        ? "Brief confirmed. Market handoff ready."
        : null,
  );
  const [actionPending, setActionPending] = useState(false);
  const [voicePending, setVoicePending] = useState(false);
  const [transportSettling, setTransportSettling] = useState(false);
  const [conversationMode, setConversationMode] = useState<string>("listening");
  const [pendingCloseSince, setPendingCloseSince] = useState<number | null>(null);
  const [closePhase, setClosePhase] = useState<ResearchConversationClosePhase>("idle");
  const sessionRef = useRef<ResearchSessionSnapshot | null>(session);
  const messagesRef = useRef(messages);
  const summaryRef = useRef(summary);
  const voicePendingRef = useRef(voicePending);
  const transportSettlingRef = useRef(transportSettling);
  const pendingCloseSinceRef = useRef<number | null>(pendingCloseSince);
  const closingSessionRef = useRef(false);
  const conversationModeRef = useRef(conversationMode);
  const closePhaseRef = useRef<ResearchConversationClosePhase>(closePhase);
  const conversationStatusRef = useRef<TransportState>("disconnected");
  const conversationIsSpeakingRef = useRef(false);
  const liveConversationBindingRef = useRef<LiveConversationBinding | null>(null);
  const disconnectingConversationBindingsRef = useRef<LiveConversationBinding[]>([]);
  const conversationAttemptTokenRef = useRef<ConversationAttemptToken>(0);
  const activeAudioAlignedAssistantTurnRef = useRef<ActiveAudioAlignedAssistantTurn | null>(null);
  const audioAlignedAssistantTurnCounterRef = useRef(0);
  const liveToolRecoveryPendingRef = useRef(false);
  const transportSettledResolversRef = useRef<Array<() => void>>([]);
  const transportSettlingTimeoutRef = useRef<number | null>(null);
  const repeatedFieldPromptCountsRef = useRef<Record<ResearchRepeatedFieldPrompt, number>>({
    city: 0,
    headcount: 0,
    budget: 0,
  });
  const transcriptSyncRetryTimeoutRef = useRef<number | null>(null);
  const terminalTranscriptAutoSyncKeyRef = useRef<string | null>(null);
  const reconcileSessionRef = useRef<
    ((
      targetSession?: ResearchSessionReconcileTarget | null,
      options?: ResearchSessionReconcileOptions,
    ) => Promise<void>) | null
  >(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  useEffect(() => {
    voicePendingRef.current = voicePending;
  }, [voicePending]);

  useEffect(() => {
    transportSettlingRef.current = transportSettling;
  }, [transportSettling]);

  useEffect(() => {
    pendingCloseSinceRef.current = pendingCloseSince;
  }, [pendingCloseSince]);

  useEffect(() => {
    conversationModeRef.current = conversationMode;
  }, [conversationMode]);

  useEffect(() => {
    closePhaseRef.current = closePhase;
  }, [closePhase]);

  const replay = useResearchRecordingReplay({
    config: recordingReplay,
    session: initialSession,
  });
  const replayActive = Boolean(replay);

  function getLiveConversationBinding() {
    return liveConversationBindingRef.current;
  }

  function getCurrentConversationAttemptToken() {
    return conversationAttemptTokenRef.current;
  }

  function snapshotConversationBinding(binding: LiveConversationBinding | null | undefined) {
    return binding
      ? {
          sessionId: binding.sessionId,
          conversationId: binding.conversationId,
          attemptToken: binding.attemptToken,
        }
      : null;
  }

  function queueDisconnectingBinding(binding: LiveConversationBinding | null | undefined) {
    const snapshot = snapshotConversationBinding(binding);

    if (!snapshot) {
      return null;
    }

    if (
      !disconnectingConversationBindingsRef.current.some(
        (candidate) => candidate.attemptToken === snapshot.attemptToken,
      )
    ) {
      disconnectingConversationBindingsRef.current.push(snapshot);
    }

    return snapshot;
  }

  function clearTransportSettlingTimeout() {
    if (transportSettlingTimeoutRef.current != null) {
      window.clearTimeout(transportSettlingTimeoutRef.current);
      transportSettlingTimeoutRef.current = null;
    }
  }

  function clearTranscriptSyncRetryTimeout() {
    if (transcriptSyncRetryTimeoutRef.current != null) {
      window.clearTimeout(transcriptSyncRetryTimeoutRef.current);
      transcriptSyncRetryTimeoutRef.current = null;
    }
  }

  function markTransportSettling(binding = getLiveConversationBinding()) {
    const nextDisconnectingBinding = queueDisconnectingBinding(binding);

    if (transportSettlingRef.current) {
      clearTransportSettlingTimeout();
      transportSettlingTimeoutRef.current = window.setTimeout(() => {
        if (!transportSettlingRef.current) {
          return;
        }

        const disconnectingBinding = nextDisconnectingBinding;

        if (
          disconnectingBinding &&
          liveConversationBindingRef.current?.attemptToken === disconnectingBinding.attemptToken
        ) {
          liveConversationBindingRef.current = null;
        }

        discardAudioAlignedAssistantTurnAfterDisconnect(disconnectingBinding);
        closePhaseRef.current = "idle";
        setClosePhase("idle");
        conversationModeRef.current = "listening";
        setConversationMode("listening");
        setPendingCloseSince(null);
        setNotice(
          sessionRef.current?.status === "collecting"
            ? "Intake paused. Resume when ready."
            : "Conversation ended.",
        );
        clearTransportSettling();
      }, RESEARCH_SESSION_CLOSE_TIMEOUT_MS);
      return;
    }

    transportSettlingRef.current = true;
    setTransportSettling(true);
    clearTransportSettlingTimeout();
    transportSettlingTimeoutRef.current = window.setTimeout(() => {
      if (!transportSettlingRef.current) {
        return;
      }

      const disconnectingBinding = nextDisconnectingBinding;

      if (
        disconnectingBinding &&
        liveConversationBindingRef.current?.attemptToken === disconnectingBinding.attemptToken
      ) {
        liveConversationBindingRef.current = null;
      }

      discardAudioAlignedAssistantTurnAfterDisconnect(disconnectingBinding);
      closePhaseRef.current = "idle";
      setClosePhase("idle");
      conversationModeRef.current = "listening";
      setConversationMode("listening");
      setPendingCloseSince(null);
      setNotice(
        sessionRef.current?.status === "collecting"
          ? "Intake paused. Resume when ready."
          : "Conversation ended.",
      );
      clearTransportSettling();
    }, RESEARCH_SESSION_CLOSE_TIMEOUT_MS);
  }

  function clearTransportSettling() {
    clearTransportSettlingTimeout();
    transportSettlingRef.current = false;
    setTransportSettling(false);
    const resolvers = transportSettledResolversRef.current.splice(0);

    for (const resolve of resolvers) {
      resolve();
    }
  }

  async function waitForTransportSettled(timeoutMs = RESEARCH_SESSION_CLOSE_TIMEOUT_MS) {
    if (!transportSettlingRef.current) {
      return true;
    }

    return await new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => {
        transportSettledResolversRef.current = transportSettledResolversRef.current.filter(
          (candidate) => candidate !== onSettled,
        );
        resolve(false);
      }, timeoutMs);

      const onSettled = () => {
        window.clearTimeout(timeout);
        resolve(true);
      };

      transportSettledResolversRef.current.push(onSettled);
    });
  }

  function getActiveConversationId() {
    return getLiveConversationBinding()?.conversationId ?? null;
  }

  function hasAssistantTranscriptForConversation(
    conversationId: string | null | undefined,
    candidateMessages = messagesRef.current,
  ) {
    return hasResearchConversationMessagesForRole(candidateMessages, conversationId, "agent");
  }

  function hasDurableAssistantTranscriptForConversation(
    conversationId: string | null | undefined,
    candidateMessages = messagesRef.current,
  ) {
    const activeAudioTurn = activeAudioAlignedAssistantTurnRef.current;

    return scopeResearchWorkspaceMessagesToConversation(candidateMessages, conversationId).some(
      (message) => {
        return (
          message.role === "agent" &&
          message.id !== activeAudioTurn?.id
        );
      },
    );
  }

  function clearOptimisticAssistantTurnMessage(turn: ActiveAudioAlignedAssistantTurn | null) {
    if (!turn) {
      return;
    }

    setMessages((current) => current.filter((message) => message.id !== turn.id));
  }

  function discardAudioAlignedAssistantTurn(options?: {
    conversationId?: string | null;
    attemptToken?: ConversationAttemptToken;
  }) {
    const currentTurn = activeAudioAlignedAssistantTurnRef.current;

    if (!currentTurn) {
      return;
    }

    if (
      options?.conversationId &&
      currentTurn.conversationId !== options.conversationId
    ) {
      return;
    }

    if (
      typeof options?.attemptToken === "number" &&
      currentTurn.attemptToken !== options.attemptToken
    ) {
      return;
    }

    activeAudioAlignedAssistantTurnRef.current = null;
    clearOptimisticAssistantTurnMessage(currentTurn);
  }

  function discardAudioAlignedAssistantTurnAfterDisconnect(
    binding: LiveConversationBinding | null | undefined,
  ) {
    if (!binding?.conversationId) {
      return;
    }

    if (
      binding.attemptToken === getCurrentConversationAttemptToken() &&
      !hasDurableAssistantTranscriptForConversation(binding.conversationId)
    ) {
      return;
    }

    discardAudioAlignedAssistantTurn({
      conversationId: binding.conversationId,
      attemptToken: binding.attemptToken,
    });
  }

  function startConversationAttempt(sessionId: string) {
    const nextAttemptToken = conversationAttemptTokenRef.current + 1;
    conversationAttemptTokenRef.current = nextAttemptToken;
    liveConversationBindingRef.current = {
      sessionId,
      conversationId: null,
      attemptToken: nextAttemptToken,
    };
    discardAudioAlignedAssistantTurn();
    return nextAttemptToken;
  }

  function bindConversationId(
    sessionId: string,
    conversationId: string,
    attemptToken = getCurrentConversationAttemptToken(),
  ) {
    if (attemptToken !== getCurrentConversationAttemptToken()) {
      return false;
    }

    liveConversationBindingRef.current = {
      sessionId,
      conversationId,
      attemptToken,
    };
    return true;
  }

  useEffect(() => {
    if (replayActive) {
      terminalTranscriptAutoSyncKeyRef.current = null;
      clearTranscriptSyncRetryTimeout();
      return;
    }

    const currentSession = session;
    const currentConversationId = currentSession?.activeConversationId ?? null;

    if (!currentSession || !isResearchTerminalStatus(currentSession.status) || !currentConversationId) {
      terminalTranscriptAutoSyncKeyRef.current = null;
      clearTranscriptSyncRetryTimeout();
      return;
    }

    const syncKey = `${currentSession.id}:${currentConversationId}`;
    const hasAssistantTranscript = hasDurableAssistantTranscriptForConversation(
      currentConversationId,
      messages,
    );

    if (hasAssistantTranscript) {
      if (terminalTranscriptAutoSyncKeyRef.current === syncKey) {
        terminalTranscriptAutoSyncKeyRef.current = null;
      }
      clearTranscriptSyncRetryTimeout();
      return;
    }

    if (terminalTranscriptAutoSyncKeyRef.current === syncKey) {
      return;
    }

    terminalTranscriptAutoSyncKeyRef.current = syncKey;
    setNotice("Syncing transcript...");
    void reconcileSessionRef.current?.(
      {
        id: currentSession.id,
        status: currentSession.status,
        activeConversationId: currentConversationId,
      },
      {
        transcriptSyncRetriesRemaining: RESEARCH_TRANSCRIPT_SYNC_RETRY_LIMIT,
      },
    );
  }, [messages, replayActive, session]);

  useEffect(() => {
    setSession(initialSession);
    setMessages(
      scopeResearchWorkspaceMessagesToConversation(
        normalizeResearchWorkspaceMessages(initialSession?.messages ?? []),
        initialSession?.activeConversationId,
      ),
    );
    setSummary(initialSession?.brief ?? createWorkspaceBrief(initialSession?.id));
    setError(null);
    setNotice(
      initialSession?.status === "review"
        ? "Brief ready for market review."
        : initialSession?.status === "confirmed"
          ? "Brief confirmed. Market handoff ready."
        : null,
    );
    setPendingCloseSince(null);
    setClosePhase("idle");
    setTransportSettling(false);
    conversationModeRef.current = "listening";
    liveConversationBindingRef.current = null;
    disconnectingConversationBindingsRef.current = [];
    activeAudioAlignedAssistantTurnRef.current = null;
    audioAlignedAssistantTurnCounterRef.current = 0;
    liveToolRecoveryPendingRef.current = false;
    transportSettledResolversRef.current = [];
    repeatedFieldPromptCountsRef.current = { city: 0, headcount: 0, budget: 0 };
    terminalTranscriptAutoSyncKeyRef.current = null;
    clearTransportSettlingTimeout();
    clearTranscriptSyncRetryTimeout();
  }, [initialSession]);

  useEffect(() => {
    return () => {
      clearTransportSettlingTimeout();
      clearTranscriptSyncRetryTimeout();
    };
  }, []);

  async function persistEvent(kind: string, payload: Record<string, unknown>) {
    if (replayActive) {
      return false;
    }

    const liveBinding = getLiveConversationBinding();
    const activeSessionId = liveBinding?.sessionId ?? sessionRef.current?.id;

    if (!activeSessionId) {
      return false;
    }

    const response = await apiRequest(`/api/research/sessions/${activeSessionId}/events`, {
      method: "POST",
      body: JSON.stringify({
        kind,
        payload,
        conversationId:
          typeof payload.conversationId === "string"
            ? payload.conversationId
            : typeof payload.conversation_id === "string"
              ? payload.conversation_id
              : liveBinding?.conversationId ?? sessionRef.current?.activeConversationId ?? undefined,
      }),
    });

    return response.ok;
  }

  function upsertAudioAlignedAssistantMessage(
    alignmentPayload: unknown,
    binding: LiveConversationBinding,
  ) {
    const rawAlignedText = extractResearchAudioAlignmentText(alignmentPayload);

    if (!rawAlignedText) {
      return;
    }

    const conversationId = binding.conversationId;
    const attemptToken = binding.attemptToken;

    if (!conversationId || typeof attemptToken !== "number") {
      return;
    }

    const currentTurn = activeAudioAlignedAssistantTurnRef.current;
    const shouldStartNewTurn =
      !currentTurn ||
      currentTurn.conversationId !== conversationId ||
      currentTurn.attemptToken !== attemptToken;

    const nextTurn = shouldStartNewTurn
      ? (() => {
          audioAlignedAssistantTurnCounterRef.current += 1;
          const eventId = `audio-turn-${audioAlignedAssistantTurnCounterRef.current}`;
          const stableKey = `conversation:${conversationId}:event:${eventId}:agent`;

          return {
            conversationId,
            attemptToken,
            eventId,
            stableKey,
            id: `optimistic:${sessionRef.current?.id ?? EMPTY_SESSION_ID}:${eventId}`,
            seq: Date.now(),
            createdAt: new Date().toISOString(),
            content: "",
          } satisfies ActiveAudioAlignedAssistantTurn;
        })()
      : currentTurn;

    const mergedContent = mergeResearchAudioAlignmentText(nextTurn.content, rawAlignedText).trim();

    if (!mergedContent) {
      return;
    }

    const payload = buildResearchAudioAlignedAssistantPayload({
      conversationId: nextTurn.conversationId,
      eventId: nextTurn.eventId,
      text: mergedContent,
      alignmentPayload,
    });

    activeAudioAlignedAssistantTurnRef.current = {
      ...nextTurn,
      content: mergedContent,
    };

    setMessages((current) =>
      mergeResearchWorkspaceMessages(current, [
        {
          id: nextTurn.id,
          seq: nextTurn.seq,
          role: "agent",
          modality: "voice",
          content: mergedContent,
          payload,
          createdAt: nextTurn.createdAt,
          stableKey: nextTurn.stableKey,
          optimistic: true,
        },
      ]),
    );
  }

  function scopeIncomingMessages(messagesToScope: ResearchMessage[], conversationId: string | null | undefined) {
    return scopeResearchWorkspaceMessagesToConversation(messagesToScope, conversationId);
  }

  function applyRemoteSession(
    nextSession: ResearchSessionSnapshot,
    mode: ResearchRemoteSessionUpdateMode = "merge",
  ) {
    const previous = sessionRef.current;
    const normalizedIncomingMessages = normalizeResearchWorkspaceMessages(nextSession.messages);
    const scopedConversationId = nextSession.activeConversationId ?? previous?.activeConversationId ?? null;
    const activeAudioTurn = activeAudioAlignedAssistantTurnRef.current;
    const shouldReplaceAudioAlignedTurn =
      Boolean(
        activeAudioTurn &&
          scopedConversationId &&
          activeAudioTurn.conversationId === scopedConversationId &&
          normalizedIncomingMessages.some((message) => {
            return (
              message.role === "agent" &&
              extractResearchConversationId(message.payload) === scopedConversationId
            );
          }),
      );
    const audioAlignedTurnIdToClear = shouldReplaceAudioAlignedTurn ? activeAudioTurn?.id ?? null : null;
    const isTerminalTransition =
      previous?.id === nextSession.id &&
      previous.status === "collecting" &&
      (nextSession.status === "review" || nextSession.status === "confirmed");

    if (!shouldApplyResearchRemoteSessionUpdate(previous?.id, nextSession.id, mode)) {
      return;
    }

    if (isTerminalTransition && conversation.status === "connected") {
      const nextClosePhase =
        conversation.isSpeaking || conversationModeRef.current === "speaking"
          ? "line_started"
          : "awaiting_final_line";

      closePhaseRef.current = nextClosePhase;
      setClosePhase(nextClosePhase);
      setPendingCloseSince(null);
    }

    if (previous?.id === nextSession.id) {
      if (previous.status === "collecting" && nextSession.status === "review") {
        setNotice("Brief ready for market review.");
      }

      if (previous.status !== "confirmed" && nextSession.status === "confirmed") {
        setNotice("Brief confirmed. Market handoff ready.");
      }
    }

    if (audioAlignedTurnIdToClear) {
      activeAudioAlignedAssistantTurnRef.current = null;
    }

    setSession((current) => {
      if (!current || mode === "replace" || current.id !== nextSession.id) {
        return nextSession;
      }

      return {
        ...nextSession,
        status: mergeSessionStatus(current.status, nextSession.status),
        activeConversationId: nextSession.activeConversationId ?? current.activeConversationId,
        lastEventSeq:
          typeof current.lastEventSeq === "number" && typeof nextSession.lastEventSeq === "number"
            ? Math.max(current.lastEventSeq, nextSession.lastEventSeq)
            : current.lastEventSeq ?? nextSession.lastEventSeq,
        brief:
          current.brief && nextSession.brief
            ? mergeBrief(current.brief, nextSession.brief)
            : nextSession.brief ?? current.brief,
      };
    });
    setMessages((current) =>
      {
        const baseMessages = audioAlignedTurnIdToClear
          ? current.filter((message) => message.id !== audioAlignedTurnIdToClear)
          : current;

        if (mode === "replace") {
          return scopeIncomingMessages(
            normalizedIncomingMessages,
            nextSession.activeConversationId,
          );
        }

        if (previous?.id === nextSession.id) {
          return scopeIncomingMessages(
            mergeResearchWorkspaceMessages(baseMessages, normalizedIncomingMessages),
            nextSession.activeConversationId ?? previous.activeConversationId,
          );
        }

        return scopeIncomingMessages(
          normalizedIncomingMessages,
          nextSession.activeConversationId,
        );
      },
    );

    if (nextSession.brief) {
      const refreshedBrief = nextSession.brief;
      setSummary((current) =>
        current.id === nextSession.id ? mergeBrief(current, refreshedBrief) : refreshedBrief,
      );
    }
  }

  async function reconcileSession(
    targetSession = sessionRef.current
      ? {
          id: sessionRef.current.id,
          status: sessionRef.current.status,
          activeConversationId: sessionRef.current.activeConversationId,
        }
      : null,
    options?: ResearchSessionReconcileOptions,
  ) {
    const isTranscriptSyncTarget =
      targetSession?.status === "review" || targetSession?.status === "confirmed";

    if (
      !targetSession?.id ||
      (targetSession.status !== "collecting" && !isTranscriptSyncTarget)
    ) {
      return;
    }

    const response = await apiRequest<RemoteResponse>(
      `/api/research/sessions/${targetSession.id}/reconcile`,
      {
        method: "POST",
        body: JSON.stringify({
          mode: options?.mode ?? "default",
        }),
      },
    );

    if (sessionRef.current?.id !== targetSession.id) {
      liveToolRecoveryPendingRef.current = false;
      return;
    }

    const liveBinding = getLiveConversationBinding();
    if (
      liveBinding?.sessionId === targetSession.id &&
      liveBinding.conversationId !== targetSession.activeConversationId
    ) {
      liveToolRecoveryPendingRef.current = false;
      return;
    }

    const nextSession = normalizeSession(response.data?.session ?? response.data);

    if (nextSession) {
      applyRemoteSession(nextSession);
      if (options?.mode === "transcript_sync") {
        const transcriptConversationId =
          nextSession.activeConversationId ?? targetSession.activeConversationId ?? null;
        const hasAssistantTranscript =
          !transcriptConversationId ||
          hasAssistantTranscriptForConversation(transcriptConversationId, nextSession.messages);

        if (
          !hasAssistantTranscript &&
          (options?.transcriptSyncRetriesRemaining ?? 0) > 0
        ) {
          setNotice("Syncing transcript...");
          setError(null);
          clearTranscriptSyncRetryTimeout();
          transcriptSyncRetryTimeoutRef.current = window.setTimeout(() => {
            transcriptSyncRetryTimeoutRef.current = null;
            void reconcileSessionRef.current?.(
              {
                id: nextSession.id,
                status: nextSession.status,
                activeConversationId: transcriptConversationId,
              },
              {
                mode: "transcript_sync",
                transcriptSyncRetriesRemaining:
                  (options?.transcriptSyncRetriesRemaining ?? 1) - 1,
              },
            );
          }, RESEARCH_TRANSCRIPT_SYNC_RETRY_MS);
          return;
        }

        clearTranscriptSyncRetryTimeout();
        setError(null);
        if (notice === "Syncing transcript...") {
          setNotice(sessionRef.current?.status === "collecting" ? "Voice connected." : "Conversation ended.");
        }
        return;
      }
      const transcriptConversationId =
        nextSession.activeConversationId ?? targetSession.activeConversationId ?? null;
      const hasAssistantTranscript =
          !transcriptConversationId ||
        hasAssistantTranscriptForConversation(transcriptConversationId, nextSession.messages);

      if (
        response.data?.recovered ||
        nextSession.status === "review" ||
        nextSession.status === "confirmed"
      ) {
        if (
          transcriptConversationId &&
          isResearchTerminalStatus(nextSession.status) &&
          !hasAssistantTranscript &&
          (options?.transcriptSyncRetriesRemaining ?? 0) > 0
        ) {
          setNotice("Syncing transcript...");
          setError(null);
          clearTranscriptSyncRetryTimeout();
          transcriptSyncRetryTimeoutRef.current = window.setTimeout(() => {
            transcriptSyncRetryTimeoutRef.current = null;
            void reconcileSessionRef.current?.(
              {
                id: nextSession.id,
                status: nextSession.status,
                activeConversationId: transcriptConversationId,
              },
              {
                onFailureNotice: options?.onFailureNotice,
                transcriptSyncRetriesRemaining: (options?.transcriptSyncRetriesRemaining ?? 1) - 1,
              },
            );
          }, RESEARCH_TRANSCRIPT_SYNC_RETRY_MS);
          liveToolRecoveryPendingRef.current = false;
          return;
        }

        clearTranscriptSyncRetryTimeout();
        if (!hasAssistantTranscript) {
          terminalTranscriptAutoSyncKeyRef.current = null;
        }
        setNotice(
          nextSession.status === "confirmed"
            ? "Brief confirmed. Market handoff ready."
            : "Brief ready for market review.",
        );
        setError(null);
        repeatedFieldPromptCountsRef.current = { city: 0, headcount: 0, budget: 0 };
        liveToolRecoveryPendingRef.current = false;
        return;
      }
    }

    if (options?.mode === "transcript_sync") {
      if ((options?.transcriptSyncRetriesRemaining ?? 0) > 0) {
        setNotice("Syncing transcript...");
        clearTranscriptSyncRetryTimeout();
        transcriptSyncRetryTimeoutRef.current = window.setTimeout(() => {
          transcriptSyncRetryTimeoutRef.current = null;
          void reconcileSessionRef.current?.(targetSession, {
            mode: "transcript_sync",
            transcriptSyncRetriesRemaining:
              (options?.transcriptSyncRetriesRemaining ?? 1) - 1,
          });
        }, RESEARCH_TRANSCRIPT_SYNC_RETRY_MS);
      }
      return;
    }

    const missingFields = Array.isArray(response.data?.missingFields)
      ? response.data?.missingFields.filter((value): value is string => typeof value === "string")
      : [];
    const toolFailureReason =
      typeof response.data?.lastToolFailureReason === "string"
        ? response.data.lastToolFailureReason
        : null;
    const toolFailureKind =
      typeof response.data?.lastToolFailureKind === "string"
        ? response.data.lastToolFailureKind
        : null;

    setNotice(
      missingFields.length > 0
        ? `Still missing: ${missingFields.join(", ")}.`
        : options?.onFailureNotice ??
            response.data?.reason ??
            (isTranscriptSyncTarget
              ? "Conversation ended."
              : "Intake ended before the brief was saved. Resume intake to continue."),
    );
    setError(
      toolFailureReason
        ? toolFailureKind
          ? `${toolFailureKind}: ${toolFailureReason}`
          : toolFailureReason
        : null,
    );
    clearTranscriptSyncRetryTimeout();
    liveToolRecoveryPendingRef.current = false;
  }

  reconcileSessionRef.current = reconcileSession;

  function findQueuedDisconnectingBinding(attemptToken: ConversationAttemptToken) {
    return (
      disconnectingConversationBindingsRef.current.find(
        (binding) => binding.attemptToken === attemptToken,
      ) ?? null
    );
  }

  function removeQueuedDisconnectingBinding(attemptToken: ConversationAttemptToken) {
    disconnectingConversationBindingsRef.current = disconnectingConversationBindingsRef.current.filter(
      (binding) => binding.attemptToken !== attemptToken,
    );
  }

  function handleAttemptScopedConnect(
    attemptToken: ConversationAttemptToken,
    conversationId: string,
  ) {
    const liveBinding = getLiveConversationBinding();

    if (!liveBinding || liveBinding.attemptToken !== attemptToken) {
      return;
    }

    if (!liveBinding.conversationId) {
      bindConversationId(liveBinding.sessionId, conversationId, attemptToken);
      setSession((current) =>
        current && current.id === liveBinding.sessionId
          ? {
              ...current,
              activeConversationId: conversationId,
            }
          : current,
      );
    }

    if (liveBinding.conversationId && liveBinding.conversationId !== conversationId) {
      return;
    }

    setNotice("Voice connected.");
    setError(null);
    void persistEvent("sdk-connect", { status: "connected", conversationId });
  }

  function handleAttemptScopedDisconnect(
    attemptToken: ConversationAttemptToken,
    details: { reason?: string; message?: string } | undefined,
  ) {
    const liveBinding = liveConversationBindingRef.current;
    const { disconnectedBinding, isCurrentAttempt, shouldClearLiveBinding } =
      resolveResearchDisconnectBinding({
        disconnectingBinding:
          findQueuedDisconnectingBinding(attemptToken) ??
          (liveBinding?.attemptToken === attemptToken ? liveBinding : null),
        liveBinding,
        currentAttemptToken: getCurrentConversationAttemptToken(),
      });
    removeQueuedDisconnectingBinding(attemptToken);

    if (shouldClearLiveBinding) {
      liveConversationBindingRef.current = null;
    }

    discardAudioAlignedAssistantTurnAfterDisconnect(disconnectedBinding);
    void persistEvent("sdk-disconnect", {
      status: "disconnected",
      reason: details?.reason,
      message: details?.message,
      conversationId: disconnectedBinding?.conversationId ?? undefined,
    });

    if (!isCurrentAttempt || !disconnectedBinding) {
      return;
    }

    clearTransportSettling();
    closePhaseRef.current = "idle";
    setClosePhase("idle");
    conversationModeRef.current = "listening";
    setConversationMode("listening");
    setPendingCloseSince(null);
    setNotice(
      sessionRef.current?.status === "collecting"
        ? "Checking for saved brief..."
        : "Syncing transcript...",
    );

    void reconcileSession(
      {
        id: disconnectedBinding.sessionId,
        status:
          sessionRef.current?.id === disconnectedBinding.sessionId
            ? sessionRef.current.status
            : "collecting",
        activeConversationId: disconnectedBinding.conversationId,
      },
      {
        onFailureNotice: "Intake ended before the brief was saved. Resume intake to continue.",
        transcriptSyncRetriesRemaining: RESEARCH_TRANSCRIPT_SYNC_RETRY_LIMIT,
      },
    );
  }

  function handleAttemptScopedError(
    attemptToken: ConversationAttemptToken,
    caught: unknown,
  ) {
    const liveBinding = getLiveConversationBinding();
    const isCurrentAttempt = attemptToken === getCurrentConversationAttemptToken();

    if (!isCurrentAttempt) {
      void persistEvent("sdk-error", {
        message: caught instanceof Error ? caught.message : "Voice session could not start.",
        ignoredWhileSuperseded: true,
      });
      return;
    }

    if (!liveBinding && !voicePendingRef.current) {
      return;
    }

    const message = caught instanceof Error ? caught.message : "Voice session could not start.";

    if (voicePendingRef.current) {
      void persistEvent("sdk-error", {
        message,
        ignoredWhileConnecting: true,
      });
      return;
    }

    if (liveBinding) {
      markTransportSettling(liveBinding);
    }

    if (transportSettlingRef.current && !voicePendingRef.current) {
      setNotice("Finishing the previous intake...");
      void persistEvent("sdk-error", {
        message,
        ignoredWhileSettling: true,
      });
      return;
    }

    if (conversationStatusRef.current === "connected" && liveBinding?.conversationId) {
      void persistEvent("sdk-error", { message, ignoredWhileConnected: true });
      return;
    }

    setError(message);
    void persistEvent("sdk-error", { message });
  }

  function handleAttemptScopedConversationMetadata(
    attemptToken: ConversationAttemptToken,
    metadata: unknown,
  ) {
    const payload = asPayloadRecord(metadata);
    const conversationId =
      typeof payload.conversation_id === "string"
        ? payload.conversation_id
        : typeof payload.conversationId === "string"
          ? payload.conversationId
          : null;
    const liveBinding = getLiveConversationBinding();

    if (
      attemptToken !== getCurrentConversationAttemptToken() ||
      !liveBinding ||
      liveBinding.attemptToken !== attemptToken
    ) {
      void persistEvent("sdk-status", {
        ...payload,
        conversationId: conversationId ?? undefined,
        ignoredWhileSuperseded: true,
      });
      return;
    }

    if (conversationId) {
      const bindingToUpdate = liveBinding;

      if (
        shouldBindResearchConversationMetadata({
          sessionId: sessionRef.current?.id,
          liveBinding: bindingToUpdate,
          conversationId,
        })
      ) {
        setSession((current) =>
          current && current.id === bindingToUpdate.sessionId
            ? {
                ...current,
                activeConversationId: conversationId,
              }
            : current,
        );
      }
    }

    void persistEvent("sdk-status", {
      ...payload,
      conversationId: conversationId ?? undefined,
    });
  }

  function handleAttemptScopedModeChange(
    attemptToken: ConversationAttemptToken,
    { mode }: { mode: string },
  ) {
    if (attemptToken !== getCurrentConversationAttemptToken() || !getLiveConversationBinding()) {
      return;
    }

    const previousMode = conversationModeRef.current;
    conversationModeRef.current = mode;
    setConversationMode(mode);
    void persistEvent("sdk-mode", {
      mode,
      conversationId: getActiveConversationId() ?? undefined,
    });

    const activeConversationId = getActiveConversationId();

    if (
      previousMode === "speaking" &&
      mode === "listening" &&
      sessionRef.current?.status === "collecting" &&
      activeConversationId &&
      !hasDurableAssistantTranscriptForConversation(activeConversationId)
    ) {
      setNotice("Syncing transcript...");
      void reconcileSession(
        {
          id: sessionRef.current.id,
          status: sessionRef.current.status,
          activeConversationId,
        },
        {
          mode: "transcript_sync",
          transcriptSyncRetriesRemaining: RESEARCH_TRANSCRIPT_SYNC_RETRY_LIMIT,
        },
      );
    }
  }

  function handleAttemptScopedMessage(
    attemptToken: ConversationAttemptToken,
    message: unknown,
  ) {
    if (attemptToken !== getCurrentConversationAttemptToken()) {
      return;
    }

    const activeConversationId = getActiveConversationId();
    const rawPayload = asPayloadRecord(message);
    const payload =
      activeConversationId &&
      typeof rawPayload.conversation_id !== "string" &&
      typeof rawPayload.conversationId !== "string"
        ? {
            ...rawPayload,
            conversation_id: activeConversationId,
          }
        : rawPayload;
    const messageRole = inferResearchMessageRole(payload);
    const messageType = inferResearchMessageType(payload);
    const messageText = extractResearchMessageText(payload)?.trim() ?? "";

    if (
      !shouldAcceptResearchConversationPayload(activeConversationId, payload, {
        requireConversationId:
          messageRole === "assistant" ||
          messageType === "agent_response" ||
          messageType === "agent_response_correction" ||
          messageType === "agent_chat_response_part",
      })
    ) {
      return;
    }

    if (messageRole === "assistant" && messageText) {
      discardAudioAlignedAssistantTurn({
        conversationId: activeConversationId ?? undefined,
      });

      const repeatedField = detectResearchRepeatedFieldPrompt(messageText);

      if (
        repeatedField &&
        briefAlreadyContainsResearchField(summaryRef.current, repeatedField)
      ) {
        const nextCount = (repeatedFieldPromptCountsRef.current[repeatedField] ?? 0) + 1;
        repeatedFieldPromptCountsRef.current[repeatedField] = nextCount;

        if (nextCount >= 2 && !liveToolRecoveryPendingRef.current) {
          liveToolRecoveryPendingRef.current = true;
          setNotice("Re-checking the handoff...");
          void reconcileSession(
            sessionRef.current
              ? {
                  id: sessionRef.current.id,
                  status: sessionRef.current.status,
                  activeConversationId: getActiveConversationId(),
                }
              : null,
            {
              onFailureNotice: "The handoff needs another pass. Review the summary and continue.",
            },
          );
        }
      }
    }

    if (messageType === "tentative_user_transcript" || messageType === "agent_chat_response_part") {
      return;
    }

    const nextMessage = coerceResearchWorkspaceMessage(payload);

    if (nextMessage) {
      setMessages((current) => mergeResearchWorkspaceMessages(current, [nextMessage]));
    }

    void persistEvent("sdk-message", payload);
  }

  function handleAttemptScopedAudioAlignment(
    attemptToken: ConversationAttemptToken,
    alignment: unknown,
  ) {
    const liveBinding = getLiveConversationBinding();
    const activeConversationId = liveBinding?.conversationId ?? null;
    const alignmentConversationId = extractResearchConversationId(alignment);

    if (
      attemptToken !== getCurrentConversationAttemptToken() ||
      !liveBinding ||
      !activeConversationId ||
      !alignmentConversationId ||
      alignmentConversationId !== activeConversationId
    ) {
      return;
    }

    if (closePhaseRef.current === "awaiting_final_line") {
      closePhaseRef.current = "line_started";
      setClosePhase("line_started");
    }

    upsertAudioAlignedAssistantMessage(alignment, liveBinding);
  }

  function handleAttemptScopedAgentToolResponse(
    attemptToken: ConversationAttemptToken,
    payload: unknown,
  ) {
    if (attemptToken !== getCurrentConversationAttemptToken()) {
      return;
    }

    const record = asPayloadRecord(payload);
    const responseSession = normalizeSession(record.session);
    const toolName =
      typeof record.tool_name === "string"
        ? record.tool_name
        : typeof record.toolName === "string"
          ? record.toolName
          : null;
    const isSaveBriefTool =
      toolName === "save_research_brief" || toolName === "save_research_brief_v2";
    const toolErrored =
      record.is_error === true || record.isError === true;
    const activeConversationId = getActiveConversationId();

    if (
      !shouldAcceptResearchConversationPayload(activeConversationId, record, {
        requireConversationId: false,
      }) &&
      typeof activeConversationId === "string"
    ) {
      return;
    }

    if (
      responseSession &&
      shouldApplyResearchRemoteSessionUpdate(sessionRef.current?.id, responseSession.id, "merge")
    ) {
      if (
        (responseSession.status === "review" || responseSession.status === "confirmed") &&
        sessionRef.current?.status === "collecting" &&
        conversationStatusRef.current === "connected"
      ) {
        const nextClosePhase =
          conversationIsSpeakingRef.current || conversationModeRef.current === "speaking"
            ? "line_started"
            : "awaiting_final_line";

        closePhaseRef.current = nextClosePhase;
        setClosePhase(nextClosePhase);
        setPendingCloseSince(null);
      }

      applyRemoteSession(responseSession);
    }

    void persistEvent("sdk-tool-response", record);

    if (isSaveBriefTool && !toolErrored) {
      repeatedFieldPromptCountsRef.current = { city: 0, headcount: 0, budget: 0 };
      liveToolRecoveryPendingRef.current = false;
      return;
    }

    if (
      isSaveBriefTool &&
      toolErrored &&
      sessionRef.current?.status === "collecting" &&
      !liveToolRecoveryPendingRef.current
    ) {
      liveToolRecoveryPendingRef.current = true;
      repeatedFieldPromptCountsRef.current = { city: 0, headcount: 0, budget: 0 };
      setNotice("Re-checking the handoff...");
      void reconcileSession(
        {
          id: sessionRef.current.id,
          status: sessionRef.current.status,
          activeConversationId: getActiveConversationId(),
        },
        {
          onFailureNotice: "The handoff needs another pass. Review the summary and continue.",
        },
      );
    }
  }

  const conversation = useConversation({
    serverLocation: "in-residency",
    clientTools: {
      sync_intake_state: async (parameters: unknown) => {
        const activeSessionId = sessionRef.current?.id;

        if (!activeSessionId || !parameters || typeof parameters !== "object") {
          return JSON.stringify({ ok: false, synced: false });
        }

        try {
          const nextBrief = buildResearchBriefFromPayload(
            {
              research_session_id: activeSessionId,
              ...(parameters as Record<string, unknown>),
            },
            summaryRef.current,
          );

          setSummary(nextBrief);
          setSession((current) =>
            current
              ? {
                  ...current,
                  inputMode: nextBrief.inputMode,
                  category: nextBrief.category,
                  scopeStatus: nextBrief.scopeStatus,
                  brief: nextBrief,
                }
              : current,
          );
          void persistEvent("sdk-tool-request", {
            toolName: "sync_intake_state",
            parameters: parameters as Record<string, unknown>,
          });

          return JSON.stringify({
            ok: true,
            synced: true,
            sessionId: activeSessionId,
          });
        } catch (caught) {
          void persistEvent("sdk-error", {
            toolName: "sync_intake_state",
            message: caught instanceof Error ? caught.message : "Unable to parse intake payload.",
          });

          return JSON.stringify({ ok: false, synced: false });
        }
      },
    },
  });

  useEffect(() => {
    conversationStatusRef.current = normalizeTransportState(conversation.status);
    conversationIsSpeakingRef.current = conversation.isSpeaking;
  }, [conversation.isSpeaking, conversation.status]);

  const closeConversationGracefully = useCallback(async () => {
    if (closingSessionRef.current) {
      return;
    }

    if (conversation.status !== "connected") {
      setPendingCloseSince(null);
      return;
    }

    closingSessionRef.current = true;
    markTransportSettling();

    try {
      await conversation.endSession();
    } catch {
      // The disconnect callback will settle the UI if the SDK races here.
    } finally {
      closingSessionRef.current = false;
      setPendingCloseSince(null);
    }
  // markTransportSettling intentionally reads the latest refs; keeping the callback keyed to the
  // SDK conversation instance avoids churn while preserving the close semantics.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation]);

  useEffect(() => {
    if (replayActive) {
      return;
    }

    if (!session?.id) {
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      const response = await apiRequest<RemoteResponse>(`/api/research/sessions/${session.id}`, {
        method: "GET",
      });

      if (!response.ok || cancelled) {
        return;
      }

      const nextSession = normalizeSession(response.data?.session ?? response.data);

      if (!nextSession || cancelled) {
        return;
      }

      applyRemoteSession(nextSession);
    };

    void refresh();
    const interval = window.setInterval(refresh, session.status === "collecting" ? 4000 : 8000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // applyRemoteSession intentionally reads the latest session refs and is kept out of deps
    // so polling cadence stays keyed to the active session rather than function identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayActive, session?.id, session?.status]);

  useEffect(() => {
    if (replayActive) {
      setPendingCloseSince(null);
      return;
    }

    if (
      !shouldQueueResearchConversationClose({
        status: session?.status,
        transportStatus: conversation.status,
        closePhase,
      })
    ) {
      if (conversation.status !== "connected") {
        setPendingCloseSince(null);
      }

      return;
    }

    setPendingCloseSince((current) => current ?? Date.now());
  }, [closePhase, conversation.status, replayActive, session?.id, session?.status]);

  useEffect(() => {
    if (replayActive) {
      return;
    }

    if (
      shouldEndResearchConversation({
        status: session?.status,
        transportStatus: conversation.status,
        isSpeaking: conversation.isSpeaking,
        mode: conversationMode,
        pendingCloseSince,
        now: Date.now(),
        closePhase,
      })
    ) {
      void closeConversationGracefully();
      return;
    }

    if (
      !shouldQueueResearchConversationClose({
        status: session?.status,
        transportStatus: conversation.status,
        closePhase,
      })
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (
        shouldEndResearchConversation({
          status: sessionRef.current?.status,
          transportStatus: conversation.status,
          isSpeaking: conversation.isSpeaking,
          mode: conversationMode,
          pendingCloseSince: pendingCloseSinceRef.current,
          now: Date.now(),
          timeoutMs: RESEARCH_SESSION_CLOSE_TIMEOUT_MS,
          closePhase: closePhaseRef.current,
        })
      ) {
        void closeConversationGracefully();
      }
    }, RESEARCH_SESSION_CLOSE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    closeConversationGracefully,
    conversation.isSpeaking,
    conversation.status,
    conversationMode,
    closePhase,
    pendingCloseSince,
    replayActive,
    session?.status,
  ]);

  async function createSession(fresh: boolean) {
    setActionPending(true);
    setError(null);
    const liveBinding = getLiveConversationBinding();
    const sdkTransportState = normalizeTransportState(conversation.status);

    if (sdkTransportState === "connected") {
      markTransportSettling();
      await conversation.endSession().catch(() => undefined);
    }

    if (sdkTransportState === "disconnecting" || (sdkTransportState === "error" && liveBinding)) {
      markTransportSettling();
    }

    if (
      sdkTransportState === "disconnecting" ||
      (sdkTransportState === "error" && liveBinding) ||
      transportSettlingRef.current
    ) {
      const settled = await waitForTransportSettled();

      if (!settled) {
        clearTransportSettling();
        setActionPending(false);
        setError("The previous intake is still closing. Try again in a moment.");
        return null;
      }
    }

    discardAudioAlignedAssistantTurn();
    audioAlignedAssistantTurnCounterRef.current = 0;
    liveConversationBindingRef.current = null;
    closePhaseRef.current = "idle";
    setClosePhase("idle");
    clearTransportSettling();
    conversationModeRef.current = "listening";

    const response = await apiRequest<RemoteResponse>("/api/research/sessions", {
      method: "POST",
      body: JSON.stringify({
        fresh,
        inputMode: "voice",
      }),
    });
    const nextSession = normalizeSession(response.data?.session ?? response.data);

    if (!response.ok || !nextSession) {
      setActionPending(false);
      setError(response.error ?? "Research session could not be created.");
      return null;
    }

    applyRemoteSession(nextSession, "replace");
    setMessages(
      scopeIncomingMessages(nextSession.messages, nextSession.activeConversationId),
    );
    setSummary(nextSession.brief ?? createWorkspaceBrief(nextSession.id, nextSession.inputMode));
    setNotice(null);
    setActionPending(false);

    startTransition(() => {
      router.replace(`/research?researchSessionId=${nextSession.id}`);
    });

    return nextSession;
  }

  async function connectVoice(targetSession = sessionRef.current) {
    if (!targetSession?.id) {
      return;
    }

    const liveBinding = getLiveConversationBinding();
    const sdkTransportState = normalizeTransportState(conversation.status);

    if (voicePendingRef.current) {
      return;
    }

    if (sdkTransportState === "connected") {
      setNotice("Voice already connected.");
      return;
    }

    if (
      sdkTransportState === "connecting" ||
      sdkTransportState === "disconnecting" ||
      (sdkTransportState === "error" && liveBinding)
    ) {
      setNotice("Voice session is still settling.");
      return;
    }

    if (transportSettlingRef.current) {
      setNotice("Finishing the previous intake...");
      return;
    }

    setVoicePending(true);
    voicePendingRef.current = true;
    setError(null);
    const attemptToken = startConversationAttempt(targetSession.id);

    const response = await apiRequest<{
      signedUrl?: string | null;
      dynamicVariables?: Record<string, string | number | boolean>;
      error?: string | null;
    }>("/api/research/elevenlabs/signed-url", {
      method: "POST",
      body: JSON.stringify({
        researchSessionId: targetSession.id,
        inputMode: "voice",
      }),
    });

    if (!response.ok || !response.data?.signedUrl) {
      if (attemptToken === getCurrentConversationAttemptToken()) {
        liveConversationBindingRef.current = null;
      }
      setVoicePending(false);
      voicePendingRef.current = false;
      setError(response.error ?? "Voice intake could not start.");
      return;
    }

    try {
      const conversationId = await conversation.startSession({
        signedUrl: response.data.signedUrl,
        dynamicVariables: response.data.dynamicVariables ?? undefined,
        serverLocation: "in-residency",
        onConnect: ({ conversationId }: { conversationId: string }) => {
          handleAttemptScopedConnect(attemptToken, conversationId);
        },
        onDisconnect: (details: { reason?: string; message?: string } | undefined) => {
          handleAttemptScopedDisconnect(attemptToken, details);
        },
        onError: (caught: unknown) => {
          handleAttemptScopedError(attemptToken, caught);
        },
        onMessage: (message: unknown) => {
          handleAttemptScopedMessage(attemptToken, message);
        },
        onAudioAlignment: (alignment: unknown) => {
          handleAttemptScopedAudioAlignment(attemptToken, alignment);
        },
        onConversationMetadata: (metadata: unknown) => {
          handleAttemptScopedConversationMetadata(attemptToken, metadata);
        },
        onModeChange: ({ mode }: { mode: string }) => {
          handleAttemptScopedModeChange(attemptToken, { mode });
        },
        onAgentToolResponse: (payload: unknown) => {
          handleAttemptScopedAgentToolResponse(attemptToken, payload);
        },
      });

      if (attemptToken !== getCurrentConversationAttemptToken()) {
        queueDisconnectingBinding({
          sessionId: targetSession.id,
          conversationId: conversationId ?? null,
          attemptToken,
        });
        await conversation.endSession().catch(() => undefined);
        return;
      }

      if (conversationId) {
        bindConversationId(targetSession.id, conversationId, attemptToken);

        await persistEvent("sdk-status", {
          conversationId,
          source: "client-start-session",
          startAttempt: attemptToken,
        });
      }

      setSession((current) =>
        current
          ? {
              ...current,
              status: mergeSessionStatus(current.status, "collecting"),
              inputMode: "voice",
              activeConversationId: conversationId ?? current.activeConversationId,
            }
          : current,
      );
      setNotice("Voice connected.");
    } catch (caught) {
      if (attemptToken === getCurrentConversationAttemptToken()) {
        liveConversationBindingRef.current = null;
        setError(caught instanceof Error ? caught.message : "Voice intake could not start.");
      }
    } finally {
      setVoicePending(false);
      voicePendingRef.current = false;
    }
  }

  async function handlePrimaryAction() {
    if (replay) {
      replay.restart();
      return;
    }

    if (!session) {
      const nextSession = await createSession(true);

      if (nextSession) {
        await connectVoice(nextSession);
      }

      return;
    }

    if (session.status === "review" || session.status === "confirmed") {
      return;
    }

    await connectVoice(session);
  }

  async function handleStartFresh() {
    if (replay) {
      replay.restart();
      return;
    }

    const nextSession = await createSession(true);

    if (nextSession) {
      await connectVoice(nextSession);
    }
  }

  async function handleResumeLatest() {
    if (!resumeCandidate) {
      return;
    }

    const response = await apiRequest<RemoteResponse>(`/api/research/sessions/${resumeCandidate.id}`, {
      method: "GET",
    });
    const latestSession = normalizeSession(response.data?.session ?? response.data);

    if (!response.ok || !latestSession) {
      setError(response.error ?? "Unable to restore the latest session.");
      startTransition(() => {
        router.refresh();
      });
      return;
    }

    if (latestSession.status === "superseded" || latestSession.status === "cancelled") {
      setNotice("The latest brief changed. Refreshing the current state.");
      setError(null);
      startTransition(() => {
        router.refresh();
      });
      return;
    }

    setError(null);
    applyRemoteSession(latestSession, "replace");
    setMessages(
      scopeIncomingMessages(
        normalizeResearchWorkspaceMessages(latestSession.messages),
        latestSession.activeConversationId,
      ),
    );
    setSummary(latestSession.brief ?? createWorkspaceBrief(latestSession.id, latestSession.inputMode));
    setNotice(
      latestSession.status === "review"
        ? "Brief ready for market review."
        : latestSession.status === "confirmed"
          ? "Brief confirmed. Market handoff ready."
          : "Latest intake restored.",
    );

    startTransition(() => {
      router.replace(`/research?researchSessionId=${encodeURIComponent(latestSession.id)}`);
    });
  }

  async function handleProceed() {
    if (!session?.id) {
      return;
    }

    if (session.status === "confirmed") {
      startTransition(() => {
        router.push(`/market?researchSessionId=${session.id}`);
      });
      return;
    }

    setActionPending(true);
    setError(null);

    const response = await apiRequest<RemoteResponse>(`/api/research/sessions/${session.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ brief: summaryRef.current }),
    });
    const nextSession = normalizeSession(response.data?.session ?? response.data);

    if (!response.ok || !nextSession) {
      setActionPending(false);
      setError(response.error ?? "Research brief could not be confirmed.");
      return;
    }

    applyRemoteSession(nextSession);
    setActionPending(false);

    startTransition(() => {
      router.push(
        (response.data?.redirectUrl as string | undefined) ?? `/market?researchSessionId=${nextSession.id}`,
      );
      router.refresh();
    });
  }

  const missingFields = summary.missingFields ?? computeMissingFields(summary);
  const ready =
    computeReadyForMarket(summary) &&
    (session?.status === "review" || session?.status === "confirmed");
  const transportState = voicePending
    ? "connecting"
    : transportSettling
      ? "disconnecting"
      : normalizeTransportState(conversation.status);
  const startFreshDisabled = transportState === "connected" || transportState === "connecting" || transportState === "disconnecting";
  const scopeStatus = summary.scopeStatus ?? session?.scopeStatus ?? null;
  const statusNotice =
    session?.status === "review"
      ? "Brief ready for market review"
      : session?.status === "confirmed"
        ? "Brief confirmed. Market handoff ready"
        : null;
  const fallbackNotice =
    !session && resumeCandidate
      ? resumeCandidate.status === "confirmed"
        ? "Fresh intake ready. Resume the last confirmed brief if you need it."
        : resumeCandidate.status === "review"
          ? "Fresh intake ready. Resume the last review if you want to continue."
          : "Fresh intake ready. Resume the latest intake if you want to continue."
      : null;
  const effectiveSessionStatus = replay?.status ?? session?.status ?? null;
  const effectiveTransportState = replay?.transportState ?? transportState;
  const effectiveNotice = replay?.notice ?? notice ?? fallbackNotice;
  const effectivePending = replayActive ? false : actionPending || voicePending;
  const effectiveSpeaking = replay?.speaking ?? conversation.isSpeaking;
  const effectiveMessages = replay?.messages ?? messages;
  const effectiveSummary = replay?.brief ?? summary;
  const effectiveScopeStatus = replay?.scopeStatus ?? scopeStatus;
  const effectiveMissingFields = replay ? [] : missingFields;
  const effectiveReady = replay?.ready ?? ready;
  const effectiveStatusNotice = replay?.statusNotice ?? statusNotice;
  const effectiveSyncLabel = formatResearchSync(replay?.syncTimestamp ?? session?.updatedAt);

  useEffect(() => {
    if (replayActive) {
      const guide: GuideEnvelope = {
        personaId: "switchboard",
        stage: "research",
        mode: "live",
        headline: effectiveReady ? "Brief ready for market review" : "Switchboard recording replay",
        body: effectiveReady
          ? "The replay has reached the market-ready handoff state."
          : "A local-only research replay is running for recording. Live intake is muted.",
        accent: "Powered by ElevenLabs / ElevenAgents",
        speakableText: "",
        speechKey: `research:${session?.id ?? "new"}:recording-replay`,
        speechToken: "",
        nextActionLabel: effectiveReady ? "Proceed to market" : "Replay intake",
        nextActionHref: "",
        blockingState: !effectiveReady,
        audioState: "muted",
      };

      setGuide(guide);
      return;
    }

    const stageStatus = session?.status ?? "draft";
    const transportLabel = transportState === "connected" ? "live" : transportState === "connecting" ? "connecting" : "standby";
    const researchReadyToNarrate =
      (stageStatus === "review" || stageStatus === "confirmed") &&
      transportState !== "connected" &&
      transportState !== "connecting" &&
      transportState !== "disconnecting";
    const guide: GuideEnvelope = {
      personaId: "switchboard",
      stage: "research",
      mode: researchReadyToNarrate ? "narrated" : "live",
      headline:
        stageStatus === "confirmed"
          ? "Brief confirmed. Market handoff ready"
          : stageStatus === "review"
            ? "Brief ready for market review"
            : transportState === "connected"
              ? "Switchboard is listening live"
              : "Start the ElevenLabs intake",
      body:
        stageStatus === "confirmed"
          ? "Switchboard captured the brief with ElevenLabs and ElevenAgents. Firecrawl can take the handoff whenever you are ready."
          : stageStatus === "review"
            ? "The live ElevenLabs intake has enough context. Review the brief and move it into Firecrawl when you are ready."
            : transportState === "connected"
              ? "Switchboard is running a live ElevenLabs / ElevenAgents intake right now. Speak naturally and the brief will update in place."
              : "Switchboard is standing by to capture the brief with ElevenLabs and ElevenAgents before the market handoff.",
      accent: "Powered by ElevenLabs / ElevenAgents",
      speakableText:
        researchReadyToNarrate && stageStatus === "confirmed"
          ? "Switchboard update. The brief is confirmed and the market handoff is ready."
          : researchReadyToNarrate && stageStatus === "review"
            ? "Switchboard update. The brief is ready for market review and can move to Firecrawl now."
            : "",
      speechKey:
        researchReadyToNarrate && stageStatus === "confirmed"
          ? `research:${session?.id ?? "new"}:confirmed-ready`
          : researchReadyToNarrate && stageStatus === "review"
            ? `research:${session?.id ?? "new"}:review-ready`
            : `research:${session?.id ?? "new"}:${stageStatus}:${transportLabel}`,
      speechToken: "",
      nextActionLabel: stageStatus === "confirmed" ? "Open market" : "Start intake",
      nextActionHref: stageStatus === "confirmed" && session?.id ? `/market?researchSessionId=${encodeURIComponent(session.id)}` : "",
      blockingState: stageStatus !== "confirmed",
      audioState: "muted",
    };

    setGuide(guide);
  }, [effectiveReady, replayActive, session?.id, session?.status, setGuide, transportState]);

  return (
    <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.85fr)]">
      <ResearchVoiceCard
        hasSession={Boolean(session)}
        sessionStatus={effectiveSessionStatus}
        resumeCandidate={
          !session && resumeCandidate
            ? {
                id: resumeCandidate.id,
                status: resumeCandidate.status,
                updatedAt: resumeCandidate.updatedAt,
              }
            : null
        }
        transportState={effectiveTransportState}
        speaking={effectiveSpeaking}
        pending={effectivePending}
        notice={effectiveNotice}
        error={error}
        messages={effectiveMessages}
        syncLabel={effectiveSyncLabel}
        disableStartFresh={replayActive}
        recordingReplayTrigger={
          replay
            ? {
                visible: !replay.isPlaying,
                label: replay.hasCompleted ? "Replay" : "Start",
                onTrigger: replay.restart,
              }
            : null
        }
        onPrimaryAction={() => void handlePrimaryAction()}
        onResumeLatest={resumeCandidate ? handleResumeLatest : undefined}
        onStartFresh={() => void handleStartFresh()}
      />

      <ResearchSummaryPane
        brief={effectiveSummary}
        status={session?.status ?? null}
        statusOverride={effectiveSessionStatus}
        scopeStatus={effectiveScopeStatus}
        statusNotice={effectiveStatusNotice}
        ready={ready}
        readyOverride={effectiveReady}
        missingFields={effectiveMissingFields}
        actionPending={actionPending}
        startFreshDisabled={replayActive || startFreshDisabled}
        draftSummaryText={replay?.draftSummary ?? null}
        draftQueryPreviewText={replay?.draftQueryPreview ?? null}
        onProceed={() => void handleProceed()}
        onStartFresh={() => void handleStartFresh()}
      />
    </div>
  );
}
