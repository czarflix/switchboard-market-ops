import { useCallback, useEffect, useMemo, useState } from "react";

import { createEmptyResearchBrief } from "../../../lib/research/schemas.ts";
import {
  normalizeResearchWorkspaceMessages,
  scopeResearchWorkspaceMessagesToConversation,
} from "./research-workspace-state.ts";
import type {
  ResearchBrief,
  ResearchMessage,
  ResearchSessionSnapshot,
  ResearchSessionStatus,
  ScopeStatus,
} from "./types.ts";

export const RESEARCH_RECORDING_REPLAY_DURATION_MS = 17_000;

export type ResearchRecordingReplayConfig = {
  enabled: boolean;
  rawDurationMs?: number | null;
};

export type ResearchRecordingReplayFrame = {
  status: ResearchSessionStatus;
  ready: boolean;
  transportState: "connected" | "disconnected";
  speaking: boolean;
  notice: string;
  statusNotice: string | null;
  messages: ResearchMessage[];
  brief: ResearchBrief;
  scopeStatus: ScopeStatus | null;
  draftSummary: string | null;
  draftQueryPreview: string | null;
  syncTimestamp: string | null;
};

type ResearchRecordingReplaySource = {
  sessionId: string;
  conversationId: string | null;
  introLine: string;
  openingUserLine: string;
  assistantCapacityLine: string;
  userCapacityLine: string;
  assistantBudgetTimelineLine: string;
  userBudgetTimelineLine: string;
  finalAssistantLine: string;
  summaryText: string;
  queryPreviewText: string;
  introCreatedAt: string | null;
  firstUserCreatedAt: string | null;
  secondUserCreatedAt: string | null;
  thirdUserCreatedAt: string | null;
  followupCreatedAt: string | null;
  finalCreatedAt: string | null;
  brief: ResearchBrief;
  scopeStatus: ScopeStatus | null;
  syncTimestamp: string | null;
};

const DEFAULT_REPLAY_INTRO =
  "Hi, I'm your research intake assistant. We are only gathering requirements right now, and the actual market research has not started yet. I'll ask a few short intake questions, then prepare a written summary for your review before anything proceeds.";
const DEFAULT_REPLAY_FINAL_LINE =
  "Your market brief is ready for review. Please verify it and click proceed to market.";

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeReplayText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function formatReplayHeadcount(category: ResearchBrief["category"], headcount: number) {
  if (headcount <= 0) {
    return "";
  }

  if (category === "banquet") {
    return `${headcount} ${headcount === 1 ? "person" : "people"}`;
  }

  return `${headcount} ${headcount === 1 ? "person" : "people"}`;
}

function formatReplayBudget(brief: ResearchBrief) {
  return normalizeReplayText(brief.budget?.notes);
}

function formatReplayTimeline(brief: ResearchBrief) {
  return normalizeReplayText(brief.timeline?.label);
}

function buildReplaySyntheticUserBrief(brief: ResearchBrief) {
  const city = normalizeReplayText(brief.city);
  const headcount = formatReplayHeadcount(brief.category, brief.headcount);
  const budget = formatReplayBudget(brief);
  const timeline = formatReplayTimeline(brief);

  if (brief.category === "banquet") {
    return normalizeReplayText(
      [
        "I'm looking to book a banquet venue",
        city ? `in ${city}` : "",
        headcount ? `for ${headcount}` : "",
        timeline ? `on ${timeline}` : "",
        budget ? `with a budget of ${budget}` : "",
      ]
        .filter(Boolean)
        .join(" ") + ".",
    );
  }

  if (brief.category === "coworking") {
    return normalizeReplayText(
      [
        "I'm looking for a coworking space",
        city ? `in ${city}` : "",
        headcount ? `for ${headcount}` : "",
        timeline ? `for ${timeline}` : "",
        budget ? `with a budget of ${budget}` : "",
      ]
        .filter(Boolean)
        .join(" ") + ".",
    );
  }

  if (brief.category === "clinic") {
    return normalizeReplayText(
      [
        "I'm looking for a clinic",
        city ? `in ${city}` : "",
        headcount ? `for ${headcount}` : "",
        timeline ? `for ${timeline}` : "",
        budget ? `with a budget of ${budget}` : "",
      ]
        .filter(Boolean)
        .join(" ") + ".",
    );
  }

  return normalizeReplayText(brief.summary);
}

