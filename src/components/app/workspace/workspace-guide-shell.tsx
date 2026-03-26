"use client";

import { Volume2, VolumeOff, Play, LoaderCircle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { GuideEnvelope } from "@/lib/market/schemas";
import { WORKSPACE_RAIL_WIDTH_CLASS } from "./workspace-shell-constants";

const GUIDE_VOICE_STORAGE_KEY = "switchboard-guide-voice-muted";
const PLAYED_RESEARCH_GUIDE_STORAGE_KEY = "switchboard-guide-played-research";

type WorkspaceGuideContextValue = {
  guide: GuideEnvelope | null;
  voiceEnabled: boolean;
  audioState: "pending" | "playing" | "blocked" | "muted" | "failed";
  setGuide: (guide: GuideEnvelope | null) => void;
  setVoiceEnabled: (enabled: boolean) => void;
  replayGuide: () => Promise<void>;
};

const WorkspaceGuideContext = createContext<WorkspaceGuideContextValue | null>(null);

function readVoiceMutedPreference() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(GUIDE_VOICE_STORAGE_KEY) === "true";
}

function guideIdentityKey(guide: GuideEnvelope) {
  return `${guide.speechKey}:${guide.speakableText}`;
}

function shouldMuteGuide(guide: GuideEnvelope | null) {
  return (
    (guide?.stage === "research" && guide.mode !== "narrated") ||
    Boolean(guide?.speechKey.includes(":recording:"))
  );
}

function shouldPersistPlayedGuide(guide: GuideEnvelope | null) {
  return guide?.stage === "research" && guide.mode === "narrated";
}

function shouldForceGuidePlayback(guide: GuideEnvelope | null) {
  return guide?.stage === "research" && guide.mode === "narrated";
}

function guidePlaybackMemoryKey(guide: GuideEnvelope) {
  if (shouldPersistPlayedGuide(guide)) {
    return guide.speechKey;
  }

  return guideIdentityKey(guide);
}

function readPlayedResearchGuideKeys() {
  if (typeof window === "undefined") {
    return new Set<string>();
  }

  try {
    const raw = window.sessionStorage.getItem(PLAYED_RESEARCH_GUIDE_STORAGE_KEY);
    if (!raw) {
      return new Set<string>();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }

    return new Set(parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0));
  } catch {
    return new Set<string>();
  }
}

function persistPlayedResearchGuideKeys(keys: Set<string>) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    PLAYED_RESEARCH_GUIDE_STORAGE_KEY,
    JSON.stringify([...keys.values()]),
  );
}

function guidePlaybackPriority(guide: GuideEnvelope) {
  const normalizedKey = guide.speechKey.toLowerCase();

  if (
    guide.stage === "winner" ||
    normalizedKey.includes(":failed") ||
    normalizedKey.includes(":completed") ||
    normalizedKey.includes(":ready")
  ) {
    return 2;
  }

  return guide.blockingState ? 1 : 0;
}

