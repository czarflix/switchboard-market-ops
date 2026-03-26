"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  workspaceSpring as spring,
  workspaceSpringFast as springFast,
} from "@/components/app/workspace/workspace-motion";
import { useWorkspaceGuide } from "@/components/app/workspace/workspace-guide-shell";
import { useShellTheme } from "@/components/marketing/marketing-shell";
import { ProviderLockup } from "@/components/marketing/provider-badges";
import {
  mergeCallCampaignProjection,
  refreshCallCampaignProjection,
  type BrowserSafeCallProjection,
} from "@/lib/market/browser";
import { buildCallsFallbackGuide } from "@/lib/market/guides";
import type { GuideEnvelope } from "@/lib/market/schemas";
import {
  useCallsRecordingReplay,
  type CallsRecordingReplayConfig,
} from "./calls-recording-replay";

type CallsWorkspaceProps = {
  marketRunId: string | null;
  initialCampaign: BrowserSafeCallProjection | null;
  notificationEmail?: string | null;
  recordingReplay?: CallsRecordingReplayConfig | null;
};

/* ─── Constants ──────────────────────────────────────────────────────────── */

/* ─── Helpers ────────────────────────────────────────────────────────────── */

async function apiRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as T | null;
  const error = json && typeof json === "object" && "error" in json && typeof (json as { error?: unknown }).error === "string"
    ? (json as { error: string }).error : null;
  return { ok: response.ok, data: json, error };
}

function formatCallTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function formatSync(value: string | null | undefined) {
  if (!value) return "Waiting for sync";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waiting for sync";
  return `Last synced ${new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(date)}`;
}

function getReminderState(notifications: BrowserSafeCallProjection["notifications"]) {
  if (notifications.some((n) => n.status === "sent"))    return "sent" as const;
  if (notifications.some((n) => n.status === "pending")) return "saved" as const;
  return "idle" as const;
}

function callLaneBorderColor(status: string) {
  if (["connected", "negotiating", "wrap_up"].includes(status)) return "rgba(34,197,94,0.4)";
  if (status === "ringing")                          return "rgba(96,165,250,0.35)";
  if (status === "no_answer")                        return "rgba(245,158,11,0.35)";
  if (status === "failed")                           return "rgba(239,68,68,0.35)";
  return "var(--border)";
}

function callStatusColor(status: string) {
  if (["connected", "negotiating", "wrap_up"].includes(status)) return "rgba(34,197,94,0.85)";
  if (status === "ringing")                          return "rgba(96,165,250,0.85)";
  if (status === "no_answer")                        return "rgba(245,158,11,0.85)";
  if (status === "failed")                           return "rgba(239,68,68,0.85)";
  return "var(--muted)";
}

function campaignStatusColor(s: string) {
  return s === "failed" ? "rgba(239,68,68,0.85)" : s === "completed" ? "rgba(34,197,94,0.85)" : "var(--muted)";
}
function campaignStatusBorder(s: string) {
  return s === "failed" ? "rgba(239,68,68,0.3)" : s === "completed" ? "rgba(34,197,94,0.3)" : "var(--border)";
}

function visibleText(language: "source" | "english", turn: { sourceText: string; englishText: string }) {
  return language === "source" ? turn.sourceText : turn.englishText;
}

/* ─── Summary hover modal (outcome only, solid dark/light bg) ────────────── */