function formatReplayCapacityAnswer(brief: ResearchBrief) {
  const headcount = brief.headcount;
  if (headcount <= 0) {
    return "";
  }

  if (brief.category === "banquet") {
    return `${headcount} ${headcount === 1 ? "person" : "people"}.`;
  }

  return `${headcount} ${headcount === 1 ? "person" : "people"}.`;
}

function formatReplayBudgetTimelineAnswer(brief: ResearchBrief) {
  const timeline = formatReplayTimeline(brief);
  const budget = formatReplayBudget(brief);

  if (!timeline && !budget) {
    return "";
  }

  if (timeline && budget) {
    return `On ${timeline}, with a budget of ${budget}.`;
  }

  if (timeline) {
    return `On ${timeline}.`;
  }

  return `With a budget of ${budget}.`;
}

function buildReplayConversationScript(brief: ResearchBrief) {
  if (brief.category === "banquet") {
    return {
      openingUserLine: normalizeReplayText(`Hi, I'm looking to book a banquet in ${brief.city}.`),
      assistantCapacityLine: "What's the capacity you're planning for?",
      userCapacityLine: formatReplayCapacityAnswer(brief),
      assistantBudgetTimelineLine: "What's the date, and what's your budget for the banquet?",
      userBudgetTimelineLine: formatReplayBudgetTimelineAnswer(brief),
      finalAssistantLine: DEFAULT_REPLAY_FINAL_LINE,
    };
  }

  if (brief.category === "coworking") {
    return {
      openingUserLine: normalizeReplayText(`Hi, I'm looking for a coworking space in ${brief.city}.`),
      assistantCapacityLine: "How many people should the space accommodate?",
      userCapacityLine: formatReplayCapacityAnswer(brief),
      assistantBudgetTimelineLine: "What's the timeline, and what's the budget?",
      userBudgetTimelineLine: formatReplayBudgetTimelineAnswer(brief),
      finalAssistantLine: DEFAULT_REPLAY_FINAL_LINE,
    };
  }

  if (brief.category === "clinic") {
    return {
      openingUserLine: normalizeReplayText(`Hi, I'm looking for a clinic option in ${brief.city}.`),
      assistantCapacityLine: "How many people is this for?",
      userCapacityLine: formatReplayCapacityAnswer(brief),
      assistantBudgetTimelineLine: "What's the timing, and what's the budget?",
      userBudgetTimelineLine: formatReplayBudgetTimelineAnswer(brief),
      finalAssistantLine: DEFAULT_REPLAY_FINAL_LINE,
    };
  }

  const denseBrief = buildReplaySyntheticUserBrief(brief);
  return {
    openingUserLine: denseBrief,
    assistantCapacityLine: "How many people is this for?",
    userCapacityLine: formatReplayCapacityAnswer(brief),
    assistantBudgetTimelineLine: "What's the timing, and what's the budget?",
    userBudgetTimelineLine: formatReplayBudgetTimelineAnswer(brief),
    finalAssistantLine: DEFAULT_REPLAY_FINAL_LINE,
  };
}

