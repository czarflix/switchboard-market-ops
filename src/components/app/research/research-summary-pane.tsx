import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CheckCircle2, LoaderCircle, Plus } from "lucide-react";

import { workspaceSpring as spring } from "@/components/app/workspace/workspace-motion";
import type { ResearchBrief, ResearchSessionStatus, ScopeStatus } from "./types";

function scopeBorderColor(s: ScopeStatus | null) {
  if (s === "supported")    return "rgba(34,197,94,0.3)";
  if (s === "adjacent")     return "rgba(245,158,11,0.3)";
  if (s === "out_of_scope") return "rgba(239,68,68,0.3)";
  return "var(--border)";
}

export function ResearchSummaryPane({
  brief,
  status,
  scopeStatus,
  statusNotice,
  ready,
  missingFields,
  actionPending,
  startFreshDisabled,
  statusOverride,
  readyOverride,
  draftSummaryText,
  draftQueryPreviewText,
  onProceed,
  onStartFresh,
}: {
  brief: ResearchBrief | null;
  status: ResearchSessionStatus | null;
  scopeStatus: ScopeStatus | null;
  statusNotice?: string | null;
  ready: boolean;
  missingFields: string[];
  actionPending: boolean;
  startFreshDisabled?: boolean;
  statusOverride?: ResearchSessionStatus | null;
  readyOverride?: boolean;
  draftSummaryText?: string | null;
  draftQueryPreviewText?: string | null;
  onProceed: () => void;
  onStartFresh: () => void;
}) {
  const effectiveStatus = statusOverride ?? status;
  const confirmed = effectiveStatus === "confirmed";
  const summaryText = (draftSummaryText ?? brief?.summary ?? "").trim();
  const queryPreviewText = (draftQueryPreviewText ?? brief?.marketQueryPreview ?? "").trim();
  const hasSummary =
    Boolean(summaryText) &&
    (effectiveStatus === "review" || effectiveStatus === "confirmed" || Boolean(draftSummaryText));
  const effectiveReady = readyOverride ?? ready;
  const proceedLabel = confirmed ? "Open market" : "Proceed to market";

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
            Summary
          </p>
          <h2
            className="mt-0.5 font-serif leading-tight tracking-[-0.03em]"
            style={{ fontSize: "clamp(1.3rem, 2.2vw, 1.8rem)", color: "var(--fg)" }}
          >
            Research brief
          </h2>
        </div>

        {/* Status pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em]"
            style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
          >
            {confirmed ? "Confirmed" : effectiveStatus === "review" ? "Review" : "Collecting"}
          </span>
          {scopeStatus && (
            <span
              className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em]"
              style={{
                color: "var(--fg)",
                border: `1px solid ${scopeBorderColor(scopeStatus)}`,
              }}
            >
              {scopeStatus.replace("_", " ")}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {statusNotice ? (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={spring}
            className="mb-4 rounded-[14px] border px-4 py-3 text-[12px] font-semibold"
            style={{
              borderColor: "rgba(216,202,179,0.24)",
              background: "linear-gradient(135deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))",
              color: "var(--fg)",
            }}
          >
            {statusNotice}
          </motion.div>
        ) : null}
        <AnimatePresence mode="wait">
          {hasSummary && summaryText ? (
            <motion.div
              key="summary"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={spring}
              className="flex flex-col gap-4"
            >
              {/* Written summary — the main content */}
              <p className="text-[14px] leading-[1.8]" style={{ color: "var(--fg)" }}>
                {summaryText}
              </p>

              {/* Market query preview — secondary, understated */}
              {queryPreviewText && (
                <div
                  className="rounded-[12px] border px-4 py-3"
                  style={{ borderColor: "var(--border)", background: "var(--card)" }}
                >
                  <p className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--subtle)" }}>
                    Query preview
                  </p>
                  <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
                    {queryPreviewText}
                  </p>
                </div>
              )}

              {/* Missing fields (shouldn't be any at this point but guard just in case) */}
              {missingFields.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <p className="w-full text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "var(--subtle)" }}>
                    Still missing
                  </p>
                  {missingFields.map((f) => (
                    <span
                      key={f}
                      className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em]"
                      style={{ color: "var(--subtle)", border: "1px solid var(--border)" }}
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-1 flex-col items-center justify-center py-14 text-center"
            >
              <div
                className="mx-auto mb-4 flex size-10 items-center justify-center rounded-full"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <span className="text-[10px] font-black" style={{ color: "var(--subtle)" }}>
                  {missingFields.length > 0 ? missingFields.length : "—"}
                </span>
              </div>
              <p className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
                {missingFields.length > 0 ? "Intake in progress" : "Almost there"}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--subtle)" }}>
                {missingFields.length > 0
                  ? `${missingFields.length} field${missingFields.length > 1 ? "s" : ""} remaining`
                  : "Waiting for session to end"}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={onStartFresh}
          disabled={actionPending || startFreshDisabled}
          className="inline-flex items-center gap-2 rounded-full px-3.5 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-75 disabled:opacity-40"
          style={{ color: "var(--muted)", background: "transparent", border: "1px solid var(--border)" }}
        >
          <Plus className="size-3.5" />
          Start fresh
        </button>

        <button
          type="button"
          onClick={onProceed}
          disabled={actionPending || !effectiveReady}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] transition-all hover:opacity-80 disabled:opacity-40"
          style={{ color: "var(--btn-fg)", background: "var(--btn-bg)" }}
        >
          {actionPending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : confirmed ? (
            <CheckCircle2 className="size-3.5" />
          ) : (
            <ArrowRight className="size-3.5" />
          )}
          {proceedLabel}
        </button>
      </div>
    </div>
  );
}