function SummaryModal({
  call,
  language,
  anchorRef,
  onClose,
  onEnter,
}: {
  call: BrowserSafeCallProjection["calls"][number];
  language: "source" | "english";
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onEnter: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
  }, [anchorRef]);

  const posStyle = useMemo((): React.CSSProperties => {
    if (!rect) return { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
    const W   = 300;
    const gap = 10;
    const vw  = typeof window !== "undefined" ? window.innerWidth  : 1280;
    const vh  = typeof window !== "undefined" ? window.innerHeight : 900;
    const useRight = rect.right + gap + W < vw - 8;
    const x = useRight ? rect.right + gap : rect.left - gap - W;
    const topY = Math.min(rect.top, vh - 220 - 8);
    return { position: "fixed", top: topY, left: x, width: W, zIndex: 60 };
  }, [rect]);

  const outcomeText = call.outcome
    ? (language === "source" ? call.outcome.summarySourceText : call.outcome.summaryEnglishText)
    : null;

  if (!outcomeText && call.status !== "completed" && call.status !== "no_answer" && call.status !== "failed") {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 6 }}
      transition={springFast}
      style={posStyle}
      onMouseEnter={onEnter}
      onMouseLeave={onClose}
    >
      <div
        className="overflow-hidden rounded-[16px]"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border-strong, var(--border))",
          boxShadow: "0 28px 72px rgba(0,0,0,0.35), 0 4px 16px rgba(0,0,0,0.2)",
        }}
      >
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-black" style={{ color: "var(--fg)" }}>{call.businessName}</p>
              <p className="text-[9px] font-bold uppercase tracking-[0.18em]" style={{ color: callStatusColor(call.status) }}>
                {call.status.replaceAll("_", " ")} · {formatCallTime(call.elapsedMs || call.targetDurationMs)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex size-5 shrink-0 items-center justify-center rounded-full transition hover:opacity-70"
              style={{ background: "var(--border)", color: "var(--fg)" }}
            >
              <X className="size-3" />
            </button>
          </div>
          <div className="px-4 py-3">
            {outcomeText ? (
              <>
                <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>Outcome</p>
                <p className="mt-1.5 text-[12px] leading-[1.7]" style={{ color: "var(--muted)" }}>{outcomeText}</p>
              </>
            ) : (
              <p className="text-[11px]" style={{ color: "var(--subtle)" }}>
                {call.status === "no_answer"
                  ? "No pickup — no outcome summary."
                  : call.status === "failed"
                    ? "This lane failed before an outcome was generated."
                    : call.status === "wrap_up"
                      ? "Switchboard is finalizing this lane summary."
                    : "Outcome pending…"}
              </p>
            )}
          </div>
      </div>
    </motion.div>
  );
}

/* ─── Call lane card — inline transcript + hover shows summary ───────────── */

