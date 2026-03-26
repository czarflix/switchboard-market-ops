"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CheckCircle2, LoaderCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";

import { workspaceSpring as spring } from "@/components/app/workspace/workspace-motion";
import { useWorkspaceGuide } from "@/components/app/workspace/workspace-guide-shell";
import { useShellTheme } from "@/components/marketing/marketing-shell";
import { ProviderLockup } from "@/components/marketing/provider-badges";
import type { BrowserSafeMarketRun } from "@/lib/market/browser";
import { buildMarketFallbackGuide } from "@/lib/market/guides";
import type { GuideEnvelope } from "@/lib/market/schemas";
import {
  useMarketRecordingReplay,
  type MarketRecordingReplayConfig,
} from "./market-recording-replay";

type MarketWorkspaceProps = {
  researchSessionId: string | null;
  requestedRunMissing: boolean;
  initialRun: BrowserSafeMarketRun | null;
  notificationEmail?: string | null;
  recordingReplay?: MarketRecordingReplayConfig | null;
};

/* ─── Constants ──────────────────────────────────────────────────────────── */

const ACTIVE_STATUSES = ["discovering", "scraping", "fallback_discovering", "scoring"];
const POLLABLE_STATUSES = ["queued", ...ACTIVE_STATUSES];
/* ─── Helpers ────────────────────────────────────────────────────────────── */

async function apiRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as T | null;
  const error =
    json && typeof json === "object" && "error" in json && typeof (json as { error?: unknown }).error === "string"
      ? (json as { error: string }).error
      : null;
  return { ok: response.ok, data: json, error };
}

const marketStartupRequestCache = new Map<
  string,
  Promise<{ run: BrowserSafeMarketRun | null; error: string | null }>
>();