function dedupeMessagesByNormalizedContent(messages: ResearchMessage[]) {
  const seen = new Set<string>();

  return messages.filter((message) => {
    const normalized = `${message.role}:${normalizeReplayText(message.content).toLowerCase()}`;

    if (!normalized || seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

function createReplayMessage(args: {
  id: string;
  seq: number;
  role: "agent" | "user";
  content: string;
  createdAt: string | null;
  conversationId: string | null;
}) {
  return {
    id: args.id,
    seq: args.seq,
    role: args.role,
    modality: "voice" as const,
    content: args.content,
    createdAt: args.createdAt,
    stableKey: args.id,
    optimistic: false,
    payload: args.conversationId
      ? {
          conversation_id: args.conversationId,
          source: args.role === "agent" ? "assistant" : "user",
          message: args.content,
        }
      : null,
  } satisfies ResearchMessage;
}

function splitIntoPhraseGroups(text: string, maxGroups = 6) {
  const words = normalizeReplayText(text).split(" ").filter(Boolean);

  if (words.length === 0) {
    return [];
  }

  const chunkSize = Math.max(2, Math.ceil(words.length / maxGroups));
  const groups: string[] = [];

  for (let index = 0; index < words.length; index += chunkSize) {
    groups.push(words.slice(index, index + chunkSize).join(" "));
  }

  return groups;
}

function renderChunkProgress(text: string, progress: number, maxGroups = 6) {
  const groups = splitIntoPhraseGroups(text, maxGroups);

  if (groups.length === 0) {
    return "";
  }

  const visibleGroupCount = Math.min(
    groups.length,
    Math.max(1, Math.ceil(clamp01(progress) * groups.length)),
  );

  return groups.slice(0, visibleGroupCount).join(" ");
}

function renderTypedProgress(text: string, progress: number) {
  const normalized = normalizeReplayText(text);

  if (!normalized) {
    return "";
  }

  const end = Math.max(1, Math.ceil(clamp01(progress) * normalized.length));
  return normalized.slice(0, end);
}

export function buildResearchRecordingReplaySource(
  session: ResearchSessionSnapshot | null,
): ResearchRecordingReplaySource | null {
  if (!session?.brief) {
    return null;
  }

  const scopedMessages = scopeResearchWorkspaceMessagesToConversation(
    normalizeResearchWorkspaceMessages(session.messages ?? []),
    session.activeConversationId,
  );
  const relevantMessages =
    scopedMessages.length > 0
      ? scopedMessages
      : normalizeResearchWorkspaceMessages(session.messages ?? []);
  const dedupedMessages = dedupeMessagesByNormalizedContent(
    relevantMessages.filter((message) => message.role === "agent" || message.role === "user"),
  );

  const agentMessages = dedupedMessages.filter((message) => message.role === "agent");

  const introMessage = agentMessages[0] ?? null;
  const userMessages = dedupedMessages.filter((message) => message.role === "user");
  const assistantMessages = dedupedMessages.filter((message) => message.role === "agent");
  const summaryText = normalizeReplayText(session.brief.summary);
  const queryPreviewText = normalizeReplayText(session.brief.marketQueryPreview);
  const script = buildReplayConversationScript(session.brief);

  if (
    !summaryText ||
    !queryPreviewText ||
    !script.openingUserLine ||
    !script.assistantCapacityLine ||
    !script.userCapacityLine ||
    !script.assistantBudgetTimelineLine ||
    !script.userBudgetTimelineLine
  ) {
    return null;
  }

  return {
    sessionId: session.id,
    conversationId: session.activeConversationId ?? null,
    introLine: normalizeReplayText(introMessage?.content) || DEFAULT_REPLAY_INTRO,
    openingUserLine: script.openingUserLine,
    assistantCapacityLine: script.assistantCapacityLine,
    userCapacityLine: script.userCapacityLine,
    assistantBudgetTimelineLine: script.assistantBudgetTimelineLine,
    userBudgetTimelineLine: script.userBudgetTimelineLine,
    finalAssistantLine: script.finalAssistantLine,
    summaryText,
    queryPreviewText,
    introCreatedAt: introMessage?.createdAt ?? null,
    firstUserCreatedAt: userMessages[0]?.createdAt ?? null,
    secondUserCreatedAt: userMessages[1]?.createdAt ?? userMessages[0]?.createdAt ?? null,
    thirdUserCreatedAt: userMessages[2]?.createdAt ?? userMessages[1]?.createdAt ?? userMessages[0]?.createdAt ?? null,
    followupCreatedAt:
      assistantMessages.find((message) => message !== introMessage)?.createdAt ?? null,
    finalCreatedAt: session.completedAt ?? session.updatedAt,
    brief: session.brief,
    scopeStatus: session.brief.scopeStatus ?? session.scopeStatus ?? null,
    syncTimestamp: session.updatedAt,
  };
}

export function buildResearchRecordingReplayFrame(
  source: ResearchRecordingReplaySource,
  elapsedMs: number,
  rawDurationMs = RESEARCH_RECORDING_REPLAY_DURATION_MS,
): ResearchRecordingReplayFrame {
  const clampedElapsed = Math.max(0, Math.min(rawDurationMs, elapsedMs));
  const introProgress = clamp01((clampedElapsed - 2_000) / 1_200);
  const openingUserProgress = clamp01((clampedElapsed - 3_400) / 1_400);
  const capacityQuestionProgress = clamp01((clampedElapsed - 5_000) / 1_200);
  const userCapacityProgress = clamp01((clampedElapsed - 6_500) / 800);
  const budgetTimelineQuestionProgress = clamp01((clampedElapsed - 7_600) / 1_600);
  const userBudgetTimelineProgress = clamp01((clampedElapsed - 9_500) / 1_400);
  const finalAssistantProgress = clamp01((clampedElapsed - 11_100) / 700);
  const summaryTypingProgress = clamp01((clampedElapsed - 11_800) / 1_200);
  const queryTypingProgress = clamp01((clampedElapsed - 12_100) / 900);
  const reviewReady = clampedElapsed >= 13_000;
  const showStructuredDraft = clampedElapsed >= 11_800;

  const draftSummary = showStructuredDraft
    ? renderTypedProgress(source.summaryText, summaryTypingProgress)
    : null;
  const draftQueryPreview = clampedElapsed >= 13_100
    ? renderTypedProgress(source.queryPreviewText, queryTypingProgress)
    : null;
  const openingUserLine = clampedElapsed >= 3_400
    ? renderChunkProgress(source.openingUserLine, openingUserProgress)
    : "";
  const assistantCapacityLine = clampedElapsed >= 5_000
    ? renderChunkProgress(source.assistantCapacityLine, capacityQuestionProgress)
    : "";
  const userCapacityLine = clampedElapsed >= 6_500
    ? renderChunkProgress(source.userCapacityLine, userCapacityProgress, 3)
    : "";
  const assistantBudgetTimelineLine = clampedElapsed >= 7_600
    ? renderChunkProgress(source.assistantBudgetTimelineLine, budgetTimelineQuestionProgress)
    : "";
  const userBudgetTimelineLine = clampedElapsed >= 9_500
    ? renderChunkProgress(source.userBudgetTimelineLine, userBudgetTimelineProgress)
    : "";
  const finalAssistantLine = clampedElapsed >= 11_100
    ? renderTypedProgress(source.finalAssistantLine, finalAssistantProgress)
    : "";
  const introLine = clampedElapsed >= 2_000
    ? renderTypedProgress(source.introLine, introProgress)
    : "";

  const messages: ResearchMessage[] = [];

  if (introLine) {
    messages.push(
      createReplayMessage({
        id: "replay:assistant:intro",
        seq: 1,
        role: "agent",
        content: introLine,
        createdAt: source.introCreatedAt,
        conversationId: source.conversationId,
      }),
    );
  }

  if (openingUserLine) {
    messages.push(
      createReplayMessage({
        id: "replay:user:opening",
        seq: 2,
        role: "user",
        content: openingUserLine,
        createdAt: source.firstUserCreatedAt,
        conversationId: source.conversationId,
      }),
    );
  }

  if (assistantCapacityLine) {
    messages.push(
      createReplayMessage({
        id: "replay:assistant:capacity",
        seq: 3,
        role: "agent",
        content: assistantCapacityLine,
        createdAt: source.followupCreatedAt,
        conversationId: source.conversationId,
      }),
    );
  }

  if (userCapacityLine) {
    messages.push(
      createReplayMessage({
        id: "replay:user:capacity",
        seq: 4,
        role: "user",
        content: userCapacityLine,
        createdAt: source.secondUserCreatedAt,
        conversationId: source.conversationId,
      }),
    );
  }

  if (assistantBudgetTimelineLine) {
    messages.push(
      createReplayMessage({
        id: "replay:assistant:budget-timeline",
        seq: 5,
        role: "agent",
        content: assistantBudgetTimelineLine,
        createdAt: source.followupCreatedAt,
        conversationId: source.conversationId,
      }),
    );
  }

  if (userBudgetTimelineLine) {
    messages.push(
      createReplayMessage({
        id: "replay:user:budget-timeline",
        seq: 6,
        role: "user",
        content: userBudgetTimelineLine,
        createdAt: source.thirdUserCreatedAt,
        conversationId: source.conversationId,
      }),
    );
  }

  if (finalAssistantLine) {
    messages.push(
      createReplayMessage({
        id: "replay:assistant:final",
        seq: 7,
        role: "agent",
        content: finalAssistantLine,
        createdAt: source.finalCreatedAt,
        conversationId: source.conversationId,
      }),
    );
  }

  const replayBrief = {
    ...createEmptyResearchBrief(source.sessionId, source.brief.inputMode),
    category: source.brief.category,
    scopeStatus: source.brief.scopeStatus,
    countryCode: source.brief.countryCode,
    sourceStrategyHint: source.brief.sourceStrategyHint,
    status: reviewReady ? "review" : "collecting",
    summary: reviewReady ? source.summaryText : "",
    marketQueryPreview: reviewReady ? source.queryPreviewText : "",
    readyForMarket: reviewReady,
    missingFields: reviewReady ? [] : createEmptyResearchBrief(source.sessionId, source.brief.inputMode).missingFields,
  } satisfies ResearchBrief;

  return {
    status: reviewReady ? "review" : "collecting",
    ready: reviewReady,
    transportState: reviewReady ? "disconnected" : "connected",
    speaking: false,
    notice:
      reviewReady
        ? "Brief ready for market review."
        : showStructuredDraft
          ? "Structuring the research brief."
          : clampedElapsed < 2_000
            ? "Replay armed."
            : "Voice connected.",
    statusNotice: reviewReady ? "Brief ready for market review" : null,
    messages,
    brief: replayBrief,
    scopeStatus: source.scopeStatus,
    draftSummary,
    draftQueryPreview,
    syncTimestamp: source.syncTimestamp,
  };
}

export function useResearchRecordingReplay(args: {
  config: ResearchRecordingReplayConfig | null;
  session: ResearchSessionSnapshot | null;
}) {
  const enabled = args.config?.enabled === true;
  const rawDurationMs = args.config?.rawDurationMs ?? RESEARCH_RECORDING_REPLAY_DURATION_MS;
  const source = useMemo(
    () => (enabled ? buildResearchRecordingReplaySource(args.session) : null),
    [enabled, args.session],
  );
  const [playbackNonce, setPlaybackNonce] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!enabled || !source || playbackNonce === 0) {
      return;
    }

    const startedAt = performance.now();
    let frameId = 0;

    const tick = () => {
      const nextElapsed = Math.min(rawDurationMs, performance.now() - startedAt);
      setElapsedMs(nextElapsed);

      if (nextElapsed < rawDurationMs) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [enabled, playbackNonce, rawDurationMs, source]);

  const restart = useCallback(() => {
    if (!enabled || !source) {
      return;
    }

    setElapsedMs(0);
    setPlaybackNonce((current) => current + 1);
  }, [enabled, source]);

  const frame = useMemo(() => {
    if (!source) {
      return null;
    }

    return buildResearchRecordingReplayFrame(source, elapsedMs, rawDurationMs);
  }, [elapsedMs, rawDurationMs, source]);

  if (!enabled || !source || !frame) {
    return null;
  }

  const isPlaying = playbackNonce > 0 && elapsedMs < rawDurationMs;
  const hasCompleted = playbackNonce > 0 && elapsedMs >= rawDurationMs;

  return {
    ...frame,
    isPlaying,
    hasCompleted,
    restart,
  };
}
