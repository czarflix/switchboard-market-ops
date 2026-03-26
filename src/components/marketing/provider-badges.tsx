"use client";

import type { CSSProperties, ReactNode } from "react";

export function ElevenLabsGlyph({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <rect x="6.5" y="3" width="3" height="18" rx="1.5" />
      <rect x="14.5" y="3" width="3" height="18" rx="1.5" />
    </svg>
  );
}

export function FirecrawlGlyph({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M12 2s-6.5 5-6.5 10.5a6.5 6.5 0 0 0 13 0C18.5 7 12 2 12 2Zm0 15a3.5 3.5 0 0 1-3.5-3.5c0-2.8 2.2-5.3 3.5-6.8 1.3 1.5 3.5 4 3.5 6.8A3.5 3.5 0 0 1 12 17Z" />
    </svg>
  );
}

export function ProviderLockup({
  compact = false,
  subdued = false,
  suffix,
}: {
  compact?: boolean;
  subdued?: boolean;
  suffix?: ReactNode;
}) {
  const iconColor = subdued ? "var(--muted)" : "var(--fg)";
  const textColor = subdued ? "var(--muted)" : "var(--fg)";

  return (
    <div
      className={`inline-flex items-center rounded-full border ${compact ? "gap-2 px-3 py-1.5" : "gap-2.5 px-4 py-2"}`}
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div className="inline-flex items-center gap-1.5">
        <ElevenLabsGlyph className={compact ? "size-3" : "size-3.5"} style={{ color: iconColor }} />
        <span
          className={compact ? "text-[10px] font-black uppercase tracking-[0.18em]" : "text-[11px] font-black uppercase tracking-[0.2em]"}
          style={{ color: textColor }}
        >
          ElevenLabs
        </span>
      </div>
      <span className="text-[9px] font-black opacity-35" style={{ color: "var(--fg)" }}>
        ×
      </span>
      <div className="inline-flex items-center gap-1.5">
        <FirecrawlGlyph className={compact ? "size-3" : "size-3.5"} style={{ color: iconColor }} />
        <span
          className={compact ? "text-[10px] font-black uppercase tracking-[0.18em]" : "text-[11px] font-black uppercase tracking-[0.2em]"}
          style={{ color: textColor }}
        >
          Firecrawl
        </span>
      </div>
      {suffix ? (
        <>
          <span className="text-[9px] font-black opacity-35" style={{ color: "var(--fg)" }}>
            ·
          </span>
          <div className="inline-flex items-center">{suffix}</div>
        </>
      ) : null}
    </div>
  );
}
