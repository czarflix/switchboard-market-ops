"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Github, Linkedin, Moon, Sun, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ReactNode,
  createContext,
  useEffect,
  use,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

import { ProviderLockup } from "@/components/marketing/provider-badges";

// ─── Theme system ─────────────────────────────────────────────────────────────

export type Theme = "dark" | "light";
const STORAGE_KEY = "switchboard-public-theme";
const CHUNK_RELOAD_PREFIX = "switchboard-chunk-reload:";
const listeners = new Set<() => void>();

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function readTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : getSystemTheme();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) cb(); };
  const onMedia = () => { if (!window.localStorage.getItem(STORAGE_KEY)) cb(); };
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onMedia);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onMedia);
  };
}

export const THEMES: Record<Theme, CSSProperties> = {
  dark: {
    colorScheme: "dark",
    // True near-black — no navy, no AI-blue
    "--bg":           "#0e0e0e",
    "--fg":           "#eeebe4",         // warm-white, not cold blue-white
    "--muted":        "rgba(238,235,228,0.6)",
    "--subtle":       "rgba(238,235,228,0.35)",
    "--card":         "rgba(255,255,255,0.04)",
    "--card-strong":  "rgba(255,255,255,0.07)",
    "--border":       "rgba(255,255,255,0.08)",
    "--accent":       "#c9b896",         // warm sand — editorial, not AI-purple
    "--accent-soft":  "rgba(201,184,150,0.12)",
    "--btn-bg":       "#eeebe4",
    "--btn-fg":       "#0e0e0e",
    "--shadow":       "0 24px 60px rgba(0,0,0,0.5)",
    "--background":   "#0e0e0e",
    "--foreground":   "#eeebe4",
    "--panel":        "rgba(255,255,255,0.045)",
    "--panel-soft":   "rgba(255,255,255,0.03)",
    "--panel-strong": "rgba(255,255,255,0.08)",
    "--border-strong":"rgba(255,255,255,0.16)",
    "--brand":        "#c9b896",
    "--brand-strong": "#d8c39a",
    "--brand-foreground": "#0e0e0e",
    "--ink":          "#151515",
    "--ink-soft":     "#1d1d1d",
    "--ink-foreground":"#eeebe4",
    "--accent-strong":"#c9b896",
    "--shadow-soft":  "0 20px 60px rgba(0,0,0,0.32)",
    "--shadow-strong":"0 28px 80px rgba(0,0,0,0.45)",
  } as CSSProperties,
  light: {
    colorScheme: "light",
    "--bg":           "#f5f6fa",
    "--fg":           "#09111f",
    "--muted":        "rgba(9,17,31,0.72)",
    "--subtle":       "rgba(9,17,31,0.52)",
    "--card":         "rgba(255,255,255,0.78)",
    "--card-strong":  "rgba(255,255,255,0.96)",
    "--border":       "rgba(9,17,31,0.09)",
    "--accent":       "#4f46e5",
    "--accent-soft":  "rgba(79,70,229,0.1)",
    "--btn-bg":       "#09111f",
    "--btn-fg":       "#f5f6fa",
    "--shadow":       "0 20px 60px rgba(9,17,31,0.08)",
    "--background":   "#f5f6fa",
    "--foreground":   "#09111f",
    "--panel":        "rgba(255,255,255,0.82)",
    "--panel-soft":   "rgba(255,255,255,0.72)",
    "--panel-strong": "rgba(255,255,255,0.96)",
    "--border-strong":"rgba(9,17,31,0.14)",
    "--brand":        "#09111f",
    "--brand-strong": "#1b2640",
    "--brand-foreground": "#f5f6fa",
    "--ink":          "#09111f",
    "--ink-soft":     "#172133",
    "--ink-foreground":"#f5f6fa",
    "--accent-strong":"#4f46e5",
    "--shadow-soft":  "0 18px 48px rgba(9,17,31,0.08)",
    "--shadow-strong":"0 26px 72px rgba(9,17,31,0.12)",
  } as CSSProperties,
};

// Context so children can read the theme without prop-drilling
export const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

export function useShellTheme() {
  return use(ThemeCtx);
}

// ─── Social links ─────────────────────────────────────────────────────────────

const SOCIAL = [
  { href: "https://github.com/czarflix",                 label: "GitHub",   Icon: Github   },
  { href: "https://www.linkedin.com/in/ayaan2001/",     label: "LinkedIn", Icon: Linkedin },
] as const;

// ─── Theme toggle ─────────────────────────────────────────────────────────────
// Icon color inherits from button text — always legible, never themed with orange/purple.

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const isDark = theme === "dark";
  return (
    <button
      aria-label="Toggle theme"
      onClick={onToggle}
      type="button"
      className="inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-opacity hover:opacity-65"
      style={{
          backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
          borderColor:     isDark ? "rgba(255,255,255,0.1)"  : "rgba(0,0,0,0.1)",
          color:           isDark ? "rgba(244,247,251,0.75)" : "rgba(9,17,31,0.55)",
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.18, ease: "easeInOut" }}
          className="flex items-center"
        >
          {isDark
            ? <Moon className="size-3.5" />     /* inherits the muted color above */
            : <Sun  className="size-3.5" />     /* inherits the muted color above — no orange */
          }
        </motion.span>
      </AnimatePresence>
      {theme}
    </button>
  );
}