export function WorkspaceGuideProvider({ children }: { children: ReactNode }) {
  const [guide, setGuideState] = useState<GuideEnvelope | null>(null);
  const [voiceEnabled, setVoiceEnabledState] = useState(() => !readVoiceMutedPreference());
  const [audioState, setAudioState] = useState<"pending" | "playing" | "blocked" | "muted" | "failed">(() =>
    readVoiceMutedPreference() ? "muted" : "blocked",
  );
  const cacheRef = useRef<Map<string, string>>(new Map());
  const audioRequestRef = useRef<Map<string, Promise<string>>>(new Map());
  const signedGuideRef = useRef<Map<string, GuideEnvelope>>(new Map());
  const lastPlayedGuideRef = useRef<string | null>(null);
  const playedResearchGuideKeysRef = useRef<Set<string>>(new Set());
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeGuideRef = useRef<GuideEnvelope | null>(null);
  const pendingGuideRef = useRef<GuideEnvelope | null>(null);
  const isMountedRef = useRef(true);
  const playbackRequestRef = useRef(0);

  const pauseCurrentAudio = useCallback(() => {
    const audio = currentAudioRef.current;
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
    }
    currentAudioRef.current = null;
  }, []);

  const stopCurrentAudio = useCallback((nextState: "blocked" | "muted" | "failed" = "muted") => {
    pauseCurrentAudio();
    currentAudioRef.current = null;
    activeGuideRef.current = null;
    setAudioState(nextState);
  }, [pauseCurrentAudio]);

  useEffect(() => {
    playedResearchGuideKeysRef.current = readPlayedResearchGuideKeys();

    const cache = cacheRef.current;
    const audioRequests = audioRequestRef.current;
    const signedGuideCache = signedGuideRef.current;
    return () => {
      isMountedRef.current = false;
      playbackRequestRef.current += 1;
      pauseCurrentAudio();
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
      cache.clear();
      audioRequests.clear();
      signedGuideCache.clear();
    };
  }, [pauseCurrentAudio]);

  const setVoiceEnabled = useCallback((enabled: boolean) => {
    setVoiceEnabledState(enabled);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(GUIDE_VOICE_STORAGE_KEY, String(!enabled));
    }
    if (!enabled) {
      pendingGuideRef.current = null;
      playbackRequestRef.current += 1;
      stopCurrentAudio("muted");
      return;
    }
    setAudioState("blocked");
  }, [stopCurrentAudio]);

  const signGuide = useCallback(async (nextGuide: GuideEnvelope) => {
    if (nextGuide.speechToken) {
      return nextGuide;
    }

    const guideKey = guideIdentityKey(nextGuide);
    const cached = signedGuideRef.current.get(guideKey);
    if (cached) {
      return cached;
    }

    const response = await fetch("/api/guide/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextGuide),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Unable to sign Switchboard update.");
    }

    const payload = (await response.json().catch(() => ({}))) as { guide?: GuideEnvelope };
    if (!payload.guide?.speechToken) {
      throw new Error("Unable to sign Switchboard update.");
    }

    if (isMountedRef.current) {
      signedGuideRef.current.set(guideKey, payload.guide);
      setGuideState((current) =>
        current && guideIdentityKey(current) === guideKey ? payload.guide ?? current : current,
      );
    }
    return payload.guide;
  }, []);

  const loadAudioUrl = useCallback(async (nextGuide: GuideEnvelope) => {
    const signedGuide = await signGuide(nextGuide);
    if (!isMountedRef.current) {
      throw new Error("Guide provider unmounted.");
    }
    const cacheKey = guideIdentityKey(signedGuide);

    if (cacheRef.current.has(cacheKey)) {
      return { signedGuide, url: cacheRef.current.get(cacheKey)! };
    }

    if (audioRequestRef.current.has(cacheKey)) {
      return {
        signedGuide,
        url: await audioRequestRef.current.get(cacheKey)!,
      };
    }

    const audioRequest = (async () => {
      const response = await fetch("/api/guide/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speechKey: signedGuide.speechKey,
          speechToken: signedGuide.speechToken,
          text: signedGuide.speakableText,
        }),
        cache: "no-store",
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error("Switchboard narration signature is invalid.");
        }
        throw new Error("Unable to synthesize Switchboard update.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (!isMountedRef.current) {
        URL.revokeObjectURL(url);
        throw new Error("Guide provider unmounted.");
      }
      cacheRef.current.set(cacheKey, url);
      return url;
    })();

    audioRequestRef.current.set(cacheKey, audioRequest);

    try {
      return { signedGuide, url: await audioRequest };
    } finally {
      audioRequestRef.current.delete(cacheKey);
    }
  }, [signGuide]);

  const playGuide = useCallback(
    async (
      nextGuide: GuideEnvelope | null,
      options: {
        force?: boolean;
        interrupt?: boolean;
      } = {},
    ) => {
      const force = options.force ?? false;
      const interrupt = options.interrupt ?? false;
      if (!nextGuide || shouldMuteGuide(nextGuide)) {
        pendingGuideRef.current = null;
        activeGuideRef.current = null;
        playbackRequestRef.current += 1;
        stopCurrentAudio("muted");
        return;
      }
      const effectiveForce = force || shouldForceGuidePlayback(nextGuide);
      if (!voiceEnabled && !effectiveForce) {
        pendingGuideRef.current = nextGuide;
        stopCurrentAudio("muted");
        return;
      }
      if (!nextGuide.speakableText.trim()) {
        pendingGuideRef.current = null;
        activeGuideRef.current = null;
        playbackRequestRef.current += 1;
        stopCurrentAudio("muted");
        return;
      }

      const currentGuide = activeGuideRef.current;
      const currentAudio = currentAudioRef.current;
      const hasActivePlayback = Boolean(currentGuide && currentAudio && !currentAudio.paused);

      if (
        !interrupt &&
        hasActivePlayback &&
        currentGuide &&
        guidePlaybackPriority(nextGuide) <= guidePlaybackPriority(currentGuide)
      ) {
        pendingGuideRef.current = nextGuide;
        return;
      }

      const requestId = ++playbackRequestRef.current;
      pendingGuideRef.current = null;
      pauseCurrentAudio();
      currentAudioRef.current = null;
      activeGuideRef.current = null;
      setAudioState("pending");

      try {
        const { signedGuide, url } = await loadAudioUrl(nextGuide);
        if (playbackRequestRef.current !== requestId) {
          return;
        }
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        activeGuideRef.current = signedGuide;
        audio.onended = () => {
          if (playbackRequestRef.current !== requestId) {
            return;
          }

          currentAudioRef.current = null;
          activeGuideRef.current = null;
          const pendingGuide = pendingGuideRef.current;

          if (pendingGuide && guideIdentityKey(pendingGuide) !== lastPlayedGuideRef.current) {
            void playGuide(pendingGuide, { force: true });
            return;
          }

          setAudioState("muted");
        };
        audio.onerror = () => {
          if (playbackRequestRef.current !== requestId) {
            return;
          }

          if (shouldForceGuidePlayback(signedGuide)) {
            pendingGuideRef.current = signedGuide;
          }
          currentAudioRef.current = null;
          activeGuideRef.current = null;
          setAudioState("failed");
        };
        await audio.play();
        if (playbackRequestRef.current !== requestId) {
          audio.pause();
          return;
        }
        lastPlayedGuideRef.current = guideIdentityKey(signedGuide);
        if (shouldPersistPlayedGuide(signedGuide)) {
          playedResearchGuideKeysRef.current.add(guidePlaybackMemoryKey(signedGuide));
          persistPlayedResearchGuideKeys(playedResearchGuideKeysRef.current);
        }
        setAudioState("playing");
      } catch (error) {
        if (playbackRequestRef.current !== requestId) {
          return;
        }
        currentAudioRef.current = null;
        activeGuideRef.current = null;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          pendingGuideRef.current = nextGuide;
          setAudioState("blocked");
          return;
        }
        if (shouldForceGuidePlayback(nextGuide)) {
          pendingGuideRef.current = nextGuide;
        }
        setAudioState("failed");
      }
    },
    [loadAudioUrl, pauseCurrentAudio, stopCurrentAudio, voiceEnabled],
  );

  useEffect(() => {
    const shouldForcePlayback = shouldForceGuidePlayback(guide);
    if (!guide || (!voiceEnabled && !shouldForcePlayback) || shouldMuteGuide(guide) || !guide.speakableText.trim()) {
      pendingGuideRef.current = null;
      activeGuideRef.current = null;
      playbackRequestRef.current += 1;
      stopCurrentAudio("muted");
      return;
    }
    const guideKey = guideIdentityKey(guide);
    const playbackMemoryKey = guidePlaybackMemoryKey(guide);
    if (shouldPersistPlayedGuide(guide) && playedResearchGuideKeysRef.current.has(playbackMemoryKey)) {
      lastPlayedGuideRef.current = guideKey;
      return;
    }
    if (
      lastPlayedGuideRef.current === guideKey ||
      (activeGuideRef.current && guideIdentityKey(activeGuideRef.current) === guideKey) ||
      (pendingGuideRef.current && guideIdentityKey(pendingGuideRef.current) === guideKey)
    ) {
      return;
    }

    const currentGuide = activeGuideRef.current;
    const currentAudio = currentAudioRef.current;
    const hasActivePlayback = Boolean(currentGuide && currentAudio && !currentAudio.paused);

    if (hasActivePlayback && currentGuide) {
      if (guidePlaybackPriority(guide) > guidePlaybackPriority(currentGuide)) {
        void playGuide(guide, { interrupt: true });
        return;
      }

      pendingGuideRef.current = guide;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void playGuide(guide);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [guide, playGuide, stopCurrentAudio, voiceEnabled]);

  useEffect(() => {
    if (
      (audioState !== "blocked" && audioState !== "failed") ||
      !pendingGuideRef.current ||
      shouldMuteGuide(pendingGuideRef.current)
    ) {
      return;
    }
    if (!voiceEnabled && !shouldForceGuidePlayback(pendingGuideRef.current)) {
      return;
    }

    const retryPlayback = (event: Event) => {
      window.removeEventListener("pointerdown", retryPlayback);
      window.removeEventListener("keydown", retryPlayback);
      if (
        event.target instanceof Element &&
        event.target.closest("[data-guide-manual-play='true']")
      ) {
        return;
      }
      const pendingGuide = pendingGuideRef.current;

      if (!pendingGuide) {
        return;
      }

      void playGuide(pendingGuide, { force: true });
    };

    window.addEventListener("pointerdown", retryPlayback);
    window.addEventListener("keydown", retryPlayback);

    return () => {
      window.removeEventListener("pointerdown", retryPlayback);
      window.removeEventListener("keydown", retryPlayback);
    };
  }, [audioState, playGuide, voiceEnabled]);

  const effectiveAudioState =
    (!voiceEnabled && !shouldForceGuidePlayback(guide)) || shouldMuteGuide(guide)
      ? "muted"
      : audioState;

  const value = useMemo<WorkspaceGuideContextValue>(
    () => ({
      guide,
      voiceEnabled,
      audioState: effectiveAudioState,
      setGuide: setGuideState,
      setVoiceEnabled,
      replayGuide: async () => {
        await playGuide(pendingGuideRef.current ?? guide, { force: true, interrupt: true });
      },
    }),
    [effectiveAudioState, guide, playGuide, setVoiceEnabled, voiceEnabled],
  );

  return <WorkspaceGuideContext.Provider value={value}>{children}</WorkspaceGuideContext.Provider>;
}

export function useWorkspaceGuide() {
  const context = useContext(WorkspaceGuideContext);

  if (!context) {
    throw new Error("useWorkspaceGuide must be used inside WorkspaceGuideProvider.");
  }

  return context;
}

export function WorkspaceGuideControls({ mobile = false }: { mobile?: boolean }) {
  const { guide, voiceEnabled, audioState, setVoiceEnabled, replayGuide } = useWorkspaceGuide();

  if (!guide || guide.stage === "research") {
    return null;
  }

  if (mobile) {
    return (
      <section className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            aria-label={voiceEnabled ? "Mute voice updates" : "Enable voice updates"}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] transition-opacity hover:opacity-80"
            style={{
              borderColor: voiceEnabled ? "var(--btn-bg)" : "var(--border)",
              color: voiceEnabled ? "var(--fg)" : "var(--muted)",
              background: "var(--card-strong)",
            }}
          >
            {voiceEnabled ? <VolumeOff className="size-3.5" /> : <Volume2 className="size-3.5" />}
            Voice
          </button>

          <button
            type="button"
            onClick={() => void replayGuide()}
            data-guide-manual-play="true"
            disabled={!guide.speakableText.trim() || audioState === "pending"}
            aria-label={audioState === "failed" ? "Retry audio update" : "Play audio update"}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: audioState === "failed" ? "rgba(239,68,68,0.3)" : "var(--border)",
              background: "var(--card-strong)",
              color: "var(--fg)",
            }}
          >
            {audioState === "pending" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {audioState === "failed" ? "Retry" : "Play"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`${WORKSPACE_RAIL_WIDTH_CLASS} overflow-hidden rounded-[16px] border`}
      style={{ borderColor: "var(--border)", background: "var(--card-strong)" }}
    >
      <div className="space-y-1.5 p-1.5">
        <button
          type="button"
          onClick={() => setVoiceEnabled(!voiceEnabled)}
          aria-label={voiceEnabled ? "Mute voice updates" : "Enable voice updates"}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] transition-opacity hover:opacity-80"
          style={{
            borderColor: voiceEnabled ? "var(--btn-bg)" : "var(--border)",
            color: voiceEnabled ? "var(--fg)" : "var(--muted)",
            background: "var(--card)",
          }}
        >
          {voiceEnabled ? <VolumeOff className="size-3.5" /> : <Volume2 className="size-3.5" />}
          Voice
        </button>

        <button
          type="button"
          onClick={() => void replayGuide()}
          data-guide-manual-play="true"
          disabled={!guide.speakableText.trim() || audioState === "pending"}
          aria-label={audioState === "failed" ? "Retry audio update" : "Play audio update"}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: audioState === "failed" ? "rgba(239,68,68,0.3)" : "var(--border)",
            background: "var(--card)",
            color: "var(--fg)",
          }}
        >
          {audioState === "pending" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          {audioState === "failed" ? "Retry" : "Play"}
        </button>
      </div>
    </section>
  );
}