function CallLane({
  call,
  index,
  language,
  onHover,
  onLeave,
}: {
  call: BrowserSafeCallProjection["calls"][number];
  index: number;
  language: "source" | "english";
  onHover: (call: BrowserSafeCallProjection["calls"][number], ref: React.RefObject<HTMLDivElement | null>) => void;
  onLeave: () => void;
}) {
  const ref  = useRef<HTMLDivElement>(null);
  const isLive = ["ringing", "connected", "negotiating", "wrap_up"].includes(call.status);
  const hasOutcome = Boolean(call.outcome) || ["completed", "no_answer", "failed"].includes(call.status);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ delay: index * 0.06, ...spring }}
      className="flex flex-col rounded-[18px] border overflow-hidden"
      style={{ borderColor: callLaneBorderColor(call.status), background: "var(--card)" }}
    >
      {/* Card header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer"
        onMouseEnter={hasOutcome ? () => onHover(call, ref as React.RefObject<HTMLDivElement | null>) : undefined}
        onMouseLeave={hasOutcome ? onLeave : undefined}
        title={hasOutcome ? "Hover for outcome summary" : undefined}
      >
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
          <span
            className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] shrink-0"
            style={{ borderColor: "var(--border)", color: "var(--subtle)" }}
          >
            Lane {index + 1}
          </span>
          <motion.span
            key={call.status}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={springFast}
            className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] shrink-0"
            style={{ borderColor: callLaneBorderColor(call.status), color: callStatusColor(call.status) }}
          >
            {call.status.replaceAll("_", " ")}
          </motion.span>
          {isLive && (
            <motion.span
              className="size-1.5 rounded-full shrink-0"
              style={{ background: "rgba(34,197,94,0.85)" }}
              animate={{ scale: [1, 1.7, 1], opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 1.1, repeat: Number.POSITIVE_INFINITY }}
            />
          )}
          <p className="truncate text-[13px] font-semibold tracking-[-0.01em]" style={{ color: "var(--fg)" }}>
            {call.businessName}
          </p>
        </div>
        <span className="shrink-0 text-[10px] font-mono" style={{ color: "var(--subtle)" }}>
          {formatCallTime(call.status === "preparing" || call.status === "queued" ? 0 : call.elapsedMs)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mx-4 mb-1 h-0.5 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: isLive ? "rgba(34,197,94,0.7)" : "var(--btn-bg)" }}
          initial={{ width: 0 }}
          animate={{
            width: `${Math.min(100, Math.max(
              ["preparing", "queued"].includes(call.status) ? 12 : (call.elapsedMs / Math.max(call.targetDurationMs, 1)) * 100,
              ["completed", "no_answer", "failed"].includes(call.status) ? 100 : 6,
            ))}%`,
          }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>

      {/* Transcript area — fixed height, scrollable */}
      <div
        className="mx-4 mb-4 mt-2 overflow-y-auto rounded-[12px] border px-3 py-3"
        style={{
          height: "160px",
          borderColor: "var(--border)",
          background: "var(--card-strong)",
        }}
      >
        {call.visibleTurns.length > 0 ? (
          <div className="flex flex-col gap-2">
            {call.visibleTurns.map((turn, i) => {
              const isBuyer  = turn.speaker === "buyer";
              const isSys    = turn.speaker === "system";
              if (isSys) return (
                <div key={turn.id} className="flex justify-center py-0.5">
                  <p
                    className="rounded-full border px-2.5 py-0.5 text-[9px] uppercase tracking-[0.12em]"
                    style={{ borderColor: "var(--border)", color: "var(--subtle)" }}
                  >
                    {visibleText(language, turn)}
                  </p>
                </div>
              );
              return (
                <motion.div
                  key={turn.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02, ...spring }}
                  className={`flex ${isBuyer ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className="max-w-[86%] rounded-[10px] px-3 py-2 text-[11px] leading-[1.6]"
                    style={
                      isBuyer
                        ? { background: "var(--btn-bg)", color: "var(--btn-fg)", borderBottomRightRadius: "3px" }
                        : { background: "var(--card)", color: "var(--fg)", border: "1px solid var(--border)", borderBottomLeftRadius: "3px" }
                    }
                  >
                    <p className="mb-0.5 text-[8px] font-black uppercase tracking-[0.14em] opacity-50">{turn.speaker}</p>
                    {visibleText(language, turn)}
                  </div>
                </motion.div>
              );
            })}
          </div>
        ) : (
          /* Skeleton */
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((n) => (
              <motion.div
                key={n}
                className={`rounded-[8px] ${n % 2 === 0 ? "self-end" : "self-start"}`}
                style={{
                  height: "28px",
                  width: `${52 + n * 14}%`,
                  background: "var(--border)",
                }}
                animate={{ opacity: [0.25, 0.5, 0.25] }}
                transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, delay: n * 0.18 }}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export function CallsWorkspace({
  marketRunId,
  initialCampaign,
  notificationEmail = null,
  recordingReplay = null,
}: CallsWorkspaceProps) {
  const router = useRouter();
  const { setGuide } = useWorkspaceGuide();
  const { theme } = useShellTheme();
  const [campaign, setCampaign] = useState<BrowserSafeCallProjection | null>(initialCampaign);
  const [error, setError]       = useState<string | null>(null);
  const [languageOverride, setLanguageOverride] = useState<"source" | "english" | null>(null);
  const [notifyPending, setNotifyPending]       = useState(false);
  const [retryPending, setRetryPending]         = useState(false);

  const [hoveredCall, setHoveredCall]   = useState<BrowserSafeCallProjection["calls"][number] | null>(null);
  const [hoverAnchor, setHoverAnchor]   = useState<React.RefObject<HTMLDivElement | null> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCreateCampaignRequestKeyRef = useRef<string | null>(null);

  const campaignId = campaign?.campaign.id ?? null;
  const callsReplay = useCallsRecordingReplay({ config: recordingReplay, campaign });
  const displayedCampaign = callsReplay?.campaign ?? campaign;
  const language      = languageOverride ?? displayedCampaign?.campaign.displayLanguage ?? "english";
  const reminderState = getReminderState(campaign?.notifications ?? []);
  const replayActive = Boolean(callsReplay);
  const replayButtonLabel = callsReplay?.isPlaying ? "Live" : callsReplay?.hasCompleted ? "Replay" : "Start";

  useEffect(() => {
    const fallbackGuide: GuideEnvelope =
      displayedCampaign?.campaign.guide ?? buildCallsFallbackGuide({ marketRunId });

    setGuide(fallbackGuide);
  }, [displayedCampaign, marketRunId, setGuide]);

  useEffect(() => {
    if (!campaignId || replayActive) {
      return;
    }

    const interval = setInterval(() => {
      setCampaign((current) => (current ? refreshCallCampaignProjection(current) : current));
    }, 250);

    return () => clearInterval(interval);
  }, [campaignId, replayActive]);

  const clearHide = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHide();
    hideTimer.current = setTimeout(() => { setHoveredCall(null); setHoverAnchor(null); }, 120);
  }, [clearHide]);

  const handleHover = useCallback((
    call: BrowserSafeCallProjection["calls"][number],
    ref: React.RefObject<HTMLDivElement | null>,
  ) => { clearHide(); setHoveredCall(call); setHoverAnchor(ref); }, [clearHide]);

  const handleLeave    = scheduleHide;
  const handleModalLeave = scheduleHide;

  useEffect(() => {
    if (recordingReplay?.enabled) return;
    if (campaign || !marketRunId) return;
    if (autoCreateCampaignRequestKeyRef.current === marketRunId) return;
    autoCreateCampaignRequestKeyRef.current = marketRunId;
    let cancelled = false;
    void (async () => {
      const res = await apiRequest<{ campaign?: BrowserSafeCallProjection; error?: string }>("/api/calls/campaigns", {
        method: "POST", body: JSON.stringify({ marketRunId }),
      });
      if (cancelled) return;
      if (!res.ok || !res.data?.campaign) {
        autoCreateCampaignRequestKeyRef.current = null;
        setError(res.error ?? "Unable to start outreach.");
        return;
      }
      const next = res.data.campaign;
      setCampaign(next);
      startTransition(() => { router.replace(`/calls?marketRunId=${next.campaign.marketRunId}&callCampaignId=${next.campaign.id}`); });
    })();
    return () => { cancelled = true; };
  }, [campaign, marketRunId, recordingReplay?.enabled, router]);

  useEffect(() => {
    if (recordingReplay?.enabled) return;
    if (!campaign?.campaign.id) return;
    let cancelled = false;
    let source: EventSource | null = null;
    let reconnectId: ReturnType<typeof setTimeout> | null = null;
    const streamCampaignId = campaign.campaign.id;

    const recoverSnapshot = async () => {
      const res = await apiRequest<{ campaign?: BrowserSafeCallProjection }>(`/api/calls/campaigns/${streamCampaignId}`);
      if (!res.ok || !res.data?.campaign) { setError("Live updates paused."); return "terminal" as const; }
      const recoveredCampaign = res.data.campaign;
      if (recoveredCampaign.campaign.id !== streamCampaignId) {
        return "terminal" as const;
      }
      setCampaign((current) =>
        current?.campaign.id === streamCampaignId
          ? mergeCallCampaignProjection(current, recoveredCampaign)
          : current,
      );
      setError(null);
      return ["completed", "failed", "cancelled", "superseded"].includes(recoveredCampaign.campaign.status)
        ? "terminal" as const
        : "retry" as const;
    };

    const connect = () => {
      if (cancelled) return;
      source = new EventSource(`/api/calls/campaigns/${streamCampaignId}/stream`);
      source.addEventListener("snapshot", (e) => {
        const next = JSON.parse((e as MessageEvent<string>).data) as BrowserSafeCallProjection;
        if (next.campaign.id !== streamCampaignId) {
          return;
        }
        setCampaign((current) =>
          current?.campaign.id === streamCampaignId
            ? mergeCallCampaignProjection(current, next)
            : current,
        );
        setError(null);
      });
      source.addEventListener("done", (e) => {
        const next = JSON.parse((e as MessageEvent<string>).data) as BrowserSafeCallProjection;
        if (next.campaign.id !== streamCampaignId) {
          return;
        }
        setCampaign((current) =>
          current?.campaign.id === streamCampaignId
            ? mergeCallCampaignProjection(current, next)
            : current,
        );
        setError(null);
        source?.close();
      });
      source.addEventListener("error", () => {
        source?.close(); source = null;
        void (async () => {
          const next = await recoverSnapshot();
          if (next === "terminal" || cancelled) return;
          reconnectId = setTimeout(connect, 1500);
        })();
      });
    };
    connect();
    return () => { cancelled = true; if (reconnectId) clearTimeout(reconnectId); source?.close(); };
  }, [campaign?.campaign.id, recordingReplay?.enabled]);

  const winnerHref = useMemo(() => {
    if (displayedCampaign?.winner?.id)           return `/winner?winnerArtifactId=${encodeURIComponent(displayedCampaign.winner.id)}`;
    if (displayedCampaign?.campaign.id)          return `/winner?callCampaignId=${encodeURIComponent(displayedCampaign.campaign.id)}`;
    if (displayedCampaign?.campaign.marketRunId) return `/winner?marketRunId=${encodeURIComponent(displayedCampaign.campaign.marketRunId)}`;
    return marketRunId ? `/winner?marketRunId=${encodeURIComponent(marketRunId)}` : "/winner";
  }, [displayedCampaign?.campaign.id, displayedCampaign?.campaign.marketRunId, displayedCampaign?.winner?.id, marketRunId]);

  const originalLanguage = useMemo(() =>
    displayedCampaign?.calls.find((c) => c.sourceLanguage)?.sourceLanguage || displayedCampaign?.campaign.sourceLanguage || "Original",
  [displayedCampaign]);

  async function subscribe() {
    if (!campaign?.campaign.id || reminderState !== "idle") return;
    setNotifyPending(true);
    const res = await apiRequest("/api/notifications/requests", { method: "POST", body: JSON.stringify({ callCampaignId: campaign.campaign.id }) });
    setNotifyPending(false);
    if (!res.ok) { setError(res.error ?? "Unable to create notification."); return; }
    const refresh = await apiRequest<{ campaign?: BrowserSafeCallProjection }>(`/api/calls/campaigns/${campaign.campaign.id}`);
    if (refresh.ok && refresh.data?.campaign) { setCampaign(refresh.data.campaign); setError(null); }
  }

  async function restartCampaign() {
    if (!campaign?.campaign.id || !campaign.campaign.marketRunId) return;
    setRetryPending(true);
    const res = await apiRequest<{ campaign?: BrowserSafeCallProjection; error?: string }>("/api/calls/campaigns", {
      method: "POST",
      body: JSON.stringify({ marketRunId: campaign.campaign.marketRunId, sourceCampaignId: campaign.campaign.id, forceFresh: true }),
    });
    setRetryPending(false);
    if (!res.ok || !res.data?.campaign) { setError(res.error ?? "Unable to restart."); return; }
    const next = res.data.campaign;
    setCampaign(next); setError(null); setLanguageOverride(null);
    startTransition(() => { router.replace(`/calls?marketRunId=${next.campaign.marketRunId}&callCampaignId=${next.campaign.id}`); });
  }

  return (
    <>
      {/* Fixed summary modal */}
      <AnimatePresence>
        {hoveredCall && hoverAnchor && (
          <SummaryModal
            key={hoveredCall.id}
            call={hoveredCall}
            language={language}
            anchorRef={hoverAnchor}
            onClose={handleModalLeave}
            onEnter={clearHide}
          />
        )}
      </AnimatePresence>

      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,0.55fr)]">

        {/* ── Main panel ── */}
        <section
          className="flex min-h-0 flex-col overflow-hidden rounded-[20px]"
          style={{ border: "1px solid var(--border)", background: "var(--card-strong)" }}
        >
          {/* Compact header */}
          <header className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em]"
                  style={{ color: "var(--subtle)", border: "1px solid var(--border)" }}
                >
                  Calls
                </span>
                {displayedCampaign && (
                  <motion.span
                    key={displayedCampaign.campaign.status}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={springFast}
                    className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em]"
                    style={{ color: campaignStatusColor(displayedCampaign.campaign.status), border: `1px solid ${campaignStatusBorder(displayedCampaign.campaign.status)}` }}
                  >
                    {displayedCampaign.campaign.status.replaceAll("_", " ")}
                  </motion.span>
                )}
                {/* Language toggle — inline */}
                {displayedCampaign && originalLanguage.toLowerCase() !== "english" && (
                  <div className="flex items-center gap-1">
                    {(["source", "english"] as const).map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => setLanguageOverride(lang)}
                        className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] transition-all hover:opacity-80"
                        style={
                          language === lang
                            ? { background: "var(--btn-bg)", color: "var(--btn-fg)" }
                            : { border: "1px solid var(--border)", color: "var(--muted)" }
                        }
                      >
                        {lang === "source" ? originalLanguage : "EN"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {displayedCampaign?.campaign.id && !replayActive ? (
                <button
                  type="button"
                  onClick={() => void restartCampaign()}
                  disabled={retryPending}
                  title="Restart outreach"
                  aria-label="Restart outreach"
                  className="inline-flex size-9 items-center justify-center rounded-full border transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                >
                  <RotateCcw className={`size-4 ${retryPending ? "animate-spin" : ""}`} />
                </button>
              ) : null}
            </div>

          <h1
            className="mt-1.5 font-serif leading-tight tracking-[-0.04em]"
            style={{ fontSize: "clamp(1.2rem, 1.8vw, 1.5rem)", color: "var(--fg)" }}
          >
            {displayedCampaign?.campaign.guide.headline ?? "Outreach board"}
          </h1>
          <div className="mt-3">
            <ProviderLockup
              compact
              subdued
              suffix={
                <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>
                  Narrated with ElevenLabs
                </span>
              }
            />
          </div>
          {callsReplay ? (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-[0.22em]" style={{ color: "var(--subtle)" }}>
                {formatSync(displayedCampaign?.campaign.updatedAt)}
              </p>
              <button
                type="button"
                onClick={callsReplay.restart}
                disabled={callsReplay.isPlaying}
                className="rounded-full px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.2em] transition-all hover:-translate-y-0.5 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  color: theme === "dark" ? "rgba(255,255,255,0.82)" : "rgba(15,23,42,0.08)",
                  border:
                    theme === "dark"
                      ? "1px solid rgba(255,255,255,0.18)"
                      : "1px solid rgba(15,23,42,0.04)",
                  background:
                    theme === "dark"
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(15,23,42,0.015)",
                  boxShadow:
                    theme === "dark"
                      ? "0 10px 28px rgba(0,0,0,0.22)"
                      : "0 6px 16px rgba(15,23,42,0.03)",
                  backdropFilter: "blur(10px)",
                }}
              >
                {replayButtonLabel}
              </button>
            </div>
          ) : null}
        </header>

          {/* Body — 2×2 grid of lane cards with inline transcript */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {error && (
              <div
                className="mb-4 rounded-[12px] border px-4 py-3 text-[12px]"
                style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.07)", color: "rgba(239,68,68,0.9)" }}
              >
                {error}
              </div>
            )}
            {displayedCampaign?.campaign.error && (
              <div
                className="mb-3 rounded-[12px] border px-4 py-3 text-[12px]"
                style={{ borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.07)", color: "rgba(245,158,11,0.85)" }}
              >
                {displayedCampaign.campaign.error}
              </div>
            )}

            <AnimatePresence>
              {(displayedCampaign?.calls ?? []).length > 0 ? (
                <motion.div
                  className="grid gap-4 sm:grid-cols-2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25 }}
                >
                  {(displayedCampaign?.calls ?? []).slice(0, 4).map((call, i) => (
                    <CallLane
                      key={call.id}
                      call={call}
                      index={i}
                      language={language}
                      onHover={handleHover}
                      onLeave={handleLeave}
                    />
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex h-64 items-center justify-center"
                >
                  <p className="text-[12px]" style={{ color: "var(--subtle)" }}>
                    {replayActive
                      ? "Replay lanes will appear once the board is started."
                      : "Outreach lanes will appear once the board is created."}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* ── Sidebar ── */}
        <aside className="grid min-h-0 gap-4 lg:grid-rows-[auto_minmax(0,1fr)]">

          {/* Controls */}
          <section
            className="overflow-hidden rounded-[20px]"
            style={{ border: "1px solid var(--border)", background: "var(--card-strong)" }}
          >
            <div className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: "var(--subtle)" }}>Controls</p>
              <h2 className="mt-1 text-[15px] font-semibold tracking-[-0.02em]" style={{ color: "var(--fg)" }}>Next action</h2>
            </div>
            <div className="space-y-3 px-5 py-4">
              <button
                type="button"
                onClick={() => void subscribe()}
                disabled={replayActive || !campaign?.campaign.id || notifyPending || reminderState !== "idle"}
                className="w-full rounded-full px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
              >
                {notifyPending ? "Saving…" : reminderState === "sent" ? "Reminder sent" : reminderState === "saved" ? "Reminder saved" : "Notify me"}
              </button>
              {notificationEmail ? (
                <p className="text-[10px] leading-[1.5]" style={{ color: "var(--subtle)" }}>
                  Will email {notificationEmail}
                </p>
              ) : null}

              <Link
                href={displayedCampaign?.campaign.canOpenWinner ? winnerHref : "#"}
                aria-disabled={!displayedCampaign?.campaign.canOpenWinner}
                className="flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80"
                style={
                  displayedCampaign?.campaign.canOpenWinner
                    ? { background: "var(--btn-bg)", color: "var(--btn-fg)" }
                    : { border: "1px solid var(--border)", color: "var(--subtle)", pointerEvents: "none", opacity: 0.5 }
                }
              >
                <ArrowRight className="size-3.5" />Open winner
              </Link>
            </div>
          </section>

          {/* Campaign counters + live resolution feed */}
          <section
            className="flex min-h-0 flex-col overflow-hidden rounded-[20px]"
            style={{ border: "1px solid var(--border)", background: "var(--card-strong)" }}
          >
            <div className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
              <p className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: "var(--subtle)" }}>Live report</p>
              <h2 className="mt-1 text-[15px] font-semibold tracking-[-0.02em]" style={{ color: "var(--fg)" }}>
                {displayedCampaign?.campaign.summary.completedCalls ?? 0}/{displayedCampaign?.campaign.summary.totalCalls ?? 0} resolved
              </h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-2">
                {(displayedCampaign?.resolutionFeed ?? []).length > 0 ? (
                  (displayedCampaign?.resolutionFeed ?? []).map((entry) => (
                    <div
                      key={entry.callId}
                      className="rounded-[12px] border px-3 py-3"
                      style={{ borderColor: callLaneBorderColor(entry.status), background: "var(--card)" }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-[12px] font-semibold" style={{ color: "var(--fg)" }}>
                          {entry.businessName}
                        </p>
                        <span
                          className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em]"
                          style={{ borderColor: callLaneBorderColor(entry.status), color: callStatusColor(entry.status) }}
                        >
                          {entry.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] leading-[1.65]" style={{ color: "var(--muted)" }}>
                        {language === "source" ? entry.summarySourceText : entry.summaryEnglishText}
                      </p>
                    </div>
                  ))
                ) : (
                  <div
                    className="rounded-[12px] border px-3 py-3 text-[11px]"
                    style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--muted)" }}
                  >
                    {displayedCampaign?.campaign.status === "active"
                      ? "Switchboard will post each outcome here as the lanes resolve."
                      : "No completed call outcomes yet."}
                  </div>
                )}
              </div>
            </div>
            <div className="border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { label: "Total",    value: displayedCampaign?.campaign.summary.totalCalls     ?? 0 },
                  { label: "Active",   value: displayedCampaign?.campaign.summary.activeCalls    ?? 0 },
                  { label: "Resolved", value: displayedCampaign?.campaign.summary.completedCalls ?? 0 },
                  { label: "Failed",   value: displayedCampaign?.campaign.summary.failedCalls    ?? 0 },
                ].map((entry) => (
                  <motion.div
                    key={entry.label}
                    whileHover={{ scale: 1.03, y: -1 }}
                    className="rounded-[12px] border px-3 py-3"
                    style={{ borderColor: "var(--border)", background: "var(--card)" }}
                  >
                    <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>{entry.label}</p>
                    <motion.p
                      key={entry.value}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={springFast}
                      className="mt-1.5 text-[22px] font-semibold tracking-[-0.03em]"
                      style={{ color: "var(--fg)" }}
                    >
                      {entry.value}
                    </motion.p>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
