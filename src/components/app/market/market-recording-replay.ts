import { useCallback, useEffect, useMemo, useState } from "react";

import type { BrowserSafeMarketRun } from "@/lib/market/browser";
import type { GuideEnvelope } from "@/lib/market/schemas";

export const MARKET_RECORDING_REPLAY_DURATION_MS = 21_000;

export type MarketRecordingReplayConfig = {
  enabled: boolean;
  rawDurationMs?: number | null;
};

type MarketRecordingReplaySource = {
  run: BrowserSafeMarketRun;
  candidates: BrowserSafeMarketRun["candidates"];
  syncTimestamp: string | null;
};

function formatNameList(names: string[]) {
  if (names.length === 0) {
    return "";
  }

  if (names.length === 1) {
    return names[0] ?? "";
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function compareReplayCandidates(
  left: BrowserSafeMarketRun["candidates"][number],
  right: BrowserSafeMarketRun["candidates"][number],
) {
  if (left.rank !== right.rank) {
    return left.rank - right.rank;
  }

  if (left.score !== right.score) {
    return right.score - left.score;
  }

  return left.displayName.localeCompare(right.displayName);
}

function createMutedGuide(guide: GuideEnvelope): GuideEnvelope {
  return {
    ...guide,
    speechToken: "",
    audioState: "muted",
  };
}

function buildReplayGuide(args: {
  runId: string;
  stage: "discovering" | "scraping" | "scoring" | "ready";
  visibleCandidates: BrowserSafeMarketRun["candidates"];
}) {
  const names = args.visibleCandidates.slice(0, 2).map((candidate) => candidate.displayName);

  switch (args.stage) {
    case "discovering":
      return createMutedGuide({
        personaId: "switchboard",
        stage: "market",
        mode: "narrated",
        headline: "Firecrawl scan in progress",
        body: "Switchboard is widening the market board and surfacing the first viable local matches.",
        accent: "Powered by Firecrawl",
        speakableText: "Switchboard update. Firecrawl is scanning the live market.",
        speechKey: `market:recording:${args.runId}:discovering`,
        speechToken: "",
        nextActionLabel: "Stand by",
        nextActionHref: "",
        blockingState: true,
        audioState: "muted",
      });
    case "scraping":
      return createMutedGuide({
        personaId: "switchboard",
        stage: "market",
        mode: "narrated",
        headline:
          names.length > 0 ? `${names[0]} is on the board` : "Collecting source evidence",
        body: "Firecrawl is validating contact paths, pricing clues, and shortlist evidence.",
        accent: "Powered by Firecrawl",
        speakableText:
          names.length > 0
            ? `Switchboard update. Firecrawl just surfaced ${names[0]} as a reviewable lead.`
            : "Switchboard update. Firecrawl is collecting source evidence.",
        speechKey: `market:recording:${args.runId}:scraping:${names[0] ?? "none"}`,
        speechToken: "",
        nextActionLabel: "Stand by",
        nextActionHref: "",
        blockingState: true,
        audioState: "muted",
      });
    case "scoring":
      return createMutedGuide({
        personaId: "switchboard",
        stage: "market",
        mode: "narrated",
        headline: "Shortlist is tightening",
        body: "Switchboard is re-ranking the board and locking the strongest reachable options.",
        accent: "Powered by Firecrawl",
        speakableText:
          "Switchboard update. Firecrawl is tightening the shortlist and ranking the strongest options.",
        speechKey: `market:recording:${args.runId}:scoring`,
        speechToken: "",
        nextActionLabel: "Stand by",
        nextActionHref: "",
        blockingState: true,
        audioState: "muted",
      });
    case "ready":
    default:
      return createMutedGuide({
        personaId: "switchboard",
        stage: "market",
        mode: "narrated",
        headline:
          names.length > 0
            ? `${formatNameList(names)} ${names.length === 1 ? "is" : "are"} ready to call`
            : "Shortlist ready to call",
        body: "Firecrawl finished the shortlist. The selected establishments are ready to move into outreach.",
        accent: "Powered by Firecrawl",
        speakableText:
          names.length > 0
            ? `Switchboard update. Firecrawl has finished the shortlist. ${formatNameList(names)} ${names.length === 1 ? "is" : "are"} ready for calls.`
            : "Switchboard update. Firecrawl has finished the shortlist.",
        speechKey: `market:recording:${args.runId}:ready:${names.join(":") || "none"}`,
        speechToken: "",
        nextActionLabel: "Move to calls",
        nextActionHref: "",
        blockingState: false,
        audioState: "muted",
      });
  }
}

function buildReplaySummary(
  run: BrowserSafeMarketRun["run"],
  visibleCandidates: BrowserSafeMarketRun["candidates"],
  finalCandidateCount: number,
) {
  return {
    ...run.summary,
    totalCandidates: Math.max(visibleCandidates.length, run.summary.totalCandidates ?? finalCandidateCount),
    eligibleCandidates: visibleCandidates.filter((candidate) => candidate.eligibility !== "ineligible")
      .length,
  };
}

function getCandidateRevealCount(elapsedMs: number, totalCandidates: number) {
  if (elapsedMs < 2_800) {
    return 0;
  }

  if (elapsedMs < 5_500) {
    return Math.min(1, totalCandidates);
  }

  if (elapsedMs < 7_200) {
    return Math.min(2, totalCandidates);
  }

  if (elapsedMs < 8_800) {
    return Math.min(3, totalCandidates);
  }

  return Math.min(4, totalCandidates);
}

function getShortlistRevealCount(elapsedMs: number, totalCandidates: number) {
  if (elapsedMs < 10_000) {
    return 0;
  }

  if (elapsedMs < 11_400) {
    return Math.min(1, totalCandidates);
  }

  if (elapsedMs < 12_800) {
    return Math.min(2, totalCandidates);
  }

  if (elapsedMs < 14_200) {
    return Math.min(3, totalCandidates);
  }

  return totalCandidates;
}

export function buildMarketRecordingReplaySource(
  run: BrowserSafeMarketRun | null,
): MarketRecordingReplaySource | null {
  if (!run?.run.id || !Array.isArray(run.candidates) || run.candidates.length === 0) {
    return null;
  }

  const replayCandidates = [...run.candidates]
    .filter((candidate) => candidate.eligibility !== "ineligible")
    .sort(compareReplayCandidates)
    .slice(0, 4);

  if (replayCandidates.length === 0) {
    return null;
  }

  return {
    run,
    candidates: replayCandidates,
    syncTimestamp: run.run.updatedAt ?? null,
  };
}

export function buildMarketRecordingReplayRun(
  source: MarketRecordingReplaySource,
  elapsedMs: number,
  rawDurationMs = MARKET_RECORDING_REPLAY_DURATION_MS,
): BrowserSafeMarketRun {
  const clampedElapsed = Math.max(0, Math.min(rawDurationMs, elapsedMs));
  const finalCandidateCount = source.candidates.length;

  let status: BrowserSafeMarketRun["run"]["status"];
  let currentStage: BrowserSafeMarketRun["run"]["currentStage"];
  let visibleCandidates: BrowserSafeMarketRun["candidates"];

  if (clampedElapsed < 4_000) {
    status = "discovering";
    currentStage = "discovering";
    visibleCandidates = source.candidates.slice(
      0,
      getCandidateRevealCount(clampedElapsed, finalCandidateCount),
    );
  } else if (clampedElapsed < 7_500) {
    status = "scraping";
    currentStage = "scraping";
    visibleCandidates = source.candidates.slice(
      0,
      getCandidateRevealCount(clampedElapsed, finalCandidateCount),
    );
  } else if (clampedElapsed < 10_000) {
    status = "scoring";
    currentStage = "scoring";
    visibleCandidates = source.candidates.slice(
      0,
      getCandidateRevealCount(clampedElapsed, finalCandidateCount),
    );
  } else {
    status = "ready";
    currentStage = "ready";
    visibleCandidates = source.candidates.slice(
      0,
      getShortlistRevealCount(clampedElapsed, finalCandidateCount),
    );
  }

  const guide = buildReplayGuide({
    runId: source.run.run.id,
    stage: status === "ready" ? "ready" : status === "scoring" ? "scoring" : status === "scraping" ? "scraping" : "discovering",
    visibleCandidates,
  });

  return {
    ...source.run,
    run: {
      ...source.run.run,
      status,
      currentStage,
      updatedAt: source.syncTimestamp,
      completedAt: status === "ready" ? source.run.run.completedAt ?? source.syncTimestamp : null,
      error: null,
      summary: buildReplaySummary(source.run.run, visibleCandidates, finalCandidateCount),
      refinements: [],
      canRefine: false,
      refinementLimitReached: false,
      guide,
    },
    candidates: visibleCandidates,
  };
}

export function useMarketRecordingReplay(args: {
  config: MarketRecordingReplayConfig | null;
  run: BrowserSafeMarketRun | null;
}) {
  const enabled = args.config?.enabled === true;
  const rawDurationMs = args.config?.rawDurationMs ?? MARKET_RECORDING_REPLAY_DURATION_MS;
  const source = useMemo(
    () => (enabled ? buildMarketRecordingReplaySource(args.run) : null),
    [enabled, args.run],
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

  const run = useMemo(() => {
    if (!source) {
      return null;
    }

    return buildMarketRecordingReplayRun(source, elapsedMs, rawDurationMs);
  }, [elapsedMs, rawDurationMs, source]);

  if (!enabled || !source || !run) {
    return null;
  }

  return {
    run,
    isPlaying: playbackNonce > 0 && elapsedMs < rawDurationMs,
    hasCompleted: playbackNonce > 0 && elapsedMs >= rawDurationMs,
    restart,
  };
}