function getOrCreateMarketStartupRequest(researchSessionId: string) {
  const cached = marketStartupRequestCache.get(researchSessionId);
  if (cached) {
    return cached;
  }

  const request = (async () => {
    const current = await apiRequest<{ run?: BrowserSafeMarketRun | null; error?: string }>(
      `/api/market/runs/current?researchSessionId=${encodeURIComponent(researchSessionId)}`,
    );

    if (!current.ok) {
      return {
        run: null,
        error: current.error ?? "Unable to load current market run.",
      };
    }

    if (current.data?.run) {
      return { run: current.data.run, error: null };
    }

    const created = await apiRequest<{ run?: BrowserSafeMarketRun; error?: string }>("/api/market/runs", {
      method: "POST",
      body: JSON.stringify({ researchSessionId }),
    });

    if (!created.ok || !created.data?.run) {
      return {
        run: null,
        error: created.error ?? "Unable to start market run.",
      };
    }

    return { run: created.data.run, error: null };
  })().finally(() => {
    marketStartupRequestCache.delete(researchSessionId);
  });

  marketStartupRequestCache.set(researchSessionId, request);
  return request;
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

function isActiveStatus(status: string) {
  return ACTIVE_STATUSES.includes(status);
}

function stageProgress(stage: string) {
  switch (stage) {
    case "discovering":          return 28;
    case "scraping":
    case "fallback_discovering": return 58;
    case "scoring":              return 82;
    case "ready":
    case "needs_input":
    case "failed":               return 100;
    default:                     return 10;
  }
}

function buildActivityFeed(run: BrowserSafeMarketRun["run"], candidates: BrowserSafeMarketRun["candidates"]) {
  const discovered = candidates.slice(0, 4).map((c) => `Found ${c.displayName}`);
  const fallback = [
    "Searching live supply", "Expanding first-party sources",
    "Checking phone and WhatsApp paths", "Scoring shortlist fit", "Finalizing results",
  ];
  const base = discovered.length > 0 ? discovered : fallback;
  if (run.currentStage === "scraping") return [...base, "Verifying contact evidence", "Extracting pricing hints"].slice(0, 6);
  if (run.currentStage === "scoring") return [...base, "Re-ranking by fit", "Locking the top picks"].slice(0, 6);
  return base.slice(0, 6);
}

function getReminderState(notifications: BrowserSafeMarketRun["notifications"]) {
  if (notifications.some((n) => n.status === "sent"))    return "sent" as const;
  if (notifications.some((n) => n.status === "pending")) return "saved" as const;
  return "idle" as const;
}

/** Semantic border color for eligibility/status — border only, bg is always var(--card) */
function eligibilityBorderColor(eligibility: string) {
  if (eligibility === "eligible")     return "rgba(34,197,94,0.35)";
  if (eligibility === "needs_review") return "rgba(245,158,11,0.35)";
  if (eligibility === "ineligible")   return "rgba(239,68,68,0.3)";
  return "var(--border)";
}

function statusBorderColor(status: string) {
  if (status === "failed")                    return "rgba(239,68,68,0.3)";
  if (status === "ready" || status === "needs_input") return "rgba(34,197,94,0.3)";
  if (isActiveStatus(status))                 return "rgba(245,158,11,0.3)";
  return "var(--border)";
}

function statusTextColor(status: string) {
  if (status === "failed")                    return "rgba(239,68,68,0.85)";
  if (status === "ready" || status === "needs_input") return "rgba(34,197,94,0.85)";
  return "var(--muted)";
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function MarketWorkspace({
  researchSessionId,
  requestedRunMissing,
  initialRun,
  notificationEmail = null,
  recordingReplay = null,
}: MarketWorkspaceProps) {
  const router = useRouter();
  const { setGuide } = useWorkspaceGuide();
  const { theme } = useShellTheme();
  const [run, setRun] = useState<BrowserSafeMarketRun | null>(initialRun);
  const [error, setError] = useState<string | null>(requestedRunMissing ? "Market run not found." : null);
  const [refinement, setRefinement] = useState("");
  const [notifyPending, setNotifyPending] = useState(false);
  const [refinePending, setRefinePending] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [selectionPendingId, setSelectionPendingId] = useState<string | null>(null);
  const marketReplay = useMarketRecordingReplay({ config: recordingReplay, run: initialRun });
  const displayedRun = marketReplay?.run ?? run;
  const replayActive = Boolean(marketReplay);
  const replayButtonLabel = marketReplay?.hasCompleted ? "Replay" : "Start";

  const selectedIds = useMemo(
    () => (displayedRun?.candidates ?? []).filter((c) => c.selectedForCalls).map((c) => c.id),
    [displayedRun?.candidates],
  );

  useEffect(() => {
    const fallbackGuide: GuideEnvelope =
      displayedRun?.run.guide ?? buildMarketFallbackGuide({ researchSessionId, requestedRunMissing });

    setGuide(fallbackGuide);
  }, [displayedRun, requestedRunMissing, researchSessionId, setGuide]);

  useEffect(() => {
    if (replayActive || run || !researchSessionId || requestedRunMissing) return;
    let cancelled = false;
    void getOrCreateMarketStartupRequest(researchSessionId).then((result) => {
      if (cancelled) return;
      if (!result.run) {
        setError(result.error ?? "Unable to start market run.");
        return;
      }
      const next = result.run;
      setRun(next);
      setError(null);
      startTransition(() => {
        router.replace(`/market?researchSessionId=${next.run.researchSessionId}&marketRunId=${next.run.id}`);
      });
    });
    return () => { cancelled = true; };
  }, [replayActive, requestedRunMissing, researchSessionId, router, run]);

  useEffect(() => {
    if (replayActive || !run?.run.id || !POLLABLE_STATUSES.includes(run.run.status)) return;
    let cancelled = false;
    const id = run.run.id;
    let inFlight = false;
    let tid: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await apiRequest<{ run?: BrowserSafeMarketRun }>(`/api/market/runs/${id}`);
        if (cancelled || !res.ok || !res.data?.run || res.data.run.run.id !== id) return;
        setRun((cur) => {
          if (cur?.run.id !== id) return cur;
          const cd = cur.run.updatedAt ?? "", nd = res.data!.run!.run.updatedAt ?? "";
          if (cd && nd && nd < cd) return cur;
          return res.data!.run!;
        });
      } finally {
        inFlight = false;
        if (!cancelled) tid = setTimeout(() => void poll(), 2200);
      }
    };
    void poll();
    return () => { cancelled = true; if (tid) clearTimeout(tid); };
  }, [replayActive, run?.run.id, run?.run.status]);

  const activityFeed = useMemo(
    () => (displayedRun ? buildActivityFeed(displayedRun.run, displayedRun.candidates) : []),
    [displayedRun],
  );
  const reminderState = getReminderState(displayedRun?.notifications ?? []);
  const canMoveToCalls =
    Boolean(displayedRun?.run.id) &&
    !isActiveStatus(displayedRun?.run.status ?? "") &&
    displayedRun?.run.status !== "failed" &&
    selectionPendingId === null &&
    selectedIds.length > 0 &&
    selectedIds.length <= 4;

  async function subscribe() {
    if (replayActive || !run?.run.id || reminderState !== "idle") return;
    setNotifyPending(true);
    const res = await apiRequest("/api/notifications/requests", { method: "POST", body: JSON.stringify({ marketRunId: run.run.id }) });
    setNotifyPending(false);
    if (!res.ok) { setError(res.error ?? "Unable to create notification request."); return; }
    const refresh = await apiRequest<{ run?: BrowserSafeMarketRun }>(`/api/market/runs/${run.run.id}`);
    if (refresh.ok && refresh.data?.run) { setRun(refresh.data.run); setError(null); }
  }

  async function submitRefinement() {
    if (
      replayActive ||
      !run?.run.id ||
      !run.run.researchSessionId ||
      !refinement.trim() ||
      !run.run.canRefine
    ) return;
    setRefinePending(true);
    const res = await apiRequest<{ run?: BrowserSafeMarketRun; error?: string }>(
      `/api/market/runs/${run.run.id}/refine`,
      { method: "POST", body: JSON.stringify({ notes: refinement.trim() }) },
    );
    setRefinePending(false);
    if (!res.ok || !res.data?.run) { setError(res.error ?? "Unable to refine market run."); return; }
    setRefinement(""); setRun(res.data.run); setError(null);
    startTransition(() => { router.replace(`/market?researchSessionId=${res.data!.run!.run.researchSessionId}&marketRunId=${res.data!.run!.run.id}`); });
  }

  async function restartMarketRun() {
    if (replayActive || !run?.run.researchSessionId || !run.run.id) return;
    setRetryPending(true);
    const res = await apiRequest<{ run?: BrowserSafeMarketRun; error?: string }>("/api/market/runs", {
      method: "POST",
      body: JSON.stringify({ researchSessionId: run.run.researchSessionId, sourceRunId: run.run.id, forceFresh: true }),
    });
    setRetryPending(false);
    if (!res.ok || !res.data?.run) { setError(res.error ?? "Unable to restart market run."); return; }
    const next = res.data.run;
    setRun(next); setError(null); setRefinement("");
    startTransition(() => { router.replace(`/market?researchSessionId=${next.run.researchSessionId}&marketRunId=${next.run.id}`); });
  }

  async function toggleCandidate(candidateId: string) {
    if (replayActive || !run?.run.id) return;
    const currentlySelected = selectedIds.includes(candidateId);
    if (currentlySelected && selectedIds.length === 1) { setError("Keep at least one establishment selected."); return; }
    const nextIds = currentlySelected ? selectedIds.filter((id) => id !== candidateId) : [...selectedIds, candidateId];
    if (!currentlySelected && nextIds.length > 4) { setError("Pick no more than four establishments."); return; }
    setSelectionPendingId(candidateId);
    const res = await apiRequest<{ run?: BrowserSafeMarketRun; error?: string }>(
      `/api/market/runs/${run.run.id}/select`,
      { method: "POST", body: JSON.stringify({ candidateIds: nextIds }) },
    );
    setSelectionPendingId(null);
    if (!res.ok || !res.data?.run) { setError(res.error ?? "Unable to save selection."); return; }
    setRun(res.data.run); setError(null);
  }

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.6fr)]">

      {/* ── Main panel ── */}
      <section
        className="flex min-h-0 flex-col overflow-hidden rounded-[20px]"
        style={{ border: "1px solid var(--border)", background: "var(--card-strong)" }}
      >
        {/* Header */}
        <header className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em]"
                style={{ color: "var(--subtle)", border: "1px solid var(--border)" }}
              >
                Market
              </span>
              {displayedRun && (
                <motion.span
                  key={displayedRun.run.status}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={spring}
                  className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em]"
                  style={{
                    color: statusTextColor(displayedRun.run.status),
                    border: `1px solid ${statusBorderColor(displayedRun.run.status)}`,
                  }}
                >
                  {displayedRun.run.status.replaceAll("_", " ")}
                </motion.span>
              )}
            </div>
            {run?.run.id && !replayActive ? (
              <button
                type="button"
                onClick={() => void restartMarketRun()}
                disabled={retryPending}
                title="Restart market scan"
                aria-label="Restart market scan"
                className="inline-flex size-9 items-center justify-center rounded-full border transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ borderColor: "var(--border)", color: "var(--fg)" }}
              >
                {retryPending ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              </button>
            ) : null}
          </div>

          <h1
            className="mt-3 font-serif leading-tight tracking-[-0.04em]"
            style={{ fontSize: "clamp(1.5rem, 2.5vw, 2rem)", color: "var(--fg)" }}
          >
            Market scan
          </h1>
          <div className="mt-3">
            <ProviderLockup
              compact
              subdued
              suffix={
                <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>
                  Powered by Firecrawl
                </span>
              }
            />
          </div>

          {/* Progress bar */}
          {displayedRun && (
            <div className="mt-5">
              <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "var(--btn-bg)" }}
                  initial={{ width: 0 }}
                  animate={{ width: `${stageProgress(displayedRun?.run.currentStage ?? "idle")}%` }}
                  transition={{ duration: 0.9, ease: "easeOut" }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-[0.22em]" style={{ color: "var(--subtle)" }}>
                  {formatSync(displayedRun?.run.updatedAt)}
                </p>
                {marketReplay ? (
                  <button
                    type="button"
                    onClick={marketReplay.restart}
                    disabled={marketReplay.isPlaying}
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
                ) : null}
              </div>
            </div>
          )}
        </header>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <AnimatePresence mode="wait">

            {/* No run yet */}
            {!displayedRun && (
              <motion.div key="boot" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
                <div className="rounded-[16px] border px-5 py-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <p className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
                    {requestedRunMissing
                      ? "Run not found."
                      : "Starting scan…"}
                  </p>
                </div>
              </motion.div>
            )}

            {/* Queued */}
            {displayedRun?.run.status === "queued" && (
              <motion.div key={`queued-${displayedRun.run.id}`} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
                <div className="rounded-[16px] border px-5 py-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "var(--subtle)" }}>Queue</p>
                  <h2 className="mt-3 text-xl font-semibold" style={{ color: "var(--fg)" }}>Preparing the market scan</h2>
                  <p className="mt-3 text-[13px] leading-7" style={{ color: "var(--muted)" }}>Assembling the query pack.</p>
                </div>
              </motion.div>
            )}

            {/* Active scan */}
            {displayedRun && isActiveStatus(displayedRun.run.status) && (
              <motion.div key={`active-${displayedRun.run.id}-${displayedRun.run.status}`} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring} className="space-y-4">

                {/* Query pack */}
                <div className="overflow-hidden rounded-[16px] border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  {/* Shimmer sweep */}
                  <div className="relative overflow-hidden">
                    <motion.div
                      className="pointer-events-none absolute inset-y-0 left-[-20%] w-[40%]"
                      style={{ background: "linear-gradient(90deg, transparent, var(--border), transparent)" }}
                      animate={{ x: ["0%", "280%"] }}
                      transition={{ duration: 2.6, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
                    />
                    <div className="relative px-5 py-5">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "var(--subtle)" }}>Query pack</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {displayedRun.run.summary.searchQueries.map((q, i) => (
                          <motion.div
                            key={q}
                            initial={{ opacity: 0, y: 8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ delay: i * 0.07, ...spring }}
                            className="rounded-full border px-3.5 py-2 text-[12px]"
                            style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                          >
                            {q}
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats + activity */}
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                  {/* Stats */}
                  <div className="rounded-[16px] border px-5 py-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "var(--subtle)" }}>Live scan</p>
                        <h2 className="mt-2 text-lg font-semibold" style={{ color: "var(--fg)" }}>
                          {displayedRun.run.currentStage === "scraping" ? "Collecting source evidence" : "Building the shortlist"}
                        </h2>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      {[
                        { label: "Queries",  value: displayedRun.run.summary.searchQueries.length },
                        { label: "Found",    value: displayedRun.run.summary.totalCandidates || displayedRun.candidates.length },
                        { label: "Eligible", value: displayedRun.run.summary.eligibleCandidates },
                      ].map((entry) => (
                        <motion.div
                          key={entry.label}
                          whileHover={{ y: -2, scale: 1.01 }}
                          className="rounded-[14px] border px-4 py-4"
                          style={{ borderColor: "var(--border)", background: "var(--card-strong)" }}
                        >
                          <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "var(--subtle)" }}>{entry.label}</p>
                          <p className="mt-3 text-3xl font-semibold tracking-[-0.04em]" style={{ color: "var(--fg)" }}>{entry.value}</p>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* Activity feed */}
                  <div className="rounded-[16px] border px-5 py-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "var(--subtle)" }}>Activity</p>
                    <div className="mt-4 space-y-2">
                      {activityFeed.map((entry, i) => (
                        <motion.div
                          key={`${entry}-${i}`}
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.06, ...spring }}
                          className="flex items-center gap-3 rounded-[12px] border px-4 py-3"
                          style={{ borderColor: "var(--border)" }}
                        >
                          <motion.span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: "var(--btn-bg)" }}
                            animate={{ scale: [1, 1.4, 1], opacity: [0.6, 1, 0.6] }}
                            transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY, delay: i * 0.1 }}
                          />
                          <p className="text-[12px]" style={{ color: "var(--fg)" }}>{entry}</p>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Terminal state — failed or complete */}
            {displayedRun && !isActiveStatus(displayedRun.run.status) && displayedRun.run.status !== "queued" && (
              <motion.div key={`terminal-${displayedRun.run.id}-${displayedRun.candidates.length}`} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring} className="space-y-4">

                {error && !replayActive && (
                  <div
                    className="rounded-[14px] border px-4 py-4 text-[13px]"
                    style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.07)", color: "rgba(239,68,68,0.9)" }}
                  >
                    {error}
                  </div>
                )}

                {displayedRun.run.status === "failed" ? (
                  <div
                    className="rounded-[16px] border px-5 py-5"
                    style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)" }}
                  >
                    <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "rgba(239,68,68,0.7)" }}>Scan failed</p>
                    <p className="mt-3 text-[13px] leading-7" style={{ color: "rgba(239,68,68,0.85)" }}>
                      {displayedRun.run.error || displayedRun.run.guide.body}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {displayedRun.candidates.map((candidate, i) => {
                      const selected  = selectedIds.includes(candidate.id);
                      const disabled  = selectionPendingId === candidate.id || candidate.eligibility === "ineligible";
                      const isPending = selectionPendingId === candidate.id;

                      return (
                        <motion.button
                          type="button"
                          key={candidate.id}
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04, ...spring }}
                          whileHover={disabled ? {} : { y: -3, scale: 1.006 }}
                          whileTap={disabled ? {} : { scale: 0.99 }}
                          onClick={() => { if (!disabled) void toggleCandidate(candidate.id); }}
                          className="text-left rounded-[18px] border px-5 py-5 transition-colors"
                          style={{
                            borderColor: selected
                              ? "var(--btn-bg)"
                              : eligibilityBorderColor(candidate.eligibility),
                            background: selected ? "var(--accent-soft)" : "var(--card)",
                            opacity: disabled && !isPending ? 0.55 : 1,
                            cursor: disabled ? "not-allowed" : "pointer",
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em]"
                                  style={{ borderColor: "var(--border)", color: "var(--subtle)" }}
                                >
                                  #{candidate.rank}
                                </span>
                                <span
                                  className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em]"
                                  style={{
                                    borderColor: eligibilityBorderColor(candidate.eligibility),
                                    color: "var(--muted)",
                                  }}
                                >
                                  {candidate.eligibility.replaceAll("_", " ")}
                                </span>
                              </div>
                              <h2 className="mt-3 text-[17px] font-semibold tracking-[-0.02em]" style={{ color: "var(--fg)" }}>
                                {candidate.displayName}
                              </h2>
                              <p className="mt-1.5 text-[12px]" style={{ color: "var(--muted)" }}>
                                {[candidate.locality || candidate.city, candidate.phone || candidate.whatsappNumber || "No direct line yet"]
                                  .filter(Boolean).join(" · ")}
                              </p>
                            </div>

                            {/* Selection indicator */}
                            <div
                              className="flex size-8 shrink-0 items-center justify-center rounded-full transition-all"
                              style={
                                selected
                                  ? { background: "var(--btn-bg)", color: "var(--btn-fg)" }
                                  : { background: "transparent", border: "1.5px solid var(--border)", color: "var(--subtle)" }
                              }
                            >
                              {isPending
                                ? <LoaderCircle className="size-3.5 animate-spin" />
                                : selected
                                ? <CheckCircle2 className="size-3.5" />
                                : <span className="text-[8px] font-black">+</span>}
                            </div>
                          </div>

                          <p className="mt-4 text-[12px] leading-[1.75]" style={{ color: "var(--muted)" }}>
                            {candidate.summary || "Evidence-backed establishment ready for live validation."}
                          </p>

                          <div className="mt-4 grid gap-2 sm:grid-cols-3">
                            {[
                              { label: "Score",    value: Math.round(candidate.score) },
                              { label: "Evidence", value: candidate.evidenceCount },
                              { label: "Language", value: candidate.sourceLanguage },
                            ].map((entry) => (
                              <div
                                key={entry.label}
                                className="rounded-[10px] border px-3 py-2.5"
                                style={{ borderColor: "var(--border)", background: "var(--card-strong)" }}
                              >
                                <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>{entry.label}</p>
                                <p className="mt-1.5 text-[12px] font-semibold" style={{ color: "var(--fg)" }}>{entry.value}</p>
                              </div>
                            ))}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* ── Sidebar ── */}
      <aside className="flex min-h-0 flex-col">

        {/* Controls — takes the full height */}
        <section
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px]"
          style={{ border: "1px solid var(--border)", background: "var(--card-strong)" }}
        >
          <div className="border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
            <p className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: "var(--subtle)" }}>Controls</p>
            <h2 className="mt-2 text-lg font-semibold tracking-[-0.02em]" style={{ color: "var(--fg)" }}>Next action</h2>
          </div>
          <div className="space-y-3 px-5 py-5">
            {error && !isActiveStatus(displayedRun?.run.status ?? "") && (
              <div
                className="rounded-[12px] border px-4 py-3 text-[12px]"
                style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.07)", color: "rgba(239,68,68,0.9)" }}
              >
                {error}
              </div>
            )}

            {/* Notify */}
            <button
              type="button"
              onClick={() => void subscribe()}
              disabled={replayActive || !run?.run.id || notifyPending || reminderState !== "idle"}
              className="w-full rounded-full px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
            >
              {notifyPending ? "Saving…" : reminderState === "sent" ? "Reminder sent" : reminderState === "saved" ? "Reminder saved" : "Notify me when done"}
            </button>
            {notificationEmail ? (
              <p className="text-[10px] leading-[1.5]" style={{ color: "var(--subtle)" }}>
                Will email {notificationEmail}
              </p>
            ) : null}

            {/* Refinement */}
            <div className="rounded-[16px] border px-4 py-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>Refinement</p>
                {displayedRun?.run.refinementLimitReached && (
                  <span className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em]" style={{ borderColor: "var(--border)", color: "var(--subtle)" }}>
                    Used
                  </span>
                )}
              </div>
              <textarea
                value={refinement}
                onChange={(e) => setRefinement(e.target.value)}
                disabled={replayActive || !displayedRun?.run.canRefine || refinePending}
                placeholder="Increase budget by ₹10k, prefer Sector 62, prioritize parking."
                className="mt-3 h-24 w-full resize-none rounded-[12px] border px-3 py-2.5 text-[12px] leading-[1.7] outline-none placeholder:opacity-40 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: "var(--border)", background: "transparent", color: "var(--fg)" }}
              />
              <button
                type="button"
                onClick={() => void submitRefinement()}
                disabled={replayActive || !displayedRun?.run.canRefine || refinePending || !refinement.trim()}
                className="mt-3 w-full rounded-full border px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ borderColor: "var(--border)", color: "var(--fg)" }}
              >
                {refinePending ? "Applying…" : displayedRun?.run.canRefine ? "Rerun with refinement" : "Refinement used"}
              </button>
              {displayedRun?.run.refinements[0] && (
                <p className="mt-3 text-[11px] leading-[1.6]" style={{ color: "var(--muted)" }}>
                  Applied: {displayedRun.run.refinements[0].rawNotes || displayedRun.run.refinements[0].notes}
                </p>
              )}
            </div>

            {/* Move to calls */}
            <Link
              href={!replayActive && canMoveToCalls && displayedRun?.run.id ? `/calls?marketRunId=${encodeURIComponent(displayedRun.run.id)}` : "#"}
              aria-disabled={!canMoveToCalls}
              className="flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80"
              style={
                canMoveToCalls
                  ? { background: "var(--btn-bg)", color: "var(--btn-fg)" }
                  : { border: "1px solid var(--border)", color: "var(--subtle)", pointerEvents: "none", opacity: 0.5 }
              }
            >
              <ArrowRight className="size-3.5" />
              Move to calls
            </Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
