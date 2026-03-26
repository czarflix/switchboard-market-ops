import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, Mic, Plus, ShieldAlert } from "lucide-react";
import { useRef } from "react";

import { useShellTheme } from "@/components/marketing/marketing-shell";
import { ProviderLockup } from "@/components/marketing/provider-badges";
import { ResearchTranscriptSplit } from "./research-transcript-split";
import type { ResearchMessage, ResearchSessionStatus } from "./types";

type TransportState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "disconnected"
  | "error";

function statusPill(state: TransportState, hasSession: boolean) {
  if (state === "connected") return "Live";
  if (state === "connecting") return "Connecting";
  if (state === "disconnecting") return "Pausing";
  if (state === "disconnected") return hasSession ? "Paused" : "Ready";
  if (state === "error") return "Offline";
  return hasSession ? "Saved" : "Ready";
}

function actionLabel(
  status: ResearchSessionStatus | null,
  state: TransportState,
  hasSession: boolean,
  hasMessages: boolean,
) {
  if (!hasSession) return "Start intake";
  if (!hasMessages && status === "collecting" && (state === "idle" || state === "disconnected" || state === "error")) {
    return "Start intake";
  }
  if (status === "review" || status === "confirmed") return "Complete";
  if (state === "connected") return "Listening…";
  if (state === "connecting") return "Connecting…";
  if (state === "disconnecting") return "Finishing…";
  return "Resume intake";
}

const spring = { type: "spring", damping: 22, stiffness: 160 } as const;

