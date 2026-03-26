"use client";

import { useConversation, type HookOptions, type Location } from "@elevenlabs/react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildResearchDynamicVariables,
  extractResearchConversationId,
  extractToolSignal,
  isSaveResearchBriefTool,
  mergeResearchTimelineEntry,
  normalizeResearchTimelineEntry,
  type ResearchConversationEvent,
  type ResearchInputMode,
  type ResearchSignedUrlRequest,
  type ResearchSignedUrlResponse,
  type ResearchTimelineEntry,
  type ResearchTransportState,
} from "@/lib/research/elevenlabs-client";

type PersistEventHandler = (
  event: ResearchConversationEvent,
) => Promise<void> | void;

interface UseResearchConversationOptions {
  sessionId: string;
  userId: string;
  priorSummary?: string;
  missingFields?: string[];
  supportedCategories?: string[];
  initialInputMode?: ResearchInputMode;
  eventEndpoint?: string;
  signedUrlEndpoint?: string;
  serverLocation?: Location;
  autoPersistEvents?: boolean;
  onEvent?: PersistEventHandler;
  onSignedUrlResolved?: (response: ResearchSignedUrlResponse) => void;
  onToolSaveBrief?: (signal: {
    toolCallId?: string;
    payload: unknown;
  }) => void;
}

function safePayload(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    return { message: value.message, name: value.name };
  }

  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }

  return { value };
}

