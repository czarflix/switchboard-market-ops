"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MoonStar, SunMedium } from "lucide-react";
import { useMemo, useSyncExternalStore, type CSSProperties } from "react";

export type MarketingTheme = "dark" | "light";

const STORAGE_KEY = "switchboard-public-theme";
const listeners = new Set<() => void>();

function systemTheme(): MarketingTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function readThemePreference(): MarketingTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : systemTheme();
}

function emitThemeChange() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  if (typeof window === "undefined") {
    return () => listeners.delete(listener);
  }

  const media = window.matchMedia("(prefers-color-scheme: light)");
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      listener();
    }
  };
  const handleMedia = () => {
    if (!window.localStorage.getItem(STORAGE_KEY)) {
      listener();
    }
  };

  window.addEventListener("storage", handleStorage);
  media.addEventListener("change", handleMedia);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
    media.removeEventListener("change", handleMedia);
  };
}

export function useMarketingTheme() {
  const theme = useSyncExternalStore<MarketingTheme>(
    subscribe,
    readThemePreference,
    () => "dark",
  );

  const style = useMemo<CSSProperties>(() => {
    if (theme === "light") {
      return {
        colorScheme: "light",
        "--marketing-bg": "#f6f8fc",
        "--marketing-fg": "#09111f",
        "--marketing-muted": "rgba(9,17,31,0.68)",
        "--marketing-subtle": "rgba(9,17,31,0.44)",
        "--marketing-card": "rgba(255,255,255,0.68)",
        "--marketing-card-strong": "rgba(255,255,255,0.92)",
        "--marketing-border": "rgba(9,17,31,0.08)",
        "--marketing-grid": "rgba(9,17,31,0.06)",
        "--marketing-accent": "#2d5bff",
        "--marketing-accent-soft": "rgba(45,91,255,0.12)",
        "--marketing-accent-alt": "#00b487",
        "--marketing-button-bg": "#09111f",
        "--marketing-button-fg": "#f8fbff",
        "--marketing-button-muted": "rgba(9,17,31,0.06)",
        "--marketing-shadow": "0 24px 80px rgba(9,17,31,0.08)",
      } as CSSProperties;
    }

    return {
      colorScheme: "dark",
      "--marketing-bg": "#07111d",
      "--marketing-fg": "#f4f7fb",
      "--marketing-muted": "rgba(244,247,251,0.7)",
      "--marketing-subtle": "rgba(244,247,251,0.46)",
      "--marketing-card": "rgba(255,255,255,0.05)",
      "--marketing-card-strong": "rgba(255,255,255,0.08)",
      "--marketing-border": "rgba(255,255,255,0.10)",
      "--marketing-grid": "rgba(255,255,255,0.05)",
      "--marketing-accent": "#8ba9ff",
      "--marketing-accent-soft": "rgba(132,163,255,0.14)",
      "--marketing-accent-alt": "#38d9aa",
      "--marketing-button-bg": "#f4f7fb",
      "--marketing-button-fg": "#07111d",
      "--marketing-button-muted": "rgba(255,255,255,0.06)",
      "--marketing-shadow": "0 30px 100px rgba(0,0,0,0.28)",
    } as CSSProperties;
  }, [theme]);

  return {
    theme,
    style,
    toggleTheme() {
      if (typeof window === "undefined") {
        return;
      }

      const nextTheme = theme === "dark" ? "light" : "dark";
      window.localStorage.setItem(STORAGE_KEY, nextTheme);
      emitThemeChange();
    },
  };
}

export function ThemeSwitch({
  theme,
  onToggle,
}: {
  theme: MarketingTheme;
  onToggle: () => void;
}) {
  return (
    <button
      aria-label="Toggle light and dark mode"
      className="inline-flex h-11 items-center gap-3 rounded-full border border-[color:var(--marketing-border)] bg-[color:var(--marketing-card)] px-4 text-sm text-[color:var(--marketing-fg)] shadow-[var(--marketing-shadow)] backdrop-blur-xl transition hover:bg-[color:var(--marketing-card-strong)]"
      onClick={onToggle}
      type="button"
    >
      <span className="relative inline-flex size-5 items-center justify-center overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.span
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: -20, scale: 0.7 }}
            initial={{ opacity: 0, rotate: 20, scale: 0.7 }}
            key={theme}
            transition={{ duration: 0.22 }}
          >
            {theme === "dark" ? (
              <MoonStar className="size-4" />
            ) : (
              <SunMedium className="size-4" />
            )}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--marketing-subtle)]">
        {theme}
      </span>
    </button>
  );
}
