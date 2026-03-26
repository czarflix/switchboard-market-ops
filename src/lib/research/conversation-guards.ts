function readStartAttempt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  return null;
}

export function readResearchConversationStartAttempt(payload: Record<string, unknown> | null | undefined) {
  if (!payload) {
    return null;
  }

  return readStartAttempt(
    payload.startAttempt ??
      payload.start_attempt ??
      payload.clientStartAttempt ??
      payload.client_start_attempt,
  );
}

export function shouldIgnoreStaleResearchConversationEvent(args: {
  activeConversationId: string | null | undefined;
  activeStartAttempt: number | null | undefined;
  eventConversationId: string | null | undefined;
  kind: string;
  payload: Record<string, unknown>;
}) {
  if (!args.eventConversationId || !args.activeConversationId) {
    return false;
  }

  if (args.eventConversationId === args.activeConversationId) {
    return false;
  }

  if (
    args.kind === "sdk-status" &&
    args.payload.source === "client-start-session"
  ) {
    const eventStartAttempt = readResearchConversationStartAttempt(args.payload);

    if (eventStartAttempt == null) {
      return true;
    }

    if (args.activeStartAttempt == null) {
      return false;
    }

    return eventStartAttempt < args.activeStartAttempt;
  }

  return true;
}

type ResearchConversationBinding = {
  sessionId: string;
  conversationId: string | null;
  attemptToken: number;
};

export function shouldBindResearchConversationMetadata(args: {
  sessionId: string | null | undefined;
  liveBinding: ResearchConversationBinding | null | undefined;
  conversationId: string | null | undefined;
}) {
  if (!args.sessionId || !args.conversationId || !args.liveBinding) {
    return false;
  }

  if (args.liveBinding.sessionId !== args.sessionId) {
    return false;
  }

  return args.liveBinding.conversationId === args.conversationId;
}

export function resolveResearchDisconnectBinding(args: {
  disconnectingBinding: ResearchConversationBinding | null | undefined;
  liveBinding: ResearchConversationBinding | null | undefined;
  currentAttemptToken: number;
}) {
  const disconnectedBinding = args.disconnectingBinding ?? args.liveBinding ?? null;

  return {
    disconnectedBinding,
    isCurrentAttempt:
      disconnectedBinding?.attemptToken === args.currentAttemptToken,
    shouldClearLiveBinding:
      Boolean(
        disconnectedBinding &&
          args.liveBinding &&
          disconnectedBinding.attemptToken === args.liveBinding.attemptToken,
      ),
  };
}
