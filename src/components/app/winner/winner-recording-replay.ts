"use client";

import { useCallback, useEffect, useState } from "react";

export const WINNER_RECORDING_REPLAY_DURATION_MS = 17_000;

export type WinnerRecordingReplayConfig = {
  enabled: boolean;
  rawDurationMs?: number | null;
};

export function useWinnerRecordingReplay(config: WinnerRecordingReplayConfig | null) {
  const enabled = config?.enabled === true;
  const rawDurationMs = config?.rawDurationMs ?? WINNER_RECORDING_REPLAY_DURATION_MS;
  const [playbackNonce, setPlaybackNonce] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!enabled || playbackNonce === 0) {
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
  }, [enabled, playbackNonce, rawDurationMs]);

  const restart = useCallback(() => {
    if (!enabled) {
      return;
    }

    setElapsedMs(0);
    setPlaybackNonce((current) => current + 1);
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  let ctaFocus: "email" | "calendar" | null = null;

  if (elapsedMs >= 3_000 && elapsedMs < 5_500) {
    ctaFocus = "email";
  } else if (elapsedMs >= 5_500 && elapsedMs < 8_000) {
    ctaFocus = "calendar";
  } else if (elapsedMs >= 8_000) {
    ctaFocus = "email";
  }

  return {
    elapsedMs,
    isPlaying: playbackNonce > 0 && elapsedMs < rawDurationMs,
    hasCompleted: playbackNonce > 0 && elapsedMs >= rawDurationMs,
    ctaFocus,
    restart,
  };
}
