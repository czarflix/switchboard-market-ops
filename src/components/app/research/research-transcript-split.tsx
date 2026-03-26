"use client";

import { useEffect, useRef, type RefObject } from "react";

import type { ResearchMessage } from "./types";

function formatTime(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(d);
}

export function ResearchTranscriptSplit({
  messages,
  viewportRef,
}: {
  messages: ResearchMessage[];
  viewportRef?: RefObject<HTMLDivElement | null>;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const viewport = viewportRef?.current;

    if (viewport) {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: messages.length > 1 ? "smooth" : "auto",
      });
      return;
    }

    endRef.current?.scrollIntoView({
      block: "end",
      behavior: messages.length > 1 ? "smooth" : "auto",
    });
  }, [messages, viewportRef]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-16 text-center">
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--subtle)" }}>
          The voice transcript will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pb-4">
      {messages.map((msg) => {
        const isUser   = msg.role === "user";
        const isAgent  = msg.role === "agent";
        const isSystem = !isUser && !isAgent;

        if (isSystem) {
          // System messages: centred, muted, no bubble
          return (
            <div key={msg.stableKey ?? msg.id} className="flex justify-center py-1">
              <p
                className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em]"
                style={{
                  color: "var(--subtle)",
                  border: "1px solid var(--border)",
                }}
              >
                {msg.content}
              </p>
            </div>
          );
        }

        return (
          <div
            key={msg.stableKey ?? msg.id}
            className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
          >
            {/* Agent avatar dot */}
            {isAgent && (
              <div className="mr-2 mt-1 flex shrink-0 items-start">
                <span
                  className="flex size-6 items-center justify-center rounded-full text-[9px] font-black"
                  style={{ background: "var(--btn-bg)", color: "var(--btn-fg)" }}
                >
                  A
                </span>
              </div>
            )}

            <div className={`flex max-w-[72%] flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
              {/* Role label */}
              <span
                className="px-1 text-[9px] font-black uppercase tracking-[0.18em]"
                style={{ color: "var(--subtle)" }}
              >
                {isUser ? "You" : "Switchboard"}
              </span>

              {/* Bubble */}
              <div
                className="rounded-[16px] px-4 py-3 text-[13px] leading-relaxed"
                style={
                  isUser
                    ? {
                        background: "var(--btn-bg)",
                        color: "var(--btn-fg)",
                        borderBottomRightRadius: "4px",
                      }
                    : {
                        background: "var(--card)",
                        color: "var(--fg)",
                        border: "1px solid var(--border)",
                        borderBottomLeftRadius: "4px",
                      }
                }
              >
                {msg.content}
              </div>

              {/* Timestamp */}
              {formatTime(msg.createdAt) && (
                <span
                  className="px-1 text-[9px]"
                  style={{ color: "var(--subtle)" }}
                >
                  {formatTime(msg.createdAt)}
                </span>
              )}
            </div>

            {/* User avatar dot */}
            {isUser && (
              <div className="ml-2 mt-1 flex shrink-0 items-start">
                <span
                  className="flex size-6 items-center justify-center rounded-full text-[9px] font-black"
                  style={{ background: "var(--border)", color: "var(--fg)" }}
                >
                  U
                </span>
              </div>
            )}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