export function useResearchConversation({
  sessionId,
  userId,
  priorSummary,
  missingFields = [],
  supportedCategories = [],
  initialInputMode = "voice",
  eventEndpoint,
  signedUrlEndpoint = "/api/research/elevenlabs/signed-url",
  serverLocation = "in-residency",
  autoPersistEvents = true,
  onEvent,
  onSignedUrlResolved,
  onToolSaveBrief,
}: UseResearchConversationOptions) {
  const [timeline, setTimeline] = useState<ResearchTimelineEntry[]>([]);
  const [transportState, setTransportState] = useState<ResearchTransportState>("idle");
  const [activeInputMode, setActiveInputMode] =
    useState<ResearchInputMode>(initialInputMode);
  const [conversationId, setConversationId] = useState<string>();
  const [error, setError] = useState<string>();

  const sequenceRef = useRef(0);
  const persistQueueRef = useRef(Promise.resolve());
  const onEventRef = useRef(onEvent);
  const onToolSaveBriefRef = useRef(onToolSaveBrief);
  const onSignedUrlResolvedRef = useRef(onSignedUrlResolved);

  useEffect(() => {
    onEventRef.current = onEvent;
    onToolSaveBriefRef.current = onToolSaveBrief;
    onSignedUrlResolvedRef.current = onSignedUrlResolved;
  }, [onEvent, onSignedUrlResolved, onToolSaveBrief]);

  const persistEvent = useCallback(
    (kind: ResearchConversationEvent["kind"], payload: Record<string, unknown>) => {
      const event: ResearchConversationEvent = {
        kind,
        sessionId,
        conversationId,
        seq: ++sequenceRef.current,
        payload,
        createdAt: new Date().toISOString(),
      };

      persistQueueRef.current = persistQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (autoPersistEvents && eventEndpoint) {
            await fetch(eventEndpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(event),
            });
          }

          await onEventRef.current?.(event);
        });
    },
    [autoPersistEvents, conversationId, eventEndpoint, sessionId],
  );

  const conversation = useConversation({
    serverLocation,
    onConnect: () => {
      setTransportState("connected");
      persistEvent("sdk-connect", { inputMode: activeInputMode });
    },
    onConversationMetadata: (payload) => {
      const nextConversationId = extractResearchConversationId(payload);

      if (nextConversationId) {
        setConversationId(nextConversationId);
      }

      persistEvent("sdk-status", safePayload(payload));
    },
    onDisconnect: () => {
      setTransportState("disconnected");
      persistEvent("sdk-disconnect", {});
    },
    onError: (caught) => {
      const normalizedError = safePayload(caught);
      setTransportState("error");
      setError(typeof normalizedError.message === "string" ? normalizedError.message : "Conversation failed.");
      persistEvent("sdk-error", normalizedError);
    },
    onMessage: (payload) => {
      const normalized = normalizeResearchTimelineEntry(payload);

      if (normalized) {
        startTransition(() => {
          setTimeline((current) => mergeResearchTimelineEntry(current, normalized));
        });
      }

      persistEvent("sdk-message", safePayload(payload));
    },
    onModeChange: ({ mode }) => {
      const nextMode = mode === "speaking" && activeInputMode === "text" ? "mixed" : activeInputMode;
      setActiveInputMode(nextMode);
      persistEvent("sdk-mode", { mode, inputMode: nextMode });
    },
    onStatusChange: ({ status }) => {
      setTransportState(status === "connected" ? "connected" : "connecting");
      persistEvent("sdk-status", { status });
    },
    onAgentToolRequest: (payload) => {
      persistEvent("sdk-tool-request", safePayload(payload));
    },
    onAgentToolResponse: (payload) => {
      const signal = extractToolSignal(payload);

      if (signal && isSaveResearchBriefTool(signal.toolName)) {
        onToolSaveBriefRef.current?.({
          toolCallId: signal.toolCallId,
          payload: signal.payload,
        });
      }

      persistEvent("sdk-tool-response", safePayload(payload));
    },
  } satisfies Partial<HookOptions>);

  const signedUrlRequest = useMemo<ResearchSignedUrlRequest>(
    () => ({
      sessionId,
      userId,
      inputMode: activeInputMode,
      priorSummary,
      missingFields,
      supportedCategories,
      dynamicVariables: buildResearchDynamicVariables({
        sessionId,
        userId,
        priorSummary,
        missingFields,
        supportedCategories,
      }),
    }),
    [
      activeInputMode,
      missingFields,
      priorSummary,
      sessionId,
      supportedCategories,
      userId,
    ],
  );

  const requestSignedUrl = useCallback(
    async (mode: ResearchInputMode) => {
      setTransportState("connecting");
      setError(undefined);

      const response = await fetch(signedUrlEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...signedUrlRequest,
          inputMode: mode,
        }),
      });

      if (!response.ok) {
        throw new Error(`Unable to start research session (${response.status}).`);
      }

      const data = (await response.json()) as ResearchSignedUrlResponse;
      onSignedUrlResolvedRef.current?.(data);

      if (data.conversationId) {
        setConversationId(data.conversationId);
      }

      return data.signedUrl;
    },
    [signedUrlEndpoint, signedUrlRequest],
  );

  const startSession = useCallback(
    async (mode: ResearchInputMode) => {
      setActiveInputMode(mode);
      const signedUrl = await requestSignedUrl(mode);
      const overrides =
        mode === "text"
          ? {
              conversation: {
                textOnly: true,
              },
            }
          : undefined;

      const startedConversationId = await conversation.startSession({
        signedUrl,
        overrides,
        serverLocation,
      });

      if (startedConversationId) {
        setConversationId(startedConversationId);
      }

      return startedConversationId;
    },
    [conversation, requestSignedUrl, serverLocation],
  );

  const ensureConnected = useCallback(
    async (mode: ResearchInputMode) => {
      if (transportState === "connected" || transportState === "connecting") {
        return;
      }

      await startSession(mode);
    },
    [startSession, transportState],
  );

  const startVoiceSession = useCallback(async () => {
    await startSession("voice");
  }, [startSession]);

  const startTextSession = useCallback(async () => {
    await startSession("text");
  }, [startSession]);

  const continueIntake = useCallback(async () => {
    await startSession(activeInputMode === "text" ? "text" : "voice");
  }, [activeInputMode, startSession]);

  const sendTextMessage = useCallback(
    async (text: string) => {
      const message = text.trim();

      if (!message) {
        return;
      }

      if (transportState !== "connected") {
        await ensureConnected("text");
      }

      if (activeInputMode === "voice") {
        setActiveInputMode("mixed");
      }

      const optimisticEntry: ResearchTimelineEntry = {
        id: `optimistic-user-${Date.now()}`,
        role: "user",
        text: message,
        messageType: "user_message",
        createdAt: new Date().toISOString(),
        final: true,
        optimistic: true,
      };

      startTransition(() => {
        setTimeline((current) => mergeResearchTimelineEntry(current, optimisticEntry));
      });

      conversation.sendUserMessage(message);
      conversation.sendUserActivity();

      persistEvent("client-text", {
        text: message,
        inputMode: activeInputMode === "voice" ? "mixed" : activeInputMode,
      });
    },
    [
      activeInputMode,
      conversation,
      ensureConnected,
      persistEvent,
      transportState,
    ],
  );

  const sendContextualUpdate = useCallback(
    async (text: string) => {
      const update = text.trim();

      if (!update) {
        return;
      }

      if (transportState !== "connected") {
        await ensureConnected(activeInputMode);
      }

      conversation.sendContextualUpdate(update);
      persistEvent("client-contextual-update", { text: update });
    },
    [activeInputMode, conversation, ensureConnected, persistEvent, transportState],
  );

  const endSession = useCallback(async () => {
    await conversation.endSession();
    setTransportState("disconnected");
  }, [conversation]);

  return {
    activeInputMode,
    canSendFeedback: conversation.canSendFeedback,
    connectionStatus: transportState,
    continueIntake,
    conversationId,
    endSession,
    error,
    isSpeaking: conversation.isSpeaking,
    sendContextualUpdate,
    sendTextMessage,
    startTextSession,
    startVoiceSession,
    timeline,
  };
}
