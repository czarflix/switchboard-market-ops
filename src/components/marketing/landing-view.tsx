"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Database,
  Phone,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { type CSSProperties } from "react";

import { MarketingShell, useShellTheme, type Theme } from "@/components/marketing/marketing-shell";
import { ProviderLockup } from "@/components/marketing/provider-badges";

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = [
  { id: "research", phase: "01", label: "Intake", body: "A voice concierge captures the brief once, then hands it off cleanly.", icon: Database },
  { id: "call",     phase: "02", label: "Call",     body: "Switchboard simulates the outreach board in parallel and returns narrated transcript lanes.", icon: Phone },
  { id: "decide",   phase: "03", label: "Decide",   body: "One ranked recommendation lands in your inbox.", icon: Sparkles },
] as const;

const spring = { type: "spring", damping: 22, stiffness: 160 } as const;
const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.65, delay, ease: [0.16, 1, 0.3, 1] as const },
});

// ─── Step Row ────────────────────────────────────────────────────────────────

function StepRow({ step, index }: { step: typeof STEPS[number]; index: number }) {
  const Icon = step.icon;
  const isLast = index === STEPS.length - 1;

  return (
    <motion.div {...fadeUp(0.5 + index * 0.14)} className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <motion.div
          className="flex size-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: "var(--card-strong)", border: "1px solid var(--border)" }}
          whileHover={{ scale: 1.06 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
        >
          <Icon className="size-5" style={{ color: index === 1 ? "var(--fg)" : "var(--subtle)" }} />
        </motion.div>
        {!isLast && (
          <motion.div
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.5, delay: 0.6 + index * 0.14, ease: "easeOut" }}
            className="mt-1 w-px flex-1"
            style={{ background: "linear-gradient(to bottom, var(--border) 60%, transparent)", transformOrigin: "top" }}
          />
        )}
      </div>

      <div className="pb-6">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold" style={{ color: "var(--subtle)" }}>
            {step.phase}
          </span>
          {index === 1 && (
            <motion.span
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.15em]"
              style={{ background: "var(--card-strong)", color: "var(--fg)", border: "1px solid var(--border)" }}
            >
              Running
            </motion.span>
          )}
        </div>
        <p className="text-[15px] font-bold leading-tight" style={{ color: "var(--fg)" }}>
          {step.label}
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
          {step.body}
        </p>
      </div>
    </motion.div>
  );
}

// ─── Sequence Card ────────────────────────────────────────────────────────────

function SequenceCard({ theme }: { theme: Theme }) {
  const isDark = theme === "dark";
  return (
    <motion.div
      className="relative hidden lg:block"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.3 }}
    >
      <div
        className="relative overflow-hidden rounded-[24px] p-7"
        style={{
          background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.88)",
          border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)"}`,
          boxShadow: isDark
            ? "0 2px 0 rgba(255,255,255,0.06) inset, 0 40px 80px rgba(0,0,0,0.4)"
            : "0 2px 0 rgba(255,255,255,1) inset, 0 20px 60px rgba(0,0,0,0.08)",
          backdropFilter: "blur(20px) saturate(180%)",
        }}
      >
        {/* Top edge highlight */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background: isDark
              ? "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)"
              : "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)",
          }}
        />

        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: "var(--subtle)" }}>
              Process
            </p>
            <h2 className="font-serif text-xl font-bold leading-tight" style={{ color: "var(--fg)" }}>
              The Sequence
            </h2>
          </div>
          {/* Live badge — neutral */}
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ background: "var(--card-strong)", border: "1px solid var(--border)" }}
          >
            <motion.span
              animate={{ opacity: [1, 0.15, 1] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
              className="block size-1.5 rounded-full"
              style={{ background: "var(--fg)" }}
            />
            <span className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>
              Live
            </span>
          </div>
        </div>

        {/* Steps */}
        <div className="flex flex-col">
          {STEPS.map((step, i) => (
            <StepRow key={step.id} step={step} index={i} />
          ))}
        </div>

        {/* Brand strip */}
        <div className="mt-3">
          <ProviderLockup
            compact
            subdued
            suffix={
              <span className="text-[9px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--subtle)" }}>
                Switchboard demo stack
              </span>
            }
          />
        </div>
      </div>
    </motion.div>
  );
}

// ─── Hero (inner content) ─────────────────────────────────────────────────────

function HeroContent({ authenticated }: { authenticated: boolean }) {
  const { theme } = useShellTheme();
  const primaryHref = authenticated ? "/research" : "/login?next=/research";

  return (
    <section className="flex min-h-0 flex-1 items-center py-2 lg:py-3">
      <div className="grid h-full w-full items-center gap-6 lg:grid-cols-[1.35fr_1fr] lg:gap-16">

        {/* Left */}
        <div className="flex flex-col gap-6">
          <div className="overflow-hidden">
            <motion.h1
              className="font-serif leading-[0.88] tracking-[-0.04em]"
              style={{ fontSize: "clamp(3rem, 9.5vh, 6rem)", color: "var(--fg)" }}
              initial={{ y: "105%" }}
              animate={{ y: 0 }}
              transition={{ ...spring, delay: 0.15 }}
            >
              AI makes the calls.
              <br />
              <span style={{ color: "var(--accent)" }}>You</span> make the final one.
            </motion.h1>
          </div>

          <motion.p
            className="max-w-lg text-base font-medium leading-relaxed lg:text-lg"
            style={{ color: "var(--muted)" }}
            {...fadeUp(0.4)}
          >
            One brief in. Live local market intelligence out. ElevenLabs and ElevenAgents capture the ask, Firecrawl sweeps the web, and Switchboard brings back the one option worth moving on.
          </motion.p>

          <motion.div {...fadeUp(0.6)}>
            <Link
              href={primaryHref}
              prefetch={false}
              className="group inline-flex items-center gap-3 rounded-full px-8 py-3.5 text-[15px] font-bold transition-all hover:scale-[1.02] active:scale-[0.98] lg:px-10 lg:py-4"
              style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" } as CSSProperties}
            >
              {authenticated ? "Open Operator" : "Launch Switchboard"}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </motion.div>
        </div>

        {/* Right */}
        <SequenceCard theme={theme} />
      </div>
    </section>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function LandingView({ authenticated }: { authenticated: boolean }) {
  return (
    <MarketingShell authenticated={authenticated} className="h-[100dvh] overflow-hidden">
      <HeroContent authenticated={authenticated} />
    </MarketingShell>
  );
}
