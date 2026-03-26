"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  refreshCallCampaignProjection,
  type BrowserSafeCallProjection,
} from "../../../lib/market/browser.ts";
import type { GuideEnvelope } from "../../../lib/market/schemas.ts";

export const CALLS_RECORDING_REPLAY_DURATION_MS = 21_000;

export type CallsRecordingReplayConfig = {
  enabled: boolean;
  rawDurationMs?: number | null;
};

type CallsRecordingReplaySource = {
  projection: BrowserSafeCallProjection;
  syncTimestamp: string | null;
  leadName: string | null;
  startSourceElapsedMs: number;
  earlySourceElapsedMs: number;
  middleSourceElapsedMs: number;
  finalSourceElapsedMs: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * clamp01(progress);
}

function createMutedGuide(guide: GuideEnvelope): GuideEnvelope {
  return {
    ...guide,
    speechToken: "",
    audioState: "muted",
  };
}

function pickReplayLeadName(campaign: BrowserSafeCallProjection) {
  const winnerCandidateId = campaign.winner?.selectedCandidateId ?? null;
  const winnerCall = winnerCandidateId
    ? campaign.calls.find((call) => call.candidateId === winnerCandidateId)
    : null;

  if (winnerCall?.businessName) {
    return winnerCall.businessName;
  }

  const firstResolved = campaign.calls.find((call) => {
    const result = call.outcome?.result ?? call.result ?? null;
    return result && result !== "no_answer" && result !== "failed";
  });

  if (firstResolved?.businessName) {
    return firstResolved.businessName;
  }

  return campaign.calls[0]?.businessName ?? null;
}

function buildReplayGuide(projection: BrowserSafeCallProjection, leadName: string | null) {
  const activeNames = projection.calls
    .filter((call) => ["ringing", "connected", "negotiating", "wrap_up"].includes(call.status))
    .slice(0, 3)
    .map((call) => call.businessName);
  const latestResolution = projection.resolutionFeed.at(-1) ?? null;

  if (projection.campaign.status === "completed") {
    return createMutedGuide({
      personaId: "switchboard",
      stage: "winner",
      mode: "narrated",
      headline: leadName ? `${leadName} leads the board` : "Outreach complete",
      body: "Every lane has resolved. Review the strongest option and open the winner board when you are ready.",
      accent: "Narrated with ElevenLabs",
      speakableText: leadName
        ? `Switchboard update. Outreach is complete. ${leadName} leads the board right now.`
        : "Switchboard update. Outreach is complete.",
      speechKey: `calls:recording:${projection.campaign.id}:completed:${leadName ?? "none"}`,
      speechToken: "",
      nextActionLabel: "Open winner",
      nextActionHref: "",
      blockingState: false,
      audioState: "muted",
    });
  }

  if (latestResolution) {
    return createMutedGuide({
      personaId: "switchboard",
      stage: "calls",
      mode: "narrated",
      headline: `${latestResolution.businessName} just resolved`,
      body: "Switchboard is turning resolved lanes into recaps while the remaining outreach finishes.",
      accent: "Narrated with ElevenLabs",
      speakableText: `Switchboard update. ${latestResolution.businessName} just resolved.`,
      speechKey: `calls:recording:${projection.campaign.id}:active:recap:${latestResolution.callId}:${projection.resolutionFeed.length}`,
      speechToken: "",
      nextActionLabel: "Watch the board",
      nextActionHref: "",
      blockingState: true,
      audioState: "muted",
    });
  }

  return createMutedGuide({
    personaId: "switchboard",
    stage: "calls",
    mode: "narrated",
    headline: "Parallel outreach is live",
    body: "Switchboard is tracking each lane as the shortlist gets pressure-tested in parallel.",
    accent: "Narrated with ElevenLabs",
    speakableText:
      activeNames.length > 0
        ? `Switchboard update. Parallel outreach is live. I am tracking ${activeNames.join(", ")}.`
        : "Switchboard update. Parallel outreach is live.",
    speechKey: `calls:recording:${projection.campaign.id}:active:intro`,
    speechToken: "",
    nextActionLabel: "Watch the board",
    nextActionHref: "",
    blockingState: true,
    audioState: "muted",
  });
}

