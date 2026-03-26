"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Calendar, CheckCircle2, ChevronDown, Clipboard, LoaderCircle, Mail, Trophy } from "lucide-react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  workspaceSpring as spring,
  workspaceSpringFast as springFast,
} from "@/components/app/workspace/workspace-motion";
import { useWorkspaceGuide } from "@/components/app/workspace/workspace-guide-shell";
import { useShellTheme } from "@/components/marketing/marketing-shell";
import { ProviderLockup } from "@/components/marketing/provider-badges";
import { buildWinnerGuide } from "@/lib/market/guides";
import type { GuideEnvelope } from "@/lib/market/schemas";
import {
  useWinnerRecordingReplay,
  type WinnerRecordingReplayConfig,
} from "./winner-recording-replay";
/* ─── Types ──────────────────────────────────────────────────────────────── */

type WinnerWorkspaceProps = {
  winner: {
    id: string;
    selectedCandidateId: string;
    reportSourceText: string;
    reportEnglishText: string;
    ranking: Array<{ candidateId: string; rank: number; score: number; reason: string }>;
  } | null;
  decision: {
    campaignId: string;
    marketRunId: string;
    researchSessionId: string;
    status: string;
    confirmed: boolean;
    recommendedCandidateId: string | null;
    selectedCandidateId: string | null;
    reportSourceText: string;
    reportEnglishText: string;
    ranking: Array<{
      candidateId: string;
      displayName: string;
      locality: string;
      websiteUrl: string;
      whatsappNumber: string;
      phone: string;
      rank: number;
      score: number;
      reason: string;
      result: string | null;
      quotedPrice: number | null;
      confidence: number | null;
      summarySourceText: string;
      summaryEnglishText: string;
    }>;
  } | null;
  defaultLanguage?: "source" | "english";
  initialGuide?: GuideEnvelope | null;
  notificationEmail?: string | null;
  recordingReplay?: WinnerRecordingReplayConfig | null;
};

/* ─── Constants ──────────────────────────────────────────────────────────── */

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
      ? (json as { error: string }).error : null;
  return { ok: response.ok, data: json, error };
}