export function ResearchVoiceCard({
  hasSession,
  sessionStatus,
  resumeCandidate,
  transportState,
  speaking,
  pending,
  notice,
  error,
  messages,
  syncLabel,
  forcePrimaryEnabled = false,
  disableStartFresh = false,
  recordingReplayTrigger,
  onPrimaryAction,
  onResumeLatest,
  onStartFresh,
}: {
  hasSession: boolean;
  sessionStatus: ResearchSessionStatus | null;
  resumeCandidate?: {
    id: string;
    status: ResearchSessionStatus;
    updatedAt: string | null;
  } | null;
  transportState: TransportState;
  speaking: boolean;
  pending: boolean;
  notice: string | null;
  error: string | null;
  messages: ResearchMessage[];
  syncLabel: string;
  forcePrimaryEnabled?: boolean;
  disableStartFresh?: boolean;
  recordingReplayTrigger?: {
    visible: boolean;
    label: string;
    onTrigger: () => void;
  } | null;
  onPrimaryAction: () => void;
  onResumeLatest?: () => void;
  onStartFresh: () => void;
}) {
  const intakeComplete = sessionStatus === "review" || sessionStatus === "confirmed";
  const live = transportState === "connected";
  const transportBusy = transportState === "connecting" || transportState === "disconnecting";
  const primaryDisabled = forcePrimaryEnabled
    ? false
    : pending || intakeComplete || live || transportBusy;
  const showResumeLatest = !hasSession && Boolean(resumeCandidate);
  const hasMessages = messages.length > 0;
  const transcriptViewportRef = useRef<HTMLDivElement | null>(null);
  const startFreshDisabled = pending || transportBusy || live || disableStartFresh;
  const { theme } = useShellTheme();

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden rounded-[20px]"
      style={{ border: "1px solid var(--border)", background: "var(--card-strong)" }}
    >
      {/* Header */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: "var(--subtle)" }}>
            Research intake
          </p>
          <h1
            className="mt-0.5 font-serif leading-tight tracking-[-0.03em]"
            style={{ fontSize: "clamp(1.3rem, 2.2vw, 1.8rem)", color: "var(--fg)" }}
          >
            Voice concierge
          </h1>
          <div className="mt-3">
            <ProviderLockup
              compact
              subdued
              suffix={
                <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>
                  Powered by ElevenLabs / ElevenAgents
                </span>
              }
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Transport status pill */}
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em]"
            style={{
              color: live ? "var(--btn-fg)" : "var(--muted)",
              background: live ? "var(--btn-bg)" : "transparent",
              border: "1px solid var(--border)",
            }}
          >
            {live && (
              <span
                className="size-1.5 rounded-full animate-pulse"
                style={{ background: "var(--btn-fg)" }}
              />
            )}
            {statusPill(transportState, hasSession)}
          </span>

          {/* Start fresh */}
          <button
            type="button"
            onClick={onStartFresh}
            disabled={startFreshDisabled}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-75 disabled:opacity-40"
            style={{ color: "var(--muted)", border: "1px solid var(--border)", background: "transparent" }}
          >
            <Plus className="size-3" />
            New
          </button>
        </div>
      </div>

      {/* Transcript area */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Sync label */}
        <div className="absolute right-4 top-3 z-10 flex flex-col items-end gap-2">
          <p className="text-[10px]" style={{ color: "var(--subtle)" }}>{syncLabel}</p>
          {recordingReplayTrigger?.visible ? (
            <button
              type="button"
              onClick={recordingReplayTrigger.onTrigger}
              className="rounded-full px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.2em] transition-all hover:-translate-y-0.5 hover:opacity-95"
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
              {recordingReplayTrigger.label}
            </button>
          ) : null}
        </div>

        <div
          ref={transcriptViewportRef}
          className="h-full overflow-y-auto overscroll-contain px-5 pb-20 pt-5"
        >
          <ResearchTranscriptSplit messages={messages} viewportRef={transcriptViewportRef} />
        </div>

        {/* Mic button — floating at bottom center */}
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2">
          <button
            type="button"
            onClick={onPrimaryAction}
            disabled={primaryDisabled}
            aria-label={actionLabel(sessionStatus, transportState, hasSession, hasMessages)}
            className="relative flex size-14 items-center justify-center rounded-full transition-all duration-200 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
            style={
              speaking
                ? {
                    background: "rgba(180,45,35,0.9)",
                    color: "#fff6f5",
                    border: "1px solid rgba(220,80,70,0.4)",
                    boxShadow: "0 20px 48px rgba(120,20,18,0.28)",
                  }
                : live
                ? {
                    background: "var(--btn-bg)",
                    color: "var(--btn-fg)",
                    border: "1px solid var(--border)",
                    boxShadow: "0 16px 40px rgba(0,0,0,0.14)",
                  }
                : {
                    background: "var(--card)",
                    color: "var(--fg)",
                    border: "1px solid var(--border)",
                    boxShadow: "0 16px 40px rgba(0,0,0,0.10)",
                  }
            }
          >
            {(live || speaking) && !intakeComplete && (
              <span
                className="absolute inset-0 rounded-full border border-current opacity-20 animate-ping"
                aria-hidden
              />
            )}
            {pending ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <Mic className="size-5" />
            )}
          </button>
        </div>
      </div>

      {/* Footer bar */}
      <div className="border-t px-5 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center gap-3">
          {/* Primary CTA */}
          <button
            type="button"
            onClick={onPrimaryAction}
            disabled={primaryDisabled}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80 disabled:opacity-40"
            style={{ color: "var(--btn-fg)", background: "var(--btn-bg)" }}
          >
            {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
            {actionLabel(sessionStatus, transportState, hasSession, hasMessages)}
          </button>

          {showResumeLatest && onResumeLatest ? (
            <button
              type="button"
              onClick={onResumeLatest}
              disabled={pending || transportBusy || live}
              className="inline-flex items-center gap-2 rounded-full px-3.5 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--muted)", background: "transparent", border: "1px solid var(--border)" }}
            >
              Resume latest
            </button>
          ) : null}

          {/* Notices / errors */}
          <AnimatePresence mode="wait">
            {error ? (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={spring}
                className="flex min-w-0 items-center gap-2"
              >
                <ShieldAlert className="size-3.5 shrink-0" style={{ color: "#b45309" }} />
                <p className="truncate text-[11px]" style={{ color: "#b45309" }}>{error}</p>
              </motion.div>
            ) : notice ? (
              <motion.p
                key="notice"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={spring}
                className="min-w-0 truncate text-[11px]"
                style={{ color: "var(--muted)" }}
              >
                {notice}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