export function buildCallsRecordingReplaySource(
  campaign: BrowserSafeCallProjection | null,
): CallsRecordingReplaySource | null {
  if (!campaign?.campaign.id || !Array.isArray(campaign.calls) || campaign.calls.length === 0) {
    return null;
  }

  const orderedCalls = [...campaign.calls].sort((left, right) => left.orderIndex - right.orderIndex);
  const playbackOffsets = orderedCalls
    .map((call) => ({
      laneStart: call.playback?.laneStartOffsetMs ?? 0,
      pickupAt: call.playback?.pickupAtMs ?? null,
      summaryReveal: call.playback?.summaryRevealMs ?? call.targetDurationMs,
    }));
  const laneStartOffsets = playbackOffsets.map((entry) => entry.laneStart).sort((left, right) => left - right);
  const pickupOffsets = playbackOffsets
    .map((entry) => entry.pickupAt)
    .filter((entry): entry is number => typeof entry === "number")
    .sort((left, right) => left - right);
  const finalSourceElapsedMs = Math.max(
    ...playbackOffsets.map((entry) => entry.summaryReveal),
    1,
  ) + 600;
  const startAnchor = laneStartOffsets[Math.min(2, laneStartOffsets.length - 1)] ?? laneStartOffsets.at(-1) ?? 0;
  const startSourceElapsedMs = Math.max(
    0,
    Math.min(
      Math.round(finalSourceElapsedMs * 0.28),
      startAnchor + 3_500,
      Math.max(finalSourceElapsedMs - 9_000, 0),
    ),
  );
  const earlySourceElapsedMs = Math.max(
    startSourceElapsedMs + 2_500,
    pickupOffsets[1] ?? pickupOffsets[0] ?? startSourceElapsedMs + 2_000,
  );
  const middleSourceElapsedMs = Math.min(
    Math.max(
      earlySourceElapsedMs + 8_000,
      Math.round(lerp(startSourceElapsedMs, finalSourceElapsedMs, 0.5)),
    ),
    Math.max(finalSourceElapsedMs - 8_500, earlySourceElapsedMs + 1_500),
  );

  return {
    projection: campaign,
    syncTimestamp: campaign.campaign.updatedAt ?? null,
    leadName: pickReplayLeadName(campaign),
    startSourceElapsedMs,
    earlySourceElapsedMs,
    middleSourceElapsedMs,
    finalSourceElapsedMs,
  };
}

export function buildCallsRecordingReplayProjection(
  source: CallsRecordingReplaySource,
  elapsedMs: number,
  rawDurationMs = CALLS_RECORDING_REPLAY_DURATION_MS,
): BrowserSafeCallProjection {
  const clampedElapsed = Math.max(0, Math.min(rawDurationMs, elapsedMs));
  const readyHoldStartMs = Math.max(rawDurationMs - 2_000, 0);

  let sourceElapsedMs: number;

  if (clampedElapsed < 2_000) {
    sourceElapsedMs = lerp(
      source.startSourceElapsedMs,
      source.earlySourceElapsedMs,
      clampedElapsed / 2_000,
    );
  } else if (clampedElapsed < 10_000) {
    sourceElapsedMs = lerp(
      source.earlySourceElapsedMs,
      source.middleSourceElapsedMs,
      (clampedElapsed - 2_000) / 8_000,
    );
  } else if (clampedElapsed < readyHoldStartMs) {
    sourceElapsedMs = lerp(
      source.middleSourceElapsedMs,
      source.finalSourceElapsedMs,
      (clampedElapsed - 10_000) / Math.max(readyHoldStartMs - 10_000, 1),
    );
  } else {
    sourceElapsedMs = source.finalSourceElapsedMs;
  }

  const nowMs = Date.now();
  const status = clampedElapsed >= readyHoldStartMs ? "completed" : "active";
  const replayBase: BrowserSafeCallProjection = {
    ...source.projection,
    campaign: {
      ...source.projection.campaign,
      status,
      playbackStartedAt: new Date(nowMs - sourceElapsedMs).toISOString(),
      playbackEndsAt: status === "completed" ? new Date(nowMs).toISOString() : null,
      updatedAt: source.syncTimestamp,
      completedAt: status === "completed"
        ? source.projection.campaign.completedAt ?? source.syncTimestamp
        : null,
      error: null,
      canOpenWinner: false,
      guide: source.projection.campaign.guide,
    },
    winner: status === "completed" ? source.projection.winner : null,
    resolutionFeed: [],
  };
  const hydrated = refreshCallCampaignProjection(replayBase, nowMs);

  return {
    ...hydrated,
    campaign: {
      ...hydrated.campaign,
      guide: buildReplayGuide(hydrated, source.leadName),
    },
  };
}

export function useCallsRecordingReplay(args: {
  config: CallsRecordingReplayConfig | null;
  campaign: BrowserSafeCallProjection | null;
}) {
  const enabled = args.config?.enabled === true;
  const rawDurationMs = args.config?.rawDurationMs ?? CALLS_RECORDING_REPLAY_DURATION_MS;
  const source = useMemo(
    () => (enabled ? buildCallsRecordingReplaySource(args.campaign) : null),
    [enabled, args.campaign],
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

  const campaign = useMemo(() => {
    if (!source) {
      return null;
    }

    return buildCallsRecordingReplayProjection(source, elapsedMs, rawDurationMs);
  }, [elapsedMs, rawDurationMs, source]);

  if (!enabled || !source || !campaign) {
    return null;
  }

  return {
    campaign,
    isPlaying: playbackNonce > 0 && elapsedMs < rawDurationMs,
    hasCompleted: playbackNonce > 0 && elapsedMs >= rawDurationMs,
    restart,
  };
}