function buildCalendarHref(candidateName: string) {
  const start  = new Date(Date.now() + 1000 * 60 * 60 * 24);
  const end    = new Date(start.getTime() + 1000 * 60 * 30);
  const fmt    = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Follow up with ${candidateName}`,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `Review the Switchboard recommendation and finalize the next step with ${candidateName}.`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function firstSentence(value: string | null | undefined) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  const match = normalized.match(/^[^.!?]+[.!?]?/);
  return (match?.[0] ?? normalized).trim();
}

function clampReplayCopy(value: string | null | undefined, maxLength = 84) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const sliced = normalized.slice(0, maxLength - 1);
  const boundary = sliced.lastIndexOf(" ");
  return `${(boundary > 24 ? sliced.slice(0, boundary) : sliced).trim()}…`;
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function WinnerWorkspace({
  winner,
  decision,
  defaultLanguage = "english",
  initialGuide = null,
  notificationEmail = null,
  recordingReplay = null,
}: WinnerWorkspaceProps) {
  const router = useRouter();
  const { setGuide } = useWorkspaceGuide();
  const { theme } = useShellTheme();
  const [language, setLanguage] = useState<"source" | "english">(defaultLanguage);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    winner?.selectedCandidateId ?? decision?.selectedCandidateId ?? decision?.recommendedCandidateId ?? null,
  );
  const [confirmPending, setConfirmPending] = useState(false);
  const [emailPending,   setEmailPending]   = useState(false);
  const [startFreshPending, setStartFreshPending] = useState(false);
  const [notice, setNotice]   = useState<string | null>(null);
  const [error,  setError]    = useState<string | null>(null);
  const [winnerState, setWinnerState] = useState(winner);
  const [guideState, setGuideState] = useState<GuideEnvelope | null>(initialGuide);
  const [rankingExpanded, setRankingExpanded] = useState(!winner || Boolean(recordingReplay?.enabled));
  const [editConfirmedWinner, setEditConfirmedWinner] = useState(false);
  const startFreshLockRef = useRef(false);
  const winnerReplay = useWinnerRecordingReplay(recordingReplay);
  const replayActive = Boolean(winnerReplay);
  const replayButtonLabel = winnerReplay?.isPlaying ? "Live" : winnerReplay?.hasCompleted ? "Replay" : "Start";

  const effectiveId = selectedCandidateId ?? winnerState?.selectedCandidateId ?? decision?.recommendedCandidateId ?? null;
  const canConfirmWinner = Boolean(decision?.campaignId && effectiveId && decision?.status === "completed");
  const selectedEntry = useMemo(
    () => decision?.ranking.find((e) => e.candidateId === effectiveId) ?? null,
    [decision?.ranking, effectiveId],
  );
  const secondBestEntry = useMemo(
    () => (decision?.ranking ?? []).find((entry) => entry.candidateId !== effectiveId) ?? null,
    [decision?.ranking, effectiveId],
  );
  const confirmedWinnerName =
    winnerState?.selectedCandidateId
      ? decision?.ranking.find((entry) => entry.candidateId === winnerState.selectedCandidateId)?.displayName ?? null
      : null;
  const recommendedWinnerCandidateId = decision?.selectedCandidateId ?? decision?.recommendedCandidateId ?? null;
  const recommendedWinnerName =
    recommendedWinnerCandidateId
      ? decision?.ranking.find((entry) => entry.candidateId === recommendedWinnerCandidateId)?.displayName ?? null
      : null;
  const isLockedWinner = Boolean(winnerState) && !editConfirmedWinner;
  const showRanking = !winnerState || rankingExpanded || editConfirmedWinner;
  const replayDecisionCards = useMemo(() => {
    if (!replayActive || !isLockedWinner || !selectedEntry) {
      return [];
    }

    return [
      {
        label: "Why this venue",
        value: clampReplayCopy(selectedEntry.reason || "Best overall fit after outreach and ranking."),
      },
      {
        label: "Call outcome",
        value: clampReplayCopy(
          firstSentence(language === "source" ? selectedEntry.summarySourceText : selectedEntry.summaryEnglishText) ||
            firstSentence(selectedEntry.summaryEnglishText) ||
            "Stayed engaged and remained the strongest handoff option.",
        ),
      },
      {
        label: "2nd best",
        value: secondBestEntry
          ? clampReplayCopy(`${secondBestEntry.displayName}: ${secondBestEntry.reason || "Strong backup, but weaker overall fit."}`)
          : "No close backup remained.",
      },
    ];
  }, [isLockedWinner, language, replayActive, secondBestEntry, selectedEntry]);
  const reportText =
    language === "source"
      ? isLockedWinner ? winnerState?.reportSourceText ?? "" : decision?.reportSourceText ?? ""
      : isLockedWinner ? winnerState?.reportEnglishText ?? "" : decision?.reportEnglishText ?? "";
  const isConfirmedSelection =
    isLockedWinner &&
    Boolean(selectedEntry?.candidateId && selectedEntry.candidateId === winnerState?.selectedCandidateId);
  const focusedReplayCta = winnerReplay?.ctaFocus ?? null;

  function replayCtaStyle(kind: "email" | "calendar") {
    const focused = replayActive && isLockedWinner && focusedReplayCta === kind;

    if (!focused) {
      return { borderColor: "var(--border)", color: "var(--fg)" };
    }

    return {
      borderColor: theme === "dark" ? "rgba(216,202,179,0.42)" : "rgba(15,23,42,0.18)",
      background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.045)",
      color: "var(--fg)",
      boxShadow: theme === "dark" ? "0 14px 32px rgba(0,0,0,0.22)" : "0 14px 32px rgba(15,23,42,0.08)",
    };
  }

  function replayCtaMotion(kind: "email" | "calendar") {
    const focused = replayActive && isLockedWinner && focusedReplayCta === kind;

    return focused
      ? {
          y: -2,
          scale: 1.015,
        }
      : {
          y: 0,
          scale: 1,
        };
  }

  useEffect(() => {
    setGuide(
      guideState ??
        buildWinnerGuide({
          winner: winnerState ? { ...winnerState, selectedName: confirmedWinnerName } : null,
          decision: decision ? { ...decision, status: decision.status, recommendedName: recommendedWinnerName } : null,
        }),
    );
  }, [confirmedWinnerName, decision, guideState, recommendedWinnerName, setGuide, winnerState]);

  async function confirmWinner() {
    if (replayActive) {
      setNotice("Recording replay only.");
      setError(null);
      return;
    }
    if (!decision?.campaignId || !effectiveId || decision.status !== "completed") return;
    setConfirmPending(true);
    const res = await apiRequest<{ winner?: WinnerWorkspaceProps["winner"]; guide?: GuideEnvelope; error?: string }>("/api/winner/confirm", {
      method: "POST",
      body: JSON.stringify({ callCampaignId: decision.campaignId, candidateId: effectiveId }),
    });
    setConfirmPending(false);
    const confirmedWinner = res.data?.winner ?? null;
    const confirmedGuide = res.data?.guide ?? null;
    if (!res.ok || !confirmedWinner) { setError(res.error ?? "Unable to confirm winner."); return; }
    setWinnerState(confirmedWinner);
    setGuideState(
      confirmedGuide ??
        buildWinnerGuide({
          winner: confirmedWinner
            ? {
                ...confirmedWinner,
                selectedName:
                  decision?.ranking.find((entry) => entry.candidateId === confirmedWinner.selectedCandidateId)?.displayName ??
                  null,
              }
            : null,
          decision: decision
            ? {
                ...decision,
                status: decision.status,
                recommendedName:
                  decision.ranking.find(
                    (entry) =>
                      entry.candidateId ===
                      (confirmedWinner.selectedCandidateId ?? decision.selectedCandidateId ?? decision.recommendedCandidateId),
                  )?.displayName ?? null,
              }
            : null,
        }),
    );
    setSelectedCandidateId(confirmedWinner.selectedCandidateId);
    setRankingExpanded(false);
    setEditConfirmedWinner(false);
    setNotice("Winner confirmed."); setError(null);
  }

  async function sendEmail() {
    if (replayActive) {
      setNotice("Recording replay only.");
      setError(null);
      return;
    }
    if (!winnerState?.id) return;
    setEmailPending(true);
    const res = await apiRequest("/api/notifications/requests", {
      method: "POST", body: JSON.stringify({ winnerArtifactId: winnerState.id }),
    });
    setEmailPending(false);
    if (!res.ok) { setError(res.error ?? "Unable to export report by email."); return; }
    setNotice("Report queued for email."); setError(null);
  }

  async function copyDetails() {
    if (!selectedEntry) return;
    const payload = [
      `Winner: ${selectedEntry.displayName}`,
      selectedEntry.locality        ? `Locality: ${selectedEntry.locality}` : "",
      selectedEntry.phone           ? `Phone: ${selectedEntry.phone}` : "",
      selectedEntry.whatsappNumber  ? `WhatsApp: ${selectedEntry.whatsappNumber}` : "",
      selectedEntry.websiteUrl      ? `Website: ${selectedEntry.websiteUrl}` : "",
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      setNotice("Winner details copied."); setError(null);
    } catch {
      setError("Unable to copy winner details.");
    }
  }

  function handleStartFresh() {
    if (replayActive) {
      setNotice("Recording replay only.");
      setError(null);
      return;
    }
    if (startFreshLockRef.current || startFreshPending) {
      return;
    }

    startFreshLockRef.current = true;
    setStartFreshPending(true);
    setError(null);
    startTransition(() => {
      router.push("/research");
    });
  }

  function handleBackToCalls() {
    if (replayActive) {
      setNotice("Recording replay only.");
      setError(null);
      return;
    }
    if (!decision?.campaignId || !decision.marketRunId) {
      return;
    }

    startTransition(() => {
      router.push(
        `/calls?marketRunId=${encodeURIComponent(decision.marketRunId)}&callCampaignId=${encodeURIComponent(decision.campaignId)}`,
      );
    });
  }

  /* ── Empty state ── */
  if (!decision && !winnerState) {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden rounded-[20px] px-8 py-12 text-center"
        style={{ border: "1px solid var(--border)", background: "var(--card-strong)" }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...spring, delay: 0.1 }}
          className="mb-5 flex size-14 items-center justify-center rounded-full"
          style={{ background: "var(--border)" }}
        >
          <Trophy className="size-6" style={{ color: "var(--subtle)" }} />
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.18 }}
          className="text-[10px] font-black uppercase tracking-[0.24em]"
          style={{ color: "var(--subtle)" }}
        >
          Winner
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.24 }}
          className="mt-2 text-xl font-semibold tracking-[-0.02em]"
          style={{ color: "var(--fg)" }}
        >
          No winner decision yet
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.3 }}
          className="mt-3 max-w-xs text-[13px] leading-[1.75]"
          style={{ color: "var(--muted)" }}
        >
          Finish the outreach campaign first. This page will switch to confirmation once all calls are complete.
        </motion.p>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.75fr)]">

      {/* ── Main report panel ── */}
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
                Winner
              </span>
              {/* Confirmed / pending pill */}
              <AnimatePresence mode="wait">
                <motion.span
                  key={winnerState ? "confirmed" : "pending"}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={springFast}
                  className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em]"
                  style={{
                    color: winnerState
                      ? editConfirmedWinner
                        ? "rgba(245,158,11,0.85)"
                        : "rgba(34,197,94,0.85)"
                      : "rgba(245,158,11,0.85)",
                    border: winnerState
                      ? editConfirmedWinner
                        ? "1px solid rgba(245,158,11,0.35)"
                        : "1px solid rgba(34,197,94,0.35)"
                      : "1px solid rgba(245,158,11,0.35)",
                  }}
                >
                  {winnerState ? (editConfirmedWinner ? "Editing" : "Confirmed") : "Recommendation"}
                </motion.span>
              </AnimatePresence>
            </div>

            {/* Language toggle */}
            <div className="flex items-center gap-1">
              {([["source", "Original"], ["english", "English"]] as const).map(([lang, label]) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLanguage(lang)}
                  className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.15em] transition-all hover:opacity-80"
                  style={
                    language === lang
                      ? { background: "var(--btn-bg)", color: "var(--btn-fg)" }
                      : { border: "1px solid var(--border)", color: "var(--muted)" }
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <h1
            className="mt-1.5 font-serif leading-tight tracking-[-0.04em]"
            style={{ fontSize: "clamp(1.2rem, 1.8vw, 1.5rem)", color: "var(--fg)" }}
          >
            {winnerState
              ? "Final recommendation"
              : decision?.status === "completed"
                ? "Confirm the winner"
                : "Winner pending calls"}
          </h1>
          <div className="mt-3">
            <ProviderLockup
              compact
              subdued
              suffix={
                <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>
                  Switchboard provenance
                </span>
              }
            />
          </div>
          {winnerReplay ? (
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                onClick={winnerReplay.restart}
                disabled={winnerReplay.isPlaying}
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

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {/* Notice / error banners */}
          <AnimatePresence>
            {error && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={springFast}
                className="mb-4 rounded-[12px] border px-4 py-3 text-[12px]"
                style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.07)", color: "rgba(239,68,68,0.9)" }}
              >
                {error}
              </motion.div>
            )}
            {notice && (
              <motion.div
                key="notice"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={springFast}
                className="mb-4 rounded-[12px] border px-4 py-3 text-[12px]"
                style={{
                  borderColor: isLockedWinner ? "rgba(216,202,179,0.24)" : "rgba(34,197,94,0.3)",
                  background: isLockedWinner
                    ? "linear-gradient(135deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))"
                    : "rgba(34,197,94,0.07)",
                  color: isLockedWinner ? "var(--fg)" : "rgba(34,197,94,0.85)",
                }}
              >
                {notice}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Selected candidate hero card */}
          <AnimatePresence mode="wait">
            {selectedEntry && (
              <motion.div
                key={selectedEntry.candidateId}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={spring}
                className="overflow-hidden rounded-[18px] border"
                style={{ borderColor: "var(--border)", background: "var(--card)" }}
              >
                {/* Hero header */}
                <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em]"
                        style={{ borderColor: "var(--border)", color: "var(--subtle)" }}
                      >
                        #{selectedEntry.rank} · Score {Math.round(selectedEntry.score)}
                      </span>
                      {isConfirmedSelection && (
                        <motion.span
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={springFast}
                          className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em]"
                          style={{ borderColor: "rgba(34,197,94,0.4)", color: "rgba(34,197,94,0.85)" }}
                        >
                          <CheckCircle2 className="size-2.5" />
                          Confirmed
                        </motion.span>
                      )}
                    </div>
                    <h2
                      className="mt-3 font-serif tracking-[-0.03em]"
                      style={{ fontSize: "clamp(1.4rem, 2vw, 1.9rem)", color: "var(--fg)" }}
                    >
                      {selectedEntry.displayName}
                    </h2>
                    <p className="mt-1.5 text-[12px]" style={{ color: "var(--muted)" }}>
                      {[selectedEntry.locality, selectedEntry.phone || selectedEntry.whatsappNumber]
                        .filter(Boolean).join(" · ") || "Location pending"}
                    </p>
                    {isConfirmedSelection ? (
                      <p className="mt-3 max-w-xl text-[13px] leading-[1.8]" style={{ color: "var(--muted)" }}>
                        Locked recommendation. Switchboard has finalized the handoff package for this venue.
                      </p>
                    ) : null}
                  </div>
                </div>
                {/* ── Actions embedded in hero card ── */}
                <div className="border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        key="error"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={springFast}
                        className="mb-3 overflow-hidden rounded-[10px] border px-3 py-2.5 text-[11px]"
                        style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.07)", color: "rgba(239,68,68,0.9)" }}
                      >
                        {error}
                      </motion.div>
                    )}
                    {notice && (
                      <motion.div
                        key="notice"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={springFast}
                        className="mb-3 overflow-hidden rounded-[10px] border px-3 py-2.5 text-[11px]"
                        style={{
                          borderColor: isLockedWinner ? "rgba(216,202,179,0.24)" : "rgba(34,197,94,0.3)",
                          background: isLockedWinner
                            ? "linear-gradient(135deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))"
                            : "rgba(34,197,94,0.07)",
                          color: isLockedWinner ? "var(--fg)" : "rgba(34,197,94,0.85)",
                        }}
                      >
                        {notice}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="flex flex-wrap gap-2">
                    {isLockedWinner ? (
                      replayActive ? null : (
                      <>
                        <motion.button
                          type="button"
                          onClick={handleStartFresh}
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          className="flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em]"
                          style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
                        >
                          Start fresh
                        </motion.button>
                        <motion.button
                          type="button"
                          onClick={handleBackToCalls}
                          disabled={!decision?.campaignId || !decision.marketRunId}
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          className="flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                          style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                        >
                          <ArrowLeft className="size-3" />
                          Back to calls
                        </motion.button>
                        <motion.button
                          type="button"
                          onClick={() => {
                            setEditConfirmedWinner(true);
                            setRankingExpanded(true);
                            setNotice("Ranking unlocked. Pick a different venue, then confirm the change.");
                            setError(null);
                          }}
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          className="flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80"
                          style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                        >
                          Change winner
                        </motion.button>
                      </>
                      )
                    ) : winnerState && editConfirmedWinner ? (
                      <>
                        <motion.button
                          type="button"
                          onClick={() => void confirmWinner()}
                          disabled={!canConfirmWinner || confirmPending}
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          className="flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-40"
                          style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
                        >
                          {confirmPending ? <LoaderCircle className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                          {confirmPending ? "Updating…" : "Update winner"}
                        </motion.button>
                        <motion.button
                          type="button"
                          onClick={() => {
                            setEditConfirmedWinner(false);
                            setRankingExpanded(false);
                            setSelectedCandidateId(winnerState.selectedCandidateId);
                            setNotice("Winner lock restored.");
                            setError(null);
                          }}
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          className="flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80"
                          style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                        >
                          Cancel change
                        </motion.button>
                      </>
                    ) : (
                      <motion.button
                        type="button"
                        onClick={() => void confirmWinner()}
                        disabled={!canConfirmWinner || confirmPending}
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.97 }}
                        className="flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
                      >
                        {confirmPending ? <LoaderCircle className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                        {confirmPending ? "Confirming…" : winnerState ? "Update winner" : "Confirm winner"}
                      </motion.button>
                    )}
                    {/* Email */}
                    <div className="flex flex-col gap-1">
                      <motion.button
                        type="button"
                        onClick={() => void sendEmail()}
                        disabled={(!winnerState?.id && !replayActive) || emailPending || editConfirmedWinner}
                        animate={replayCtaMotion("email")}
                        transition={springFast}
                        whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
                        className="flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                        style={replayCtaStyle("email")}
                      >
                        {emailPending ? <LoaderCircle className="size-3 animate-spin" /> : <Mail className="size-3" />}
                        {emailPending ? "Sending…" : editConfirmedWinner ? "Confirm change to export" : "Email report"}
                      </motion.button>
                      {notificationEmail ? (
                        <p className="text-[10px] leading-[1.5]" style={{ color: "var(--subtle)" }}>
                          Will email {notificationEmail}
                        </p>
                      ) : null}
                    </div>
                    {/* Copy */}
                    <motion.button
                      type="button"
                      onClick={() => void copyDetails()}
                      disabled={!selectedEntry || editConfirmedWinner}
                      whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
                      className="flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                    >
                      <Clipboard className="size-3" />Copy
                    </motion.button>
                    {/* Calendar */}
                    <motion.a
                      href={
                        selectedEntry && !editConfirmedWinner && !replayActive
                          ? buildCalendarHref(selectedEntry.displayName)
                          : "#"
                      }
                      target="_blank" rel="noreferrer"
                      onClick={(event) => {
                        if (replayActive) {
                          event.preventDefault();
                        }
                      }}
                      aria-disabled={!selectedEntry || editConfirmedWinner}
                      animate={replayCtaMotion("calendar")}
                      transition={springFast}
                      whileHover={selectedEntry && !editConfirmedWinner ? { y: -1 } : {}}
                      className="flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80"
                      style={
                        selectedEntry && !editConfirmedWinner
                          ? replayCtaStyle("calendar")
                          : { borderColor: "var(--border)", color: "var(--subtle)", pointerEvents: "none", opacity: 0.4 }
                      }
                    >
                      <Calendar className="size-3" />{replayActive ? "Add to calendar" : "Calendar"}
                    </motion.a>
                  </div>
                </div>



                {/* Contact chips */}
                {(selectedEntry.phone || selectedEntry.whatsappNumber || selectedEntry.websiteUrl) && (
                  <div className="flex flex-wrap gap-2 border-t px-5 py-3" style={{ borderColor: "var(--border)" }}>
                    {selectedEntry.phone && (
                      <span
                        className="rounded-full border px-3 py-1.5 text-[10px] font-semibold"
                        style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                      >
                        📞 {selectedEntry.phone}
                      </span>
                    )}
                    {selectedEntry.whatsappNumber && (
                      <span
                        className="rounded-full border px-3 py-1.5 text-[10px] font-semibold"
                        style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                      >
                        💬 {selectedEntry.whatsappNumber}
                      </span>
                    )}
                    {selectedEntry.websiteUrl && (
                      <a
                        href={selectedEntry.websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border px-3 py-1.5 text-[10px] font-semibold transition-all hover:opacity-70"
                        style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                      >
                        🌐 Website
                      </a>
                    )}
                  </div>
                )}

                {/* Report text */}
                {reportText && (
                  <div className="border-t px-5 py-5" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>
                      Full report
                    </p>
                    <p className="mt-3 text-[13px] leading-[1.85]" style={{ color: "var(--fg)" }}>
                      {reportText}
                    </p>
                  </div>
                )}

                {/* Reason / outcome */}
                {selectedEntry.reason && (
                  <div className="border-t px-5 py-5" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>
                      Why this venue
                    </p>
                    <p className="mt-3 text-[13px] leading-[1.8]" style={{ color: "var(--muted)" }}>
                      {selectedEntry.reason}
                    </p>
                  </div>
                )}

                {/* Call outcome */}
                {selectedEntry.summaryEnglishText && (
                  <div className="border-t px-5 py-5" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>
                      Call outcome
                    </p>
                    <p className="mt-3 text-[13px] leading-[1.8]" style={{ color: "var(--muted)" }}>
                      {language === "source" ? selectedEntry.summarySourceText : selectedEntry.summaryEnglishText}
                    </p>
                  </div>
                )}

              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* ── Right sidebar — full-height ranking ── */}
      <aside className="min-h-0">
        {/* Decision board / ranking */}
        <section
          className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20px]"
          style={{ border: "1px solid var(--border)", background: "var(--card-strong)" }}
        >
          <div className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: "var(--subtle)" }}>
                  Ranking
                </p>
                <h2 className="mt-1 text-[15px] font-semibold tracking-[-0.02em]" style={{ color: "var(--fg)" }}>
                  {replayDecisionCards.length > 0 ? "Decision board" : winnerState && !editConfirmedWinner ? "View ranking" : "Decision board"}
                </h2>
              </div>
              {winnerState && !replayDecisionCards.length ? (
                <button
                  type="button"
                  onClick={() => setRankingExpanded((current) => !current)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] transition-all hover:opacity-80"
                  style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                >
                  {showRanking ? "Hide" : "View"}
                  <ChevronDown
                    className="size-3 transition-transform"
                    style={{ transform: showRanking ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>
              ) : null}
            </div>
          </div>
          <AnimatePresence mode="wait">
            {replayDecisionCards.length > 0 ? (
              <motion.div
                key="replay-decision-board"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={spring}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
              >
                {replayDecisionCards.map((card, index) => (
                  <motion.div
                    key={card.label}
                    initial={{ opacity: 0, y: 14, scale: 0.99 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: index * 0.06, ...springFast }}
                    className="rounded-[16px] border px-4 py-4"
                    style={{ borderColor: "var(--border)", background: "var(--card)" }}
                  >
                    <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>
                      {card.label}
                    </p>
                    <p className="mt-2.5 text-[12px] leading-[1.75]" style={{ color: "var(--fg)" }}>
                      {card.value}
                    </p>
                  </motion.div>
                ))}
              </motion.div>
            ) : showRanking ? (
              <motion.div
                key="ranking"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={spring}
                className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4"
              >
                {(decision?.ranking ?? []).map((entry, i) => {
                  const isActive = effectiveId === entry.candidateId;
                  return (
                    <motion.button
                      type="button"
                      key={entry.candidateId}
                      initial={{ opacity: 0, y: 18, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ delay: i * 0.06, ...springFast }}
                      whileHover={winnerState && !editConfirmedWinner ? {} : { y: -2, scale: 1.01 }}
                      whileTap={winnerState && !editConfirmedWinner ? {} : { scale: 0.98 }}
                      onClick={() => {
                        if (winnerState && !editConfirmedWinner) {
                          return;
                        }

                        setSelectedCandidateId(entry.candidateId);
                      }}
                      className="w-full rounded-[14px] border px-4 py-4 text-left transition-colors"
                      style={{
                        borderColor: isActive ? "var(--btn-bg)" : "var(--border)",
                        background: isActive ? "var(--accent-soft)" : "var(--card)",
                        cursor: winnerState && !editConfirmedWinner ? "default" : "pointer",
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold" style={{ color: "var(--fg)" }}>
                            {entry.displayName}
                          </p>
                          <p className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
                            {entry.locality || "Location pending"}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>
                            #{entry.rank}
                          </p>
                          <p className="mt-0.5 text-[13px] font-semibold" style={{ color: "var(--fg)" }}>
                            {Math.round(entry.score)}
                          </p>
                        </div>
                      </div>
                      {entry.reason && (
                        <p className="mt-2.5 text-[11px] leading-[1.65]" style={{ color: "var(--muted)" }}>
                          {entry.reason}
                        </p>
                      )}
                    </motion.button>
                  );
                })}
              </motion.div>
            ) : (
              <motion.div
                key="collapsed"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={spring}
                className="flex flex-1 flex-col items-center justify-center px-6 text-center"
              >
                <p className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>
                  The ranking is locked behind the confirmed recommendation.
                </p>
                <p className="mt-2 text-[11px] leading-[1.7]" style={{ color: "var(--subtle)" }}>
                  Open it if you need to audit the board or explicitly change the winner.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </aside>
    </div>
  );
}