// ─── Shared Header ────────────────────────────────────────────────────────────

function Header({
  theme,
  toggle,
  authenticated,
  authenticatedNav,
  authenticatedMeta,
  authenticatedAction,
}: {
  theme: Theme;
  toggle: () => void;
  authenticated?: boolean;
  authenticatedNav?: ReactNode;
  authenticatedMeta?: ReactNode;
  authenticatedAction?: ReactNode;
}) {
  return (
    <header
      className="flex shrink-0 flex-col gap-3"
      style={{ minHeight: authenticated ? "72px" : "56px" }}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-70">
          <div
            className="flex size-9 items-center justify-center rounded-xl"
            style={{ background: "var(--fg)", color: "var(--bg)" } as CSSProperties}
          >
            <Zap className="size-[18px] fill-current" />
          </div>
          <span className="font-serif text-lg font-bold tracking-tight" style={{ color: "var(--fg)" }}>
            Switchboard
          </span>
        </Link>

        {/* Right — no social icons here, footer only */}
        <div className="flex flex-wrap items-center justify-end gap-3 lg:gap-4">
          {/* Partner pill */}
          <div className="hidden lg:flex">
            <ProviderLockup
              compact
              subdued
              suffix={
                <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--subtle)" }}>
                  Voice + web market data
                </span>
              }
            />
          </div>

          <div className="hidden h-4 w-px lg:block" style={{ background: "var(--border)" }} />

          <ThemeToggle theme={theme} onToggle={toggle} />

          {authenticated ? (
            <div className="flex flex-wrap items-center gap-2">
              {authenticatedNav}
              {authenticatedAction}
            </div>
          ) : (
            <Link
              href="/login"
              className="text-[14px] font-bold transition-opacity hover:opacity-60"
              style={{ color: "var(--fg)" }}
            >
              Sign in
            </Link>
          )}
        </div>
      </div>

      {authenticated && authenticatedMeta ? (
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold uppercase tracking-[0.18em]">
          {authenticatedMeta}
        </div>
      ) : null}
    </header>
  );
}

// ─── Shared Footer ────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer
      className="flex shrink-0 items-center justify-between border-t py-3 text-[11px] lg:py-0 lg:h-14"
      style={{ borderColor: "var(--border)", color: "var(--subtle)" }}
    >
      <div className="flex items-center gap-3">
        <span style={{ color: "var(--muted)" }}>© 2026 Switchboard</span>
        <span className="opacity-30" style={{ color: "var(--fg)" }}>·</span>
        <ProviderLockup compact subdued />
      </div>

      <div className="flex items-center gap-4">
        {SOCIAL.map(({ href, label, Icon }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            className="transition-opacity hover:opacity-60"
            style={{ color: "var(--muted)" }}
          >
            <Icon className="size-4" />
          </a>
        ))}
      </div>
    </footer>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export function MarketingShell({
  children,
  authenticated,
  authenticatedNav,
  authenticatedMeta,
  authenticatedAction,
  className = "",
}: {
  children: ReactNode;
  authenticated?: boolean;
  authenticatedNav?: ReactNode;
  authenticatedMeta?: ReactNode;
  authenticatedAction?: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const theme = useSyncExternalStore<Theme>(subscribe, readTheme, () => "dark");
  const themeStyle = useMemo(() => THEMES[theme], [theme]);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(STORAGE_KEY, next);
    listeners.forEach((cb) => cb());
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.removeItem(`${CHUNK_RELOAD_PREFIX}${pathname}`);
  }, [pathname]);

  return (
    <ThemeCtx value={{ theme, toggle }}>
      <div
        className={`relative flex min-h-[100dvh] flex-col select-none ${className}`}
        style={{ ...themeStyle, background: "var(--bg)", color: "var(--fg)" } as CSSProperties}
      >
        {/* Background */}
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          {/* Dot grid — neutral, no color */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
          {/* No colored gradient — clean neutral background */}
        </div>

        {/* Content */}
        <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[1440px] flex-1 flex-col px-6 py-3 lg:px-14 lg:py-5">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <Header
              theme={theme}
              toggle={toggle}
              authenticated={authenticated}
              authenticatedNav={authenticatedNav}
              authenticatedMeta={authenticatedMeta}
              authenticatedAction={authenticatedAction}
            />
          </motion.div>

          <div className="flex min-h-0 flex-1 flex-col">
            {children}
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1 }}
          >
            <Footer />
          </motion.div>
        </div>
      </div>
    </ThemeCtx>
  );
}
